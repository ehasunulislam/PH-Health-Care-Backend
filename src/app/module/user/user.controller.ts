import { Request, Response } from "express";
import httpStatus from "http-status"
import { catchAsync } from "../../utils/catchAsync"
import { sendResponse } from "../../utils/sendResponse";
import { userService } from "./user.service";

const uploadProfileImage = catchAsync(async (req: Request, res: Response) => {
    if(!req.file) {
        throw new Error("file not found");
    }

	const userId = req.user?.userId as string;
    const result = await userService.uploadProfileImageFromDB(req.file?.buffer, userId);


	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "User profile image updated successfully successfully",
		data: result,
	});
})


export const userController = {
    uploadProfileImage
}