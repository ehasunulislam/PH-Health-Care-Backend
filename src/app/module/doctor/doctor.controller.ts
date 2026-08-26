import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ApplyAsDoctorValidationZodSchema } from "./doctor.validation";
import { DoctorService } from "./doctor.service";

const applyAsDoctor = catchAsync(async (req: Request, res: Response) => {
	const files = req.files as { [fieldname: string]: Express.Multer.File[] };
	console.log({ files });
	const resume = files?.["resume"] ? files["resume"][0] : null;
	const additionalFiles = files?.["additionalFiles"] || [];

	const zodValidationResult = ApplyAsDoctorValidationZodSchema.safeParse(
		JSON.parse(req.body.data),
	);

	if (!zodValidationResult.success) {
		throw new Error(zodValidationResult.error.issues[0].message);
	}

	const payload = zodValidationResult.data;

	const result = await DoctorService.applyAsDoctor(
		payload,
		resume,
		additionalFiles,
	);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Applied As Doctor Successfuly",
		data: result,
	});
});


// verify doctor 
const verifyDoctorEmail = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	const result = await DoctorService.verifyDoctorEmail(payload);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Doctor Email verified Successfuly",
		data: result,
	});
});


// approved doctor 
const approvedDoctor = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!  

	const result = await DoctorService.approvedDoctor(payload, user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Doctor Email verified Successfuly",
		data: result,
	});
});

// getAll Doctor
const getAllDoctor = catchAsync(async (req: Request, res: Response) => {
	const query = req.query;

	const {data, meta} = await DoctorService.getAllDoctor(query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Doctor Retrived Successfuly",
		data: data,
		meta: meta
	});
});

export const DoctorController = {
	applyAsDoctor,
	verifyDoctorEmail,
	approvedDoctor,
	getAllDoctor
};