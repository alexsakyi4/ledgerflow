import { DocumentStatus, DocumentType } from "@prisma/client";
import { Response } from "express";
import { db } from "../config/db";
import { AppError } from "../middleware/error";
import type { AuthRequest } from "../types";

function homeOutstanding(document: { total: unknown; amountPaid: unknown; exchangeRate: unknown }) {
  return (Number(document.total) - Number(document.amountPaid)) * Number(document.exchangeRate || 1);
}

export async function summary(req: AuthRequest, res: Response) {
  const companyId = req.user?.companyId;
  if (!companyId) throw new AppError("Company context required", 400);
  const now = new Date();
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const [company, banks, documents, entries, unpaidInvoices, billsToPay, reconciliations] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } }),
    db.bankAccount.findMany({ where: { companyId, isActive: true }, include: { account: true } }),
    db.businessDocument.findMany({ where: { companyId, type: { in: [DocumentType.INVOICE, DocumentType.CREDIT_MEMO, DocumentType.BILL, DocumentType.VENDOR_CREDIT] }, status: { notIn: [DocumentStatus.DRAFT, DocumentStatus.VOID, DocumentStatus.PAID] } } }),
    db.journalEntry.findMany({ where: { companyId, status: "POSTED", date: { gte: sixMonthsAgo, lte: now } }, include: { lines: { include: { account: { select: { type: true, code: true, name: true } } } } }, orderBy: { date: "asc" } }),
    db.businessDocument.findMany({ where: { companyId, type: DocumentType.INVOICE, status: { in: [DocumentStatus.SENT, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE] } }, include: { contact: { select: { displayName: true } } }, orderBy: { dueDate: "asc" }, take: 6 }),
    db.businessDocument.findMany({ where: { companyId, type: DocumentType.BILL, status: { in: [DocumentStatus.APPROVED, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE] } }, include: { contact: { select: { displayName: true } } }, orderBy: { dueDate: "asc" }, take: 6 }),
    db.bankReconciliation.findMany({ where: { companyId, status: "IN_PROGRESS" }, include: { bankAccount: { select: { name: true } } }, take: 5 }),
  ]);
  const cashLines = banks.length ? await db.journalLine.findMany({ where: { accountId: { in: banks.map((bank) => bank.accountId) }, entry: { is: { companyId, status: "POSTED", date: { lte: now } } } } }) : [];
  const cashBalance = banks.reduce((sum, bank) => {
    const changes = cashLines.filter((line) => line.accountId === bank.accountId).reduce((amount, line) => amount + Number(line.debit) - Number(line.credit), 0);
    return sum + Number(bank.openingBalance) + changes;
  }, 0);
  const isOpen = (type: DocumentType) => documents.filter((document) => document.type === type);
  const invoices = isOpen(DocumentType.INVOICE).reduce((sum, document) => sum + homeOutstanding(document), 0);
  const credits = isOpen(DocumentType.CREDIT_MEMO).reduce((sum, document) => sum + homeOutstanding(document), 0);
  const bills = isOpen(DocumentType.BILL).reduce((sum, document) => sum + homeOutstanding(document), 0);
  const vendorCredits = isOpen(DocumentType.VENDOR_CREDIT).reduce((sum, document) => sum + homeOutstanding(document), 0);
  const months: Record<string, { income: number; expenses: number }> = {};
  const expenseCategories = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.date.getUTCFullYear()}-${String(entry.date.getUTCMonth() + 1).padStart(2, "0")}`;
    months[key] ||= { income: 0, expenses: 0 };
    for (const line of entry.lines) {
      if (line.account.type === "INCOME") months[key].income += Number(line.credit) - Number(line.debit);
      if (["EXPENSE", "COGS"].includes(line.account.type)) {
        const amount = Number(line.debit) - Number(line.credit);
        months[key].expenses += amount;
        expenseCategories.set(line.account.name, (expenseCategories.get(line.account.name) || 0) + amount);
      }
    }
  }
  const thisMonth = months[`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`] || { income: 0, expenses: 0 };
  const incomeVsExpenses = Object.entries(months).map(([month, value]) => ({ month, ...value }));
  res.json({ success: true, data: {
    currency: company.currency,
    cashBalance: cashBalance.toFixed(2),
    accountsReceivable: (invoices - credits).toFixed(2),
    accountsPayable: (bills - vendorCredits).toFixed(2),
    profitThisMonth: (thisMonth.income - thisMonth.expenses).toFixed(2),
    incomeVsExpenses,
    topExpenseCategories: Array.from(expenseCategories, ([name, amount]) => ({ name, amount: amount.toFixed(2) })).sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5),
    todo: {
      unpaidInvoices: unpaidInvoices.map((document) => ({ id: document.id, number: document.number, contact: document.contact?.displayName, dueDate: document.dueDate, amountDue: homeOutstanding(document).toFixed(2) })),
      billsToPay: billsToPay.map((document) => ({ id: document.id, number: document.number, vendor: document.contact?.displayName, dueDate: document.dueDate, amountDue: homeOutstanding(document).toFixed(2) })),
      reconciliationsDue: reconciliations.map((item) => ({ id: item.id, account: item.bankAccount.name, statementEndDate: item.statementEndDate })),
    },
  } });
}
