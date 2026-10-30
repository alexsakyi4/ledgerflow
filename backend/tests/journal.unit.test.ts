import { validateBalancedLines } from "../src/utils/journalBalance";

describe("double-entry journal validation", () => {
  it("accepts exact balanced debit and credit totals with decimal precision", () => {
    const result = validateBalancedLines([
      { accountId: "cash", debit: "123.4500" },
      { accountId: "revenue", credit: "100.0000" },
      { accountId: "tax", credit: "23.4500" },
    ]);
    expect(result.debits.toFixed(4)).toBe("123.4500");
    expect(result.credits.toFixed(4)).toBe("123.4500");
    expect(result.lines).toHaveLength(3);
  });

  it("rejects entries whose debit and credit totals do not balance", () => {
    expect(() => validateBalancedLines([
      { accountId: "cash", debit: "10" },
      { accountId: "income", credit: "9.99" },
    ])).toThrow(/not balanced/);
  });

  it("rejects a journal with fewer than two lines", () => {
    expect(() => validateBalancedLines([{ accountId: "cash", debit: "1" }])).toThrow(/at least two/);
  });

  it("rejects negative amounts, zero amounts, and two-sided lines", () => {
    expect(() => validateBalancedLines([{ accountId: "a", debit: "-2" }, { accountId: "b", credit: "2" }])).toThrow(/one positive/);
    expect(() => validateBalancedLines([{ accountId: "a", debit: "0", credit: "0" }, { accountId: "b", credit: "1" }])).toThrow(/one positive/);
    expect(() => validateBalancedLines([{ accountId: "a", debit: "1", credit: "1" }, { accountId: "b", credit: "2" }])).toThrow(/one positive/);
  });
});
