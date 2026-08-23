import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppointmentService } from "./appointment.service";


const bookAppointment = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

    const result = await AppointmentService.bookAppointmentService(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Appointment Payment Initiated Successfully",
		data: result,
	});
});


const payAppointment = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

    const result = await AppointmentService.payAppointment(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Appointment Payment Initiated Successfully",
		data: result,
	});
});


const bookAppointmentCallBack = catchAsync(async (req: Request, res: Response) => {
	console.log("req.query", req.query);
    const {redirectUrl} = await AppointmentService.bookAppointmentCallback(req.query);


	res.redirect(redirectUrl);
});


const cancleAppointment = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

    const result = await AppointmentService.canceledAppointment(payload);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Appointment Payment Cancelled Refund Successfully",
		data: result,
	});
});


export const AppointmentController = {
    bookAppointment,
	bookAppointmentCallBack,
	payAppointment,
	cancleAppointment
};

