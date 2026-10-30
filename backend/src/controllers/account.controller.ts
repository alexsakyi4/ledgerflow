import { AccountType } from "@prisma/client";
import { Request, Response } from "express";
import { z } from "zod";
import { AccountService, AccountInput } from "../services/account.service";
import { AppError } from "../middleware/error";
import type { AuthRequest } from "../types";

const balanceSchema = z.union([
  z.number().finite().refine((value) => Math.abs(value) < 1_000_000_000_000_000),
  z.string().regex(/^-?\d{1,15}(\.\d{1,4})?$/),
]);
const accountSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  type: z.nativeEnum(AccountType),
  description: z.string().trim().max(1000).nullable().optional(),
  parentId: z.string().nullable().optional(),
  openingBalance: balanceSchema.optional(),
  openingBalanceDate: z.string().datetime().nullable().optional(),
});

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(result.error.issues.map((issue) => issue.message).join("; "), 400);
  return result.data;
}
function companyId(req: AuthRequest) {
  if (!req.user?.companyId) throw new AppError("Company context required", 400);
  return req.user.companyId;
}
function actor(req: AuthRequest) {
  if (!req.user) throw new AppError("Authentication required", 401);
  return req.user;
}
function requestMeta(req: Request) {
  return { ip: req.ip, userAgent: req.get("User-Agent") };
}

export async function listAccounts(req: AuthRequest, res: Response) {
  const type = req.query.type ? parse(z.nativeEnum(AccountType), req.query.type) : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const includeInactive = req.query.includeInactive === "true";
  const accounts = await AccountService.list(companyId(req), { type, search, includeInactive });
  res.json({ success: true, data: accounts });
}

export async function getAccount(req: AuthRequest, res: Response) {
  const account = await AccountService.get(companyId(req), req.params.accountId);
  res.json({ success: true, data: account });
}

export async function createAccount(req: AuthRequest, res: Response) {
  const user = actor(req);
  const input: AccountInput = parse(accountSchema, req.body);
  const account = await AccountService.create(companyId(req), user.id, input, requestMeta(req));
  res.status(201).json({ success: true, data: account });
}

export async function updateAccount(req: AuthRequest, res: Response) {
  const user = actor(req);
  const input = parse(accountSchema.partial(), req.body);
  if (!Object.keys(input).length) throw new AppError("Provide at least one field to update", 400);
  const account = await AccountService.update(companyId(req), user.id, req.params.accountId, input, requestMeta(req));
  res.json({ success: true, data: account });
}

export async function archiveAccount(req: AuthRequest, res: Response) {
  const user = actor(req);
  const account = await AccountService.archive(companyId(req), user.id, req.params.accountId, requestMeta(req));
  res.json({ success: true, data: account });
}
