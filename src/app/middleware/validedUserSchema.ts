import type { NextFunction, Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import type z from "zod";

export const validatedSchema = (zodSchema: z.ZodObject) => {
	return catchAsync((req: Request, res: Response, next: NextFunction) => {
		const payload = req.body ?? {};

		const result = zodSchema.safeParse(payload);

		if (!result.success) {
			// let errorMessage = "";
			// payload.error.issues.forEach((issue) => {
			// 	errorMessage = errorMessage + issue.message
			// })
			console.log(result.error);
			console.log(result.error.issues);
			throw new Error(result.error.issues[0].message);
		}

		req.body = result.data;

		next();
	});
};
