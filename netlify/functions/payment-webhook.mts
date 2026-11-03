import {createHmac,timingSafeEqual} from 'node:crypto';
import {confirmCharge,confirmTransfer} from '../lib/payment-events.mts';
export default async(req:Request)=>{
 if(req.method!=='POST')return new Response(null,{status:405});
 const key=Netlify.env.get('PAYSTACK_SECRET_KEY');if(!key)return new Response(null,{status:503});
 const raw=await req.text();if(raw.length>1000000)return new Response(null,{status:413});
 const signature=req.headers.get('x-paystack-signature') || '';
 if(!/^[a-f0-9]{128}$/i.test(signature))return new Response(null,{status:401});
 const expected=createHmac('sha512',key).update(raw).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return new Response(null,{status:401});
 try{const event=JSON.parse(raw);const reference=event.data?.reference;if(typeof reference!=='string'||reference.length>100)return new Response(null,{status:200});
  if(event.event==='charge.success'&&reference.startsWith('shp-'))await confirmCharge(reference);
  if(['transfer.success','transfer.failed','transfer.reversed'].includes(event.event)&&reference.startsWith('shw-'))await confirmTransfer(reference);
  return new Response(null,{status:200});
 }catch{return new Response(null,{status:503});}
};
export const config={path:'/api/paystack-webhook'};
