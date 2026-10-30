export type CompanyRole = "OWNER" | "ADMIN" | "ACCOUNTANT" | "BOOKKEEPER" | "READ_ONLY";

export const ROLE_PERMISSIONS = {
  readCompanyData: ["OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"],
  manageCompanySettings: ["OWNER", "ADMIN"],
  manageMembers: ["OWNER", "ADMIN"],
  manageChartOfAccounts: ["OWNER", "ADMIN", "ACCOUNTANT"],
  assignOwnerRole: ["OWNER"],
} as const satisfies Record<string, readonly CompanyRole[]>;

export function hasAnyRole(actualRole: string | undefined, allowedRoles: readonly string[]) {
  return actualRole !== undefined && allowedRoles.includes(actualRole);
}
