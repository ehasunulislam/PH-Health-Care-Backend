/** biome-ignore-all lint/style/useImportType: <explanation> */
import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AuthController } from "./auth.controller";
import { validatedSchema } from "../../middleware/validedUserSchema";
import { userValidation } from "./auth.validation";

const router = Router();

router.post(
	"/register",
	validatedSchema(userValidation.patientRegistrationZodSchema),
	AuthController.registerPatient,
);

router.post(
	"/login",
	validatedSchema(userValidation.loginZodSchema),
	AuthController.loginUser,
);

router.get(
	"/me",
	auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN),
	AuthController.getMe,
);


router.post("/refresh-token", AuthController.refreshToken);


// GOOGLE'S CLIENT
router.post("/google", AuthController.googleLogin);


// forgot password route
router.post("/forgot-password", 
	validatedSchema(userValidation.ForgotPasswordZodSchema), 
	AuthController.forgotPassword
);

// reset password route
router.post("/reset-password", 
	validatedSchema(userValidation.ResetPasswordZodSchema), 
	AuthController.resetPassword
);

export const AuthRoutes = router;
