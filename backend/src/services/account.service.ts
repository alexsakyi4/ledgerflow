import { AccountType, AuditAction, Prisma } from "@prisma/client";
import { db } from "../config/db";
import { AppError } from "../middleware/error";

export type AccountInput = {
  code: string;
  name: string;
  type: AccountType;
  description?: string | null;
  parentId?: string | null;
  openingBalance?: number | string;
  openingBalanceDate?: string | null;
};

const accountInclude = {
  parent: { select: { id: true, code: true, name: true } },
  children: { select: { id: true, code: true, name: true, isActive: true } },
};

export class AccountService {
  static async list(companyId: string, options: { type?: AccountType; search?: string; includeInactive?: boolean }) {
    const where: Prisma.AccountWhereInput = {
      companyId,
      ...(options.type ? { type: options.type } : {}),
      ...(options.includeInactive ? {} : { isActive: true }),
      ...(options.search
        ? { OR: [
            { code: { contains: options.search, mode: "insensitive" } },
            { name: { contains: options.search, mode: "insensitive" } },
            { description: { contains: options.search, mode: "insensitive" } },
          ] }
        : {}),
    };
    return db.account.findMany({ where, include: accountInclude, orderBy: [{ code: "asc" }] });
  }

  static async get(companyId: string, accountId: string) {
    const account = await db.account.findFirst({ where: { id: accountId, companyId }, include: accountInclude });
    if (!account) throw new AppError("Account not found", 404);
    return account;
  }

  static async create(companyId: string, userId: string, input: AccountInput, request?: { ip?: string; userAgent?: string }) {
    const normalized = normalizeAccount(input);
    await this.validateParent(companyId, normalized.parentId, undefined, db, normalized.type);
    const company = await db.company.findUnique({ where: { id: companyId }, select: { currency: true } });
    if (!company) throw new AppError("Company not found", 404);
    return db.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          companyId,
          code: normalized.code,
          name: normalized.name,
          type: normalized.type,
          description: normalized.description,
          parentId: normalized.parentId,
          openingBalance: new Prisma.Decimal(normalized.openingBalance),
          openingBalanceDate: input.openingBalanceDate ? new Date(input.openingBalanceDate) : null,
          currency: company.currency,
        },
        include: accountInclude,
      });
      await tx.auditLog.create({
        data: {
          companyId, userId, action: AuditAction.CREATE, entity: "Account", entityId: account.id,
          newValues: auditAccount(account), ipAddress: request?.ip, userAgent: request?.userAgent,
        },
      });
      return account;
    });
  }

  static async update(companyId: string, userId: string, accountId: string, input: Partial<AccountInput>, request?: { ip?: string; userAgent?: string }) {
    const before = await this.get(companyId, accountId);
    const [postedActivity, mappedBank] = await Promise.all([
      db.journalLine.findFirst({ where: { accountId, entry: { is: { companyId, status: "POSTED" } } }, select: { id: true } }),
      db.bankAccount.findFirst({ where: { companyId, accountId }, select: { id: true } }),
    ]);
    if (before.isSystem && ((input.code !== undefined && input.code.trim() !== before.code) || (input.type !== undefined && input.type !== before.type))) throw new AppError("System account codes and types cannot be changed", 409);
    if ((postedActivity || mappedBank) && ((input.code !== undefined && input.code.trim() !== before.code) || (input.type !== undefined && input.type !== before.type))) throw new AppError("An account code or type cannot change after it is used in posted activity or mapped to a bank account", 409);
    if (postedActivity && (input.openingBalance !== undefined || input.openingBalanceDate !== undefined)) throw new AppError("Opening balances cannot be changed after an account has posted activity", 409);
    const data: Prisma.AccountUpdateInput = {};
    if (input.code !== undefined) data.code = input.code.trim();
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.type !== undefined) data.type = input.type;
    if (input.description !== undefined) data.description = input.description;
    if (input.openingBalance !== undefined) data.openingBalance = new Prisma.Decimal(input.openingBalance);
    if (input.openingBalanceDate !== undefined) data.openingBalanceDate = input.openingBalanceDate ? new Date(input.openingBalanceDate) : null;
    if (input.parentId !== undefined) {
      if (input.parentId === accountId) throw new AppError("An account cannot be its own sub-account", 400);
      data.parent = input.parentId ? { connect: { id: input.parentId } } : { disconnect: true };
    }

    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
      const current = await tx.account.findFirst({ where: { id: accountId, companyId }, include: accountInclude });
      if (!current) throw new AppError("Account not found", 404);
      if (!current.isActive) throw new AppError("Archived accounts cannot be updated", 409);
      if (input.parentId !== undefined) await this.validateParent(companyId, input.parentId, accountId, tx, input.type ?? current.type);
      const [hasPostedActivity, isMappedBank] = await Promise.all([
        tx.journalLine.findFirst({ where: { accountId, entry: { is: { companyId, status: "POSTED" } } }, select: { id: true } }),
        tx.bankAccount.findFirst({ where: { companyId, accountId }, select: { id: true } }),
      ]);
      if (current.isSystem && ((input.code !== undefined && input.code.trim() !== current.code) || (input.type !== undefined && input.type !== current.type))) throw new AppError("System account codes and types cannot be changed", 409);
      if ((hasPostedActivity || isMappedBank) && ((input.code !== undefined && input.code.trim() !== current.code) || (input.type !== undefined && input.type !== current.type))) throw new AppError("An account code or type cannot change after it is used in posted activity or mapped to a bank account", 409);
      if (hasPostedActivity && (input.openingBalance !== undefined || input.openingBalanceDate !== undefined)) throw new AppError("Opening balances cannot be changed after an account has posted activity", 409);
      const account = await tx.account.update({ where: { id: accountId }, data, include: accountInclude });
      await tx.auditLog.create({
        data: {
          companyId, userId, action: AuditAction.UPDATE, entity: "Account", entityId: accountId,
          oldValues: auditAccount(current), newValues: auditAccount(account), ipAddress: request?.ip, userAgent: request?.userAgent,
        },
      });
      return account;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  static async archive(companyId: string, userId: string, accountId: string, request?: { ip?: string; userAgent?: string }) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
      const account = await tx.account.findFirst({ where: { id: accountId, companyId }, include: accountInclude });
      if (!account) throw new AppError("Account not found", 404);
      if (account.isSystem) throw new AppError("System accounts cannot be archived", 409);
      if (account.children.some((child) => child.isActive)) throw new AppError("Archive sub-accounts before archiving this account", 409);
      if (!account.openingBalance.isZero() || account.openingBalanceDate) throw new AppError("An account with an opening balance cannot be archived", 409);
      const [postedActivity, mappedBank] = await Promise.all([
        tx.journalLine.findFirst({ where: { accountId, entry: { is: { companyId, status: "POSTED" } } }, select: { id: true } }),
        tx.bankAccount.findFirst({ where: { companyId, accountId }, select: { id: true } }),
      ]);
      if (postedActivity) throw new AppError("An account used in posted journals cannot be archived", 409);
      if (mappedBank) throw new AppError("An account mapped to a bank or credit-card account cannot be archived", 409);
      const updated = await tx.account.update({ where: { id: accountId }, data: { isActive: false }, include: accountInclude });
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.DELETE, entity: "Account", entityId: accountId, oldValues: auditAccount(account), newValues: auditAccount(updated), ipAddress: request?.ip, userAgent: request?.userAgent } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private static async validateParent(companyId: string, parentId?: string | null, currentId?: string, client: Prisma.TransactionClient | typeof db = db, accountType?: AccountType) {
    if (!parentId) return;
    let parent = await client.account.findFirst({ where: { id: parentId, companyId }, select: { id: true, parentId: true, type: true } });
    if (!parent) throw new AppError("Parent account must belong to the same company", 400);
    const visited = new Set<string>();
    while (parent) {
      if (accountType && parent.type !== accountType) throw new AppError("Sub-accounts must have the same account type as their parent", 400);
      if (parent.id === currentId) throw new AppError("Sub-account hierarchy cannot contain a cycle", 400);
      if (visited.has(parent.id)) throw new AppError("Existing account hierarchy contains a cycle", 409);
      visited.add(parent.id);
      if (!parent.parentId) break;
      const nextId: string = parent.parentId;
      parent = await client.account.findFirst({ where: { id: nextId, companyId }, select: { id: true, parentId: true, type: true } });
    }
  }
}

function normalizeAccount(input: AccountInput) {
  return {
    code: input.code.trim(),
    name: input.name.trim(),
    type: input.type,
    description: input.description?.trim() || null,
    parentId: input.parentId || null,
    openingBalance: input.openingBalance ?? 0,
    openingBalanceDate: input.openingBalanceDate ?? null,
  };
}

function auditAccount(account: any) {
  return {
    code: account.code,
    name: account.name,
    type: account.type,
    description: account.description,
    parentId: account.parentId,
    openingBalance: account.openingBalance?.toString(),
    openingBalanceDate: account.openingBalanceDate,
    isActive: account.isActive,
    isSystem: account.isSystem,
  };
}
