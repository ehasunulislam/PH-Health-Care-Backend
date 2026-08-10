import { Role } from "../../generated/prisma/enums"
import config from "../config";
import { prisma } from "../lib/prisma"
import bcrypt from "bcryptjs";

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

        await prisma.user.delete({
            where: {
                email: config.super_admin_email
            }
        })
    }
}