import { Router } from "express";
import * as controller from "../controllers/tax.controller";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireCompany, requireRoles } from "../middleware/auth";
const router=Router({mergeParams:true});router.use(authenticate,requireCompany);
router.get("/",asyncHandler(controller.list));router.post("/",requireRoles("OWNER","ADMIN","ACCOUNTANT"),asyncHandler(controller.create));router.patch("/:taxRateId",requireRoles("OWNER","ADMIN","ACCOUNTANT"),asyncHandler(controller.update));router.delete("/:taxRateId",requireRoles("OWNER","ADMIN","ACCOUNTANT"),asyncHandler(controller.archive));export default router;
