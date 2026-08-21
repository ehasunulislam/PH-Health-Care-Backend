import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppointmentService } from "./appointment.service";


const bookAppointment = catchAsync(async (req: Request, res: Response) => {

    const result = await AppointmentService.bookAppointmentService();

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Bkash Payment on final",
		data: result,
	});
});

const bookAppointmentCallBack = catchAsync(async (req: Request, res: Response) => {
	console.log("req.query", req.query);
    const result = AppointmentService.bookAppointmentCallBack();

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Bkash Payment on final",
		data: result,
	});
});


export const AppointmentController = {
    bookAppointment,
	bookAppointmentCallBack
};

