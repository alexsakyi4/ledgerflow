import { AuditAction, ContactType, Prisma } from "@prisma/client";
import { db } from "../config/db";
import { AppError } from "../middleware/error";

export type ContactInput = {
  type: ContactType; displayName: string; companyName?: string | null; email?: string | null; phone?: string | null;
  billingAddress?: Record<string, unknown> | null; shippingAddress?: Record<string, unknown> | null; paymentTermsDays?: number;
  taxId?: string | null; currency?: string;
};

export function summarizeContactBalances(contactType: ContactType, opening: Prisma.Decimal, documents: Array<{ type: string; total: Prisma.Decimal; amountPaid: Prisma.Decimal; exchangeRate: Prisma.Decimal }>) {
  let receivable = new Prisma.Decimal(0);
  let payable = new Prisma.Decimal(0);
  if (contactType === ContactType.CUSTOMER) receivable = new Prisma.Decimal(opening);
  else if (contactType === ContactType.VENDOR) payable = new Prisma.Decimal(opening);
  else if (new Prisma.Decimal(opening).gt(0)) receivable = new Prisma.Decimal(opening);
  else if (new Prisma.Decimal(opening).lt(0)) payable = new Prisma.Decimal(opening).abs();
  for (const document of documents) {
    const outstanding = new Prisma.Decimal(document.total).minus(document.amountPaid).mul(document.exchangeRate);
    if (document.type === "INVOICE") receivable = receivable.plus(outstanding);
    else if (document.type === "CREDIT_MEMO") receivable = receivable.minus(outstanding);
    else if (document.type === "BILL") payable = payable.plus(outstanding);
    else if (document.type === "VENDOR_CREDIT") payable = payable.minus(outstanding);
  }
  const current = contactType === ContactType.VENDOR ? payable : contactType === ContactType.BOTH ? receivable.minus(payable) : receivable;
  return { receivableBalance: receivable.toFixed(2), payableBalance: payable.toFixed(2), currentBalance: current.toFixed(2) };
}

export class ContactService {
  static async list(companyId: string, options: { type?: ContactType; search?: string; archived?: boolean }) {
    const typeFilter = options.type ? { type: { in: options.type === ContactType.CUSTOMER ? [ContactType.CUSTOMER, ContactType.BOTH] : options.type === ContactType.VENDOR ? [ContactType.VENDOR, ContactType.BOTH] : [options.type] } } : {};
    const contacts = await db.contact.findMany({
      where: { companyId, ...typeFilter, isArchived: options.archived ?? false,
        ...(options.search ? { OR: [
          { displayName: { contains: options.search, mode: "insensitive" } },
          { companyName: { contains: options.search, mode: "insensitive" } },
          { email: { contains: options.search, mode: "insensitive" } },
          { phone: { contains: options.search, mode: "insensitive" } },
        ] } : {}) },
      orderBy: { displayName: "asc" },
      ...(options.search ? { take: 20 } : {}),
    });
    if (!contacts.length) return [];
    const [company, openDocuments] = await Promise.all([
      db.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } }),
      db.businessDocument.findMany({
        where: { companyId, contactId: { in: contacts.map((contact) => contact.id) }, type: { in: ["INVOICE", "CREDIT_MEMO", "BILL", "VENDOR_CREDIT"] }, status: { notIn: ["DRAFT", "VOID", "PAID"] } },
        select: { contactId: true, type: true, total: true, amountPaid: true, exchangeRate: true },
      }),
    ]);
    const docsByContact = new Map<string, typeof openDocuments>();
    for (const doc of openDocuments) if (doc.contactId) docsByContact.set(doc.contactId, [...(docsByContact.get(doc.contactId) || []), doc]);
    return contacts.map((contact) => ({ ...contact, balanceCurrency: company.currency, ...summarizeContactBalances(contact.type, contact.openingBalance, docsByContact.get(contact.id) || []) }));
  }

  static async get(companyId: string, contactId: string) {
    const contact = await db.contact.findFirst({ where: { id: contactId, companyId } });
    if (!contact) throw new AppError("Contact not found", 404);
    const [company, documents, openDocuments] = await Promise.all([
      db.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } }),
      db.businessDocument.findMany({ where: { companyId, contactId, status: { not: "VOID" } }, orderBy: { issueDate: "desc" }, take: 100 }),
      db.businessDocument.findMany({
        where: { companyId, contactId, type: { in: ["INVOICE", "CREDIT_MEMO", "BILL", "VENDOR_CREDIT"] }, status: { notIn: ["DRAFT", "VOID", "PAID"] } },
        select: { type: true, total: true, amountPaid: true, exchangeRate: true },
      }),
    ]);
    return { ...contact, documents, balanceCurrency: company.currency, ...summarizeContactBalances(contact.type, contact.openingBalance, openDocuments) };
  }


  static async create(companyId: string, userId: string, input: ContactInput, request?: { ip?: string; userAgent?: string }) {
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } });
    const contact = await db.contact.create({ data: {
      companyId, type: input.type, displayName: input.displayName.trim(), companyName: input.companyName || null,
      email: input.email?.trim().toLowerCase() || null, phone: input.phone || null,
      billingAddress: input.billingAddress === undefined || input.billingAddress === null ? Prisma.JsonNull : input.billingAddress as Prisma.InputJsonValue,
      shippingAddress: input.shippingAddress === undefined || input.shippingAddress === null ? Prisma.JsonNull : input.shippingAddress as Prisma.InputJsonValue,
      paymentTermsDays: input.paymentTermsDays ?? 0, taxId: input.taxId || null, currency: input.currency?.toUpperCase() || company.currency,
    } });
    await db.auditLog.create({ data: { companyId, userId, action: AuditAction.CREATE, entity: "Contact", entityId: contact.id, newValues: { displayName: contact.displayName, type: contact.type }, ipAddress: request?.ip, userAgent: request?.userAgent } });
    return contact;
  }

  static async update(companyId: string, userId: string, contactId: string, input: Partial<ContactInput>, request?: { ip?: string; userAgent?: string }) {
    const before = await db.contact.findFirst({ where: { id: contactId, companyId } });
    if (!before) throw new AppError("Contact not found", 404);
    const data: Prisma.ContactUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.displayName !== undefined) data.displayName = input.displayName.trim();
    if (input.companyName !== undefined) data.companyName = input.companyName;
    if (input.email !== undefined) data.email = input.email?.trim().toLowerCase() || null;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.billingAddress !== undefined) data.billingAddress = input.billingAddress === null ? Prisma.JsonNull : input.billingAddress as Prisma.InputJsonValue;
    if (input.shippingAddress !== undefined) data.shippingAddress = input.shippingAddress === null ? Prisma.JsonNull : input.shippingAddress as Prisma.InputJsonValue;
    if (input.paymentTermsDays !== undefined) data.paymentTermsDays = input.paymentTermsDays;
    if (input.taxId !== undefined) data.taxId = input.taxId;
    if (input.currency !== undefined) data.currency = input.currency.toUpperCase();
    const contact = await db.contact.update({ where: { id: contactId }, data });
    await db.auditLog.create({ data: { companyId, userId, action: AuditAction.UPDATE, entity: "Contact", entityId: contactId, oldValues: { displayName: before.displayName, email: before.email, type: before.type }, newValues: { displayName: contact.displayName, email: contact.email, type: contact.type }, ipAddress: request?.ip, userAgent: request?.userAgent } });
    return contact;
  }

  static async archive(companyId: string, userId: string, contactId: string, request?: { ip?: string; userAgent?: string }) {
    const before = await db.contact.findFirst({ where: { id: contactId, companyId } });
    if (!before) throw new AppError("Contact not found", 404);
    const contact = await db.contact.update({ where: { id: contactId }, data: { isArchived: true } });
    await db.auditLog.create({ data: { companyId, userId, action: AuditAction.DELETE, entity: "Contact", entityId: contactId, oldValues: { isArchived: false }, newValues: { isArchived: true }, ipAddress: request?.ip, userAgent: request?.userAgent } });
    return contact;
  }

  static async merge(companyId: string, userId: string, sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new AppError("Choose a different contact to merge into", 400);
    return db.$transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.contact.findFirst({ where: { id: sourceId, companyId, isArchived: false } }),
        tx.contact.findFirst({ where: { id: targetId, companyId, isArchived: false } }),
      ]);
      if (!source || !target) throw new AppError("Both contacts must exist in this company", 404);
      if (source.type !== target.type) throw new AppError("Contacts can only be merged when their customer/vendor types match", 409);
      await tx.businessDocument.updateMany({ where: { companyId, contactId: sourceId }, data: { contactId: targetId } });
      const merged = await tx.contact.update({ where: { id: targetId }, data: { openingBalance: { increment: source.openingBalance } } });
      await tx.contact.update({ where: { id: sourceId }, data: { isArchived: true } });
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.UPDATE, entity: "Contact", entityId: targetId, oldValues: { openingBalance: target.openingBalance.toString() }, newValues: { mergedContactId: sourceId, openingBalance: merged.openingBalance.toString() } } });
      return merged;
    });
  }
}
