import { Router } from "express";
import { DoctorController } from "./doctor.controller";
import { upload } from "../../lib/multer";

const router = Router();

// register route
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

export const DoctorRoutes = router;