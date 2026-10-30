import { ContactType, Prisma } from "@prisma/client";
import { summarizeContactBalances } from "../src/services/contact.service";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("contact home-currency balances", () => {
  it("nets partially-paid invoices and credit memos in home currency", () => {
    const result = summarizeContactBalances(ContactType.CUSTOMER, decimal("25"), [
      { type: "INVOICE", total: decimal("100"), amountPaid: decimal("40"), exchangeRate: decimal("1.2") },
      { type: "CREDIT_MEMO", total: decimal("10"), amountPaid: decimal("0"), exchangeRate: decimal("1.2") },
    ]);
    expect(result).toEqual({ receivableBalance: "85.00", payableBalance: "0.00", currentBalance: "85.00" });
  });

  it("nets vendor credits against bills", () => {
    const result = summarizeContactBalances(ContactType.VENDOR, decimal("50"), [
      { type: "BILL", total: decimal("100"), amountPaid: decimal("0"), exchangeRate: decimal("2") },
      { type: "VENDOR_CREDIT", total: decimal("25"), amountPaid: decimal("0"), exchangeRate: decimal("2") },
    ]);
    expect(result).toEqual({ receivableBalance: "0.00", payableBalance: "200.00", currentBalance: "200.00" });
  });

  it("shows separate receivable/payable totals and a net for dual-role contacts", () => {
    const result = summarizeContactBalances(ContactType.BOTH, decimal("-10"), [
      { type: "INVOICE", total: decimal("100"), amountPaid: decimal("0"), exchangeRate: decimal("1") },
      { type: "CREDIT_MEMO", total: decimal("10"), amountPaid: decimal("0"), exchangeRate: decimal("1") },
      { type: "BILL", total: decimal("50"), amountPaid: decimal("0"), exchangeRate: decimal("1") },
      { type: "VENDOR_CREDIT", total: decimal("5"), amountPaid: decimal("0"), exchangeRate: decimal("1") },
    ]);
    expect(result).toEqual({ receivableBalance: "90.00", payableBalance: "55.00", currentBalance: "35.00" });
  });
});
