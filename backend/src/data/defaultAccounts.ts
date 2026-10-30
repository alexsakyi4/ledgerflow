import type { AccountType } from "@prisma/client";

export const DEFAULT_ACCOUNTS: Array<{
  code: string;
  name: string;
  type: AccountType;
}> = [
  { code: "1000", name: "Cash", type: "ASSET" },
  { code: "1100", name: "Accounts Receivable", type: "ASSET" },
  { code: "1200", name: "Inventory", type: "ASSET" },
  { code: "1300", name: "Prepaid Expenses", type: "ASSET" },
  { code: "1350", name: "Input Tax Receivable", type: "ASSET" },
  { code: "1500", name: "Equipment", type: "ASSET" },
  { code: "1600", name: "Accumulated Depreciation", type: "ASSET" },
  { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
  { code: "2100", name: "Credit Cards", type: "LIABILITY" },
  { code: "2200", name: "Sales Tax Payable", type: "LIABILITY" },
  { code: "2300", name: "Payroll Liabilities", type: "LIABILITY" },
  { code: "2500", name: "Loans Payable", type: "LIABILITY" },
  { code: "3000", name: "Owner's Equity", type: "EQUITY" },
  { code: "3100", name: "Retained Earnings", type: "EQUITY" },
  { code: "3200", name: "Owner's Draw", type: "EQUITY" },
  { code: "4000", name: "Sales Revenue", type: "INCOME" },
  { code: "4100", name: "Service Revenue", type: "INCOME" },
  { code: "4200", name: "Other Income", type: "INCOME" },
  { code: "4300", name: "Realized Foreign Exchange Gain", type: "INCOME" },
  { code: "5000", name: "Cost of Goods Sold", type: "COGS" },
  { code: "6800", name: "Realized Foreign Exchange Loss", type: "EXPENSE" },
  { code: "6000", name: "Advertising Expense", type: "EXPENSE" },
  { code: "6100", name: "Bank Fees", type: "EXPENSE" },
  { code: "6200", name: "Depreciation Expense", type: "EXPENSE" },
  { code: "6300", name: "Insurance Expense", type: "EXPENSE" },
  { code: "6400", name: "Office Expense", type: "EXPENSE" },
  { code: "6500", name: "Rent Expense", type: "EXPENSE" },
  { code: "6600", name: "Salaries and Wages", type: "EXPENSE" },
  { code: "6700", name: "Utilities Expense", type: "EXPENSE" },
];
