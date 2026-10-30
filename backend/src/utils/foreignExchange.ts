import { Prisma } from "@prisma/client";

export type SettlementSide = "RECEIVABLE" | "PAYABLE";
export function homeValue(amount: Prisma.Decimal | number | string, rate: Prisma.Decimal | number | string, scale = 4) {
  return new Prisma.Decimal(amount).mul(new Prisma.Decimal(rate)).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}
export function settlementFx(cashHome: Prisma.Decimal | number | string, carryingHome: Prisma.Decimal | number | string, side: SettlementSide) {
  const cash = new Prisma.Decimal(cashHome);
  const carrying = new Prisma.Decimal(carryingHome);
  const signedGain = side === "RECEIVABLE" ? cash.minus(carrying) : carrying.minus(cash);
  return {
    gain: signedGain.gt(0) ? signedGain : new Prisma.Decimal(0),
    loss: signedGain.isNegative() ? signedGain.abs() : new Prisma.Decimal(0),
  };
}
