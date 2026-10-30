import { Router } from "express";
import {
  register,
  login,
  refresh,
  logout,
  me,
  registerValidation,
  loginValidation,
} from "../controllers/auth.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

router.post("/register", registerValidation, validateRequest, register);
router.post("/login", loginValidation, validateRequest, login);
router.post("/refresh", refresh);
router.post("/logout", authenticate, asyncHandler(logout));
router.get("/me", authenticate, me);

export default router;
