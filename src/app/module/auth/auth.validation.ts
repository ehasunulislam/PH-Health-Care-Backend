import z from "zod";

const patientRegistrationZodSchema = z.object({
	name: z
		.string()
		.min(3, { message: "Name must be at least 3 characters long" })
		.max(10, { message: "Name must not exceed 10 characters" }),

	email: z.email({
		message: "Please provide a valid email address",
	}),

	password: z
		.string()
		.min(8, { message: "Password must be at least 8 characters long" })
		.regex(/[A-Z]/, {
			message: "Password must contain at least one uppercase letter",
		})
		.regex(/[0-9]/, {
			message: "Password must contain at least one number",
		})
		.regex(/[^A-Za-z0-9]/, {
			message: "Password must contain at least one special character",
		}),

	patient: z.object({
		contactNumber: z.string().optional(),
	}),
});

const loginZodSchema = z.object({
	email: z.email({
		message: "Please provide a valid email address",
	}),

	password: z
		.string()
		.min(8, { message: "Password must be at least 8 characters long" })
		.regex(/[A-Z]/, {
			message: "Password must contain at least one uppercase letter",
		})
		.regex(/[0-9]/, {
			message: "Password must contain at least one number",
		})
		.regex(/[^A-Za-z0-9]/, {
			message: "Password must contain at least one special character",
		}),
});

export const userValidation = {
	patientRegistrationZodSchema,
	loginZodSchema,
};
