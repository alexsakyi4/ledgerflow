-- Prevent duplicate invoices/bills derived from the same source document.
CREATE UNIQUE INDEX "BusinessDocument_companyId_sourceDocumentId_type_key"
ON "BusinessDocument"("companyId", "sourceDocumentId", "type");
