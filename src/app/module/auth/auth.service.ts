/** biome-ignore-all lint/style/useConst: <explanation> */
import bcrypt from "bcryptjs";
import type { TokenPayload } from "google-auth-library";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { googleClient } from "../../lib/googleAuth";
import { prisma } from "../../lib/prisma";
import { jwtUtils } from "../../utils/jwt";
import type * as authInterface from "./auth.interface";
import { redisClient } from "../../lib/redis";
import { error } from "console";
import { transporter } from "../../lib/nodeMailer";


// Register functionality
const registerPatient = async (
	payload: authInterface.IRegisterPatientPayload,
) => {
	const { name, password, patient: patientData } = payload;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new Error("User with this email already exists");
	}

	const hashedPassword = await bcrypt.hash(password, Number(config.bcrypt_salt_rounds));

	const createdUser = await prisma.user.create({
		data: {
			name,
			email,
			password: hashedPassword,
			role: Role.PATIENT,
			status: UserStatus.ACTIVE,
			emailVerified: false,
			patient: {
				create: {
					name,
					email,
					contactNumber: patientData?.contactNumber || "",
				},
			},
		},
		omit: { password: true },
		include: { patient: true },
	});

	const { patient, ...user } = createdUser;
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		user,
		patient,
		accessToken,
		refreshToken,
	};
};

// login user functionality
const loginUser = async (payload: authInterface.ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new Error("User not found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User is blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	if (user.password === null && user.googleId !== null) {
		throw new Error("Please login with Google");
	}

	const isPasswordMatched = await bcrypt.compare(
		password,
		user.password as string,
	);

	if (!isPasswordMatched) {
		throw new Error("Invalid credentials");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};


// get me with profile in login user
const getMe = async (user: authInterface.IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			patient: true,
		},
		omit: {
			password: true,
		},
	});

	if (!isUserExists) {
		throw new Error("User not found");
	}

	return isUserExists;
};


// get a new accessToken
const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new Error(
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new Error("User is inactive or not found");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};


// googl's client
const googleLogin = async (payload: authInterface.IGoogleLogin) => {
	let googleIdTokenPayload: TokenPayload | null | undefined = null;

	try {
		const ticket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_client_id,
		});

		googleIdTokenPayload = ticket.getPayload();
	} catch (err) {
		console.log("Google Id Token verification failed:", err);
		throw new Error("Google Id Token verification failed or Expired");
	}

	if (!googleIdTokenPayload) {
		throw new Error("Google Id Token verification failed or Expired");
	}

	if (!googleIdTokenPayload.email) {
		throw new Error("Google Email not found");
	}

	if (!googleIdTokenPayload.name) {
		throw new Error("Google name not found");
	}

	const isPatientExistsWithGoogleAuth = await prisma.user.findUnique({
		where: {
			email: googleIdTokenPayload.email,
			role: Role.PATIENT,
			googleId: googleIdTokenPayload.sub,
		},
	});

	let user = isPatientExistsWithGoogleAuth;

	if (!isPatientExistsWithGoogleAuth) {
		const isPatientExistsWithCredential = await prisma.user.findUnique({
			where: {
				email: googleIdTokenPayload.email,
				role: Role.PATIENT,
				authProvider: AuthProvider.CREDENTIAL,
			},
		});

		if (isPatientExistsWithCredential) {
			if (!isPatientExistsWithCredential.emailVerified) {
				throw new Error("Please verify your email first");
			}

			if (isPatientExistsWithCredential.status === UserStatus.BLOCKED) {
				throw new Error("User is blocked");
			}

			if (
				isPatientExistsWithCredential.isDeleted ||
				isPatientExistsWithCredential.status === UserStatus.DELETED
			) {
				throw new Error("User is deleted");
			}

			user = await prisma.user.update({
				where: {
					id: isPatientExistsWithCredential.id,
				},
				data: {
					googleId: googleIdTokenPayload.sub,
				},
			});
		} else {
			user = await prisma.user.create({
				data: {
					name: googleIdTokenPayload.name,
					email: googleIdTokenPayload.email,
					role: Role.PATIENT,
					emailVerified: true,
					googleId: googleIdTokenPayload.sub,
					authProvider: AuthProvider.GOOGLE,
					patient: {
						create: {
							name: googleIdTokenPayload.name,
							email: googleIdTokenPayload.email,
						},
					},
				},
			});
		}
	}

	if (!user) {
		throw new Error("User not found or created");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new Error("User is blocked");
	}

	if (user.isDeleted || user.status === UserStatus.DELETED) {
		throw new Error("User is deleted");
	}

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return {
		accessToken,
		refreshToken,
	};
};


// forgot password
const forgotPassword = async(payload: authInterface.IForgotPasswordPayload) => {
	const {email} = payload;

	const  isUserExist = await prisma.user.findUnique({
		where: {
			email
		}
	});

	if(!isUserExist) {
		throw new Error("user not found");
	}

	if(isUserExist.status === "BLOCKED") {
		throw new Error("user is blocked")
	}

	if(!isUserExist.emailVerified) {
		throw new Error("user is not verified");
	}


	if(isUserExist.isDeleted || isUserExist.status === "DELETED"){
		throw new Error("user is deleted");
	}

	if(isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new Error("user has an account with GOOGLE");
	}

	/* generate the otp with redis */
	const otp = crypto.randomInt(100000, 1000000).toString();
	const key = `forgot-password-otp: ${isUserExist.email}`
	
	await redisClient.set(key, otp, {
		expiration: {
			type: "EX",
			value: 5 * 60
		}
	});

	/* node-mailer send otp */
	await transporter.sendMail({
		from: config.email_sender,
		to: isUserExist.email,
		subject: "Forgot Password",
		text: `Your OTP is ${otp}`
	});
}

// reset password
const resetPassword = async(payload: authInterface.IResetPasswordPayload) => {
	const {email, otp, newPassword} = payload;

	const  isUserExist = await prisma.user.findUnique({
		where: {
			email
		}
	});

	if(!isUserExist) {
		throw new Error("user not found");
	}

	if(isUserExist.status === "BLOCKED") {
		throw new Error("user is blocked")
	}

	if(!isUserExist.emailVerified) {
		throw new Error("user is not verified");
	}


	if(isUserExist.isDeleted || isUserExist.status === "DELETED"){
		throw new Error("user is deleted");
	}

	if(isUserExist.googleId && isUserExist.authProvider === "GOOGLE") {
		throw new Error("user has an account with GOOGLE");
	}

	const key = `forgot-password-otp: ${isUserExist.email}`

	const redisOtp = await redisClient.get(key);

	if(!redisOtp) {
		throw new Error("Invalid OTP");
	}

	if(redisOtp !== otp) {
		throw new Error("OTP dose not matched");
	}

	const hashedNewPassword = await bcrypt.hash(newPassword, Number(config.bcrypt_salt_rounds));

	/* password updated */
	await prisma.user.update({
		where: {
			email: isUserExist.email
		},
		data: {
			password: hashedNewPassword
		}
	});

	/* delete the key with redis */
	await redisClient.del([key]);

	/* node-mailer send message after changed password */
	await transporter.sendMail({
		from: config.email_sender,
		to: isUserExist.email,
		subject: "Forgot Password",
		html: `Your Password Changed Successfully`
	});
}

export const AuthService = {
	registerPatient,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword, 
	resetPassword
};
