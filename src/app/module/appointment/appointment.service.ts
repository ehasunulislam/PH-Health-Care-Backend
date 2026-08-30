import { addMinutes, isBefore, isSameDay, subHours } from "date-fns";
import { AppointmentStatus, PaymentStatus, Role } from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkasToken } from "../../lib/bkas";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { IBookAppointmentPayload, ICancelAppointmentPayload, IPayAppointmentPayload, IUpdateAppointmentStatusPayload } from "./appointment.interface";
import  httpStatus  from "http-status";
import { transporter } from "../../lib/nodeMailer";
import  PDFDocument  from 'pdfkit'
import { IQuery } from "../../interfaces/global.interface";
import { AppointmentWhereInput } from "../../../generated/prisma/models";

const bookAppointmentService = async (payload: IBookAppointmentPayload, user: RequestUser) => {
    const transactionResult = await prisma.$transaction(async(tx) => {
        /* Business logic */
        const patient = await prisma.patient.findUnique({
            where: {
                userId: user.userId
            }
        });

        if(!patient) {
            throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
        }

        const schedule = await prisma.schedule.findUnique({
			where: { id: payload.scheduleId },
			include: { doctor: true },
		});

		if (!schedule || schedule.isDeleted) {
			throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
		}

        if(schedule.staus || schedule.isDeleted) {
            throw new AppError(httpStatus.BAD_REQUEST, "This Schedule Is Not Published Yet")
        }

        const now = new Date();

        if(!isSameDay(now, schedule.startDateTime)) {
            throw new AppError(
				httpStatus.BAD_REQUEST,
				"This Schedule Is Not Available Today",
			);
        }

        if(!isBefore(now, schedule.startDateTime)){
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"This Schedule Has Already Started",
			);
		}

        const existingAppointment = await prisma.appointment.findFirst({
			where : {
				patientId : patient.id,
				scheduleId : schedule.id,
				// status : { not : AppointmentStatus.CANCELLED }
			}
		});

        if(existingAppointment?.status === AppointmentStatus.PENDING){
			throw new AppError(httpStatus.BAD_REQUEST, "You Already Have A Pending Appointment. Please Pay For That")
		}
		if(existingAppointment?.status === AppointmentStatus.CONFIRMED){
			throw new AppError(httpStatus.BAD_REQUEST, "You Already Have A Confirmed Appointment.")
		}
		if(existingAppointment?.status === AppointmentStatus.ONGOING){
			throw new AppError(httpStatus.BAD_REQUEST, "You Already Have A Ongoing Appointment")
		}
		if(existingAppointment?.status === AppointmentStatus.COMPLETED){
			throw new AppError(httpStatus.BAD_REQUEST, "You Already Have Completed An Appointment On This Schedule. Please Try Again Another Day")
		}

		if(schedule.availableSlot === 0){
			throw new AppError(httpStatus.BAD_REQUEST, "This Schedule Is Fully Booked");
		}

		if(!schedule.doctor.consultationFee){
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Doctor Has Not Set A Consultation Fee Yet",
			);
		}

		const amount = schedule.doctor.consultationFee.toString();

        /* create appointment */
        const appointment = await tx.appointment.create({
            data: {
                status: AppointmentStatus.PENDING,
                patientId : patient.id,
				doctorId : schedule.doctor.id,
				scheduleId : schedule.id
            }
        })
        
        /* bkash process */
        const bkasIdToken = await getBkasToken();

        if(!bkasIdToken) {
            throw new Error("No Bkas Id oken Found")
        }

        // console.log({bkasIdToken});

        const bkascreatePaymentResponse = await fetch(`${config.bkash_base_url}/tokenized/checkout/create`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: bkasIdToken,
                "X-App-Key" : config.bkash_app_key
            },
            body: JSON.stringify({  
                mode: "0011",
                // payerReference: "0123456789",
                payerReference: user.email,
                callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
                merchantAssociationInfo: "MI05MID54RF09123456One",
                amount: amount,
                currency: "BDT",
                intent: "sale",
                // merchantInvoiceNumber: "Inv03" // appointment id
                merchantInvoiceNumber: appointment.id // appointment id
            })
        });

        const bkashCreatePaymentResult = await bkascreatePaymentResponse.json();


        /* payment model create */
        await tx.payment.create({
            data: {
                merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
                appointmentId: appointment.id,
                amount: amount,
                gatewayResponse: bkashCreatePaymentResult,
                bkashPaymentId: bkashCreatePaymentResult.paymentID,
                payerReference: user.email,
            }
        })

        return {
            paymentUrl: bkashCreatePaymentResult.bkashURL
        };
    });

    return transactionResult
};


// if any  payment is not confiremed the use this function 
const payAppointment = async(payload: IPayAppointmentPayload, user: RequestUser) => {
    const appointmentId = payload.appointmentId;

    const existingAppointment = await prisma.appointment.findUnique({
        where: {
            id: appointmentId
        },
        include: {
            schedule: {
                include: {
                    doctor: true
                }
            }
        }
    });

    if(!existingAppointment) {
        throw new Error("Appointment dose not exists");
    }

    if(existingAppointment.status !== "PENDING") {
        throw new Error("Appointment is not pending");
    }

    /* bkash process */
    const bkasIdToken = await getBkasToken();

    if(!bkasIdToken) {
        throw new Error("No Bkas Id oken Found")
    }

    if (!existingAppointment.schedule.doctor.consultationFee){
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Doctor Has Not Set A Consultation Fee Yet",
		);
	}

    const amount = existingAppointment.schedule.doctor.consultationFee.toString();
	const bkashIdToken = await getBkasToken();

	if (!bkashIdToken) {
		throw new AppError(httpStatus.BAD_GATEWAY, "No Bkash Access Token Found!");
	}

    const bkascreatePaymentResponse = await fetch(`${config.bkash_base_url}/tokenized/checkout/create`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: bkasIdToken,
            "X-App-Key" : config.bkash_app_key
        },
        body: JSON.stringify({  
            mode: "0011",
            // payerReference: "0123456789",
            payerReference: user.email,
            callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
            merchantAssociationInfo: "MI05MID54RF09123456One",
            amount: amount,
            currency: "BDT",
            intent: "sale",
            // merchantInvoiceNumber: "Inv03" // appointment id
            merchantInvoiceNumber: existingAppointment.id // appointment id
        })
    });

    const bkashCreatePaymentResult = await bkascreatePaymentResponse.json();


    await prisma.payment.update({
        where: {
            appointmentId: existingAppointment.id
        },

        data: {
            merchantInvoiceNumber: bkashCreatePaymentResult.merchantInvoiceNumber,
            gatewayResponse: bkashCreatePaymentResult,
            bkashPaymentId: bkashCreatePaymentResult.paymentID,
        }
    });

    return {
        paymentUrl: bkashCreatePaymentResult.bkashURL
    }
}

// book appointment payment callback
const bookAppointmentCallback = async (query: Record<string, any>) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const paymentId = query.paymentID;

		if (!paymentId) {
			throw new Error("Payment Id Missing");
		}

		const status = query.status;

		if (!status) {
			throw new Error("Payment Status is Missing");
		}

		const bkashIdToken = await getBkasToken();

		if (!bkashIdToken) {
			throw new Error("No Bkash Access Token Found!");
		}

		const executedPaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/execute`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: bkashIdToken,
					"X-App-Key": config.bkash_app_key,
				},

				body: JSON.stringify({
					paymentID: paymentId,
				}),
			},
		);

		const executedPaymentResult = await executedPaymentResponse.json();

		if (status === "success") {

            const appointment = await prisma.appointment.findUnique({
                where: {
                    id: executedPaymentResult.merchantInvoiceNumber
                },
                include : {
					schedule : true,
					patient : true,
					doctor : true
				}
            });

            if(!appointment){
				throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found!")
			}


            const alreadyBookedSlots = appointment.schedule.totalSlots - appointment.schedule.availableSlot;
			const serialNumber = alreadyBookedSlots + 1;

            const joiningTime = addMinutes(
				appointment.schedule.startDateTime, 
				(serialNumber - 1) * 20
			)

			await tx.appointment.update({
				where: {
					id: executedPaymentResult.merchantInvoiceNumber,
				},
				data: {
					status: AppointmentStatus.CONFIRMED,
                    joiningTime,
					serialNumber
				},
			});

            const newAvailableSlots = appointment.schedule.availableSlot - 1;

			await prisma.schedule.update({
				where : {
					id : appointment.schedule.id
				},
				data : {
					availableSlots : newAvailableSlots
				}
			})

			await tx.payment.update({
				where: {
					appointmentId: executedPaymentResult.merchantInvoiceNumber,
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.PAID,
					bkashTrxId: executedPaymentResult.trxID,
					paidAt: executedPaymentResult.paymentExecuteTime,
					gatewayResponse: executedPaymentResult,
				},
			});

            /* sending a email */
            const pdfDocument = new PDFDocument({
                margin: 50
            });

            const pdfChunks: Buffer[] = [];

            pdfDocument.on("data", (chunk: Buffer) => {
                pdfChunks.push(chunk)
            });

            const pdfReadyPromise = new Promise<Buffer>((resolve)=>{
				pdfDocument.on("end", () => {
					resolve(Buffer.concat(pdfChunks))
				})
			});

            pdfDocument.fontSize(20).text("PH HealthCare System",{ align: "center" });
            pdfDocument.fontSize(14).text("Appointment Invoice", { align: "center" });
            pdfDocument.moveDown(2);

            pdfDocument.fontSize(12).text(`Patient Name: ${appointment.patient?.name}`);
			pdfDocument.text(`Patient Email: ${appointment.patient?.email}`);
			pdfDocument.moveDown();

			pdfDocument.text(`Doctor Name: ${appointment.doctor?.name}`);
			pdfDocument.text(`Specialization: ${appointment.doctor?.specialization}`);
			pdfDocument.moveDown();

			pdfDocument.text(
				`Appointment Date: ${appointment.schedule.startDateTime.toDateString()}`,
			);
			pdfDocument.text(`Your Joining Time: ${joiningTime.toString()}`);
			pdfDocument.text(`Your Serial Number: ${serialNumber}`);
			pdfDocument.text(`Meeting Link: ${appointment.schedule.meetingLink}`);
			pdfDocument.moveDown();

			pdfDocument.text(`Amount Paid: ${executedPaymentResult.amount} BDT`);
			pdfDocument.text(`Payment Method: bKash`);
			pdfDocument.text(`Transaction Id: ${executedPaymentResult.trxID}`);
			pdfDocument.text(`Paid At: ${executedPaymentResult.paymentExecuteTime}`);

			pdfDocument.end();

            const pdfBuffer = await pdfReadyPromise;

            await transporter.sendMail({
				from: config.email_sender,
				to: appointment.patient.email,
				subject: "Your Appointment Invoice - PH Healthcare System",
                attachments: [
                    {
                        filename: "invoice.pdf",
						content : pdfBuffer
                    }
                ]
			})

			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=success`,
			};
		} else if (status === "failure") {
			await tx.payment.update({
				where: {
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.FAILED,
					gatewayResponse: executedPaymentResult,
				},
			});
			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=failue`,
			};
		} else if (status === "cancel") {
			await tx.payment.update({
				where: {
					bkashPaymentId: paymentId,
				},
				data: {
					status: PaymentStatus.CANCELED,
					gatewayResponse: executedPaymentResult,
				},
			});
			return {
				executedPaymentResult,
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?status=cancel`,
			};
		} else {
			return {
				executedPaymentResult,
				redirectUrl: `${config.frontend_url}/dashboard/my-appointments?error=payment-failed`,
			};
		}
	});

	return transactionResult;
};


// refund system
const canceledAppointment = async(payload: ICancelAppointmentPayload, user: RequestUser) => {
    const transactionResult = await prisma.$transaction(async(tx) => {
        const appointmentId = payload.appointmentId;

        const existingAppointment = await tx.appointment.findUnique({
            where: {
                id: appointmentId,
                patient: {
                    email: user.email
                }
            },
            include: {
                payment: true,
                schedule: true
            }
        });

        if(!existingAppointment) {
            throw new Error("Appointment dose not exists");
        }

        if(existingAppointment.status === "ONGOING" || existingAppointment.status === "COMPLETED") {
            throw new Error("Appointment Ongoing or Completed");
        }

        if(existingAppointment.status === "CANCELED") {
            throw new Error("Appointment Already Calceled")
        }

        const updatedAppointment = await tx.appointment.update({
            where: {
                id: existingAppointment.id
            },
            data: {
                status: AppointmentStatus.CANCELED
            }
        });

        await prisma.schedule.update({
            where: {
                id: existingAppointment.schedule.id
            },

            data: {
                availableSlot: {
                    increment: 1
                }
            }
        })

        /* bkash process */
        const now = new Date();
        const startDateTime = existingAppointment.schedule.startDateTime;
        const refundCutOff = subHours(startDateTime, 1);
        const iselegibleForRefund = isBefore(now, refundCutOff);

        if(iselegibleForRefund) {
            const bkasIdToken = await getBkasToken();

            if(!bkasIdToken) {
                throw new Error("No Bkas Id oken Found")
            }

            const bkashRefundPaymentResponse = await fetch(`${config.bkash_base_url}/tokenized/checkout/payment/refund`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    Authorization: bkasIdToken,
                    "X-App-Key" : config.bkash_app_key
                },
                body: JSON.stringify({  
                    paymentID: existingAppointment.payment?.bkashPaymentId,
                    trxID: existingAppointment.payment?.bkashTrxId,
                    amount: existingAppointment.payment?.amount.toString(),
                    sku:"Appointment Cancellation",
                    reason: "Patient cancel the payment"
                })
            });


            const bkashRefundePaymentResult = await bkashRefundPaymentResponse.json();

            console.log({bkashRefundePaymentResult});

            await tx.payment.update({
                where: {
                    appointmentId: existingAppointment.id
                },

                data: {
                    refundTrxId: bkashRefundePaymentResult.refundTrxID,
                    refundAt: bkashRefundePaymentResult.completedTime,
                    refundAmount: bkashRefundePaymentResult.amount,
                    refundReason: "Patient cancel the payment",
                    status: PaymentStatus.REFUND,
                    gatewayResponse: bkashRefundePaymentResult
                }
            });
        }

        const newPaymentInfo = await prisma.payment.findUnique({
            where: {
                appointmentId: existingAppointment.id
            }
        })


        return {
            appointment: updatedAppointment,
            payment: newPaymentInfo
        }
    });

    return transactionResult
}

// update appointment only dcotor [ confirmed -> Ongoing -> Completed  ]
const updateAppointmentStatus = async(appointmentId: string, payload: IUpdateAppointmentStatusPayload, user: RequestUser) => {
    const doctor = await prisma.doctor.findUnique({
        where: {
            userId: user.userId
        }
    });

    if (!doctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
	}

    const appointment = await prisma.appointment.findUnique({
        where: {
            id: appointmentId,
            doctorId: doctor.id
        }
    });

    if (!appointment) {
		throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found");
	}

    if(appointment.status === AppointmentStatus.COMPLETED){
		throw new AppError(httpStatus.FORBIDDEN, "Appointment is already completed")
	}

	if(appointment.status === AppointmentStatus.CANCELED){
		throw new AppError(httpStatus.FORBIDDEN, "Appointment is already cancelled")
	}

	if(appointment.status === AppointmentStatus.PENDING){
		throw new AppError(httpStatus.FORBIDDEN, "Appointment is Pending. You can change the status after appointment is confirmed")
	}

    if(appointment.status === AppointmentStatus.CONFIRMED){

		if(payload.status !== "ONGOING"){
			throw new AppError(httpStatus.BAD_REQUEST, "Confirmed Appointment Must Be Ongoing At First")
		}

		await prisma.appointment.update({
			where : {
				id : appointment.id
			},
			data : {
				status : AppointmentStatus.ONGOING
			}
		})
	}

    if(appointment.status === AppointmentStatus.ONGOING){

		if(payload.status !== "COMPLETED"){
			throw new AppError(httpStatus.BAD_REQUEST, "Ongoinf Appointment Must Be Complted.")
		}

		await prisma.appointment.update({
			where: {
				id: appointment.id
			},
			data: {
				status: AppointmentStatus.COMPLETED
			}
		});

        const updatedAppointment = await prisma.appointment.findUnique({
            where : {
                id : appointment.id
            }
        });

	    return updatedAppointment
	}
}

// patients appointment
const getMyAppointments = async (query : IQuery, user : RequestUser) => {
	const limit = query.limit ? Number(query.limit) : 10; 
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const patient = await prisma.patient.findUnique({
		where: { userId: user.userId },
	});

	if (!patient) {
		throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
	}

	const andConditions: AppointmentWhereInput[] = [
		{
			patientId : patient.id
		}
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const appointments = await prisma.appointment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy] : sortOrder},
		include: {
			doctor: { select: { id: true, name: true, specialization: true } },
			schedule: true,
			payment: true,
		},
	});

	const total = await prisma.appointment.count({
		where: { AND: andConditions },
	});

	return {
		data: appointments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};


}

//doctor appointments
const getDoctorAppointments = async (query: IQuery, user: RequestUser) => {

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"

	const doctor = await prisma.doctor.findUnique({
		where: { userId: user.userId },
	});

	if (!doctor) {
		throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
	}

	const andConditions: AppointmentWhereInput[] = [
		{
			doctorId : doctor.id
		}
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const appointments = await prisma.appointment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy] : sortOrder},
		include: {
			patient: {
				select: { id: true, name: true, email: true, contactNumber: true },
			},
			schedule: true,
			payment: true,
		},
	});

	const total = await prisma.appointment.count({
		where: { AND: andConditions },
	});

	return {
		data: appointments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
}

//admin super admin
const getAllAppointments = async (query : IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc"
 
	const andConditions: AppointmentWhereInput[] = [];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	if (query.doctorId) {
		andConditions.push({ doctorId: query.doctorId });
	}

	if (query.patientId) {
		andConditions.push({ patientId: query.patientId });
	}

	if(query.doctorEmail){
		andConditions.push({
			doctor : {
				email : query.doctorEmail
			}
		})
	}
	if(query.patientEmail){
		andConditions.push({
			patient : {
				email : query.patientEmail
			}
		})
	}

	const appointments = await prisma.appointment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy] : sortOrder },
		include: {
			patient: { select: { id: true, name: true, email: true } },
			doctor: { select: { id: true, name: true, specialization: true } },
			schedule: true,
			payment: true,
		},
	});

	const total = await prisma.appointment.count({
		where: { AND: andConditions },
	});

	return {
		data: appointments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};


}

// for all loggedin user
const getSingleAppointment = async (appointmentId : string, user : RequestUser) => {
	const appointment = await prisma.appointment.findUnique({
		where: { id: appointmentId },
		include: {
			patient: { select: { id: true, name: true, email: true, userId: true } },
			doctor: {
				select: { id: true, name: true, specialization: true, userId: true },
			},
			schedule: true,
			payment: true,
		},
	});

	if (!appointment) {
		throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found");
	}

	if(user.role === Role.PATIENT){
		if(appointment.patient.userId !== user.userId){
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not Allowed To View This Appointment",
			);
		}
	}
	if(user.role === Role.DOCTOR){
		if(appointment.doctor.userId !== user.userId){
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not Allowed To View This Appointment",
			);
		}
	}

	return appointment
}


export const AppointmentService = {
    bookAppointmentService,
    bookAppointmentCallback,
    payAppointment,
    canceledAppointment,
    updateAppointmentStatus,
    getMyAppointments,
    getDoctorAppointments,
    getAllAppointments,
    getSingleAppointment
}
