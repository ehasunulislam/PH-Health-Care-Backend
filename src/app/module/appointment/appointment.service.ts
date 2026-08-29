import { addMinutes, isBefore, isSameDay } from "date-fns";
import { AppointmentStatus, PaymentStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkasToken } from "../../lib/bkas";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { IBookAppointmentPayload } from "./appointment.interface";
import  httpStatus  from "http-status";
import { transporter } from "../../lib/nodeMailer";
import  PDFDocument  from 'pdfkit'

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
const payAppointment = async(payload: any, user: RequestUser) => {
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
const canceledAppointment = async(payload: any) => {
    const transactionResult = await prisma.$transaction(async(tx) => {
        const appointmentId = payload.appointmentId;

        const existingAppointment = await tx.appointment.findUnique({
            where: {
                id: appointmentId
            },
            include: {
                payment: true
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
                status: "CANCELED"
            }
        });

        /* bkash process */
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

        const updatedPayment = await tx.payment.update({
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

        return {
            appointment: updatedAppointment,
            payment: updatedPayment
        }
    });

    return transactionResult
}


export const AppointmentService = {
    bookAppointmentService,
    bookAppointmentCallback,
    payAppointment,
    canceledAppointment
}
