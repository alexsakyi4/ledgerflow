import { ContactType, ProductKind } from "@prisma/client";
import { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../middleware/error";
import type { AuthRequest } from "../types";
import { ContactService } from "../services/contact.service";
import { ProductService } from "../services/product.service";

const contactSchema = z.object({
  type: z.nativeEnum(ContactType), displayName: z.string().trim().min(1).max(160),
  companyName: z.string().trim().max(160).nullable().optional(), email: z.string().email().nullable().optional(), phone: z.string().max(40).nullable().optional(),
  billingAddress: z.record(z.unknown()).nullable().optional(), shippingAddress: z.record(z.unknown()).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(), taxId: z.string().max(80).nullable().optional(), currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
});
const productSchema = z.object({
  kind: z.nativeEnum(ProductKind), name: z.string().trim().min(1).max(160), sku: z.string().max(80).nullable().optional(), description: z.string().max(1000).nullable().optional(),
  salePrice: z.union([z.number().finite(), z.string().regex(/^\d{1,15}(\.\d{1,4})?$/)]),
  purchaseCost: z.union([z.number().finite(), z.string().regex(/^\d{1,15}(\.\d{1,4})?$/)]), incomeAccountId: z.string().min(1), expenseAccountId: z.string().nullable().optional(), taxRateId: z.string().nullable().optional(),
  inventoryTracking: z.boolean().optional(), quantityOnHand: z.union([z.number().finite(), z.string().regex(/^\d{1,15}(\.\d{1,4})?$/)]).optional(),
  averageCost: z.union([z.number().finite(), z.string().regex(/^\d{1,15}(\.\d{1,4})?$/)]).optional(), reorderLevel: z.union([z.number().finite(), z.string().regex(/^\d{1,15}(\.\d{1,4})?$/)]).optional(),
});
const adjustmentSchema = z.object({ quantityDelta: z.union([z.number().finite(), z.string()]), unitCost: z.union([z.number().finite(), z.string()]), reason: z.string().trim().min(1).max(300) });
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> { const result = schema.safeParse(value); if (!result.success) throw new AppError(result.error.issues.map((issue) => issue.message).join("; "), 400); return result.data; }
function companyId(req: AuthRequest) { if (!req.user?.companyId) throw new AppError("Company context required", 400); return req.user.companyId; }
function actor(req: AuthRequest) { if (!req.user) throw new AppError("Authentication required", 401); return req.user; }
function meta(req: Request) { return { ip: req.ip, userAgent: req.get("User-Agent") }; }

export async function listContacts(req: AuthRequest, res: Response) {
  const type = req.query.type ? parse(z.nativeEnum(ContactType), req.query.type) : undefined;
  const list = await ContactService.list(companyId(req), { type, search: typeof req.query.search === "string" ? req.query.search.trim() : undefined, archived: req.query.includeArchived === "true" });
  res.json({ success: true, data: list });
}
export async function getContact(req: AuthRequest, res: Response) { res.json({ success: true, data: await ContactService.get(companyId(req), req.params.contactId) }); }
export async function createContact(req: AuthRequest, res: Response) { const user = actor(req); const contact = await ContactService.create(companyId(req), user.id, parse(contactSchema, req.body), meta(req)); res.status(201).json({ success: true, data: contact }); }
export async function updateContact(req: AuthRequest, res: Response) { const user = actor(req); const contact = await ContactService.update(companyId(req), user.id, req.params.contactId, parse(contactSchema.partial(), req.body), meta(req)); res.json({ success: true, data: contact }); }
export async function archiveContact(req: AuthRequest, res: Response) { const user = actor(req); res.json({ success: true, data: await ContactService.archive(companyId(req), user.id, req.params.contactId, meta(req)) }); }
export async function mergeContact(req: AuthRequest, res: Response) { const user = actor(req); const targetId = parse(z.string().min(1), req.body.targetId); res.json({ success: true, data: await ContactService.merge(companyId(req), user.id, req.params.contactId, targetId) }); }

export async function listProducts(req: AuthRequest, res: Response) { const list = await ProductService.list(companyId(req), typeof req.query.search === "string" ? req.query.search : undefined, req.query.includeInactive === "true"); res.json({ success: true, data: list }); }
export async function createProduct(req: AuthRequest, res: Response) { const user = actor(req); const product = await ProductService.create(companyId(req), user.id, parse(productSchema, req.body)); res.status(201).json({ success: true, data: product }); }
export async function updateProduct(req: AuthRequest, res: Response) { const user = actor(req); const product = await ProductService.update(companyId(req), user.id, req.params.productId, parse(productSchema.partial(), req.body)); res.json({ success: true, data: product }); }
export async function archiveProduct(req: AuthRequest, res: Response) { const user = actor(req); res.json({ success: true, data: await ProductService.archive(companyId(req), user.id, req.params.productId) }); }
export async function adjustStock(req: AuthRequest, res: Response) { const user = actor(req); const input = parse(adjustmentSchema, req.body); const product = await ProductService.adjustStock(companyId(req), user.id, req.params.productId, input.quantityDelta, input.unitCost, input.reason); res.json({ success: true, data: product }); }
