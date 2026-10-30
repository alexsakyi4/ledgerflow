import Stripe from "stripe";
import { DocumentStatus, DocumentType, Prisma } from "@prisma/client";
import { env } from "../config/env";
import { db } from "../config/db";
import { AppError } from "../middleware/error";
import { createPostedJournal } from "./journal.service";
import { settlementFx } from "../utils/foreignExchange";

let stripeClient: Stripe | null = null;
const zeroDecimalCurrencies = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
const threeDecimalCurrencies = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);
function stripe() {
  if (!env.STRIPE_SECRET_KEY) throw new AppError("Stripe is not configured. Set STRIPE_SECRET_KEY.", 503);
  if (!stripeClient) stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}
function currencyDecimals(currency: string) {
  const code = currency.toLowerCase();
  return zeroDecimalCurrencies.has(code) ? 0 : threeDecimalCurrencies.has(code) ? 3 : 2;
}
function minorUnits(amount: Prisma.Decimal, currency: string) {
  return amount.mul(new Prisma.Decimal(10).pow(currencyDecimals(currency))).round().toNumber();
}
function amountFromMinor(value: number, currency: string) {
  return new Prisma.Decimal(value).div(new Prisma.Decimal(10).pow(currencyDecimals(currency)));
}

export class StripeService {
  static async createCheckout(companyId: string, invoiceId: string, successUrl?: string, cancelUrl?: string) {
    const invoice = await db.businessDocument.findFirst({ where: { id: invoiceId, companyId, type: DocumentType.INVOICE }, include: { contact: true, company: true } });
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (!([DocumentStatus.SENT, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE] as DocumentStatus[]).includes(invoice.status)) throw new AppError("Only open invoices can be paid online", 409);
    const outstanding = new Prisma.Decimal(invoice.total).minus(invoice.amountPaid);
    if (!outstanding.gt(0)) throw new AppError("Invoice has no outstanding balance", 409);
    const currency = invoice.currency.toLowerCase();
    const normalizedCharge = amountFromMinor(minorUnits(outstanding, currency), currency);
    if (!normalizedCharge.equals(outstanding)) throw new AppError(`Stripe cannot charge the exact outstanding balance at ${currency.toUpperCase()} precision. Adjust the invoice balance before creating a payment link.`, 400);
    const existing = await db.stripePayment.findFirst({ where: { companyId, documentId: invoice.id, amount: outstanding, currency: invoice.currency, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    if (existing) {
      const session = await stripe().checkout.sessions.retrieve(existing.checkoutSessionId);
      if (session.status === "open" && session.url) return { checkoutUrl: session.url, sessionId: session.id, amount: outstanding.toFixed(currencyDecimals(currency)), currency: invoice.currency };
      if (session.status === "expired") await db.stripePayment.update({ where: { id: existing.id }, data: { status: "EXPIRED" } });
    }
    const attempts = await db.stripePayment.count({ where: { companyId, documentId: invoice.id, amount: outstanding, currency: invoice.currency } });
    const session = await stripe().checkout.sessions.create({
      mode: "payment", client_reference_id: invoice.id, metadata: { companyId, documentId: invoice.id },
      line_items: [{ price_data: { currency, unit_amount: minorUnits(outstanding, currency), product_data: { name: `Invoice ${invoice.number}`, description: invoice.contact?.displayName || invoice.company.name } }, quantity: 1 }],
      success_url: successUrl || `${env.PUBLIC_APP_URL}/sales/invoices?payment=success`,
      cancel_url: cancelUrl || `${env.PUBLIC_APP_URL}/sales/invoices?payment=cancelled`,
    }, { idempotencyKey: `invoice-${invoice.id}-${outstanding.toFixed(4)}-${attempts}` });
    if (!session.url) throw new AppError("Stripe did not return a checkout URL", 502);
    await db.stripePayment.create({ data: { companyId, documentId: invoice.id, checkoutSessionId: session.id, amount: outstanding, currency: invoice.currency, status: "PENDING" } });
    return { checkoutUrl: session.url, sessionId: session.id, amount: outstanding.toFixed(currencyDecimals(currency)), currency: invoice.currency };
  }

  static constructEvent(payload: Buffer, signature: string): Stripe.Event {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new AppError("Stripe webhook is not configured", 503);
    try { return stripe().webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET); }
    catch { throw new AppError("Invalid Stripe webhook signature", 400); }
  }

  static async handleEvent(event: Stripe.Event) {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") await this.completeCheckout(session);
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await db.stripePayment.updateMany({ where: { checkoutSessionId: session.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    }
    return { received: true };
  }

  private static async completeCheckout(session: Stripe.Checkout.Session) {
    if (!session.metadata?.companyId || !session.metadata?.documentId || session.client_reference_id !== session.metadata.documentId) throw new AppError("Stripe session metadata is invalid", 400);
    await db.$transaction(async (tx) => {
      const record = await tx.stripePayment.findUnique({ where: { checkoutSessionId: session.id } });
      if (!record) throw new AppError("Stripe payment session is not registered", 404);
      if (record.companyId !== session.metadata!.companyId || record.documentId !== session.metadata!.documentId) throw new AppError("Stripe session does not match its registered invoice", 400);
      if (record.status === "PAID") return;
      const invoice = await tx.businessDocument.findFirst({ where: { id: record.documentId, companyId: record.companyId, type: DocumentType.INVOICE } });
      if (!invoice) throw new AppError("Invoice no longer exists", 404);
      const amount = new Prisma.Decimal(record.amount);
      const outstanding = new Prisma.Decimal(invoice.total).minus(invoice.amountPaid);
      if (!outstanding.gt(0) || amount.gt(outstanding)) throw new AppError("Stripe payment exceeds the outstanding invoice balance", 409);
      if (session.currency?.toLowerCase() !== record.currency.toLowerCase() || (session.amount_total !== null && session.amount_total !== minorUnits(amount, record.currency))) throw new AppError("Stripe payment currency or amount does not match the invoice", 400);

      const company = await tx.company.findUniqueOrThrow({ where: { id: record.companyId }, select: { currency: true } });
      const cash = await tx.account.findFirst({ where: { companyId: record.companyId, code: "1000", isActive: true } });
      const ar = await tx.account.findFirst({ where: { companyId: record.companyId, code: "1100", isActive: true } });
      if (!cash || !ar) throw new AppError("Required cash or receivables account missing", 400);
      const paymentDate = new Date();
      let paymentRate = new Prisma.Decimal(1);
      if (record.currency !== company.currency) {
        const direct = await tx.currencyRate.findFirst({ where: { companyId: record.companyId, baseCurrency: record.currency, quoteCurrency: company.currency, rateDate: { lte: paymentDate } }, orderBy: { rateDate: "desc" } });
        if (direct) paymentRate = new Prisma.Decimal(direct.rate);
        else {
          const inverse = await tx.currencyRate.findFirst({ where: { companyId: record.companyId, baseCurrency: company.currency, quoteCurrency: record.currency, rateDate: { lte: paymentDate } }, orderBy: { rateDate: "desc" } });
          if (!inverse || new Prisma.Decimal(inverse.rate).isZero()) throw new AppError(`No current exchange rate is configured for ${record.currency}/${company.currency}`, 400);
          paymentRate = new Prisma.Decimal(1).div(inverse.rate);
        }
      }
      const cashHome = amount.mul(paymentRate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const carryingHome = amount.mul(invoice.exchangeRate.isZero() ? 1 : invoice.exchangeRate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const fx = settlementFx(cashHome, carryingHome, "RECEIVABLE");
      const number = `STRIPE-${session.id.slice(-12).toUpperCase()}`;
      const payment = await tx.businessDocument.create({ data: {
        companyId: record.companyId, contactId: invoice.contactId, type: DocumentType.CUSTOMER_PAYMENT, number,
        issueDate: paymentDate, currency: record.currency, exchangeRate: paymentRate, homeCurrencyTotal: cashHome,
        subtotal: amount, total: amount, amountPaid: amount, status: DocumentStatus.PAID,
        reference: typeof session.payment_intent === "string" ? session.payment_intent : session.id,
        memo: "Online payment via Stripe", lineItems: [{ invoiceId: invoice.id, amount: amount.toString(), processor: "Stripe" }] as unknown as Prisma.InputJsonValue,
        createdByUserId: invoice.createdByUserId,
      } });
      const lines: Array<{ accountId: string; debit: string | number; credit: string | number; description?: string }> = [
        { accountId: cash.id, debit: cashHome.toFixed(4), credit: 0, description: "Stripe cash received" },
        { accountId: ar.id, debit: 0, credit: carryingHome.toFixed(4), description: "Accounts Receivable settlement" },
      ];
      if (fx.gain.gt(0)) {
        const gain = await tx.account.findFirst({ where: { companyId: record.companyId, code: "4300", isActive: true } });
        if (!gain) throw new AppError("Realized FX gain account 4300 is missing", 400);
        lines.push({ accountId: gain.id, debit: 0, credit: fx.gain.toFixed(4), description: "Realized foreign exchange gain" });
      }
      if (fx.loss.gt(0)) {
        const loss = await tx.account.findFirst({ where: { companyId: record.companyId, code: "6800", isActive: true } });
        if (!loss) throw new AppError("Realized FX loss account 6800 is missing", 400);
        lines.push({ accountId: loss.id, debit: fx.loss.toFixed(4), credit: 0, description: "Realized foreign exchange loss" });
      }
      const journal = await createPostedJournal(tx, record.companyId, invoice.createdByUserId, { date: paymentDate, reference: number, memo: "Stripe invoice payment", sourceType: "STRIPE_PAYMENT", sourceId: record.id, lines });
      await tx.businessDocument.update({ where: { id: payment.id }, data: { journalEntryId: journal.id } });
      const nextPaid = new Prisma.Decimal(invoice.amountPaid).plus(amount);
      await tx.businessDocument.update({ where: { id: invoice.id }, data: { amountPaid: nextPaid, status: nextPaid.gte(invoice.total) ? DocumentStatus.PAID : DocumentStatus.PARTIALLY_PAID } });
      await tx.stripePayment.update({ where: { id: record.id }, data: { status: "PAID", paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
