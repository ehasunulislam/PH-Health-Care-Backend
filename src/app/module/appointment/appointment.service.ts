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
            payerReference: "01723888888",
            callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
            merchantAssociationInfo: "MI05MID54RF09123456One",
            amount: "1200",
            currency: "BDT",
            intent: "sale",
            merchantInvoiceNumber: "Inv0124" // appointment id
        })
    });

    const bkasCreatePaymentResult = await bkascreatePaymentResponse.json();

    return bkasCreatePaymentResult;
};


const bookAppointmentCallBack = () => {

    return {
        success: true
    }
}

export const AppointmentService = {
    bookAppointmentService,
    bookAppointmentCallBack
}
