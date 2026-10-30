-- Extend business documents with home-currency valuation and payment document types.
ALTER TYPE "DocumentType" ADD VALUE 'CUSTOMER_PAYMENT';
ALTER TYPE "DocumentType" ADD VALUE 'VENDOR_PAYMENT';

ALTER TABLE "BusinessDocument"
  ADD COLUMN "exchangeRate" DECIMAL(19,8) NOT NULL DEFAULT 1,
  ADD COLUMN "homeCurrencyTotal" DECIMAL(19,4) NOT NULL DEFAULT 0;
ALTER TABLE "BusinessDocument"
  ADD CONSTRAINT "BusinessDocument_exchangeRate_positive_check" CHECK ("exchangeRate" > 0);

-- Inventory audit trail, closed accounting periods, dated exchange rates, and Checkout references.
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityDelta" DECIMAL(19,4) NOT NULL,
    "unitCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClosedPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedByUserId" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "ClosedPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CurrencyRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rateDate" TIMESTAMP(3) NOT NULL,
    "rate" DECIMAL(19,8) NOT NULL,
    "source" TEXT,
    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CurrencyRate_rate_positive_check" CHECK ("rate" > 0),
    CONSTRAINT "CurrencyRate_currency_pair_check" CHECK ("baseCurrency" <> "quoteCurrency")
);

CREATE TABLE "StripePayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "checkoutSessionId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StripePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockMovement_companyId_createdAt_idx" ON "StockMovement"("companyId", "createdAt");
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
CREATE INDEX "ClosedPeriod_companyId_endDate_idx" ON "ClosedPeriod"("companyId", "endDate");
CREATE UNIQUE INDEX "ClosedPeriod_companyId_startDate_endDate_key" ON "ClosedPeriod"("companyId", "startDate", "endDate");
CREATE INDEX "CurrencyRate_companyId_rateDate_idx" ON "CurrencyRate"("companyId", "rateDate");
CREATE UNIQUE INDEX "CurrencyRate_companyId_baseCurrency_quoteCurrency_rateDate_key" ON "CurrencyRate"("companyId", "baseCurrency", "quoteCurrency", "rateDate");
CREATE UNIQUE INDEX "StripePayment_checkoutSessionId_key" ON "StripePayment"("checkoutSessionId");
CREATE UNIQUE INDEX "StripePayment_paymentIntentId_key" ON "StripePayment"("paymentIntentId");
CREATE INDEX "StripePayment_companyId_status_idx" ON "StripePayment"("companyId", "status");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClosedPeriod" ADD CONSTRAINT "ClosedPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StripePayment" ADD CONSTRAINT "StripePayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StripePayment" ADD CONSTRAINT "StripePayment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BusinessDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
