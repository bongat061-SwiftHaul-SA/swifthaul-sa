import {processPayments} from '../lib/payment-events.mts';
import {paymentReady} from '../lib/paystack.mts';
export default async()=>{if(paymentReady())await processPayments();};
export const config={schedule:'*/5 * * * *'};
