import type {} from '@netlify/functions';
import {RouteError} from './delivery.mts';
export const paymentReady=()=>Boolean(Netlify.env.get('PAYSTACK_SECRET_KEY'));
export async function paystack(path:string,body?:unknown){
 const key=Netlify.env.get('PAYSTACK_SECRET_KEY');if(!key)throw new RouteError('Online payments and withdrawals are not configured yet.',503);
 const response=await fetch('https://api.paystack.co'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok||!data.status)throw new RouteError('The payment provider could not complete this request. Please retry.',502);
 return data.data;
}
