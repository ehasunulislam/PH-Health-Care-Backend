import cron from 'node-cron';
import { prisma } from './prisma';
import { DoctorVerificaitonStatus, Role } from '../../generated/prisma/enums';

export const deleteUnverifiendDoctors = async() => {
    cron.schedule('*/10 * * * *', async() => {
        
        try{
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

            const deleteDoctors = await prisma.user.deleteMany({
                where: {
                    role: Role.DOCTOR,
                    emailVerified: false,
                    createdAt: { lt: oneHourAgo }
                }
            });

            doctor: {
                verofitionStatus: DoctorVerificaitonStatus.PENDING
            }

            if(deleteDoctors.count > 0) {
                console.log(`
                    Cron: Deleted ${deleteDoctors.count} unverified email doctor application older than 1 hour`)
            }
        }
        catch(err) {
            console.log("Corn: Failed to delete unverified doctor applications", err)
        }

        console.log("Unverified Doctor delete cron schedule (every 10 min")
    });
}