import { NextFunction, Response } from "express";
import type { AuthRequest } from "../types";

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(
  err: Error | AppError,
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  let statusCode = 500;
  let message = "Internal server error";

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err.message === "Invalid credentials" || err.message === "Email already registered") {
    statusCode = 400;
    message = err.message;
  } else if (err.name === "ValidationError") {
    statusCode = 400;
    message = err.message;
  } else if ("code" in err && typeof (err as any).code === "string") {
    const code = (err as any).code as string;
    if (code === "P2002") {
      statusCode = 409;
      message = "A record with this value already exists";
    } else if (code === "P2034") {
      statusCode = 409;
      message = "Another transaction changed this data at the same time. Please review and retry.";
    } else if (code === "P2025") {
      statusCode = 404;
      message = "Record not found";
    } else {
      statusCode = 400;
      message = "The requested data could not be saved";
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
}
