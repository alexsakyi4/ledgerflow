import { Router } from "express";
import * as controller from "../controllers/report.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireCompany } from "../middleware/auth";

const router = Router({ mergeParams: true });
router.use(authenticate, requireCompany);
router.get("/saved", asyncHandler(controller.saved));
router.post("/saved", asyncHandler(controller.save));
router.post("/saved/:reportId/run", asyncHandler(controller.runSaved));
router.delete("/saved/:reportId", asyncHandler(controller.removeSaved));
router.get("/:reportType", asyncHandler(controller.run));
export default router;
