import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { DEFAULT_ACCOUNTS } from "../src/data/defaultAccounts";

const prisma = new PrismaClient();

async function main() {
  const saltHash = await argon2.hash("Admin@12345");

  // Demo company
  const existingCompany = await prisma.company.findFirst({ where: { name: "Demo Company LLC" } });
  const company = existingCompany || await prisma.company.create({
    data: {
      name: "Demo Company LLC",
      legalName: "Demo Company LLC",
      legalEntityType: "LLC",
      fiscalYearStart: 1,
      currency: "USD",
      taxSettings: {},
      address: {
        street: "123 Main Street",
        city: "Accra",
        region: "Greater Accra",
        postalCode: "",
        country: "GH",
      },
      phone: "+233 20 123 4567",
      email: "billing@demo.com",
    },
  });

  // Demo user (owner)
  const user = await prisma.user.upsert({
    where: { email: "owner@demo.com" },
    update: {},
    create: {
      email: "owner@demo.com",
      passwordHash: saltHash,
      firstName: "Demo",
      lastName: "Owner",
    },
  });

  // Membership
  await prisma.companyMember.upsert({
    where: { userId_companyId: { userId: user.id, companyId: company.id } },
    update: { role: "OWNER" },
    create: {
      userId: user.id,
      companyId: company.id,
      role: "OWNER",
    },
  });

  // Seed the standard chart of accounts.
  for (const acct of DEFAULT_ACCOUNTS) {
    await prisma.account.upsert({
      where: { companyId_code: { companyId: company.id, code: acct.code } },
      update: {},
      create: {
        companyId: company.id,
        code: acct.code,
        name: acct.name,
        type: acct.type,
        currency: company.currency,
        openingBalance: 0,
        isSystem: true,
      },
    });
  }

  console.log("Seed complete:", { companyId: company.id, userId: user.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
