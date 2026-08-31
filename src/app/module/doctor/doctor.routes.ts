import { Router } from "express";
import { DoctorController } from "./doctor.controller";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";
import { validatedSchema } from "../../middleware/validedUserSchema";
import { UpdateDoctorProfileValidationZodSchema } from "./doctor.validation";

const router = Router();

// Apply as a doctor route
router.post("/apply-as-doctor", 
    upload.fields([
        {
            name: "resume",
            maxCount: 1
        },

        {
            name: "additionalFiles",
            maxCount: 10
        }
    ]),
    DoctorController.applyAsDoctor
);


// verify doctor route
router.post("/apply-as-doctor/verify-email", DoctorController.verifyDoctorEmail);


// approved doctor
router.post(
    "/approved-doctor", 
    auth(Role.ADMIN, Role.SUPER_ADMIN), 
    DoctorController.approvedDoctor
);

// getAll doctor route
router.get(
    "/all-doctors",
    auth(Role.ADMIN, Role.SUPER_ADMIN),
    DoctorController.getAllDoctor
)

// update doctor
router.patch(
	"/update-my-profile",
	auth(Role.DOCTOR),
	validatedSchema(UpdateDoctorProfileValidationZodSchema),
	DoctorController.updateDoctorProfile,
);

router.get(
	"/public/available-today",
	DoctorController.getAvailableDoctorByTodaysSchedule,
);

router.get(
	"/public/all-doctors",
	DoctorController.getAllDoctorsListPublic,
);

router.get(
	"/public/:doctorId",
	DoctorController.getSingleDoctorPublicProfile,
);

export const DoctorRoutes = router;