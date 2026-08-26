import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma"
import { cloudinary } from "../../lib/cloudinary";
import bcrypt from "bcryptjs";
import config from "../../config";
import { Role } from "../../../generated/prisma/enums";
import crypto from "crypto"
import { redisClient } from "../../lib/redis";
import path from "path"
import ejs from "ejs";
import { transporter } from "../../lib/nodeMailer";
import { IApplyAsDoctorPayload, IVerifyDoctorEmailPayload } from "./doctor.interface";


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



export const DoctorService = {
    applyAsDoctor,
    verifyDoctorEmail
}