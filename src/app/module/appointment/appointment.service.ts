import config from "../../config";
import { getBkasToken } from "../../lib/bkas";

const bookAppointmentService = async () => {
	// Business logic

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
            payerReference: "0123456789",
            callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
            merchantAssociationInfo: "MI05MID54RF09123456One",
            amount: "1200",
            currency: "BDT",
            intent: "sale",
            merchantInvoiceNumber: "Inv03" // appointment id
        })
    });

    const bkashCreatePaymentResult = await bkascreatePaymentResponse.json();

    return bkashCreatePaymentResult;
};



const bookAppointmentCallBack = async(query: Record<string, any>) => {
    const paymentId = query.paymentID;

    if(!paymentId) {
        throw new Error("Payment id is missing");
    }

    const status = query.status;

    if(!status) {
        throw new Error("Payment status is missing");
    }

    const bkasIdToken = await getBkasToken();

    if(!bkasIdToken) {
        throw new Error("No Bkas Id oken Found")
    }

    const executePaymentResponse = await fetch(`${config.bkash_base_url}/tokenized/checkout/execute`, {
        method: 'POST',
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: bkasIdToken,
            "X-App-Key" : config.bkash_app_key
        },
        body: JSON.stringify({
            paymentID: paymentId
        })
    });


    const executedPaymentResult = await executePaymentResponse.json();

    if(status === "success") {
        return {
            executedPaymentResult,
            redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=success`
        }
    }

    if(status === "failure") {
        return {
            executedPaymentResult,
            redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=failure`
        }
    }

    if(status === "cancel") {
        return {
            executedPaymentResult,
            redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=cancel`
        }
    }

    return {
        executedPaymentResult,
        redirectUrl: `${config.frontend_url}/dashboard/my-appointment`
    };
}

export const AppointmentService = {
    bookAppointmentService,
    bookAppointmentCallBack
}
