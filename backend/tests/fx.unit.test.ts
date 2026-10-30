import { homeValue, settlementFx } from "../src/utils/foreignExchange";

describe("foreign exchange arithmetic", () => {
  it("converts foreign amounts using decimal precision and half-up rounding", () => {
    expect(homeValue("100.125", "12.345678", 4).toFixed(4)).toBe("1236.1110");
    expect(homeValue("1.005", "1", 2).toFixed(2)).toBe("1.01");
  });

  it("recognizes a receivable gain when settlement cash exceeds its carrying amount", () => {
    const result = settlementFx("1250.00", "1200.00", "RECEIVABLE");
    expect(result.gain.toFixed(2)).toBe("50.00");
    expect(result.loss.toFixed(2)).toBe("0.00");
  });

  it("recognizes a receivable loss when settlement cash is below carrying amount", () => {
    const result = settlementFx("1150.00", "1200.00", "RECEIVABLE");
    expect(result.gain.toFixed(2)).toBe("0.00");
    expect(result.loss.toFixed(2)).toBe("50.00");
  });

  it("reverses gain/loss economics for vendor payables", () => {
    const paidMore = settlementFx("1250.00", "1200.00", "PAYABLE");
    const paidLess = settlementFx("1150.00", "1200.00", "PAYABLE");
    expect(paidMore.loss.toFixed(2)).toBe("50.00");
    expect(paidLess.gain.toFixed(2)).toBe("50.00");
  });

  it("does not classify a zero FX difference as a gain or loss", () => {
    const result = settlementFx("1200.00", "1200.00", "RECEIVABLE");
    expect(result.gain.isZero()).toBe(true);
    expect(result.loss.isZero()).toBe(true);
  });
});
