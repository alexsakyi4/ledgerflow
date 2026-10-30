import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireCompany, requireRoles } from "../middleware/auth";
import * as documentController from "../controllers/document.controller";
import * as journalController from "../controllers/journal.controller";
import * as importController from "../controllers/import.controller";
import * as dashboardController from "../controllers/dashboard.controller";
import * as periodController from "../controllers/period.controller";
import * as paymentController from "../controllers/payment.controller";

const router = Router({ mergeParams: true });
router.use(authenticate, requireCompany);
const bookkeepers = requireRoles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER");
const accountants = requireRoles("OWNER", "ADMIN", "ACCOUNTANT");

router.get("/dashboard", asyncHandler(dashboardController.summary));
router.get("/invoices/:documentId/pdf", asyncHandler(paymentController.downloadPdf));
router.post("/invoices/:documentId/email", bookkeepers, asyncHandler(paymentController.emailDocument));
router.post("/invoices/:documentId/payment-link", bookkeepers, asyncHandler(paymentController.createPaymentLink));
router.get("/accounting/closed-periods", asyncHandler(periodController.list));
router.post("/accounting/closed-periods", accountants, asyncHandler(periodController.close));
router.delete("/accounting/closed-periods/:periodId", requireRoles("OWNER", "ADMIN"), asyncHandler(periodController.reopen));
router.post("/imports/:entity", bookkeepers, asyncHandler(importController.importCsv));
router.get("/journal-entries", asyncHandler(journalController.list));
router.post("/journal-entries", accountants, asyncHandler(journalController.create));
router.get("/journal-entries/:entryId", asyncHandler(journalController.get));

router.get("/:resource", asyncHandler(documentController.listDocuments));
router.post("/:resource", bookkeepers, asyncHandler(documentController.createDocument));
router.get("/:resource/:documentId", asyncHandler(documentController.getDocument));
router.post("/invoices/:documentId/issue", bookkeepers, asyncHandler(documentController.issueDocument));
router.post("/bills/:documentId/approve", bookkeepers, asyncHandler(documentController.issueDocument));
router.post("/credit-memos/:documentId/issue", bookkeepers, asyncHandler(documentController.issueDocument));
router.post("/vendor-credits/:documentId/approve", bookkeepers, asyncHandler(documentController.issueDocument));
router.post("/estimates/:documentId/convert", bookkeepers, asyncHandler(documentController.convertEstimate));
router.post("/purchase-orders/:documentId/convert", bookkeepers, asyncHandler(documentController.convertPurchaseOrder));
router.post("/:resource/:documentId/void", accountants, asyncHandler(documentController.voidDocument));

export default router;
