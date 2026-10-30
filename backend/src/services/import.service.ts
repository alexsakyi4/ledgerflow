import { parse as parseCsv } from "csv-parse/sync";
import { AuditAction, ContactType, ImportEntity, ProductKind, Prisma } from "@prisma/client";
import { db } from "../config/db";
import { AppError } from "../middleware/error";
import { AccountService } from "./account.service";
import { ContactService } from "./contact.service";
import { ProductService } from "./product.service";
import { JournalService } from "./journal.service";

type CsvRow = Record<string, string>;

export class ImportService {
  static async run(companyId: string, userId: string, entity: ImportEntity, fileName: string, csv: string) {
    if (!csv.trim()) throw new AppError("CSV file is empty", 400);
    let rows: CsvRow[];
    try { rows = parseCsv(csv, { columns: true, skip_empty_lines: true, bom: true, trim: true, max_record_size: 100_000 }) as CsvRow[]; }
    catch (error: any) { throw new AppError(`Invalid CSV: ${error.message}`, 400); }
    if (!rows.length) throw new AppError("CSV has no data rows", 400);
    if (rows.length > 5000) throw new AppError("Import is limited to 5,000 rows per file", 413);
    let importedRows = 0;
    const errors: Array<{ row: number; message: string }> = [];
    if (entity === ImportEntity.TRANSACTIONS) {
      const groups = new Map<string, CsvRow[]>();
      rows.forEach((row, index) => { const ref = row.entry || row.reference || `row-${index + 2}`; groups.set(ref, [...(groups.get(ref) || []), row]); });
      for (const [reference, group] of groups) {
        try {
          const first = group[0];
          const accountMap = await db.account.findMany({ where: { companyId }, select: { id: true, code: true } });
          const byCode = new Map(accountMap.map((account) => [account.code, account.id]));
          const lines = group.map((row) => {
            const accountId = byCode.get(row.accountCode || row.account_code || "");
            if (!accountId) throw new Error(`Unknown account code ${row.accountCode || row.account_code}`);
            return { accountId, debit: row.debit || "0", credit: row.credit || "0", description: row.description || undefined };
          });
          const date = new Date(first.date || first.transactionDate || "");
          if (Number.isNaN(date.getTime())) throw new Error("A valid date column is required");
          await JournalService.create(companyId, userId, { date, reference, memo: first.memo || "Imported transaction", sourceType: "CSV_IMPORT", lines });
          importedRows += group.length;
        } catch (error: any) { errors.push({ row: rows.indexOf(group[0]) + 2, message: error.message }); }
      }
    } else {
      const coas: CsvRow[] = entity === ImportEntity.CHART_OF_ACCOUNTS ? rows : [];
      const codeToId = new Map<string, string>();
      if (coas.length) {
        const pending = [...coas];
        let progress = true;
        while (pending.length && progress) {
          progress = false;
          for (let i = pending.length - 1; i >= 0; i--) {
            const row = pending[i];
            try {
              const parentCode = row.parentCode || row.parent_code || "";
              if (parentCode && !codeToId.has(parentCode)) continue;
              const account = await AccountService.create(companyId, userId, {
                code: required(row.code, "code"), name: required(row.name, "name"), type: row.type.toUpperCase() as any,
                description: row.description || null, openingBalance: row.openingBalance || row.opening_balance || 0,
                openingBalanceDate: row.openingBalanceDate || row.opening_balance_date || null,
                parentId: parentCode ? codeToId.get(parentCode) : null,
              });
              codeToId.set(account.code, account.id); pending.splice(i, 1); importedRows++; progress = true;
            } catch (error: any) { errors.push({ row: rows.indexOf(row) + 2, message: error.message }); pending.splice(i, 1); }
          }
        }
        for (const row of pending) errors.push({ row: rows.indexOf(row) + 2, message: `Parent account code not found: ${row.parentCode || row.parent_code}` });
      } else {
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index];
          try {
            if (entity === ImportEntity.CUSTOMERS || entity === ImportEntity.VENDORS) {
              const kind = entity === ImportEntity.CUSTOMERS ? ContactType.CUSTOMER : ContactType.VENDOR;
              await ContactService.create(companyId, userId, {
                type: kind, displayName: required(row.displayName || row.name, "displayName/name"), companyName: row.companyName || row.company || null,
                email: row.email || null, phone: row.phone || null, taxId: row.taxId || row.tax_id || null,
                currency: row.currency || "GHS", paymentTermsDays: Number(row.paymentTermsDays || row.payment_terms_days || 0),
                billingAddress: row.billingAddress ? JSON.parse(row.billingAddress) : null,
                shippingAddress: row.shippingAddress ? JSON.parse(row.shippingAddress) : null,
              });
            } else if (entity === ImportEntity.PRODUCTS) {
              const accounts = await db.account.findMany({ where: { companyId }, select: { id: true, code: true } });
              const accountMap = new Map(accounts.map((account) => [account.code, account.id]));
              const incomeAccountId = accountMap.get(row.incomeAccountCode || row.income_account_code || "");
              if (!incomeAccountId) throw new Error("Valid incomeAccountCode is required");
              await ProductService.create(companyId, userId, {
                kind: (row.kind || "SERVICE").toUpperCase() as ProductKind, name: required(row.name, "name"), sku: row.sku || null,
                description: row.description || null, salePrice: row.salePrice || row.sale_price || "0", purchaseCost: row.purchaseCost || row.purchase_cost || "0",
                incomeAccountId, expenseAccountId: accountMap.get(row.expenseAccountCode || row.expense_account_code || "") || null,
                inventoryTracking: /^(true|1|yes)$/i.test(row.inventoryTracking || row.inventory_tracking || "false"),
                quantityOnHand: row.quantityOnHand || row.quantity_on_hand || "0", averageCost: row.averageCost || row.average_cost || row.purchaseCost || "0",
                reorderLevel: row.reorderLevel || row.reorder_level || "0",
              });
            }
            importedRows++;
          } catch (error: any) { errors.push({ row: index + 2, message: error.message }); }
        }
      }
    }
    const batch = await db.importBatch.create({ data: {
      companyId, userId, entity, fileName: fileName.slice(0, 255), totalRows: rows.length,
      importedRows, rejectedRows: rows.length - importedRows, errors: errors as unknown as Prisma.InputJsonValue,
    } });
    await db.auditLog.create({ data: { companyId, userId, action: AuditAction.CREATE, entity: "ImportBatch", entityId: batch.id, newValues: { entity, fileName, importedRows, rejectedRows: rows.length - importedRows } } });
    return { batchId: batch.id, totalRows: rows.length, importedRows, rejectedRows: rows.length - importedRows, errors };
  }
}

function required(value: string | undefined, label: string) { const out = value?.trim(); if (!out) throw new Error(`${label} is required`); return out; }
