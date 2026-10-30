import { AuditAction, Prisma, ProductKind } from "@prisma/client";
import { db } from "../config/db";
import { AppError } from "../middleware/error";
import { createPostedJournal } from "./journal.service";

export type ProductInput = {
  kind: ProductKind; name: string; sku?: string | null; description?: string | null;
  salePrice: number | string; purchaseCost: number | string; incomeAccountId: string; expenseAccountId?: string | null;
  taxRateId?: string | null; inventoryTracking?: boolean; quantityOnHand?: number | string;
  averageCost?: number | string; reorderLevel?: number | string;
};

export class ProductService {
  static async list(companyId: string, search?: string, includeInactive = false) {
    return db.productService.findMany({ where: { companyId, ...(includeInactive ? {} : { isActive: true }), ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] } : {}) }, include: { incomeAccount: { select: { id: true, code: true, name: true } }, expenseAccount: { select: { id: true, code: true, name: true } }, taxRate: true }, orderBy: { name: "asc" }, ...(search ? { take: 20 } : {}) });
  }

  static async validateReferences(companyId: string, incomeAccountId: string, expenseAccountId?: string | null, taxRateId?: string | null) {
    const [income, expense, tax] = await Promise.all([
      db.account.findFirst({ where: { id: incomeAccountId, companyId, isActive: true } }),
      expenseAccountId ? db.account.findFirst({ where: { id: expenseAccountId, companyId, isActive: true } }) : Promise.resolve(null),
      taxRateId ? db.taxRate.findFirst({ where: { id: taxRateId, companyId, isActive: true } }) : Promise.resolve(null),
    ]);
    if (!income) throw new AppError("Income account must be active and belong to this company", 400);
    if (expenseAccountId && !expense) throw new AppError("Expense account must be active and belong to this company", 400);
    if (taxRateId && !tax) throw new AppError("Tax rate must be active and belong to this company", 400);
  }

  static async create(companyId: string, userId: string, input: ProductInput) {
    await this.validateReferences(companyId, input.incomeAccountId, input.expenseAccountId, input.taxRateId);
    return db.$transaction(async (tx) => {
      const quantity = new Prisma.Decimal(input.quantityOnHand ?? 0);
      const averageCost = new Prisma.Decimal(input.averageCost ?? input.purchaseCost);
      if (quantity.isNegative() || averageCost.isNegative()) throw new AppError("Opening quantity and average cost cannot be negative", 400);
      if (input.inventoryTracking && input.kind !== "PRODUCT") throw new AppError("Inventory tracking is only available for products", 400);
      if (quantity.gt(0) && !input.inventoryTracking) throw new AppError("Opening stock requires inventory tracking on a product", 400);
      const product = await tx.productService.create({ data: {
        companyId, kind: input.kind, name: input.name.trim(), sku: input.sku?.trim() || null, description: input.description || null,
        salePrice: new Prisma.Decimal(input.salePrice), purchaseCost: new Prisma.Decimal(input.purchaseCost), incomeAccountId: input.incomeAccountId,
        expenseAccountId: input.expenseAccountId || null, taxRateId: input.taxRateId || null, inventoryTracking: Boolean(input.inventoryTracking),
        quantityOnHand: quantity, averageCost, reorderLevel: new Prisma.Decimal(input.reorderLevel ?? 0),
      } });
      if (quantity.gt(0)) {
        const openingValue = quantity.mul(averageCost);
        await tx.stockMovement.create({ data: { companyId, productId: product.id, quantityDelta: quantity, unitCost: averageCost, reason: "Opening inventory", createdByUserId: userId } });
        if (openingValue.gt(0)) {
          const [inventory, equity] = await Promise.all([
            tx.account.findFirst({ where: { companyId, code: "1200", isActive: true } }),
            tx.account.findFirst({ where: { companyId, code: "3000", isActive: true } }),
          ]);
          if (!inventory || !equity) throw new AppError("Inventory and opening equity accounts are required to set opening stock", 400);
          await createPostedJournal(tx, companyId, userId, { date: new Date(), reference: `OPEN-${product.sku || product.id}`, memo: `Opening stock · ${product.name}`, sourceType: "STOCK_OPENING", sourceId: product.id, lines: [{ accountId: inventory.id, debit: openingValue.toString(), credit: 0 }, { accountId: equity.id, debit: 0, credit: openingValue.toString() }] });
        }
      }
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.CREATE, entity: "ProductService", entityId: product.id, newValues: { name: product.name, sku: product.sku, kind: product.kind } } });
      return product;
    });
  }

  static async update(companyId: string, userId: string, id: string, input: Partial<ProductInput>) {
    if (input.quantityOnHand !== undefined || input.averageCost !== undefined) throw new AppError("Use the stock adjustment workflow to change quantity or average cost", 400);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
      const before = await tx.productService.findFirst({ where: { id, companyId } });
      if (!before) throw new AppError("Product or service not found", 404);
      if (!before.isActive) throw new AppError("Archived products or services cannot be updated", 409);
      const nextKind = input.kind ?? before.kind;
      const nextInventoryTracking = input.inventoryTracking ?? before.inventoryTracking;
      if (nextInventoryTracking && nextKind !== "PRODUCT") throw new AppError("Inventory tracking is only available for products", 400);
      if (before.inventoryTracking && !nextInventoryTracking && before.quantityOnHand.gt(0)) throw new AppError("Reduce inventory to zero before disabling inventory tracking", 409);
      if (nextKind !== "PRODUCT" && before.quantityOnHand.gt(0)) throw new AppError("Inventory quantity must be zero before changing this item to a service", 409);
      if (input.incomeAccountId || input.expenseAccountId !== undefined || input.taxRateId !== undefined) {
        await this.validateReferences(companyId, input.incomeAccountId || before.incomeAccountId, input.expenseAccountId === undefined ? before.expenseAccountId : input.expenseAccountId, input.taxRateId === undefined ? before.taxRateId : input.taxRateId);
      }
      const data: Prisma.ProductServiceUpdateInput = {};
      if (input.kind !== undefined) data.kind = input.kind;
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.sku !== undefined) data.sku = input.sku?.trim() || null;
      if (input.description !== undefined) data.description = input.description;
      if (input.salePrice !== undefined) data.salePrice = new Prisma.Decimal(input.salePrice);
      if (input.purchaseCost !== undefined) data.purchaseCost = new Prisma.Decimal(input.purchaseCost);
      if (input.incomeAccountId !== undefined) data.incomeAccount = { connect: { id: input.incomeAccountId } };
      if (input.expenseAccountId !== undefined) data.expenseAccount = input.expenseAccountId ? { connect: { id: input.expenseAccountId } } : { disconnect: true };
      if (input.taxRateId !== undefined) data.taxRate = input.taxRateId ? { connect: { id: input.taxRateId } } : { disconnect: true };
      if (input.inventoryTracking !== undefined) data.inventoryTracking = input.inventoryTracking;
      if (input.reorderLevel !== undefined) data.reorderLevel = new Prisma.Decimal(input.reorderLevel);
      const product = await tx.productService.update({ where: { id }, data });
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.UPDATE, entity: "ProductService", entityId: id, oldValues: { name: before.name, sku: before.sku }, newValues: { name: product.name, sku: product.sku } } });
      return product;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  static async adjustStock(companyId: string, userId: string, id: string, quantityDelta: string | number, unitCost: string | number, reason: string) {
    const delta = new Prisma.Decimal(quantityDelta);
    const cost = new Prisma.Decimal(unitCost);
    if (delta.isZero()) throw new AppError("Adjustment quantity must not be zero", 400);
    if (cost.isNegative()) throw new AppError("Unit cost cannot be negative", 400);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
      const product = await tx.productService.findFirst({ where: { id, companyId, isActive: true } });
      if (!product) throw new AppError("Product not found", 404);
      if (!product.inventoryTracking || product.kind !== "PRODUCT") throw new AppError("Inventory tracking is not enabled for this product", 400);
      const newQty = product.quantityOnHand.plus(delta);
      if (newQty.isNegative()) throw new AppError("Adjustment would make quantity on hand negative", 409);
      const oldValue = product.quantityOnHand.mul(product.averageCost);
      const addedValue = delta.gt(0) ? delta.mul(cost) : new Prisma.Decimal(0);
      const newAverage = newQty.isZero() ? new Prisma.Decimal(0) : delta.gt(0) ? oldValue.plus(addedValue).div(newQty) : product.averageCost;
      const updated = await tx.productService.update({ where: { id }, data: { quantityOnHand: newQty, averageCost: newAverage } });
      const effectiveCost = delta.gt(0) ? cost : product.averageCost;
      const movement = await tx.stockMovement.create({ data: { companyId, productId: id, quantityDelta: delta, unitCost: effectiveCost, reason: reason.trim(), createdByUserId: userId } });
      const adjustmentValue = delta.abs().mul(effectiveCost);
      if (adjustmentValue.gt(0)) {
        const inventory = await tx.account.findFirst({ where: { companyId, code: "1200", isActive: true } });
        const offset = await tx.account.findFirst({ where: { companyId, code: delta.gt(0) ? "4200" : "5000", isActive: true } });
        if (!inventory || !offset) throw new AppError("Inventory adjustment accounts are missing", 400);
        await createPostedJournal(tx, companyId, userId, { date: new Date(), reference: `STK-${movement.id.slice(-8)}`, memo: `Stock adjustment · ${reason}`, sourceType: "STOCK_ADJUSTMENT", sourceId: movement.id, lines: delta.gt(0)
          ? [{ accountId: inventory.id, debit: adjustmentValue.toString(), credit: 0 }, { accountId: offset.id, debit: 0, credit: adjustmentValue.toString() }]
          : [{ accountId: offset.id, debit: adjustmentValue.toString(), credit: 0 }, { accountId: inventory.id, debit: 0, credit: adjustmentValue.toString() }] });
      }
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.UPDATE, entity: "StockMovement", entityId: id, oldValues: { quantityOnHand: product.quantityOnHand.toString() }, newValues: { quantityOnHand: newQty.toString(), reason } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  static async archive(companyId: string, userId: string, id: string) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
      const product = await tx.productService.findFirst({ where: { id, companyId } });
      if (!product) throw new AppError("Product or service not found", 404);
      if (!product.isActive) throw new AppError("Product or service is already archived", 409);
      if (product.inventoryTracking && product.quantityOnHand.gt(0)) throw new AppError("Reduce inventory to zero before archiving this product", 409);
      const updated = await tx.productService.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({ data: { companyId, userId, action: AuditAction.DELETE, entity: "ProductService", entityId: id, oldValues: { isActive: true }, newValues: { isActive: false } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
