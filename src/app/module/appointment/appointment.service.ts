import { AppointmentStatus, PaymentStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { getBkasToken } from "../../lib/bkas";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";

const bookAppointmentService = async (payload: any, user: RequestUser) => {
    const transactionResult = await prisma.$transaction(async(tx) => {
        /* Business logic */
        /* create appointment */
        const appointment = await tx.appointment.create({
            data: {
                status: AppointmentStatus.PENDING
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
                amount: "1200",
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
                amount: "1200",
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
            amount: "1200",
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
			await tx.appointment.update({
				where: {
					id: executedPaymentResult.merchantInvoiceNumber,
				},
				data: {
					status: AppointmentStatus.CONFIRMED,
				},
			});

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
