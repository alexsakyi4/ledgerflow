import { AuditAction, BusinessDocument, ContactType, DocumentStatus, DocumentType, Prisma } from "@prisma/client";
import { db } from "../config/db";
import { AppError } from "../middleware/error";
import { createPostedJournal } from "./journal.service";
import { settlementFx } from "../utils/foreignExchange";

export type DocumentLineInput = { productId?: string | null; accountId?: string | null; description?: string; quantity: number | string; unitPrice: number | string; discount?: number | string; taxRateId?: string | null };
export type DocumentInput = { type: DocumentType; contactId?: string | null; issueDate?: string; dueDate?: string | null; termsDays?: number; currency?: string; reference?: string | null; memo?: string | null; taxInclusive?: boolean; lines: DocumentLineInput[]; bankAccountId?: string; paymentAllocations?: Array<{ documentId: string; amount: number | string }>; sourceDocumentId?: string | null };
type Tx = Prisma.TransactionClient;

const prefix: Record<DocumentType, string> = {
  INVOICE: "INV", ESTIMATE: "EST", SALES_RECEIPT: "SR", BILL: "BILL", EXPENSE: "EXP",
  PURCHASE_ORDER: "PO", CREDIT_MEMO: "CM", VENDOR_CREDIT: "VC", CUSTOMER_PAYMENT: "PAY", VENDOR_PAYMENT: "VPAY",
};

function toDecimal(value: number | string | undefined, fallback = 0) { return new Prisma.Decimal(value ?? fallback); }
function jsonLines(document: BusinessDocument): any[] { return Array.isArray(document.lineItems) ? document.lineItems as any[] : []; }
function isUniqueConstraintError(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002"; }

export class DocumentService {
  static async list(companyId: string, type: DocumentType, search?: string, from?: Date, to?: Date) {
    const where: Prisma.BusinessDocumentWhereInput = {
      companyId,
      type,
      ...(search ? { OR: [
        { number: { contains: search, mode: "insensitive" } },
        { reference: { contains: search, mode: "insensitive" } },
        { contact: { displayName: { contains: search, mode: "insensitive" } } },
      ] } : {}),
      ...(from || to ? { issueDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    return db.businessDocument.findMany({
      where,
      include: { contact: { select: { id: true, displayName: true, email: true } }, journalEntry: true },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      ...(search ? { take: 20 } : {}),
    });
  }

  static async get(companyId: string, id: string) {
    const doc = await db.businessDocument.findFirst({
      where: { id, companyId },
      include: {
        contact: true,
        journalEntry: { include: { lines: { include: { account: { select: { code: true, name: true, type: true } } } } } },
      },
    });
    if (!doc) throw new AppError("Transaction not found", 404);
    return doc;
  }

  static async create(companyId: string, userId: string, input: DocumentInput) {
    const type = input.type;
    if (([DocumentType.CUSTOMER_PAYMENT, DocumentType.VENDOR_PAYMENT] as DocumentType[]).includes(type)) return this.createPayment(companyId, userId, input);
    if (([DocumentType.INVOICE, DocumentType.ESTIMATE, DocumentType.BILL, DocumentType.PURCHASE_ORDER, DocumentType.CREDIT_MEMO, DocumentType.VENDOR_CREDIT] as DocumentType[]).includes(type) && !input.contactId) throw new AppError("Select a customer or vendor", 400);
    if (input.lines.length === 0) throw new AppError("Add at least one line item", 400);
    const contact = input.contactId ? await db.contact.findFirst({ where: { id: input.contactId, companyId, isArchived: false } }) : null;
    if (input.contactId && !contact) throw new AppError("Contact not found in this company", 404);
    if (([DocumentType.INVOICE, DocumentType.ESTIMATE, DocumentType.CREDIT_MEMO] as DocumentType[]).includes(type) && contact && !([ContactType.CUSTOMER, ContactType.BOTH] as ContactType[]).includes(contact.type)) throw new AppError("Select a customer contact", 400);
    if (([DocumentType.BILL, DocumentType.PURCHASE_ORDER, DocumentType.VENDOR_CREDIT] as DocumentType[]).includes(type) && contact && !([ContactType.VENDOR, ContactType.BOTH] as ContactType[]).includes(contact.type)) throw new AppError("Select a vendor contact", 400);

    const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } });
    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    if (Number.isNaN(issueDate.getTime())) throw new AppError("Transaction date is invalid", 400);
    const termsDays = input.termsDays ?? contact?.paymentTermsDays ?? 0;
    const dueDate = input.dueDate ? new Date(input.dueDate) : new Date(issueDate.getTime() + termsDays * 86400000);
    if (Number.isNaN(dueDate.getTime())) throw new AppError("Due date is invalid", 400);
    const resolvedCurrency = (input.currency || contact?.currency || company.currency).toUpperCase();
    const exchangeRate = await this.resolveExchangeRate(companyId, resolvedCurrency, company.currency, issueDate);
    const computed = await this.calculateLines(companyId, type, input.lines, Boolean(input.taxInclusive), exchangeRate);
    const number = `${prefix[type]}-${issueDate.getUTCFullYear()}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

    const created = await db.$transaction(async (tx) => {
      const doc = await tx.businessDocument.create({ data: {
        companyId, contactId: contact?.id ?? null, type, number, issueDate, dueDate,
        termsDays, currency: resolvedCurrency, exchangeRate, homeCurrencyTotal: computed.homeTotal,
        subtotal: computed.subtotal, taxTotal: computed.taxTotal, discountTotal: computed.discountTotal, total: computed.total,
        reference: input.reference || null, memo: input.memo || null, lineItems: computed.lines as unknown as Prisma.InputJsonValue,
        sourceDocumentId: input.sourceDocumentId || null, createdByUserId: userId,
      } });
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.CREATE, entity: type, entityId: doc.id, newValues: { number, total: computed.total.toString() } } });
      return doc;
    });

    if (([DocumentType.SALES_RECEIPT, DocumentType.EXPENSE] as DocumentType[]).includes(type)) {
      return this.post(companyId, userId, created.id, input.bankAccountId);
    }
    return created;
  }

  private static async calculateLines(companyId: string, type: DocumentType, inputLines: DocumentLineInput[], inclusive: boolean, exchangeRate: Prisma.Decimal) {
    let subtotal = new Prisma.Decimal(0); let taxes = new Prisma.Decimal(0); let discounts = new Prisma.Decimal(0); let total = new Prisma.Decimal(0); let homeTotal = new Prisma.Decimal(0);
    const lines: any[] = [];
    for (const input of inputLines) {
      const quantity = toDecimal(input.quantity);
      const unitPrice = toDecimal(input.unitPrice);
      const discount = toDecimal(input.discount);
      if (!quantity.gt(0) || unitPrice.isNegative() || discount.isNegative()) throw new AppError("Quantity must be positive and price/discount cannot be negative", 400);
      const product = input.productId ? await db.productService.findFirst({ where: { id: input.productId, companyId, isActive: true } }) : null;
      if (input.productId && !product) throw new AppError("Product or service was not found in this company", 404);
      const isSales = ([DocumentType.INVOICE, DocumentType.ESTIMATE, DocumentType.SALES_RECEIPT, DocumentType.CREDIT_MEMO] as DocumentType[]).includes(type);
      const accountId = input.accountId || (isSales ? product?.incomeAccountId : product?.expenseAccountId || product?.incomeAccountId);
      if (!accountId) throw new AppError("Select an account for every line item", 400);
      const account = await db.account.findFirst({ where: { id: accountId, companyId, isActive: true } });
      if (!account) throw new AppError("Every line account must be active and belong to this company", 400);
      const taxRateId = input.taxRateId || product?.taxRateId;
      const taxRate = taxRateId ? await db.taxRate.findFirst({ where: { id: taxRateId, companyId, isActive: true }, include: { account: true } }) : null;
      if (taxRateId && !taxRate) throw new AppError("Tax code not found for this company", 400);
      if (taxRate?.account && taxRate.account.type !== (isSales ? "LIABILITY" : "ASSET")) throw new AppError(isSales ? "Sales tax must post to a liability account" : "Purchase tax must post to an asset account", 400);
      const raw = quantity.mul(unitPrice).minus(discount);
      if (raw.isNegative()) throw new AppError("A line discount cannot exceed its gross amount", 400);
      const rate = taxRate ? new Prisma.Decimal(taxRate.rate) : new Prisma.Decimal(0);
      const lineInclusive = inclusive || Boolean(taxRate?.isInclusive);
      const net = lineInclusive && !rate.isZero() ? raw.div(new Prisma.Decimal(1).plus(rate)) : raw;
      const taxAmount = lineInclusive ? raw.minus(net) : net.mul(rate);
      const lineTotal = lineInclusive ? raw : net.plus(taxAmount);
      subtotal = subtotal.plus(net); taxes = taxes.plus(taxAmount); discounts = discounts.plus(discount); total = total.plus(lineTotal);
      const homeNet = net.mul(exchangeRate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const homeTax = taxAmount.mul(exchangeRate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const homeLineTotal = homeNet.plus(homeTax);
      homeTotal = homeTotal.plus(homeLineTotal);
      lines.push({ productId: product?.id || null, description: input.description?.trim() || product?.name || account.name, quantity: quantity.toString(), unitPrice: unitPrice.toString(), discount: discount.toString(), net: net.toFixed(4), tax: taxAmount.toFixed(4), total: lineTotal.toFixed(4), homeNet: homeNet.toFixed(4), homeTax: homeTax.toFixed(4), homeTotal: homeLineTotal.toFixed(4), homeUnitPrice: unitPrice.mul(exchangeRate).toFixed(4), accountId: account.id, taxRateId: taxRate?.id || null, taxAccountId: taxRate?.accountId || null, taxRate: rate.toString(), inventoryTracking: Boolean(product?.inventoryTracking), averageCost: product?.averageCost.toString() || "0", kind: product?.kind || null });
    }
    return { subtotal, taxTotal: taxes, discountTotal: discounts, total, homeTotal, lines };
  }

  static async post(companyId: string, userId: string, documentId: string, bankAccountId?: string) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
      const doc = await tx.businessDocument.findFirst({ where: { id: documentId, companyId }, include: { contact: true } });
      if (!doc) throw new AppError("Transaction not found", 404);
      if (doc.status !== DocumentStatus.DRAFT) throw new AppError("Only draft transactions can be posted", 409);
      const lines = jsonLines(doc);
      const entries: Array<{ accountId: string; description: string; debit: string; credit: string }> = [];
      const add = (accountId: string | null | undefined, description: string, debit: Prisma.Decimal, credit: Prisma.Decimal) => {
        if (!accountId) throw new AppError("Required posting account is not configured", 400);
        if (debit.isZero() && credit.isZero()) return;
        entries.push({ accountId, description, debit: debit.toFixed(4), credit: credit.toFixed(4) });
      };
      const total = doc.homeCurrencyTotal.isZero() ? new Prisma.Decimal(doc.total) : new Prisma.Decimal(doc.homeCurrencyTotal);
      const ar = await this.accountByCode(tx, companyId, "1100");
      const ap = await this.accountByCode(tx, companyId, "2000");
      const bank = bankAccountId ? await tx.bankAccount.findFirst({ where: { id: bankAccountId, companyId, isActive: true }, include: { account: true } }) : null;
      if (([DocumentType.SALES_RECEIPT, DocumentType.EXPENSE] as DocumentType[]).includes(doc.type) && !bank) throw new AppError("Choose an active Bank or Credit Card account", 400);

      if (doc.type === DocumentType.INVOICE) {
        add(ar.id, "Accounts Receivable", total, new Prisma.Decimal(0));
        for (const line of lines) add(line.accountId, line.description, new Prisma.Decimal(0), new Prisma.Decimal(line.homeNet ?? line.net));
        for (const tax of groupBy(lines.filter((line) => Number(line.homeTax ?? line.tax) > 0), "taxAccountId", "homeTax")) {
          const taxAccount = tax.key || (await this.accountByCode(tx, companyId, "2200")).id;
          add(taxAccount, "Sales tax payable", new Prisma.Decimal(0), tax.amount);
        }
      } else if (doc.type === DocumentType.CREDIT_MEMO) {
        add(ar.id, "Accounts Receivable credit", new Prisma.Decimal(0), total);
        for (const line of lines) add(line.accountId, line.description, new Prisma.Decimal(line.homeNet ?? line.net), new Prisma.Decimal(0));
        for (const tax of groupBy(lines.filter((line) => Number(line.homeTax ?? line.tax) > 0), "taxAccountId", "homeTax")) {
          const taxAccount = tax.key || (await this.accountByCode(tx, companyId, "2200")).id;
          add(taxAccount, "Sales tax reversal", tax.amount, new Prisma.Decimal(0));
        }
      } else if (doc.type === DocumentType.BILL || doc.type === DocumentType.VENDOR_CREDIT) {
        const inventoryAccount = lines.some((line) => line.inventoryTracking) ? await this.accountByCode(tx, companyId, "1200") : null;
        const inputTax = await this.accountByCode(tx, companyId, "1350");
        if (doc.type === DocumentType.BILL) {
          for (const line of lines) add(line.inventoryTracking ? inventoryAccount!.id : line.accountId, line.description, new Prisma.Decimal(line.homeNet ?? line.net), new Prisma.Decimal(0));
          for (const tax of groupBy(lines.filter((line) => Number(line.homeTax ?? line.tax) > 0), "taxAccountId", "homeTax")) add(tax.key || inputTax.id, "Input tax receivable", tax.amount, new Prisma.Decimal(0));
          add(ap.id, "Accounts Payable", new Prisma.Decimal(0), total);
        } else {
          add(ap.id, "Accounts Payable credit", total, new Prisma.Decimal(0));
          for (const line of lines) {
            const net = new Prisma.Decimal(line.homeNet ?? line.net);
            if (line.inventoryTracking && line.productId) {
              const product = await tx.productService.findFirst({ where: { id: line.productId, companyId } });
              if (!product) throw new AppError(`Inventory item not found for ${line.description}`, 409);
              const quantity = new Prisma.Decimal(line.quantity);
              const carryingCost = product.averageCost.mul(quantity);
              add(inventoryAccount!.id, line.description, new Prisma.Decimal(0), carryingCost);
              const variance = net.minus(carryingCost);
              if (variance.gt(0)) add((await this.accountByCode(tx, companyId, "5000")).id, `Purchase return price variance · ${line.description}`, new Prisma.Decimal(0), variance);
              else if (variance.lt(0)) add((await this.accountByCode(tx, companyId, "5000")).id, `Purchase return price variance · ${line.description}`, variance.abs(), new Prisma.Decimal(0));
            } else {
              add(line.accountId, line.description, new Prisma.Decimal(0), net);
            }
          }
          for (const tax of groupBy(lines.filter((line) => Number(line.homeTax ?? line.tax) > 0), "taxAccountId", "homeTax")) add(tax.key || inputTax.id, "Input tax reversal", new Prisma.Decimal(0), tax.amount);
        }
      } else if (doc.type === DocumentType.SALES_RECEIPT) {
        add(bank!.accountId, bank!.name, total, new Prisma.Decimal(0));
        for (const line of lines) add(line.accountId, line.description, new Prisma.Decimal(0), new Prisma.Decimal(line.homeNet ?? line.net));
        for (const tax of groupBy(lines.filter((line) => Number(line.homeTax ?? line.tax) > 0), "taxAccountId", "homeTax")) {
          const taxAccount = tax.key || (await this.accountByCode(tx, companyId, "2200")).id;
          add(taxAccount, "Sales tax payable", new Prisma.Decimal(0), tax.amount);
        }
      } else if (doc.type === DocumentType.EXPENSE) {
        const inputTax = await this.accountByCode(tx, companyId, "1350");
        for (const line of lines) add(line.accountId, line.description, new Prisma.Decimal(line.homeNet ?? line.net), new Prisma.Decimal(0));
        for (const tax of groupBy(lines.filter((line) => Number(line.homeTax ?? line.tax) > 0), "taxAccountId", "homeTax")) add(tax.key || inputTax.id, "Input tax receivable", tax.amount, new Prisma.Decimal(0));
        add(bank!.accountId, bank!.name, new Prisma.Decimal(0), total);
      } else {
        throw new AppError("This transaction type does not post to the General Ledger", 400);
      }

      // Inventory/COGS for issued sales and inventory purchases are posted with the same entry.
      if (doc.type === DocumentType.INVOICE || doc.type === DocumentType.SALES_RECEIPT) {
        for (const line of lines.filter((item) => item.inventoryTracking && item.productId)) {
          const product = await tx.productService.findFirst({ where: { id: line.productId, companyId } });
          if (!product || product.quantityOnHand.lt(line.quantity)) throw new AppError(`Insufficient stock for ${line.description}`, 409);
          // Freeze the cost basis actually used at posting so later cash-basis
          // allocations do not use an outdated draft-time average cost.
          line.averageCost = product.averageCost.toString();
          const cost = product.averageCost.mul(line.quantity);
          const inventory = await this.accountByCode(tx, companyId, "1200");
          const cogs = await this.accountByCode(tx, companyId, "5000");
          add(cogs.id, `COGS · ${line.description}`, cost, new Prisma.Decimal(0));
          add(inventory.id, `Inventory · ${line.description}`, new Prisma.Decimal(0), cost);
          const newQuantity = product.quantityOnHand.minus(line.quantity);
          await tx.productService.update({ where: { id: product.id }, data: { quantityOnHand: newQuantity } });
          await tx.stockMovement.create({ data: { companyId, productId: product.id, quantityDelta: new Prisma.Decimal(line.quantity).negated(), unitCost: product.averageCost, reason: `${doc.type} ${doc.number}`, createdByUserId: userId } });
        }
      }
      if (doc.type === DocumentType.CREDIT_MEMO) {
        for (const line of lines.filter((item) => item.inventoryTracking && item.productId)) {
          const product = await tx.productService.findFirst({ where: { id: line.productId, companyId } });
          if (!product) continue;
          const quantity = new Prisma.Decimal(line.quantity);
          const cost = product.averageCost.mul(quantity);
          const nextQuantity = product.quantityOnHand.plus(quantity);
          const inventory = await this.accountByCode(tx, companyId, "1200");
          const cogs = await this.accountByCode(tx, companyId, "5000");
          add(inventory.id, `Inventory return · ${line.description}`, cost, new Prisma.Decimal(0));
          add(cogs.id, `COGS reversal · ${line.description}`, new Prisma.Decimal(0), cost);
          await tx.productService.update({ where: { id: product.id }, data: { quantityOnHand: nextQuantity } });
          await tx.stockMovement.create({ data: { companyId, productId: product.id, quantityDelta: quantity, unitCost: product.averageCost, reason: `Credit memo ${doc.number}`, createdByUserId: userId } });
        }
      }
      if (doc.type === DocumentType.VENDOR_CREDIT) {
        for (const line of lines.filter((item) => item.inventoryTracking && item.productId)) {
          const product = await tx.productService.findFirst({ where: { id: line.productId, companyId } });
          const quantity = new Prisma.Decimal(line.quantity);
          if (!product || product.quantityOnHand.lt(quantity)) throw new AppError(`Insufficient stock to return ${line.description}`, 409);
          await tx.productService.update({ where: { id: product.id }, data: { quantityOnHand: product.quantityOnHand.minus(quantity) } });
          await tx.stockMovement.create({ data: { companyId, productId: product.id, quantityDelta: quantity.negated(), unitCost: product.averageCost, reason: `Vendor credit ${doc.number}`, createdByUserId: userId } });
        }
      }
      if (doc.type === DocumentType.BILL) {
        for (const line of lines.filter((item) => item.inventoryTracking && item.productId)) {
          const product = await tx.productService.findFirst({ where: { id: line.productId, companyId } });
          if (!product) continue;
          const quantity = new Prisma.Decimal(line.quantity);
          const currentValue = product.quantityOnHand.mul(product.averageCost);
          line.previousAverageCost = product.averageCost.toString();
          const unitCost = new Prisma.Decimal(line.homeNet ?? line.net).div(quantity);
          const addition = quantity.mul(unitCost);
          const nextQuantity = product.quantityOnHand.plus(quantity);
          const nextCost = nextQuantity.isZero() ? new Prisma.Decimal(0) : currentValue.plus(addition).div(nextQuantity);
          await tx.productService.update({ where: { id: product.id }, data: { quantityOnHand: nextQuantity, averageCost: nextCost } });
          await tx.stockMovement.create({ data: { companyId, productId: product.id, quantityDelta: quantity, unitCost, reason: `Bill ${doc.number}`, createdByUserId: userId } });
        }
      }

      const journal = await createPostedJournal(tx, companyId, userId, { date: doc.issueDate, reference: doc.number, memo: doc.memo, sourceType: doc.type, sourceId: doc.id, lines: entries });
      const nextStatus = doc.type === DocumentType.INVOICE ? DocumentStatus.SENT : doc.type === DocumentType.BILL ? DocumentStatus.APPROVED : doc.type === DocumentType.SALES_RECEIPT || doc.type === DocumentType.EXPENSE ? DocumentStatus.PAID : DocumentStatus.OPEN;
      const updated = await tx.businessDocument.update({ where: { id: doc.id }, data: { status: nextStatus, journalEntryId: journal.id, lineItems: lines as Prisma.InputJsonValue, ...(doc.type === DocumentType.SALES_RECEIPT || doc.type === DocumentType.EXPENSE ? { amountPaid: doc.total } : {}) } });
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.UPDATE, entity: doc.type, entityId: doc.id, oldValues: { status: doc.status }, newValues: { status: nextStatus, journalEntryId: journal.id } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  static async convertEstimate(companyId: string, userId: string, estimateId: string) {
    const estimate = await this.get(companyId, estimateId);
    if (estimate.type !== DocumentType.ESTIMATE || estimate.status !== DocumentStatus.DRAFT) throw new AppError("Only unconverted draft estimates can be converted", 409);
    const existingInvoice = await db.businessDocument.findFirst({ where: { companyId, sourceDocumentId: estimate.id, type: DocumentType.INVOICE } });
    if (existingInvoice) throw new AppError("This estimate has already been converted", 409);
    const lines = jsonLines(estimate).map((line) => ({ productId: line.productId, accountId: line.accountId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount, taxRateId: line.taxRateId }));
    let invoice: BusinessDocument;
    try {
      invoice = await this.create(companyId, userId, { type: DocumentType.INVOICE, contactId: estimate.contactId, issueDate: new Date().toISOString(), termsDays: estimate.termsDays, currency: estimate.currency, reference: estimate.number, memo: estimate.memo, lines, sourceDocumentId: estimate.id });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new AppError("This estimate has already been converted", 409);
      throw error;
    }
    await db.$transaction(async (tx) => {
      const updated = await tx.businessDocument.updateMany({ where: { id: estimate.id, companyId, status: DocumentStatus.DRAFT }, data: { status: DocumentStatus.OPEN } });
      if (updated.count !== 1) throw new AppError("Estimate status changed during conversion", 409);
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.UPDATE, entity: "ESTIMATE", entityId: estimate.id, oldValues: { status: DocumentStatus.DRAFT }, newValues: { status: DocumentStatus.OPEN, invoiceId: invoice.id } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.get(companyId, invoice.id);
  }

  static async convertPurchaseOrder(companyId: string, userId: string, purchaseOrderId: string) {
    const purchaseOrder = await this.get(companyId, purchaseOrderId);
    if (purchaseOrder.type !== DocumentType.PURCHASE_ORDER || !([DocumentStatus.DRAFT, DocumentStatus.OPEN] as DocumentStatus[]).includes(purchaseOrder.status)) throw new AppError("Only active purchase orders can be converted to a bill", 409);
    const existingBill = await db.businessDocument.findFirst({ where: { companyId, sourceDocumentId: purchaseOrder.id, type: DocumentType.BILL } });
    if (existingBill) throw new AppError("This purchase order has already been converted", 409);
    const lines = jsonLines(purchaseOrder).map((line) => ({ productId: line.productId, accountId: line.accountId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount, taxRateId: line.taxRateId }));
    let bill: BusinessDocument;
    try {
      bill = await this.create(companyId, userId, { type: DocumentType.BILL, contactId: purchaseOrder.contactId, issueDate: new Date().toISOString(), termsDays: purchaseOrder.termsDays, currency: purchaseOrder.currency, reference: purchaseOrder.number, memo: purchaseOrder.memo, lines, sourceDocumentId: purchaseOrder.id });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new AppError("This purchase order has already been converted", 409);
      throw error;
    }
    await db.$transaction(async (tx) => {
      const updated = await tx.businessDocument.updateMany({ where: { id: purchaseOrder.id, companyId, status: { in: [DocumentStatus.DRAFT, DocumentStatus.OPEN] } }, data: { status: DocumentStatus.RECEIVED } });
      if (updated.count !== 1) throw new AppError("Purchase order status changed during conversion", 409);
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.UPDATE, entity: "PURCHASE_ORDER", entityId: purchaseOrder.id, oldValues: { status: purchaseOrder.status }, newValues: { status: DocumentStatus.RECEIVED, billId: bill.id } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.get(companyId, bill.id);
  }

  static async void(companyId: string, userId: string, id: string) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
      const doc = await tx.businessDocument.findFirst({ where: { id, companyId }, include: { journalEntry: { include: { lines: true } } } });
      if (!doc) throw new AppError("Transaction not found", 404);
      if (doc.status === DocumentStatus.VOID || doc.status === DocumentStatus.PAID || new Prisma.Decimal(doc.amountPaid).gt(0)) throw new AppError("Paid, partially paid, or already void transactions cannot be voided", 409);
      const converted = await tx.businessDocument.findFirst({ where: { companyId, sourceDocumentId: doc.id } });
      if (converted) throw new AppError(`This transaction has already been converted to ${converted.number} and cannot be voided`, 409);
      let reversalJournalEntryId: string | null = null;
      if (doc.journalEntry) {
        const lines = jsonLines(doc);
        const stockTypes: DocumentType[] = [DocumentType.INVOICE, DocumentType.BILL, DocumentType.CREDIT_MEMO, DocumentType.VENDOR_CREDIT];
        const inventoryLines = stockTypes.includes(doc.type) ? lines.filter((line) => line.inventoryTracking && line.productId) : [];
        if (inventoryLines.length) {
          const reason = doc.type === DocumentType.CREDIT_MEMO ? `Credit memo ${doc.number}` : doc.type === DocumentType.VENDOR_CREDIT ? `Vendor credit ${doc.number}` : doc.type === DocumentType.BILL ? `Bill ${doc.number}` : `${doc.type} ${doc.number}`;
          const movements = await tx.stockMovement.findMany({ where: { companyId, reason }, orderBy: { createdAt: "asc" } });
          if (movements.length !== inventoryLines.length) throw new AppError("Inventory history is incomplete; this transaction cannot be safely voided", 409);
          const byProduct = new Map<string, typeof movements>();
          for (const movement of movements) byProduct.set(movement.productId, [...(byProduct.get(movement.productId) || []), movement]);
          for (const [productId, productMovements] of byProduct) {
            const lastOwn = productMovements[productMovements.length - 1];
            const laterMovement = await tx.stockMovement.findFirst({ where: { companyId, productId, id: { notIn: productMovements.map((movement) => movement.id) }, createdAt: { gte: lastOwn.createdAt } }, select: { id: true } });
            if (laterMovement) throw new AppError("Inventory has changed since this transaction was posted; adjust stock instead of voiding it", 409);
          }
          const nextByProduct = new Map(Array.from(byProduct, ([productId, items]) => [productId, [...items]]));
          for (const line of [...inventoryLines].reverse()) {
            const productId = line.productId as string;
            const original = nextByProduct.get(productId)?.pop();
            if (!original) throw new AppError("Inventory history does not match the transaction; void was stopped", 409);
            const product = await tx.productService.findFirst({ where: { id: productId, companyId } });
            if (!product) throw new AppError("Inventory item is missing; void was stopped", 409);
            const currentQuantity = new Prisma.Decimal(product.quantityOnHand);
            const originalDelta = new Prisma.Decimal(original.quantityDelta);
            const restoredQuantity = currentQuantity.minus(originalDelta);
            if (restoredQuantity.lt(0)) throw new AppError("Reversing this transaction would create negative stock", 409);
            const updateData: Prisma.ProductServiceUpdateInput = { quantityOnHand: restoredQuantity };
            if (doc.type === DocumentType.BILL) {
              if (typeof line.previousAverageCost !== "string") throw new AppError("The bill has no saved pre-posting inventory cost; it cannot be safely voided", 409);
              updateData.averageCost = new Prisma.Decimal(line.previousAverageCost);
            }
            await tx.productService.update({ where: { id: product.id }, data: updateData });
            await tx.stockMovement.create({ data: { companyId, productId, quantityDelta: originalDelta.negated(), unitCost: original.unitCost, reason: `Void ${doc.type} ${doc.number}`, createdByUserId: userId } });
          }
        }
        const reversal = await createPostedJournal(tx, companyId, userId, { date: new Date(), reference: `REV-${doc.number}`, memo: `Reversal of ${doc.number}`, sourceType: "REVERSAL", sourceId: doc.id, lines: doc.journalEntry.lines.map((line) => ({ accountId: line.accountId, description: `Reversal · ${line.description || doc.number}`, debit: line.credit.toString(), credit: line.debit.toString() })) });
        reversalJournalEntryId = reversal.id;
        await tx.journalEntry.update({ where: { id: doc.journalEntry.id }, data: { status: "VOID" } });
      }
      const updated = await tx.businessDocument.update({ where: { id }, data: { status: DocumentStatus.VOID } });
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.UPDATE, entity: doc.type, entityId: doc.id, oldValues: { status: doc.status }, newValues: { status: DocumentStatus.VOID, reversalJournalEntryId } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private static async createPayment(companyId: string, userId: string, input: DocumentInput) {
    if (!input.contactId || !input.bankAccountId || !input.paymentAllocations?.length) throw new AppError("Choose a contact, bank account, and one or more allocations", 400);
    const isVendor = input.type === DocumentType.VENDOR_PAYMENT;
    const contact = await db.contact.findFirst({ where: { id: input.contactId, companyId, isArchived: false } });
    if (!contact) throw new AppError("Contact not found", 404);
    if (isVendor ? !([ContactType.VENDOR, ContactType.BOTH] as ContactType[]).includes(contact.type) : !([ContactType.CUSTOMER, ContactType.BOTH] as ContactType[]).includes(contact.type)) throw new AppError("Contact type does not match this payment", 400);
    const bank = await db.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId, isActive: true } });
    if (!bank) throw new AppError("Bank account not found", 404);
    const allocations = input.paymentAllocations.map((allocation) => ({ id: allocation.documentId, amount: toDecimal(allocation.amount) }));
    if (allocations.some((item) => !item.amount.gt(0))) throw new AppError("Every payment allocation must be greater than zero", 400);
    const total = allocations.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } });
    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    if (Number.isNaN(issueDate.getTime())) throw new AppError("Payment date is invalid", 400);
    const targetType = isVendor ? DocumentType.BILL : DocumentType.INVOICE;
    const number = `${prefix[input.type]}-${Date.now().toString(36).toUpperCase()}`;
    return db.$transaction(async (tx) => {
      let paymentCurrency: string | null = null;
      let carryingTotal = new Prisma.Decimal(0);
      const details: Array<{ id: string; amount: Prisma.Decimal; document: BusinessDocument }> = [];
      for (const allocation of allocations) {
        const doc = await tx.businessDocument.findFirst({ where: { id: allocation.id, companyId, contactId: contact.id, type: targetType } });
        const allowed: DocumentStatus[] = isVendor
          ? [DocumentStatus.APPROVED, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE]
          : [DocumentStatus.SENT, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE];
        if (!doc || !allowed.includes(doc.status)) throw new AppError(`Invoice or bill ${allocation.id} is not eligible for payment`, 400);
        if (allocation.amount.gt(new Prisma.Decimal(doc.total).minus(doc.amountPaid))) throw new AppError(`Allocation exceeds the outstanding balance for ${doc.number}`, 400);
        if (paymentCurrency && paymentCurrency !== doc.currency) throw new AppError("A single payment cannot allocate across different currencies", 400);
        paymentCurrency = doc.currency;
        const fx = doc.exchangeRate.isZero() ? new Prisma.Decimal(1) : new Prisma.Decimal(doc.exchangeRate);
        carryingTotal = carryingTotal.plus(allocation.amount.mul(fx).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP));
        details.push({ ...allocation, document: doc });
      }
      paymentCurrency ||= company.currency;
      const paymentRate = await this.resolveExchangeRate(companyId, paymentCurrency, company.currency, issueDate);
      const cashTotal = total.mul(paymentRate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      carryingTotal = carryingTotal.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const difference = cashTotal.minus(carryingTotal).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const payment = await tx.businessDocument.create({ data: { companyId, contactId: contact.id, type: input.type, number,
        issueDate, dueDate: null, termsDays: 0, currency: paymentCurrency, exchangeRate: paymentRate, homeCurrencyTotal: cashTotal,
        subtotal: total, total, amountPaid: total, lineItems: allocations.map((item) => ({ documentId: item.id, amount: item.amount.toString() })) as unknown as Prisma.InputJsonValue,
        status: DocumentStatus.PAID, createdByUserId: userId, memo: input.memo || null } });
      const arAp = await this.accountByCode(tx, companyId, isVendor ? "2000" : "1100");
      const bankAccount = await tx.bankAccount.findUniqueOrThrow({ where: { id: bank.id }, include: { account: true } });
      const journalLines: Array<{ accountId: string; description?: string; debit: string | number; credit: string | number }> = isVendor
        ? [{ accountId: arAp.id, description: "Accounts Payable settlement", debit: carryingTotal.toFixed(4), credit: 0 }, { accountId: bankAccount.accountId, description: bank.name, debit: 0, credit: cashTotal.toFixed(4) }]
        : [{ accountId: bankAccount.accountId, description: bank.name, debit: cashTotal.toFixed(4), credit: 0 }, { accountId: arAp.id, description: "Accounts Receivable settlement", debit: 0, credit: carryingTotal.toFixed(4) }];
      if (!difference.isZero()) {
        const fx = settlementFx(cashTotal, carryingTotal, isVendor ? "PAYABLE" : "RECEIVABLE");
        if (fx.gain.gt(0)) journalLines.push({ accountId: (await this.accountByCode(tx, companyId, "4300")).id, description: "Realized foreign exchange gain", debit: 0, credit: fx.gain.toFixed(4) });
        if (fx.loss.gt(0)) journalLines.push({ accountId: (await this.accountByCode(tx, companyId, "6800")).id, description: "Realized foreign exchange loss", debit: fx.loss.toFixed(4), credit: 0 });
      }
      const journal = await createPostedJournal(tx, companyId, userId, { date: payment.issueDate, reference: number, memo: input.memo || "Payment", sourceType: input.type, sourceId: payment.id, lines: journalLines });
      await tx.businessDocument.update({ where: { id: payment.id }, data: { journalEntryId: journal.id } });
      for (const allocation of details) {
        const paid = new Prisma.Decimal(allocation.document.amountPaid).plus(allocation.amount);
        await tx.businessDocument.update({ where: { id: allocation.document.id }, data: { amountPaid: paid, status: paid.gte(allocation.document.total) ? DocumentStatus.PAID : DocumentStatus.PARTIALLY_PAID } });
      }
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.CREATE, entity: input.type, entityId: payment.id, newValues: { number, total: total.toString(), homeCurrencyTotal: cashTotal.toString() } } });
      return payment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private static async resolveExchangeRate(companyId: string, currency: string, homeCurrency: string, date: Date) {
    if (currency === homeCurrency) return new Prisma.Decimal(1);
    const direct = await db.currencyRate.findFirst({ where: { companyId, baseCurrency: currency, quoteCurrency: homeCurrency, rateDate: { lte: date } }, orderBy: { rateDate: "desc" } });
    if (direct) return new Prisma.Decimal(direct.rate);
    const inverse = await db.currencyRate.findFirst({ where: { companyId, baseCurrency: homeCurrency, quoteCurrency: currency, rateDate: { lte: date } }, orderBy: { rateDate: "desc" } });
    if (inverse && !new Prisma.Decimal(inverse.rate).isZero()) return new Prisma.Decimal(1).div(inverse.rate);
    throw new AppError(`No exchange rate is configured for ${currency}/${homeCurrency} on or before ${date.toISOString().slice(0,10)}`, 400);
  }

  private static async accountByCode(tx: Tx, companyId: string, code: string) {
    const account = await tx.account.findFirst({ where: { companyId, code, isActive: true } });
    if (!account) throw new AppError(`Required account ${code} is missing or inactive`, 400);
    return account;
  }
}

function groupBy(lines: any[], keyName: string, valueKey = "tax") {
  const map = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const key = line[keyName] || "";
    map.set(key, (map.get(key) || new Prisma.Decimal(0)).plus(line[valueKey] ?? line.tax));
  }
  return Array.from(map, ([key, amount]) => ({ key: key || null, amount }));
}
