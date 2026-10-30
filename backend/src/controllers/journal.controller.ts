import { Response } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { JournalService } from "../services/journal.service";
import { AppError } from "../middleware/error";
import type { AuthRequest } from "../types";

const schema = z.object({ date: z.string().datetime(), reference: z.string().max(120).nullable().optional(), memo: z.string().max(2000).nullable().optional(), lines: z.array(z.object({ accountId: z.string(), description: z.string().max(500).optional(), debit: z.union([z.string(), z.number()]).optional(), credit: z.union([z.string(), z.number()]).optional() })).min(2) });
function ctx(req: AuthRequest) { if (!req.user?.companyId || !req.user.id) throw new AppError("Company context required", 401); return { companyId: req.user.companyId, userId: req.user.id }; }
function parseDate(value: unknown) { if (typeof value !== "string") return undefined; const date = new Date(value); if (Number.isNaN(date.getTime())) throw new AppError("Invalid date", 400); return date; }
export async function list(req: AuthRequest, res: Response) { const { companyId } = ctx(req); res.json({ success: true, data: await JournalService.list(companyId, parseDate(req.query.from), parseDate(req.query.to)) }); }
export async function create(req: AuthRequest, res: Response) { const { companyId, userId } = ctx(req); const result = schema.safeParse(req.body); if (!result.success) throw new AppError(result.error.issues.map((i) => i.message).join("; "), 400); const entry = await JournalService.create(companyId, userId, { ...result.data, date: new Date(result.data.date) }); res.status(201).json({ success: true, data: entry }); }
export async function get(req: AuthRequest, res: Response) { const { companyId } = ctx(req); const entry = await db.journalEntry.findFirst({ where: { id: req.params.entryId, companyId }, include: { lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } }, createdBy: { select: { id: true, email: true } } } }); if (!entry) throw new AppError("Journal entry not found", 404); res.json({ success: true, data: entry }); }
