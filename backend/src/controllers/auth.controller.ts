import { Request, Response } from "express";
import { body } from "express-validator";
import { AuthService } from "../services/auth.service";
import { db } from "../config/db";
import { errorHandler } from "../middleware/error";
import type { AuthRequest } from "../types";

export const registerValidation = [
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min: 8 }),
  body("firstName").optional().trim(),
  body("lastName").optional().trim(),
];

export const loginValidation = [
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty(),
];

export async function register(req: Request, res: Response) {
  const { email, password, firstName, lastName } = req.body;
  try {
    const user = await AuthService.register({ email, password, firstName, lastName });
    res.status(201).json({
      success: true,
      data: { id: user.id, email: user.email },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  try {
    const { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt } =
      await AuthService.login({
        email,
        password,
        userAgent: req.get("User-Agent"),
        ipAddress: req.ip,
      });

    setAuthCookies(res, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt);

    res.json({
      success: true,
      data: {
        accessToken,
        accessExpiresAt,
      },
    });
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message });
  }
}

export async function refresh(req: Request, res: Response) {
  const refreshToken = req.cookies.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ success: false, error: "Refresh token required" });
  }

  try {
    const { accessToken, refreshToken: newRefreshToken, accessExpiresAt, refreshExpiresAt } =
      await AuthService.refreshToken(refreshToken, req.get("User-Agent"), req.ip);

    setAuthCookies(res, accessToken, newRefreshToken, accessExpiresAt, refreshExpiresAt);

    res.json({
      success: true,
      data: { accessToken, accessExpiresAt },
    });
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message });
  }
}

export async function logout(req: Request, res: Response) {
  const refreshToken = req.cookies.refresh_token;
  if (refreshToken) {
    await db.session.deleteMany({ where: { refreshToken } });
  }

  res.clearCookie("access_token");
  res.clearCookie("refresh_token");
  res.json({ success: true, data: { message: "Logged out" } });
}

export async function me(req: AuthRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }
  res.json({ success: true, data: { user: req.user } });
}

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  accessExpiresAt: Date,
  refreshExpiresAt: Date
) {
  const isSecure = process.env.SESSION_COOKIE_SECURE === "true";
  const sameSite: "lax" | "strict" | "none" =
    (process.env.SESSION_COOKIE_SAME_SITE as any) || "lax";

  res.cookie("access_token", accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite,
    path: "/",
    expires: accessExpiresAt,
  });

  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite,
    path: "/",
    expires: refreshExpiresAt,
  });
}
