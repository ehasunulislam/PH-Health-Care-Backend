import { Router } from "express";
import { AppointmentController } from "./appointment.controller";

const router = Router();


router.post("/book-appointment", AppointmentController.bookAppointment);


// get route for bkas payment
router.get("/book-appointment/payment/callback", AppointmentController.bookAppointmentCallBack)


export const AppointmentRoute = router;
