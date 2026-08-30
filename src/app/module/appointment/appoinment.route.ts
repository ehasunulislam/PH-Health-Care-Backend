import { Router } from "express";
import { AppointmentController } from "./appointment.controller";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";
import { validatedSchema } from "../../middleware/validedUserSchema";
import { BookAppointmentValidationZodSchema, UpdateAppointmentStatusValidationZodSchema } from "./appointment.valiidation";

const router = Router();

router.post(
  "/book-appointment",
  auth(Role.PATIENT),
  validatedSchema(BookAppointmentValidationZodSchema),
  AppointmentController.bookAppointment,
);

router.post(
  "/pay-appointment",
  auth(Role.PATIENT),
  AppointmentController.payAppointment,
);

router.post(
  "/cancel-appointment",
  auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.cancleAppointment,
);

// get route for bkas payment
router.get(
  "/book-appointment/payment/callback",
  AppointmentController.bookAppointmentCallBack,
);

router.patch(
  "/update-status/:appointmentId",
  auth(Role.DOCTOR),
  validatedSchema(UpdateAppointmentStatusValidationZodSchema),
  AppointmentController.updateAppointmentStatus,
);

router.get(
  "/my-appointments",
  auth(Role.PATIENT),
  AppointmentController.getMyAppointments,
);

router.get(
  "/doctor-appointments",
  auth(Role.DOCTOR),
  AppointmentController.getDoctorAppointments,
);

router.get(
  "/all-appointments",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.getAllAppointments,
);

router.get(
  "/:appointmentId",
  auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.getSingleAppointment,
);

export const AppointmentRoute = router;
