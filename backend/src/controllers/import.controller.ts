import { ImportEntity } from "@prisma/client";
import { Response } from "express";
import { z } from "zod";
import { ImportService } from "../services/import.service";
import { AppError } from "../middleware/error";
import type { AuthRequest } from "../types";
export async function importCsv(req: AuthRequest, res: Response) {
  if (!req.user?.companyId || !req.user.id) throw new AppError("Company context required", 401);
  const parsed = z.nativeEnum(ImportEntity).safeParse(String(req.params.entity).toUpperCase());
  if (!parsed.success) throw new AppError("Supported import types: CUSTOMERS, VENDORS, PRODUCTS, CHART_OF_ACCOUNTS, TRANSACTIONS", 400);
  const entity = parsed.data;
  if (([ImportEntity.CHART_OF_ACCOUNTS, ImportEntity.TRANSACTIONS] as ImportEntity[]).includes(entity) && !["OWNER", "ADMIN", "ACCOUNTANT"].includes(req.user.role || "")) throw new AppError("Accountant role or higher is required for this import", 403);
  const body = req.body as string | { csv?: string; fileName?: string };
  const csv = typeof body === "string" ? body : body?.csv;
  if (typeof csv !== "string") throw new AppError("Send CSV text as the request body or { csv } in JSON", 400);
  const fileName = typeof body === "string" ? String(req.query.fileName || "import.csv") : body.fileName || String(req.query.fileName || "import.csv");
  const result = await ImportService.run(req.user.companyId, req.user.id, entity, fileName, csv);
  res.status(201).json({ success: true, data: result });
}
