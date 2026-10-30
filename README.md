# LedgerFlow — Web-Based Accounting Application

A QuickBooks-style small business accounting application supporting multiple companies, role-based users, and core bookkeeping workflows.

## Project Status: Phases 1–8 implemented; local database and demo sign-in working

LedgerFlow now includes the planned application phases: authentication and multi-company RBAC; contacts, products, services, and CSV imports; sales/purchasing documents and balanced journals; bank feeds and reconciliation; reports, tax and period controls; dashboards, PDFs and SMTP email; Stripe Checkout/webhooks; and dated multi-currency accounting with realized/unrealized FX reporting. See [PHASE3_8_SUMMARY.md](./PHASE3_8_SUMMARY.md) for scope and verification details.

**Verification in this workspace:** PostgreSQL is running, all six Prisma migrations are applied, the demo seed completed, and the demo login was tested through the frontend API proxy. With `RUN_DB_INTEGRATION=true`, all 29 backend tests pass, including the database-backed API/constraint tests. Prisma validation, backend build, frontend TypeScript check, and production build pass. SMTP delivery and live Stripe webhook flows still require provider credentials and were not verified.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript, Tailwind CSS, Vite, React Router |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Authentication | JWT (access + refresh tokens), argon2 password hashing, httpOnly cookies |
| API Validation | express-validator + zod |
| Containerization | Docker Compose |

## Folder Structure

```
accounting-app/
├── docker-compose.yml              # Local dev: Postgres + backend + frontend
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma           # Data model (users, companies, members, audit log, accounts)
│   │   ├── migrations/             # Initial PostgreSQL schema migration
│   │   └── seed.ts                 # Demo company, owner user, default chart of accounts
│   ├── src/
│   │   ├── config/env.ts           # Zod-validated env config
│   │   ├── config/db.ts            # Prisma client singleton
│   │   ├── controllers/auth.controller.ts   # register/login/refresh/logout/me
│   │   ├── middleware/auth.ts      # authenticate, requireCompany, requireRoles
│   │   ├── middleware/error.ts      # Centralized error handler
│   │   ├── middleware/validation.ts # express-validator result handler
│   │   ├── routes/auth.routes.ts   # Auth route definitions
│   │   ├── services/auth.service.ts  # Auth business logic (tokens, sessions)
│   │   ├── types/index.ts          # TS interfaces
│   │   └── server.ts               # Express app entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx                # React entry point
│   │   ├── App.tsx                 # Route shell (public + private routes)
│   │   ├── index.css               # Tailwind + component styles
│   │   ├── lib/api.ts              # Axios client (withCredentials)
│   │   ├── context/AuthContext.tsx # Auth state + session management
│   │   ├── components/layout/      # Layout, Sidebar, Topbar
│   │   ├── components/auth/        # ProtectedRoute
│   │   ├── pages/auth/             # Login, Register
│   │   └── pages/dashboard/        # Dashboard (placeholder)
│   │   └── types/auth.ts           # Auth TS interfaces
│   ├── package.json
│   ├── vite.config.ts              # Dev server + /api proxy
│   ├── tailwind.config.js
│   └── tsconfig.json
│
└── docs/                           # Phase delivery notes (see PHASE1_SUMMARY.md)
```

## Quick Start — Local Development

### Prerequisites
- Node.js 20+
- PostgreSQL 15+ (or use Docker Compose)

### Option A: Docker Compose (recommended)

```bash
cd /home/user/accounting-app
cp backend/.env.example backend/.env   # edit secrets if desired
docker compose up --build
```

- Backend API: `http://localhost:4000`
- Frontend: `http://localhost:5173`
- Postgres: `localhost:5432`

### Option B: Manual

1. Start PostgreSQL and create a database `accounting_app`.
2. Backend:
   ```bash
   cd backend
   cp .env.example .env
   # edit DATABASE_URL and JWT secrets in .env
   npm install
   npx prisma generate
   npx prisma migrate dev
   npm run db:seed
   npm run dev
   ```
3. Frontend:
   ```bash
   cd frontend
   npm install
   npm run dev   # proxies /api to http://localhost:4000
   ```

### Demo Credentials (after seeding)
- Email: `owner@demo.com`
- Password: `Admin@12345`
- Company: `Demo Company LLC` (USD)

## Implemented foundation (Phases 1–2)

1. **Project scaffolding** — monorepo-style `backend/` and `frontend/`, Docker Compose, env validation.
2. **Database schema** — `User`, `Company`, `CompanyMember` (Owner/Admin/Accountant/Bookkeeper/Read-only), `Session` (refresh tokens), `AuditLog`, and `Account` (Chart of Accounts foundation).
3. **Authentication** — JWT access (15m) + refresh (7d) tokens, argon2 password hashing, httpOnly secure cookies, refresh-token rotation, `/register`, `/login`, `/refresh`, `/logout`, `/me`.
4. **Multi-company + RBAC** — `requireCompany` middleware, `requireRoles(...)` middleware, role enforced on the API layer.
5. **Audit log** — `AuditLog` model ready to record CREATE/UPDATE/DELETE with user, timestamp, entity, old/new values.
6. **Frontend shell** — Vite + React Router, Tailwind UI, QuickBooks-style navigation and sign-in/register.
7. **Company and accounting workflows** — onboarding, company switching, RBAC, contacts, products/services, taxes, sales/purchasing, payments, banking, reconciliation, reports, exports, close periods, currency rates, PDF/email, and Stripe.
8. **API documentation** — Swagger UI at `http://localhost:4000/api/docs` and OpenAPI JSON at `/api/openapi.json`.

## Core and Business APIs

- `GET/POST /api/companies` — list memberships / create a company (creator becomes Owner; starter accounts are added transactionally)
- `GET/PATCH /api/companies/:companyId` — profile and company settings
- `GET/POST /api/companies/:companyId/members` — list members / add an existing registered user
- `PATCH/DELETE /api/companies/:companyId/members/:membershipId` — change role / revoke company access
- `GET/POST /api/companies/:companyId/accounts` — search/filter accounts / create account
- `GET/PATCH/DELETE /api/companies/:companyId/accounts/:accountId` — retrieve / edit / archive account
- `/api/companies/:companyId/contacts`, `/products`, `/tax-rates`, `/currency-rates` — tenant-scoped directories, tax codes, and dated FX rates
- `/api/companies/:companyId/:resource` — sales and purchasing documents, issue/approve/convert/void, customer/vendor payments, journal entries, period locks, invoice PDF/email/payment links, and dashboard summary
- `/api/companies/:companyId/banking` — accounts, CSV/OFX imports, matching/splitting/transfers, and reconciliations
- `/api/companies/:companyId/reports` — financial/management reports and CSV, XLSX, PDF exports
- `POST /api/stripe/webhook` — Stripe-signed webhook endpoint (requires webhook secret)

RBAC is enforced in Express middleware, and every company-scoped request verifies an active membership from the database. Owners and admins manage members and company settings; Owners, Admins, and Accountants maintain the Chart of Accounts; all company roles may read it. A company must retain at least one active Owner.

## Running Tests

```bash
# Backend unit tests (database-free)
cd backend
npm test

# Database integration tests (after migrations and test DB setup)
RUN_DB_INTEGRATION=true npm test -- --runInBand

# Frontend type-check + production bundle
cd ../frontend
npm run build
```

## Environment-dependent verification

Before using the app with real data, configure PostgreSQL, apply all migrations with `npx prisma migrate deploy`, run `npm run db:seed` if demo data is desired, and execute the DB-backed test suite with `RUN_DB_INTEGRATION=true npm test -- --runInBand`. SMTP and Stripe require their own valid credentials and provider-side webhook configuration; they have not been exercised against live services in this workspace.

## QuickBooks Equivalences

Each screen in later phases carries a short "QuickBooks equivalents" note describing the matching QuickBooks action (e.g. Dashboard = Home, Invoices = Invoices, Estimates = Estimates/Quotes, Bank Feeds = Bank Feeds, Reconcile = Reconcile, Chart of Accounts = Chart of Accounts).
