import { Role } from "../../generated/prisma/enums"
import config from "../config";
import { prisma } from "../lib/prisma"
import bcrypt from "bcryptjs";

// create a super admin before server start
export const seedSuperAdmin = async() => {
    try{
        const isSuperAdminExist = await prisma.user.findFirst({
            where: {
                role: Role.SUPER_ADMIN
            }
        });

        if(isSuperAdminExist) {
            console.log("Super Admin already exists");
            return
        }

        const name = config.super_admin_name;
        const email = config.super_admin_email;
        const password = config.super_admin_password;

        if(!name || !email || !password) {
            throw new Error("name, email, password missing in ENV file")
        }

        const hashPassword = await bcrypt.hash(password, Number(config.bcrypt_salt_rounds));

        const superAdmin = await prisma.user.create({
            data: {
                name,
                email, 
                password: hashPassword,
                role: Role.SUPER_ADMIN,
                needPasswordChange: false,
                emailVerified: true
            }
        });

        console.log("Super Admin created successfully:" , superAdmin);

    }
    catch(err) {
        console.error("Error seeding Super Admin:", err);

        // await prisma.user.delete({
        //     where: {
        //         email: config.super_admin_email
        //     }
        // })
    }
}


// create a doctor before server start
export const seedDoctor = async() => {
    try{
        const isDoctorExists = await prisma.user.findFirst({
            where: {
                role: Role.DOCTOR
            }
        })

        if(isDoctorExists) {
            console.log("Doctor already exists");
            return
        }

        const name = config.doctor_name;
        const email = config.doctor_email;
        const password = config.doctor_password;

        if(!name || !email || !password) {
            throw new Error("name, email, or password doesn't exists in .env file")
        }

        const hashPassword = await bcrypt.hash(password, Number(config.bcrypt_salt_rounds));

        const createDoctor = await prisma.user.create({
           data: {
            name,
            email,
            password: hashPassword,
            role: Role.DOCTOR,
            needPasswordChange: false,
            emailVerified: true
           } 
        });

        console.log("Doctor created successfully", createDoctor)
    }
    catch(err) {
        console.log("Error seeding Doctor:", err)
    }
}

// create a patient before server start
export const seedPatient = async() => {
    try{
        const isPatientExists = await prisma.user.findFirst({
            where: {
                role: Role.PATIENT
            }
        })

        if(isPatientExists) {
            console.log("Doctor already exists");
            return
        }

        const name = config.patient_name;
        const email = config.patient_email;
        const password = config.patient_password;

        if(!name || !email || !password) {
            throw new Error("name, email, or password doesn't exists in .env file")
        }

        const hashPassword = await bcrypt.hash(password, Number(config.bcrypt_salt_rounds));

        const createPatient = await prisma.user.create({
           data: {
            name,
            email,
            password: hashPassword,
            role: Role.PATIENT,
            needPasswordChange: false,
            emailVerified: true
           } 
        });

        console.log("Doctor created successfully", createPatient)
    }
    catch(err) {
        console.log("Error seeding Doctor:", err)
    }
}