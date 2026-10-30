import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { AppError } from "../middleware/error";
import type { AuthRequest } from "../types";

const schema = z.object({
  baseCurrency: z.string().trim().length(3).transform((x) => x.toUpperCase()),
  quoteCurrency: z.string().trim().length(3).transform((x) => x.toUpperCase()),
  rateDate: z.string().datetime().or(z.string().date()),
  rate: z.number().positive().max(1_000_000_000),
  source: z.string().trim().max(80).optional(),
});
function context(req: AuthRequest) {
  if (!req.user?.companyId || !req.user.id) throw new AppError("Company context required", 401);
  return { companyId: req.user.companyId, userId: req.user.id };
}
function parse(value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(result.error.issues.map((issue) => issue.message).join("; "), 400);
  if (result.data.baseCurrency === result.data.quoteCurrency) throw new AppError("Currencies must be different", 400);
  const date = new Date(result.data.rateDate);
  if (Number.isNaN(date.getTime())) throw new AppError("Invalid exchange-rate date", 400);
  return { ...result.data, rateDate: date };
}
export async function list(req: AuthRequest, res: Response) {
  const { companyId } = context(req);
  const where: any = { companyId };
  if (typeof req.query.baseCurrency === "string") where.baseCurrency = req.query.baseCurrency.toUpperCase();
  if (typeof req.query.quoteCurrency === "string") where.quoteCurrency = req.query.quoteCurrency.toUpperCase();
  res.json({ success: true, data: await db.currencyRate.findMany({ where, orderBy: [{ rateDate: "desc" }, { baseCurrency: "asc" }] }) });
}
export async function upsert(req: AuthRequest, res: Response) {
  const { companyId, userId } = context(req);
  const input = parse(req.body);
  const rate = await db.currencyRate.upsert({
    where: { companyId_baseCurrency_quoteCurrency_rateDate: { companyId, baseCurrency: input.baseCurrency, quoteCurrency: input.quoteCurrency, rateDate: input.rateDate } },
    create: { companyId, ...input },
    update: { rate: input.rate, source: input.source },
  });
  await db.auditLog.create({ data: { companyId, userId, action: "CREATE", entity: "CurrencyRate", entityId: rate.id, newValues: { baseCurrency: rate.baseCurrency, quoteCurrency: rate.quoteCurrency, rate: rate.rate.toString(), rateDate: rate.rateDate.toISOString() } } });
  res.status(201).json({ success: true, data: rate });
}
export async function remove(req: AuthRequest, res: Response) {
  const { companyId, userId } = context(req);
  const before = await db.currencyRate.findFirst({ where: { id: req.params.rateId, companyId } });
  if (!before) throw new AppError("Exchange rate not found", 404);
  await db.currencyRate.delete({ where: { id: before.id } });
  await db.auditLog.create({ data: { companyId, userId, action: "DELETE", entity: "CurrencyRate", entityId: before.id, oldValues: { baseCurrency: before.baseCurrency, quoteCurrency: before.quoteCurrency, rate: before.rate.toString() } } });
  res.json({ success: true, data: { deleted: true } });
}
