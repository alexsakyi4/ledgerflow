import { Response } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { AppError } from "../middleware/error";
import type { AuthRequest } from "../types";

function ctx(req: AuthRequest) {
  if (!req.user?.companyId || !req.user.id) throw new AppError("Company context required", 401);
  return { companyId: req.user.companyId, userId: req.user.id };
}

export async function list(req: AuthRequest, res: Response) {
  const { companyId } = ctx(req);
  res.json({ success: true, data: await db.closedPeriod.findMany({ where: { companyId }, orderBy: { startDate: "desc" } }) });
}

export async function close(req: AuthRequest, res: Response) {
  const { companyId, userId } = ctx(req);
  const input = z.object({ startDate: z.string().datetime(), endDate: z.string().datetime(), note: z.string().max(500).optional() }).safeParse(req.body);
  if (!input.success) throw new AppError(input.error.issues.map((issue) => issue.message).join("; "), 400);
  const startDate = new Date(input.data.startDate);
  const endDate = new Date(input.data.endDate);
  if (startDate > endDate) throw new AppError("Start date must be before end date", 400);

  const period = await db.$transaction(async (tx) => {
    // Use the same company lock as journal posting so a close cannot race a post.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
    const overlap = await tx.closedPeriod.findFirst({ where: { companyId, startDate: { lte: endDate }, endDate: { gte: startDate } } });
    if (overlap) throw new AppError("This date range overlaps an already closed period", 409);
    return tx.closedPeriod.create({ data: { companyId, startDate, endDate, lockedByUserId: userId, note: input.data.note } });
  }, { isolationLevel: "Serializable" });

  res.status(201).json({ success: true, data: period });
}

export async function reopen(req: AuthRequest, res: Response) {
  const { companyId } = ctx(req);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
    const period = await tx.closedPeriod.findFirst({ where: { id: req.params.periodId, companyId } });
    if (!period) throw new AppError("Closed period not found", 404);
    await tx.closedPeriod.delete({ where: { id: period.id } });
  }, { isolationLevel: "Serializable" });
  res.json({ success: true, data: { reopened: true } });
}
