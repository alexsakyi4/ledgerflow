import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireCompany, requireRoles } from "../middleware/auth";
import * as controller from "../controllers/account.controller";

const router = Router({ mergeParams: true });
router.use(authenticate, requireCompany);

router.get("/", asyncHandler(controller.listAccounts));
router.post("/", requireRoles("OWNER", "ADMIN", "ACCOUNTANT"), asyncHandler(controller.createAccount));
router.get("/:accountId", asyncHandler(controller.getAccount));
router.patch("/:accountId", requireRoles("OWNER", "ADMIN", "ACCOUNTANT"), asyncHandler(controller.updateAccount));
router.delete("/:accountId", requireRoles("OWNER", "ADMIN", "ACCOUNTANT"), asyncHandler(controller.archiveAccount));

export default router;
