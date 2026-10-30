import { AuditAction, CompanyMemberRole, Prisma } from "@prisma/client";
import { db } from "../config/db";
import { DEFAULT_ACCOUNTS } from "../data/defaultAccounts";
import { AppError } from "../middleware/error";

export type CompanyInput = {
  name: string;
  legalName?: string | null;
  legalEntityType?: string | null;
  fiscalYearStart: number;
  currency: string;
  taxId?: string | null;
  taxSettings?: Record<string, unknown> | null;
  logoUrl?: string | null;
  address?: Record<string, unknown> | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
};

const companySelection = {
  id: true,
  name: true,
  legalName: true,
  legalEntityType: true,
  fiscalYearStart: true,
  currency: true,
  taxId: true,
  taxSettings: true,
  logoUrl: true,
  address: true,
  phone: true,
  email: true,
  website: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

export class CompanyService {
  static async listForUser(userId: string) {
    const rows = await db.companyMember.findMany({
      where: { userId, isActive: true, company: { isActive: true } },
      include: {
        company: { select: { ...companySelection, _count: { select: { members: true, chartOfAccounts: true } } } },
      },
      orderBy: { company: { name: "asc" } },
    });
    return rows.map(({ company, ...membership }) => ({
      ...company,
      membershipId: membership.id,
      role: membership.role,
      memberCount: company._count.members,
      accountCount: company._count.chartOfAccounts,
    }));
  }

  static async create(userId: string, input: CompanyInput, request?: { ip?: string; userAgent?: string }) {
    return db.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: input.name.trim(),
          legalName: input.legalName || null,
          legalEntityType: input.legalEntityType || null,
          fiscalYearStart: input.fiscalYearStart,
          currency: input.currency.toUpperCase(),
          taxId: input.taxId || null,
          taxSettings: input.taxSettings === undefined ? Prisma.JsonNull : (input.taxSettings as Prisma.InputJsonValue),
          logoUrl: input.logoUrl || null,
          address: input.address === undefined ? Prisma.JsonNull : (input.address as Prisma.InputJsonValue),
          phone: input.phone || null,
          email: input.email?.toLowerCase() || null,
          website: input.website || null,
        },
        select: companySelection,
      });

      await tx.companyMember.create({
        data: { companyId: company.id, userId, role: CompanyMemberRole.OWNER },
      });
      await tx.account.createMany({
        data: DEFAULT_ACCOUNTS.map((account) => ({
          companyId: company.id,
          code: account.code,
          name: account.name,
          type: account.type,
          currency: company.currency,
          openingBalance: 0,
          isSystem: true,
        })),
      });
      await tx.auditLog.create({
        data: {
          companyId: company.id,
          userId,
          action: AuditAction.CREATE,
          entity: "Company",
          entityId: company.id,
          newValues: { name: company.name, currency: company.currency },
          ipAddress: request?.ip,
          userAgent: request?.userAgent,
        },
      });
      return { ...company, role: CompanyMemberRole.OWNER };
    });
  }

  static async getForMember(companyId: string) {
    const company = await db.company.findFirst({
      where: { id: companyId, isActive: true },
      select: companySelection,
    });
    if (!company) throw new AppError("Company not found", 404);
    return company;
  }

  static async update(companyId: string, userId: string, input: Partial<CompanyInput>, request?: { ip?: string; userAgent?: string }) {
    const before = await this.getForMember(companyId);
    const data: Prisma.CompanyUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.legalName !== undefined) data.legalName = input.legalName;
    if (input.legalEntityType !== undefined) data.legalEntityType = input.legalEntityType;
    if (input.fiscalYearStart !== undefined) data.fiscalYearStart = input.fiscalYearStart;
    if (input.currency !== undefined) data.currency = input.currency.toUpperCase();
    if (input.taxId !== undefined) data.taxId = input.taxId;
    if (input.taxSettings !== undefined) data.taxSettings = input.taxSettings === null ? Prisma.JsonNull : (input.taxSettings as Prisma.InputJsonValue);
    if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl;
    if (input.address !== undefined) data.address = input.address === null ? Prisma.JsonNull : (input.address as Prisma.InputJsonValue);
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.email !== undefined) data.email = input.email?.toLowerCase() || null;
    if (input.website !== undefined) data.website = input.website;

    return db.$transaction(async (tx) => {
      if (input.currency && input.currency.toUpperCase() !== before.currency) {
        const [journals, documents, bankTransactions, accountBalances, contactBalances, products, bankAccounts, rates] = await Promise.all([
          tx.journalEntry.count({ where: { companyId } }),
          tx.businessDocument.count({ where: { companyId } }),
          tx.bankTransaction.count({ where: { companyId } }),
          tx.account.count({ where: { companyId, openingBalance: { not: 0 } } }),
          tx.contact.count({ where: { companyId, openingBalance: { not: 0 } } }),
          tx.productService.count({ where: { companyId } }),
          tx.bankAccount.count({ where: { companyId } }),
          tx.currencyRate.count({ where: { companyId } }),
        ]);
        if (journals + documents + bankTransactions + accountBalances + contactBalances + products + bankAccounts + rates > 0) throw new AppError("Home currency cannot be changed after financial activity or opening balances have been recorded", 409);
        await tx.account.updateMany({ where: { companyId, currency: before.currency }, data: { currency: input.currency.toUpperCase() } });
      }
      const company = await tx.company.update({ where: { id: companyId }, data, select: companySelection });
      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: AuditAction.UPDATE,
          entity: "Company",
          entityId: companyId,
          oldValues: before as unknown as Prisma.InputJsonValue,
          newValues: company as unknown as Prisma.InputJsonValue,
          ipAddress: request?.ip,
          userAgent: request?.userAgent,
        },
      });
      return company;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  static async listMembers(companyId: string) {
    return db.companyMember.findMany({
      where: { companyId, isActive: true },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } } },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
  }

  static async addMember(companyId: string, actingUserId: string, email: string, role: Exclude<CompanyMemberRole, "OWNER"> | "OWNER", request?: { ip?: string; userAgent?: string }) {
    const target = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!target) throw new AppError("No registered user found with that email", 404);
    const existing = await db.companyMember.findUnique({ where: { userId_companyId: { userId: target.id, companyId } } });
    if (existing?.isActive) throw new AppError("This user is already an active company member", 409);

    return db.$transaction(async (tx) => {
      const member = existing
        ? await tx.companyMember.update({ where: { id: existing.id }, data: { role, isActive: true, joinedAt: new Date() } })
        : await tx.companyMember.create({ data: { companyId, userId: target.id, role } });
      await tx.auditLog.create({
        data: {
          companyId,
          userId: actingUserId,
          action: AuditAction.CREATE,
          entity: "CompanyMember",
          entityId: member.id,
          newValues: { email: target.email, role },
          ipAddress: request?.ip,
          userAgent: request?.userAgent,
        },
      });
      return { ...member, user: { id: target.id, email: target.email, firstName: target.firstName, lastName: target.lastName } };
    });
  }

  static async changeMemberRole(
    companyId: string,
    membershipId: string,
    actingUserId: string,
    actingRole: CompanyMemberRole,
    role: CompanyMemberRole,
    request?: { ip?: string; userAgent?: string }
  ) {
    return db.$transaction(async (tx) => {
      const existing = await tx.companyMember.findFirst({ where: { id: membershipId, companyId, isActive: true } });
      if (!existing) throw new AppError("Company member not found", 404);
      if (existing.role === CompanyMemberRole.OWNER && actingRole !== CompanyMemberRole.OWNER) {
        throw new AppError("Only an owner can change another owner's role", 403);
      }
      if (existing.role === CompanyMemberRole.OWNER && role !== CompanyMemberRole.OWNER) {
        const owners = await tx.companyMember.count({ where: { companyId, role: CompanyMemberRole.OWNER, isActive: true } });
        if (owners <= 1) throw new AppError("A company must have at least one active owner", 409);
      }
      const member = await tx.companyMember.update({ where: { id: membershipId }, data: { role } });
      await tx.auditLog.create({
        data: { companyId, userId: actingUserId, action: AuditAction.UPDATE, entity: "CompanyMember", entityId: member.id,
          oldValues: { role: existing.role }, newValues: { role }, ipAddress: request?.ip, userAgent: request?.userAgent },
      });
      return member;
    });
  }

  static async deactivateMember(
    companyId: string,
    membershipId: string,
    actingUserId: string,
    actingRole: CompanyMemberRole,
    request?: { ip?: string; userAgent?: string }
  ) {
    return db.$transaction(async (tx) => {
      const existing = await tx.companyMember.findFirst({ where: { id: membershipId, companyId, isActive: true } });
      if (!existing) throw new AppError("Company member not found", 404);
      if (existing.role === CompanyMemberRole.OWNER && actingRole !== CompanyMemberRole.OWNER) {
        throw new AppError("Only an owner can remove another owner", 403);
      }
      if (existing.role === CompanyMemberRole.OWNER) {
        const owners = await tx.companyMember.count({ where: { companyId, role: CompanyMemberRole.OWNER, isActive: true } });
        if (owners <= 1) throw new AppError("A company must have at least one active owner", 409);
      }
      const member = await tx.companyMember.update({ where: { id: membershipId }, data: { isActive: false } });
      await tx.auditLog.create({
        data: { companyId, userId: actingUserId, action: AuditAction.DELETE, entity: "CompanyMember", entityId: member.id,
          oldValues: { role: existing.role, isActive: true }, newValues: { isActive: false }, ipAddress: request?.ip, userAgent: request?.userAgent },
      });
      return member;
    });
  }
}
