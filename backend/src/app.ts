import express from "express";
import cors from "cors";
import path from "path";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./docs/openapi";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error";
import { authenticate } from "./middleware/auth";
import authRoutes from "./routes/auth.routes";
import companyRoutes from "./routes/company.routes";
import accountRoutes from "./routes/account.routes";
import contactsRoutes from "./routes/contacts.routes";
import productsRoutes from "./routes/products.routes";
import businessRoutes from "./routes/business.routes";
import taxRoutes from "./routes/tax.routes";
import currencyRoutes from "./routes/currency.routes";
import bankingRoutes from "./routes/banking.routes";
import reportsRoutes from "./routes/reports.routes";
import * as paymentController from "./controllers/payment.controller";
import { asyncHandler } from "./middleware/asyncHandler";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(cookieParser());
app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), asyncHandler(paymentController.webhook));
app.use(express.text({ type: ["text/csv", "text/plain"], limit: "10mb" }));
app.use(express.json({ limit: "1mb" }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "accounting-backend", time: new Date().toISOString() });
});
app.get("/api/openapi.json", (_req, res) => res.json(openApiSpec));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/companies", apiLimiter, companyRoutes);
app.use("/api/companies/:companyId/accounts", apiLimiter, accountRoutes);
app.use("/api/companies/:companyId/contacts", apiLimiter, contactsRoutes);
app.use("/api/companies/:companyId/products", apiLimiter, productsRoutes);
app.use("/api/companies/:companyId/tax-rates", apiLimiter, taxRoutes);
app.use("/api/companies/:companyId/currency-rates", apiLimiter, currencyRoutes);
app.use("/api/companies/:companyId/banking", apiLimiter, bankingRoutes);
app.use("/api/companies/:companyId/reports", apiLimiter, reportsRoutes);
app.use("/api/companies/:companyId", apiLimiter, businessRoutes);
app.get("/api/me", authenticate, (_req, res) => {
  res.json({ success: true, data: { authenticated: true } });
});

// In a single-origin production deployment, Express serves the built Vite app
// as well as the API. This keeps cookie auth same-origin and avoids a separate
// frontend proxy/CORS setup.
if (env.NODE_ENV === "production") {
  const frontendDist = path.resolve(__dirname, "../../frontend/dist");
  app.use(express.static(frontendDist, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(frontendDist, "index.html"), (error) => { if (error) next(error); });
  });
}

app.use((_req, res) => res.status(404).json({ success: false, error: "Not found" }));
app.use(errorHandler);

export default app;
