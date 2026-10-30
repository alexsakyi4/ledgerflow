import { CompanyMemberRole } from "@prisma/client";
import { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../middleware/error";
import type { AuthRequest } from "../types";
import { CompanyService } from "../services/company.service";

const companySchema = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(160).nullable().optional(),
  legalEntityType: z.string().trim().max(80).nullable().optional(),
  fiscalYearStart: z.number().int().min(1).max(12).default(1),
  currency: z.string().regex(/^[A-Za-z]{3}$/).default("USD"),
  taxId: z.string().trim().max(80).nullable().optional(),
  taxSettings: z.record(z.unknown()).nullable().optional(),
  logoUrl: z.string().trim().max(2048).nullable().optional(),
  address: z.record(z.unknown()).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  website: z.string().trim().max(2048).nullable().optional(),
});

const memberCreateSchema = z.object({
  email: z.string().trim().email(),
  role: z.nativeEnum(CompanyMemberRole).default(CompanyMemberRole.BOOKKEEPER),
});
const memberRoleSchema = z.object({ role: z.nativeEnum(CompanyMemberRole) });

function validated<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(result.error.issues.map((issue) => issue.message).join("; "), 400);
  return result.data;
}

function actor(req: AuthRequest) {
  if (!req.user) throw new AppError("Authentication required", 401);
  return req.user;
}
function companyId(req: Request) {
  return req.params.companyId;
}
function requestMeta(req: Request) {
  return { ip: req.ip, userAgent: req.get("User-Agent") };
}

export async function listCompanies(req: AuthRequest, res: Response) {
  const current = actor(req);
  const companies = await CompanyService.listForUser(current.id);
  res.json({ success: true, data: companies });
}

export async function createCompany(req: AuthRequest, res: Response) {
  const current = actor(req);
  const input = validated(companySchema, req.body);
  const company = await CompanyService.create(current.id, input, requestMeta(req));
  res.status(201).json({ success: true, data: company });
}

export async function getCompany(req: Request, res: Response) {
  const company = await CompanyService.getForMember(companyId(req));
  res.json({ success: true, data: company });
}

export async function updateCompany(req: AuthRequest, res: Response) {
  const current = actor(req);
  const input = validated(companySchema.partial(), req.body);
  const company = await CompanyService.update(companyId(req), current.id, input, requestMeta(req));
  res.json({ success: true, data: company });
}

export async function listMembers(req: Request, res: Response) {
  const members = await CompanyService.listMembers(companyId(req));
  res.json({ success: true, data: members });
}

export async function addMember(req: AuthRequest, res: Response) {
  const current = actor(req);
  const input = validated(memberCreateSchema, req.body);
  if (input.role === CompanyMemberRole.OWNER && current.role !== CompanyMemberRole.OWNER) {
    throw new AppError("Only an owner can assign the Owner role", 403);
  }
  const member = await CompanyService.addMember(companyId(req), current.id, input.email, input.role, requestMeta(req));
  res.status(201).json({ success: true, data: member });
}

export async function updateMemberRole(req: AuthRequest, res: Response) {
  const current = actor(req);
  const { role } = validated(memberRoleSchema, req.body);
  if (role === CompanyMemberRole.OWNER && current.role !== CompanyMemberRole.OWNER) {
    throw new AppError("Only an owner can assign the Owner role", 403);
  }
  const member = await CompanyService.changeMemberRole(companyId(req), req.params.membershipId, current.id, current.role as CompanyMemberRole, role, requestMeta(req));
  res.json({ success: true, data: member });
}

export async function removeMember(req: AuthRequest, res: Response) {
  const current = actor(req);
  const member = await CompanyService.deactivateMember(companyId(req), req.params.membershipId, current.id, current.role as CompanyMemberRole, requestMeta(req));
  res.json({ success: true, data: member });
}
