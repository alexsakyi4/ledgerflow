const errorResponse = {
  description: "Request failed",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "LedgerFlow Accounting API",
    version: "0.2.0",
    description: "Phase 1–2 API for authentication, multi-company access, user roles, and Chart of Accounts.",
  },
  servers: [{ url: "/", description: "Current server" }],
  tags: [
    { name: "Health" }, { name: "Authentication" }, { name: "Companies" }, { name: "Members" }, { name: "Chart of Accounts" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      accessCookie: { type: "apiKey", in: "cookie", name: "access_token" },
    },
    schemas: {
      Error: { type: "object", properties: { success: { type: "boolean", example: false }, error: { type: "string" } } },
      CompanyInput: {
        type: "object", required: ["name"], properties: {
          name: { type: "string", maxLength: 120 }, legalName: { type: "string", nullable: true },
          legalEntityType: { type: "string", nullable: true }, fiscalYearStart: { type: "integer", minimum: 1, maximum: 12, default: 1 },
          currency: { type: "string", pattern: "^[A-Za-z]{3}$", default: "USD" }, taxId: { type: "string", nullable: true },
          taxSettings: { type: "object", nullable: true }, logoUrl: { type: "string", nullable: true }, address: { type: "object", nullable: true },
          phone: { type: "string", nullable: true }, email: { type: "string", format: "email", nullable: true }, website: { type: "string", nullable: true },
        },
      },
      CompanyUpdateInput: {
        type: "object", properties: {
          name: { type: "string", maxLength: 120 }, legalName: { type: "string", nullable: true },
          legalEntityType: { type: "string", nullable: true }, fiscalYearStart: { type: "integer", minimum: 1, maximum: 12 },
          currency: { type: "string", pattern: "^[A-Za-z]{3}$" }, taxId: { type: "string", nullable: true },
          taxSettings: { type: "object", nullable: true }, logoUrl: { type: "string", nullable: true }, address: { type: "object", nullable: true },
          phone: { type: "string", nullable: true }, email: { type: "string", format: "email", nullable: true }, website: { type: "string", nullable: true },
        },
      },
      AccountInput: {
        type: "object", required: ["code", "name", "type"], properties: {
          code: { type: "string", maxLength: 32 }, name: { type: "string", maxLength: 120 },
          type: { type: "string", enum: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE", "COGS"] },
          description: { type: "string", nullable: true }, parentId: { type: "string", nullable: true },
          openingBalance: { oneOf: [{ type: "number" }, { type: "string" }], default: 0 },
          openingBalanceDate: { type: "string", format: "date-time", nullable: true },
        },
      },
      AccountUpdateInput: {
        type: "object", properties: {
          code: { type: "string", maxLength: 32 }, name: { type: "string", maxLength: 120 },
          type: { type: "string", enum: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE", "COGS"] },
          description: { type: "string", nullable: true }, parentId: { type: "string", nullable: true },
          openingBalance: { oneOf: [{ type: "number" }, { type: "string" }] },
          openingBalanceDate: { type: "string", format: "date-time", nullable: true },
        },
      },
      CompanyRole: { type: "string", enum: ["OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "READ_ONLY"] },
    },
  },
  paths: {
    "/health": { get: { tags: ["Health"], summary: "Health check", responses: { "200": { description: "API is ready" } } } },
    "/api/auth/register": { post: { tags: ["Authentication"], summary: "Register a user", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string", minLength: 8 }, firstName: { type: "string" }, lastName: { type: "string" } } } } } }, responses: { "201": { description: "User registered" }, "400": errorResponse } } },
    "/api/auth/login": { post: { tags: ["Authentication"], summary: "Sign in; sets httpOnly auth cookies", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string" } } } } } }, responses: { "200": { description: "Authenticated" }, "401": errorResponse } } },
    "/api/auth/me": { get: { tags: ["Authentication"], summary: "Get current user", security: [{ accessCookie: [] }, { bearerAuth: [] }], responses: { "200": { description: "Current user" }, "401": errorResponse } } },
    "/api/companies": {
      get: { tags: ["Companies"], summary: "List the current user's active companies", security: [{ accessCookie: [] }, { bearerAuth: [] }], responses: { "200": { description: "Company workspaces" }, "401": errorResponse } },
      post: { tags: ["Companies"], summary: "Create a company (creator becomes Owner; starter accounts are added)", security: [{ accessCookie: [] }, { bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CompanyInput" } } } }, responses: { "201": { description: "Company created" }, "400": errorResponse } },
    },
    "/api/companies/{companyId}": {
      parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Companies"], summary: "Get company profile (active members)", security: [{ accessCookie: [] }, { bearerAuth: [] }], responses: { "200": { description: "Company profile" }, "403": errorResponse } },
      patch: { tags: ["Companies"], summary: "Update company profile (Owner/Admin)", security: [{ accessCookie: [] }, { bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CompanyUpdateInput" } } } }, responses: { "200": { description: "Updated company" }, "403": errorResponse } },
    },
    "/api/companies/{companyId}/members": {
      parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Members"], summary: "List active company members", security: [{ accessCookie: [] }, { bearerAuth: [] }], responses: { "200": { description: "Members and roles" }, "403": errorResponse } },
      post: { tags: ["Members"], summary: "Add an existing registered user to the company (Owner/Admin)", security: [{ accessCookie: [] }, { bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" }, role: { $ref: "#/components/schemas/CompanyRole", default: "BOOKKEEPER" } } } } } }, responses: { "201": { description: "Member added" }, "404": errorResponse, "403": errorResponse } },
    },
    "/api/companies/{companyId}/members/{membershipId}": {
      parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }, { name: "membershipId", in: "path", required: true, schema: { type: "string" } }],
      patch: { tags: ["Members"], summary: "Change a member role (Owner/Admin; only Owner may assign Owner)", security: [{ accessCookie: [] }, { bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["role"], properties: { role: { $ref: "#/components/schemas/CompanyRole" } } } } } }, responses: { "200": { description: "Role changed" }, "403": errorResponse, "409": errorResponse } },
      delete: { tags: ["Members"], summary: "Deactivate company access (Owner/Admin)", security: [{ accessCookie: [] }, { bearerAuth: [] }], responses: { "200": { description: "Member deactivated" }, "403": errorResponse, "409": errorResponse } },
    },
    "/api/companies/{companyId}/accounts": {
      parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Chart of Accounts"], summary: "List accounts; supports type, search, includeInactive filters", security: [{ accessCookie: [] }, { bearerAuth: [] }], parameters: [{ name: "type", in: "query", schema: { type: "string", enum: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE", "COGS"] } }, { name: "search", in: "query", schema: { type: "string" } }, { name: "includeInactive", in: "query", schema: { type: "boolean" } }], responses: { "200": { description: "Chart of Accounts" }, "403": errorResponse } },
      post: { tags: ["Chart of Accounts"], summary: "Create an account or sub-account (Owner/Admin/Accountant)", security: [{ accessCookie: [] }, { bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AccountInput" } } } }, responses: { "201": { description: "Account created" }, "400": errorResponse, "403": errorResponse, "409": errorResponse } },
    },
    "/api/companies/{companyId}/accounts/{accountId}": {
      parameters: [{ name: "companyId", in: "path", required: true, schema: { type: "string" } }, { name: "accountId", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Chart of Accounts"], summary: "Get an account", security: [{ accessCookie: [] }, { bearerAuth: [] }], responses: { "200": { description: "Account details" }, "404": errorResponse } },
      patch: { tags: ["Chart of Accounts"], summary: "Edit account (Owner/Admin/Accountant)", security: [{ accessCookie: [] }, { bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AccountUpdateInput" } } } }, responses: { "200": { description: "Updated account" }, "400": errorResponse, "403": errorResponse } },
      delete: { tags: ["Chart of Accounts"], summary: "Archive account (system accounts cannot be archived)", security: [{ accessCookie: [] }, { bearerAuth: [] }], responses: { "200": { description: "Account archived" }, "403": errorResponse, "409": errorResponse } },
    },
  },
} as const;
