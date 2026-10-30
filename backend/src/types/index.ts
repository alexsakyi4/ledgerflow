import { Request } from "express";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    companyId?: string;
    role?: string;
  };
}

export type JWTPayload = {
  sub: string;
  email: string;
  companyId?: string;
  role?: string;
  type: "access" | "refresh";
};

export type ServiceResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
};
