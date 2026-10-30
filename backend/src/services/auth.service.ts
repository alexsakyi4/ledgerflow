import { db } from "../config/db";
import { env } from "../config/env";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { JWTPayload } from "../types";

const ACCESS_SECRET = env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = env.JWT_REFRESH_SECRET;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export class AuthService {
  static async register(data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }) {
    const existing = await db.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new Error("Email already registered");
    }

    const passwordHash = await argon2.hash(data.password);
    const user = await db.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
      },
    });
    return user;
  }

  static async login(data: {
    email: string;
    password: string;
    userAgent?: string;
    ipAddress?: string;
  }) {
    const user = await db.user.findUnique({ where: { email: data.email } });
    if (!user || !user.passwordHash) {
      throw new Error("Invalid credentials");
    }
    if (user.status !== "ACTIVE") {
      throw new Error("Account is not active");
    }

    const valid = await argon2.verify(user.passwordHash, data.password);
    if (!valid) {
      throw new Error("Invalid credentials");
    }

    return this.createSession(user, data.userAgent, data.ipAddress);
  }

  static async refreshToken(refreshToken: string, userAgent?: string, ipAddress?: string) {
    let payload: JWTPayload;
    try {
      payload = jwt.verify(refreshToken, REFRESH_SECRET) as JWTPayload;
    } catch {
      throw new Error("Invalid or expired refresh token");
    }

    if (payload.type !== "refresh") {
      throw new Error("Invalid token type");
    }

    const session = await db.session.findUnique({ where: { refreshToken } });
    if (!session || session.expiresAt < new Date()) {
      await db.session.delete({ where: { refreshToken } }).catch(() => {});
      throw new Error("Session not found or expired");
    }

    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== "ACTIVE") {
      throw new Error("User not found or inactive");
    }

    // Rotate refresh token
    await db.session.delete({ where: { refreshToken } });

    return this.createSession(user, userAgent, ipAddress);
  }

  static async logout(refreshToken: string) {
    await db.session.delete({ where: { refreshToken } }).catch(() => {});
  }

  static async logoutAllSessions(userId: string) {
    await db.session.deleteMany({ where: { userId } });
  }

  static async getMemberContext(
    userId: string,
    companyId?: string
  ): Promise<{
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      avatarUrl: string | null;
    };
    membership: {
      id: string;
      companyId: string;
      companyName: string;
      companyCurrency: string;
      role: string;
    } | null;
  }> {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: { company: true },
          where: { isActive: true },
        },
      },
    });
    if (!user) throw new Error("User not found");

    const membershipRecord = companyId
      ? user.memberships.find((m) => m.companyId === companyId)
      : user.memberships[0];

    if (companyId && !membershipRecord) {
      throw new Error("Not a member of this company");
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
      },
      membership: membershipRecord
        ? {
            id: membershipRecord.id,
            companyId: membershipRecord.companyId,
            companyName: membershipRecord.company.name,
            companyCurrency: membershipRecord.company.currency,
            role: membershipRecord.role,
          }
        : null,
    };
  }

  private static async createSession(
    user: { id: string; email: string },
    userAgent?: string,
    ipAddress?: string
  ): Promise<TokenPair> {
    const accessPayload: JWTPayload = {
      sub: user.id,
      email: user.email,
      type: "access",
    };
    const refreshPayload: JWTPayload = {
      sub: user.id,
      email: user.email,
      type: "refresh",
    };

    const accessToken = jwt.sign(accessPayload, ACCESS_SECRET as string, {
      expiresIn: env.JWT_ACCESS_EXPIRY as any,
    });
    const refreshToken = jwt.sign(refreshPayload, REFRESH_SECRET as string, {
      expiresIn: env.JWT_REFRESH_EXPIRY as any,
    });

    const accessExpiresAt = new Date(Date.now() + this.parseMs(env.JWT_ACCESS_EXPIRY));
    const refreshExpiresAt = new Date(Date.now() + this.parseMs(env.JWT_REFRESH_EXPIRY));

    await db.session.create({
      data: {
        userId: user.id,
        refreshToken,
        userAgent,
        ipAddress,
        expiresAt: refreshExpiresAt,
      },
    });

    return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
  }

  private static parseMs(expiry: string): number {
    const match = /^(\d+)([smhd])$/.exec(expiry);
    if (!match) return 15 * 60 * 1000;
    const val = Number(match[1]);
    const unit = match[2];
    const mult = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[unit] ?? 0;
    return val * mult;
  }
}
