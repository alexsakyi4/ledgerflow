import { Router } from "express";
import * as controller from "../controllers/people.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireCompany, requireRoles } from "../middleware/auth";

const router = Router({ mergeParams: true });
router.use(authenticate, requireCompany);
router.get("/", asyncHandler(controller.listProducts));
router.post("/", requireRoles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"), asyncHandler(controller.createProduct));
router.patch("/:productId", requireRoles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"), asyncHandler(controller.updateProduct));
router.delete("/:productId", requireRoles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"), asyncHandler(controller.archiveProduct));
router.post("/:productId/adjustments", requireRoles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"), asyncHandler(controller.adjustStock));
export default router;
