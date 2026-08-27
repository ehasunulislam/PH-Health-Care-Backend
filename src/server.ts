import app from "./app";
import config from "./app/config";
import { deleteUnverifiendDoctors } from "./app/lib/corn";
import { transporter } from "./app/lib/nodeMailer";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redis";
import { seedDoctor, seedPatient, seedSuperAdmin } from "./app/utils/seeds";

const PORT = config.port;

const main = async () => {
	try {
		await prisma.$connect();
		console.log("Connected to the database successfully.");

		await redisClient.connect();
		console.log("Redis connected successfully");

		await transporter.verify();
		console.log("Nodemailer Connected successfully");
		
		await seedSuperAdmin();
		await seedDoctor();
		await seedPatient();

		await deleteUnverifiendDoctors();

		app.listen(PORT, () => {
			console.log(`Server is running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
