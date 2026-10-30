import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { db } from "../config/db";
import type { AuthRequest, JWTPayload } from "../types";
import { hasAnyRole } from "../utils/rbac";

export const ACCESS_TOKEN_NAME = "access_token";
export const REFRESH_TOKEN_NAME = "refresh_token";

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies[ACCESS_TOKEN_NAME] || req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ success: false, error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JWTPayload;
    if (payload.type !== "access") {
      return res.status(401).json({ success: false, error: "Invalid token type" });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      companyId: payload.companyId,
      role: payload.role,
    };
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Token expired or invalid" });
  }
}

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies[ACCESS_TOKEN_NAME] || req.headers.authorization?.replace("Bearer ", "");
  if (!token) return next();

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JWTPayload;
    if (payload.type === "access") {
      req.user = {
        id: payload.sub,
        email: payload.email,
        companyId: payload.companyId,
        role: payload.role,
      };
    }
  } catch {
    // ignore — optional
  }
  next();
}

export async function requireCompany(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: "Authentication required" });
  }

  const companyId =
    req.params.companyId ||
    (typeof req.query.companyId === "string" ? req.query.companyId : undefined) ||
    req.body?.companyId;
  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ success: false, error: "companyId is required" });
  }

  try {
    const membership = await db.companyMember.findUnique({
      where: { userId_companyId: { userId: req.user.id, companyId } },
      include: { company: true },
    });

    if (!membership || !membership.isActive || !membership.company.isActive) {
      return res.status(403).json({ success: false, error: "Not a member of this company" });
    }

    req.user.companyId = membership.companyId;
    req.user.role = membership.role;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    if (!hasAnyRole(req.user.role, allowedRoles)) {
      return res.status(403).json({ success: false, error: "Insufficient permissions" });
    }
    next();
  };
}
