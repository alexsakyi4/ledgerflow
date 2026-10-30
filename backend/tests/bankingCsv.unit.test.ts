import { parseBankCsv } from "../src/services/banking.service";

describe("bank CSV parsing", () => {
  it("recognizes common capitalized headers and currency symbols", () => {
    const rows = parseBankCsv('Date,Description,Amount,Reference\n2026-10-30,"Office supply shop","GHS 1,250.50",INV-9');
    expect(rows).toEqual([{ date: "2026-10-30", description: "Office supply shop", reference: "INV-9", externalId: undefined, amount: "1250.5" }]);
  });

  it("normalizes debit/credit columns with the bank-feed sign convention", () => {
    const rows = parseBankCsv('Transaction Date,Payee,Debit,Credit,Fit ID\n2026-10-29,Rent,"2,500.00",,abc\n2026-10-30,Customer,,750.25,xyz');
    expect(rows.map((row) => row.amount)).toEqual(["-2500", "750.25"]);
    expect(rows.map((row) => row.externalId)).toEqual(["abc", "xyz"]);
  });

  it("handles accounting parentheses and rejects ambiguous debit plus credit rows", () => {
    expect(parseBankCsv('Posted Date,Memo,Amount\n2026-10-28,Fee,"(45.20)"')[0].amount).toBe("-45.2");
    expect(() => parseBankCsv('Date,Description,Debit,Credit\n2026-10-28,Ambiguous,10,5')).toThrow("A row cannot contain both debit and credit amounts");
  });
});
