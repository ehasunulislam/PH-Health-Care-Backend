import { UploadApiResponse } from "cloudinary";
import { prisma } from "../../lib/prisma"
import { cloudinary } from "../../lib/cloudinary";
import bcrypt from "bcryptjs";
import config from "../../config";
import { Role } from "../../../generated/prisma/enums";

const applyAsDoctor = async(
    payload: any, 
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

        return doctorApplication
}



export const DoctorService = {
    applyAsDoctor
}