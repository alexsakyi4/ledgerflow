# Run LedgerFlow on your computer

## Requirements
- Docker Desktop (or Docker Engine with the Compose plugin)
- No separate Node.js or PostgreSQL installation is needed; Compose supplies both.

## Start
1. Download and extract `LedgerFlow-local.zip`.
2. Open a terminal in the extracted `accounting-app` folder.
3. Run:
   ```sh
   docker compose up --build
   ```
4. Wait for the backend container to finish migrations and seeding, then open **http://localhost:5173**.

Demo sign-in:
- Email: `owner@demo.com`
- Password: `Admin@12345`

The API is on `http://localhost:4000`; PostgreSQL is on port `5432`. Stop the stack with `Ctrl+C` (or run `docker compose down`). This is a development setup; change the demo password and secrets before any deployment.
