# Phase 2 Delivery Summary

**Phase:** Multi-company, users, roles, and Chart of Accounts  
**Status:** Implementation complete; database migration/seed and live DB integration still require PostgreSQL.

## Added

### Company workspace and settings
- Company create/list/profile endpoints with memberships scoped to the authenticated user.
- Company creation is transactional: creates company, assigns creator as `OWNER`, seeds the standard Chart of Accounts, and writes an audit entry.
- Setup fields: business/legal name and entity type, fiscal year start month, ISO currency, tax ID/settings, logo URL, address/contact details.
- Company switcher uses only the signed-in user's returned memberships; selection is persisted in the browser.
- Company currency changes update default-currency accounts while preserving accounts set to other currencies.

### Membership management and RBAC
- Add an existing registered user to one or more companies; update their company-specific role; deactivate access without deleting history.
- Roles: `OWNER`, `ADMIN`, `ACCOUNTANT`, `BOOKKEEPER`, `READ_ONLY`.
- API permissions:
  - All active members can read company data and the Chart of Accounts.
  - Owner/Admin manage company profile and team membership.
  - Owner/Admin/Accountant create, edit, and archive accounts.
  - Only Owner assigns the Owner role or manages another Owner.
  - A company cannot lose its last active Owner.
- Every company-scoped route checks active membership from the database. Account record lookups always include the active company ID, preventing cross-company ID access.
- CREATE/UPDATE/DELETE audit records capture actor, company, entity, before/after values, IP, and user agent.

### Chart of Accounts
- Company-specific seeded default accounts for Assets, Liabilities, Equity, Income, COGS, and Expenses.
- List/search/filter by type; show/hide inactive accounts.
- Create, edit, archive, and retrieve accounts; accounts support parent/child sub-account hierarchy, code/name/type/description, opening balance and opening-balance date.
- Prevents cross-company parent references and cycles in account hierarchy; system defaults cannot be archived; parent accounts cannot be archived while active child accounts remain.

### Frontend
- Company setup form, business settings and team role screen, company switcher, and editable Chart of Accounts screen.
- Each Phase 2 screen displays a "QuickBooks equivalent" note.
- User/company data is loaded from the API; UI role checks improve usability, while authorization remains enforced server-side.

### API documentation
- Swagger UI: `/api/docs`
- OpenAPI JSON: `/api/openapi.json`

## Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/companies` | List active company memberships |
| POST | `/api/companies` | Create company, Owner membership, and default accounts |
| GET/PATCH | `/api/companies/:companyId` | Get/update company profile |
| GET/POST | `/api/companies/:companyId/members` | List members / add registered user |
| PATCH/DELETE | `/api/companies/:companyId/members/:membershipId` | Change role / deactivate access |
| GET/POST | `/api/companies/:companyId/accounts` | List/filter/search / create accounts |
| GET/PATCH/DELETE | `/api/companies/:companyId/accounts/:accountId` | Get/edit/archive account |

## Database migrations

- `backend/prisma/migrations/20261030190000_init/migration.sql` — initial schema
- `backend/prisma/migrations/20261030193000_account_opening_date/migration.sql` — account opening-balance date

When PostgreSQL is available:

```bash
cd backend
npx prisma migrate deploy
npm run db:seed
```

For local development, `npx prisma migrate dev` can be used instead. The seed credentials remain `owner@demo.com` / `Admin@12345`.

## Verification

- Prisma Client generated and schema validated.
- Backend TypeScript production build passed.
- Frontend TypeScript check and production build passed.
- Backend database-free unit tests: 8 passed (password/JWT and role policy).
- 4 database integration test cases are included in `backend/tests/companies.integration.test.ts`, but are skipped by default until a test PostgreSQL database is configured. Run with `RUN_DB_INTEGRATION=true npm test -- --runInBand` after migrations; use a dedicated disposable test database.

## Next phase (requires confirmation)

Phase 3: Contacts, products, and services (customers/vendors, product/service catalog, inventory tracking and CSV import foundation).