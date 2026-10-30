import jwt from "jsonwebtoken";
import argon2 from "argon2";
import type { CompanyMemberRole } from "@prisma/client";
import request from "supertest";
import app from "../src/app";
import { db } from "../src/config/db";
import { env } from "../src/config/env";

const runIntegration = process.env.RUN_DB_INTEGRATION === "true";
const integration = runIntegration ? describe : describe.skip;

integration("company and Chart of Accounts API integration", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerEmail = `phase2-owner-${suffix}@test.invalid`;
  const readerEmail = `phase2-reader-${suffix}@test.invalid`;
  let ownerId = "";
  let readerId = "";
  let companyId = "";
  let ownerToken = "";
  let readerToken = "";

  function accessToken(userId: string, email: string) {
    return jwt.sign({ sub: userId, email, type: "access" }, env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
  }

  beforeAll(async () => {
    const passwordHash = await argon2.hash("Integration-test-password-123!");
    const owner = await db.user.create({ data: { email: ownerEmail, passwordHash } });
    const reader = await db.user.create({ data: { email: readerEmail, passwordHash } });
    ownerId = owner.id; readerId = reader.id;
    const company = await db.company.create({ data: { name: `Phase 2 test ${suffix}`, currency: "GHS" } });
    companyId = company.id;
    await db.companyMember.createMany({ data: [
      { userId: owner.id, companyId: company.id, role: "OWNER" as CompanyMemberRole },
      { userId: reader.id, companyId: company.id, role: "READ_ONLY" as CompanyMemberRole },
    ] });
    ownerToken = accessToken(owner.id, owner.email);
    readerToken = accessToken(reader.id, reader.email);
  });

  afterAll(async () => {
    if (companyId) await db.company.deleteMany({ where: { id: companyId } });
    if (ownerId || readerId) await db.user.deleteMany({ where: { id: { in: [ownerId, readerId].filter(Boolean) } } });
    await db.$disconnect();
  });

  it("logs in successfully, signs an access token, and persists the refresh session", async () => {
    const response = await request(app).post("/api/auth/login").send({ email: ownerEmail, password: "Integration-test-password-123!" });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const token = response.body.data.accessToken as string;
    expect((jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string }).sub).toBe(ownerId);
    const session = await db.session.findFirst({ where: { userId: ownerId } });
    expect(session).not.toBeNull();
  });

  it("creates companies for the caller and lists only their memberships", async () => {
    const response = await request(app).get("/api/companies").set("Authorization", `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.some((company: { id: string }) => company.id === companyId)).toBe(true);
  });

  it("permits read-only members to list accounts but blocks account mutations", async () => {
    const list = await request(app).get(`/api/companies/${companyId}/accounts`).set("Authorization", `Bearer ${readerToken}`);
    expect(list.status).toBe(200);
    const create = await request(app).post(`/api/companies/${companyId}/accounts`)
      .set("Authorization", `Bearer ${readerToken}`)
      .send({ code: "8999", name: "Forbidden account", type: "EXPENSE" });
    expect(create.status).toBe(403);
  });

  it("blocks users who are not company members", async () => {
    const foreignCompany = await db.company.create({ data: { name: `Foreign ${suffix}`, currency: "GHS" } });
    try {
      const response = await request(app).get(`/api/companies/${foreignCompany.id}/accounts`).set("Authorization", `Bearer ${ownerToken}`);
      expect(response.status).toBe(403);
    } finally {
      await db.company.delete({ where: { id: foreignCompany.id } });
    }
  });

  it("allows an owner to create an account and writes the audit record", async () => {
    const response = await request(app).post(`/api/companies/${companyId}/accounts`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code: "8998", name: "Integration test account", type: "EXPENSE", openingBalance: "10.50" });
    expect(response.status).toBe(201);
    const audit = await db.auditLog.findFirst({ where: { companyId, entity: "Account", entityId: response.body.data.id } });
    expect(audit?.action).toBe("CREATE");
  });

  it("enforces balanced posted journal entries at the PostgreSQL commit boundary", async () => {
    const debitAccount = await db.account.create({ data: { companyId, code: "8996", name: "Trigger debit", type: "ASSET" } });
    const creditAccount = await db.account.create({ data: { companyId, code: "8997", name: "Trigger credit", type: "INCOME" } });
    await expect(db.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({ data: { companyId, date: new Date(), createdByUserId: ownerId, status: "POSTED" } });
      await tx.journalLine.createMany({ data: [
        { entryId: entry.id, accountId: debitAccount.id, debit: "10.00", credit: "0" },
        { entryId: entry.id, accountId: creditAccount.id, debit: "0", credit: "9.99" },
      ] });
      // Force deferred commit checks while still inside Prisma's interactive callback.
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return entry.id;
    })).rejects.toThrow(/unbalanced/i);
  });
});
