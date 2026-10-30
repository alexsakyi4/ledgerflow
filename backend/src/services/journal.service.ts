import { AuditAction, JournalStatus, Prisma } from "@prisma/client";
import { db } from "../config/db";
import { AppError } from "../middleware/error";
import { validateBalancedLines } from "../utils/journalBalance";

export type JournalLineInput = { accountId: string; description?: string; debit?: string | number; credit?: string | number };
export type JournalInput = { date: Date; reference?: string | null; memo?: string | null; sourceType?: string | null; sourceId?: string | null; lines: JournalLineInput[] };

type Tx = Prisma.TransactionClient;

export async function createPostedJournal(tx: Tx, companyId: string, userId: string, input: JournalInput) {
  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) throw new AppError("Journal date is invalid", 400);
  // Serialize posting against period-close operations for this company.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
  const closed = await tx.closedPeriod.findFirst({ where: { companyId, startDate: { lte: date }, endDate: { gte: date } } });
  if (closed) throw new AppError("This accounting period is closed", 409);

  const accounts = await tx.account.findMany({ where: { companyId, id: { in: [...new Set(input.lines.map((line) => line.accountId))] }, isActive: true }, select: { id: true } });
  if (accounts.length !== new Set(input.lines.map((line) => line.accountId)).size) throw new AppError("Every journal account must be active and belong to this company", 400);

  const balanced = validateBalancedLines(input.lines);
  const { lines, debits, credits } = balanced;

  const entry = await tx.journalEntry.create({
    data: {
      companyId, date, reference: input.reference || null, memo: input.memo || null,
      sourceType: input.sourceType || null, sourceId: input.sourceId || null,
      status: JournalStatus.POSTED, createdByUserId: userId,
    },
  });
  await tx.journalLine.createMany({ data: lines.map((line) => ({ ...line, entryId: entry.id })) });
  await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.CREATE, entity: "JournalEntry", entityId: entry.id,
    newValues: { date: date.toISOString(), reference: entry.reference, memo: entry.memo, debitTotal: debits.toString(), creditTotal: credits.toString() } } });
  return tx.journalEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { lines: { include: { account: { select: { code: true, name: true, type: true } } } } } });
}

export class JournalService {
  static async list(companyId: string, from?: Date, to?: Date) {
    return db.journalEntry.findMany({
      where: { companyId, status: JournalStatus.POSTED, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      include: { lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } }, createdBy: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
  }

  static async create(companyId: string, userId: string, input: JournalInput) {
    return db.$transaction((tx) => createPostedJournal(tx, companyId, userId, input));
  }
}
