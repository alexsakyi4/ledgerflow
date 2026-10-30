import { DocumentType } from "@prisma/client";
import { Request, Response } from "express";
import { z } from "zod";
import { DocumentService } from "../services/document.service";
import { AppError } from "../middleware/error";
import type { AuthRequest } from "../types";

const names: Record<string, DocumentType> = {
  invoices: DocumentType.INVOICE, estimates: DocumentType.ESTIMATE, "sales-receipts": DocumentType.SALES_RECEIPT,
  bills: DocumentType.BILL, expenses: DocumentType.EXPENSE, "purchase-orders": DocumentType.PURCHASE_ORDER,
  "credit-memos": DocumentType.CREDIT_MEMO, "vendor-credits": DocumentType.VENDOR_CREDIT,
  payments: DocumentType.CUSTOMER_PAYMENT, "vendor-payments": DocumentType.VENDOR_PAYMENT,
};
const lineSchema = z.object({ productId: z.string().nullable().optional(), accountId: z.string().nullable().optional(), description: z.string().max(500).optional(), quantity: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d{1,4})?$/)]), unitPrice: z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,4})?$/)]), discount: z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,4})?$/)]).optional(), taxRateId: z.string().nullable().optional() });
const documentSchema = z.object({ contactId: z.string().nullable().optional(), issueDate: z.string().datetime().optional(), dueDate: z.string().datetime().nullable().optional(), termsDays: z.number().int().min(0).max(365).optional(), currency: z.string().regex(/^[A-Za-z]{3}$/).optional(), reference: z.string().max(120).nullable().optional(), memo: z.string().max(2000).nullable().optional(), taxInclusive: z.boolean().optional(), bankAccountId: z.string().optional(), lines: z.array(lineSchema).default([]), paymentAllocations: z.array(z.object({ documentId: z.string(), amount: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d{1,4})?$/)]) })).optional() });
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> { const result = schema.safeParse(value); if (!result.success) throw new AppError(result.error.issues.map((issue) => issue.message).join("; "), 400); return result.data; }
function context(req: AuthRequest) { if (!req.user?.companyId || !req.user.id) throw new AppError("Authentication and company context required", 401); return { companyId: req.user.companyId, userId: req.user.id }; }
function type(req: Request) { const result = names[req.params.resource]; if (!result) throw new AppError("Unknown transaction type", 404); return result; }
function dateParam(value: unknown) { if (typeof value !== "string" || !value) return undefined; const date = new Date(value); if (Number.isNaN(date.getTime())) throw new AppError("Invalid report date", 400); return date; }

export async function listDocuments(req: AuthRequest, res: Response) { const { companyId } = context(req); const list = await DocumentService.list(companyId, type(req), typeof req.query.search === "string" ? req.query.search : undefined, dateParam(req.query.from), dateParam(req.query.to)); res.json({ success: true, data: list }); }
export async function createDocument(req: AuthRequest, res: Response) { const { companyId, userId } = context(req); const input = parse(documentSchema, req.body); const doc = await DocumentService.create(companyId, userId, { ...input, type: type(req) }); res.status(201).json({ success: true, data: doc }); }
export async function getDocument(req: AuthRequest, res: Response) { const { companyId } = context(req); const doc = await DocumentService.get(companyId, req.params.documentId); if (doc.type !== type(req)) throw new AppError("Transaction not found", 404); res.json({ success: true, data: doc }); }
export async function issueDocument(req: AuthRequest, res: Response) { const { companyId, userId } = context(req); const doc = await DocumentService.get(companyId, req.params.documentId); const expected = type(req); if (doc.type !== expected) throw new AppError("Transaction not found", 404); const result = await DocumentService.post(companyId, userId, doc.id, req.body?.bankAccountId); res.json({ success: true, data: result }); }
export async function convertEstimate(req: AuthRequest, res: Response) { const { companyId, userId } = context(req); res.status(201).json({ success: true, data: await DocumentService.convertEstimate(companyId, userId, req.params.documentId) }); }
export async function convertPurchaseOrder(req: AuthRequest, res: Response) { const { companyId, userId } = context(req); res.status(201).json({ success: true, data: await DocumentService.convertPurchaseOrder(companyId, userId, req.params.documentId) }); }
export async function voidDocument(req: AuthRequest, res: Response) { const { companyId, userId } = context(req); res.json({ success: true, data: await DocumentService.void(companyId, userId, req.params.documentId) }); }
