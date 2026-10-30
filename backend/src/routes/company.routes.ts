import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireCompany, requireRoles } from "../middleware/auth";
import * as controller from "../controllers/company.controller";

const router = Router();
router.use(authenticate);

router.get("/", asyncHandler(controller.listCompanies));
router.post("/", asyncHandler(controller.createCompany));
router.get("/:companyId", requireCompany, asyncHandler(controller.getCompany));
router.patch("/:companyId", requireCompany, requireRoles("OWNER", "ADMIN"), asyncHandler(controller.updateCompany));

router.get("/:companyId/members", requireCompany, asyncHandler(controller.listMembers));
router.post("/:companyId/members", requireCompany, requireRoles("OWNER", "ADMIN"), asyncHandler(controller.addMember));
router.patch("/:companyId/members/:membershipId", requireCompany, requireRoles("OWNER", "ADMIN"), asyncHandler(controller.updateMemberRole));
router.delete("/:companyId/members/:membershipId", requireCompany, requireRoles("OWNER", "ADMIN"), asyncHandler(controller.removeMember));

export default router;
