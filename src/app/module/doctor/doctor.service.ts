import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma"
import { cloudinary } from "../../lib/cloudinary";
import bcrypt from "bcryptjs";
import config from "../../config";
import { DoctorVerificaitonStatus, Role } from "../../../generated/prisma/enums";
import crypto from "crypto"
import { redisClient } from "../../lib/redis";
import path from "path"
import ejs from "ejs";
import { transporter } from "../../lib/nodeMailer";
import { IApplyAsDoctorPayload, IApprovedDoctorPayload, IVerifyDoctorEmailPayload } from "./doctor.interface";
import { RequestUser } from "../../middleware/checkAuth";
import { IQuery } from "../../interfaces/global.interface";
import { DoctorWhereInput } from "../../../generated/prisma/models";


const applyAsDoctor = async(
    payload: IApplyAsDoctorPayload, 
    resume: Express.Multer.File | null, 
    additionalFiles: Express.Multer.File[]
    ) => {
        const isUserExists = await prisma.user.findUnique({
            where: {
                email: payload.user.email
            }
        });

        if(isUserExists) {
            throw new Error("user already exists with this email");
        }

        const resumeUploadResult = await new  Promise<UploadApiResponse >((resolve, reject) => {
            cloudinary.uploader.upload_stream(
            {
                "resource_type": "auto"
            },
    
            async (error, result) => {
                if(error) {
                    return reject(error);
                }
    
                if(!result) {
                    return reject(new Error("No result returned from Cloudinary upload"));
                }
    
    
                resolve(result);
            }).end(resume?.buffer);
        });

        const additionalFilesUploadResults = await Promise.all(
            additionalFiles.map((file) => {
                return new Promise<UploadApiResponse>((resolve, reject) => {
                    cloudinary.uploader.upload_stream(
                        {
                            resource_type: "auto"
                        },

                        async (error, result) => {
                            if(error) {
                                return reject(error);
                            }
                            
                            if(!result) {
                                return reject(new Error("No result returned from Cloudinary upload"));
                            }

                            resolve(result);
                        }
                    ).end(file.buffer)
                })
            })
        )

        const randomDoctorPassowd = Math.random().toString(36).slice(-8);
        const hassPassowrd = await bcrypt.hash(randomDoctorPassowd, Number(config.bcrypt_salt_rounds))

        const doctorApplication = await prisma.user.create({
            data: {
                ...payload.user, 
                password: hassPassowrd,
                role: Role.DOCTOR, 
                needPasswordChange: true,

                doctor: {
                    create: {
                        name: payload.user.name, 
                        email: payload.user.email,
                        ...payload.doctor,
                        resume: resumeUploadResult.secure_url,
                        resumePublicid: resumeUploadResult.public_id,
                        additionalFiles: additionalFilesUploadResults.map((file) => ({
                            url: file.secure_url,
                            publicId: file.public_id    
                        }))
                    }
                }
            },

            include: {
                doctor: true
            }
        });


        /* otp generate for the email-verifiend with redis */
        const expirationSecond = 60 * 60;
        const otpKey = `doctor-applicaiton-otp:${payload.user.email}`;
        const otpValue = crypto.randomInt(100000, 1000000).toString();

        await redisClient.set(otpKey, otpValue, {
            expiration: {
                type: "EX",
                value: expirationSecond
            }
        });

        const templatePath = path.join(process.cwd(), "/src/app/template/register-user-otp.ejs");

        const templateData = {
            name: payload.user.name,
            email: payload.user.email,
            otp: otpValue,
            expirationLimit: expirationSecond / 60,
        }

        const html = await ejs.renderFile(templatePath, templateData);

        await transporter.sendMail({
            from: config.email_sender,
            to: payload.user.email,
            subject: "Doctor Aplicaiton - Email Verification",
            html
        })

        return doctorApplication
}


// verify doctor 
const verifyDoctorEmail = async (payload: IVerifyDoctorEmailPayload) => {
    const otp = payload.otp;
    const email = payload.email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
        where: {
            email, 
            role: Role.DOCTOR
        }
    });

    if(!existingUser) {
        throw new Error("Doctor Allication Not Found. Please Apply Again");
    }

    if(existingUser.emailVerified) {
        throw new Error("Email Already Verified");
    }

    /* get the otp with redis */
    const otpKey = `doctor-applicaiton-otp:${email}`;
    const redisOtp = await redisClient.get(otpKey);

    if(!redisOtp) {
        throw new Error("OTP Expired. Your Application window has closed. please apply again")
    }

    if(redisOtp !== otp) {
        throw new Error("OTP Does not matched")
    }

    await redisClient.del(otpKey);

    /* update the doctor email verified */
    const verifiedUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: { emailVerified: true },
        omit: { password: true },
        include: { doctor: true }
    });

    return verifiedUser
}


// approved doctor 
const approvedDoctor = async(payload: IApprovedDoctorPayload, reviewer: RequestUser) => {
    const { doctorId, verificationStatus, rejectionReason } = payload;

    const exsistingDoctor = await prisma.doctor.findUnique({
        where: {
            id: doctorId
        },
        include: {
            user: true
        }
    });

    if(!exsistingDoctor) {
        throw new Error("Doctor Applicaiton not found");
    }

    if(exsistingDoctor.isDeleted) {
        throw new Error("Doctor Application has deleted");
    }

    if(!exsistingDoctor.user.emailVerified) {
        throw new Error(
            "Doctor was not verified their Email Yet. Application cannot be revived"
        )
    }

    if(exsistingDoctor.verificationStatus !== DoctorVerificaitonStatus.PENDING) {
        throw new Error(`Doctor Application was Already Beed ${exsistingDoctor.verificationStatus.toLocaleLowerCase()}`);
    }

    if (
		verificationStatus === DoctorVerificaitonStatus.REJECTED &&
		!rejectionReason
	) {
		throw new Error(
			"Rejection Reason is required when Rejecting A Doctor Application",
		);
	}


    /* update the doctor */
    const updatedDoctor = await prisma.doctor.update({
        where: {
            id: doctorId
        },

        data: {
            verificationStatus,
            rejectionReason: verificationStatus === DoctorVerificaitonStatus.REJECTED ? rejectionReason : null,
            reviewdBy: reviewer.userId,
            reviewedAt: new Date()
        }
    });


    const isApproved = verificationStatus === DoctorVerificaitonStatus.APPROVED;

    const templatePath = path.join(process.cwd(), 
        `
        src/app/template/${isApproved ? 
        "doctor-applicaiton-approved.ejs" : 
        "doctor-application.reject.ejs"
        }`
    );

    const templateData = {
        name: updatedDoctor.name,
        resone: updatedDoctor.rejectionReason
    }

    const html = await ejs.renderFile(templatePath, templateData);

    await transporter.sendMail({
        from: config.email_sender,
        to: updatedDoctor.email,
        subject: isApproved ? 
                 "Your Doctor Application Has been Approved" : 
                 "Your Doctor Application Has Been Rejected",
        html
    });

    return updatedDoctor
}

// getAll Doctor
const getAllDoctor = async(query: IQuery) => {
    const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

    const andConditions: DoctorWhereInput[] = [];

    /* searching */
    if(query.searchTerm) {
        andConditions.push({
            OR: [
                {name: {contains: query.searchTerm, mode: "insensitive"}},
                {email: {contains:query.searchTerm, mode: "insensitive"}},
                {
                    specialization: {
                        contains: query.searchTerm,
                        mode: "insensitive"
                    }
                },
                {
                    licenseNumber: {
                        contains: query.searchTerm,
                        mode: "insensitive"
                    }
                }
            ]
        })
    }


    /* filtering */
    	if (query.specialization) {
		andConditions.push({
			specialization: { equals: query.specialization, mode: "insensitive" },
		});
	}

	if (query.email) {
		andConditions.push({
			email: { contains: query.email, mode: "insensitive" },
		});
	}

	if (query.licenseNumber) {
		andConditions.push({
			licenseNumber: { equals: query.licenseNumber, mode: "insensitive" },
		});
	}

	if (query.verificationStatus) {
		andConditions.push({
			verificationStatus: query.verificationStatus as DoctorVerificaitonStatus,
		});
	}

	andConditions.push({ isDeleted: false });

    const allDoctors = await prisma.doctor.findMany({
        where: {
            AND: andConditions.length > 0 ? andConditions : undefined
        },
        take: limit,
		skip: skip,


		orderBy: {
			// sortBy : sortOrder
			[sortBy]: sortOrder
		},

        include: {
            user: {
                omit: {
                    password: true
                }
            }
        }
    });

    const totalDoctorCount = await prisma.doctor.count({
		where: {
			AND: andConditions
		}
	})

    return {
		data: allDoctors,
		meta: {
			page: page,
			limit: limit,
			total: totalDoctorCount,
			totalPages: Math.ceil(totalDoctorCount / limit)
		}
	}
} 



export const DoctorService = {
    applyAsDoctor,
    verifyDoctorEmail,
    approvedDoctor,
    getAllDoctor
}