import { Router } from "express";
import * as controller from "../controllers/people.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireCompany, requireRoles } from "../middleware/auth";

const router = Router({ mergeParams: true });
router.use(authenticate, requireCompany);
router.get("/", asyncHandler(controller.listContacts));
router.post("/", requireRoles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"), asyncHandler(controller.createContact));
router.get("/:contactId", asyncHandler(controller.getContact));
router.patch("/:contactId", requireRoles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"), asyncHandler(controller.updateContact));
router.delete("/:contactId", requireRoles("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER"), asyncHandler(controller.archiveContact));
router.post("/:contactId/merge", requireRoles("OWNER", "ADMIN", "ACCOUNTANT"), asyncHandler(controller.mergeContact));
export default router;
