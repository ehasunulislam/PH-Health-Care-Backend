import { Router } from "express";
import { upload } from "../../lib/multer"; 
import { userController } from "./user.controller";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

// profile image update route
router.patch("/profile-image",
    auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN),
    upload.single("profileImage"),
    userController.uploadProfileImage
);

export const UserRoutes = router;
