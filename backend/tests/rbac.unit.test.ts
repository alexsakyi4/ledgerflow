import { hasAnyRole, ROLE_PERMISSIONS } from "../src/utils/rbac";

describe("company RBAC policy", () => {
  it("allows every company role to read company data", () => {
    for (const role of ["OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"]) {
      expect(hasAnyRole(role, ROLE_PERMISSIONS.readCompanyData)).toBe(true);
    }
  });

  it("limits account maintenance to owners, admins, and accountants", () => {
    expect(hasAnyRole("OWNER", ROLE_PERMISSIONS.manageChartOfAccounts)).toBe(true);
    expect(hasAnyRole("ADMIN", ROLE_PERMISSIONS.manageChartOfAccounts)).toBe(true);
    expect(hasAnyRole("ACCOUNTANT", ROLE_PERMISSIONS.manageChartOfAccounts)).toBe(true);
    expect(hasAnyRole("BOOKKEEPER", ROLE_PERMISSIONS.manageChartOfAccounts)).toBe(false);
    expect(hasAnyRole("READ_ONLY", ROLE_PERMISSIONS.manageChartOfAccounts)).toBe(false);
  });

  it("reserves owner assignment for an existing owner", () => {
    expect(hasAnyRole("OWNER", ROLE_PERMISSIONS.assignOwnerRole)).toBe(true);
    expect(hasAnyRole("ADMIN", ROLE_PERMISSIONS.assignOwnerRole)).toBe(false);
    expect(hasAnyRole(undefined, ROLE_PERMISSIONS.assignOwnerRole)).toBe(false);
  });
});
