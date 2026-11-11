import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const response=(s:number,t:string)=>new Response(t,{status:s,headers:{"Content-Type":"text/plain","Cache-Control":"no-store"}});
function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");}
function equal(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return response(405,"Method not allowed");
 const secret=Deno.env.get("PAYSTACK_SECRET_KEY");if(!secret)return response(503,"Webhook secret unavailable");
 const raw=await req.text();if(raw.length>256000)return response(413,"Payload too large");
 const supplied=(req.headers.get("x-paystack-signature")||"").toLowerCase();
 if(!/^[0-9a-f]{128}$/.test(supplied))return response(401,"Invalid signature");
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-512"},false,["sign"]);
 const digest=hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw)));
 if(!equal(digest,supplied))return response(401,"Invalid signature");
 let event:Record<string,any>;try{event=JSON.parse(raw)}catch{return response(400,"Invalid JSON");}
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!service)return response(503,"Backend unavailable");
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const emitTaxDocument=async(payload:Record<string,string>)=>{const endpoint=Deno.env.get("TAX_DOCUMENTS_API_URL"),secret=Deno.env.get("TAX_DOCUMENT_WEBHOOK_SECRET");if(!endpoint||!secret){console.error("Tax PDF event cannot run: TAX_DOCUMENTS_API_URL / TAX_DOCUMENT_WEBHOOK_SECRET not configured.");return false;}const body=JSON.stringify(payload);const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const signature=hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body)));try{const result=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","x-tax-doc-signature":signature},body,signal:AbortSignal.timeout(15000)});if(!result.ok){console.error("Tax PDF generation failed",result.status,await result.text());return false;}return true;}catch(error){console.error("Tax PDF generation request failed",String(error));return false;}};
 const sendNotification=async(payload:Record<string,unknown>)=>{try{const response=await fetch(url+"/functions/v1/notification-dispatch",{method:"POST",headers:{Authorization:"Bearer "+service,apikey:Deno.env.get("SUPABASE_ANON_KEY")||"","Content-Type":"application/json"},body:JSON.stringify({action:"send",...payload})});if(!response.ok)console.error("Notification dispatch failed",response.status,await response.text());}catch(error){console.error("Notification dispatch unavailable",String(error));}};
 if(event.event==="charge.success"){
  const ref=String(event.data?.reference||"");const amount=Number(event.data?.amount),currency=String(event.data?.currency||"");
  if(!ref||!Number.isSafeInteger(amount)||amount<100||currency!=="ZAR")return response(400,"Invalid payment fields");
  const {data:p,error:pe}=await db.from("payment_transactions").select("id,amount,status,booking_waybill").eq("provider","paystack").eq("provider_reference",ref).maybeSingle();
  if(pe)return response(503,"Payment lookup failed");if(!p)return response(404,"Payment reference not found");
  if(Math.round(Number(p.amount)*100)!==amount)return response(400,"Payment amount mismatch");
  if(p.status==="complete"){const generated=await emitTaxDocument({event:"charge.success",reference:ref,waybill:String(p.booking_waybill)});return generated?response(200,"OK"):response(503,"Payment saved; tax document generation will retry.");}
  const verify=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(ref),{headers:{Authorization:"Bearer "+secret},signal:AbortSignal.timeout(12000)});
  const v=await verify.json().catch(()=>null);
  if(!verify.ok||v?.status!==true||v?.data?.status!=="success"||v?.data?.currency!=="ZAR"||Number(v.data.amount)!==amount)return response(400,"Transaction verification failed");
  const {data:applied,error}=await db.rpc("apply_paystack_payment",{p_payment_id:p.id,p_reference:ref,p_amount_cents:amount,p_payload:{event:"charge.success",reference:ref,amount,currency}});
  if(error){console.error("Paystack payment apply failed",error.message);return response(503,"Payment confirmation could not be saved");}
  if(applied!==true)return response(409,"Payment is no longer eligible");
  const generated=await emitTaxDocument({event:"charge.success",reference:ref,waybill:String(p.booking_waybill)});
  return generated?response(200,"OK"):response(503,"Payment saved; tax document generation will retry.");
 }
 if(["transfer.success","transfer.failed","transfer.reversed"].includes(event.event)){
  const ref=String(event.data?.reference||"");const code=String(event.data?.transfer_code||"");
  if(!ref)return response(400,"Missing transfer reference");
  const status=event.event==="transfer.success"?"success":"failed";
  const {data:applied,error}=await db.rpc("apply_paystack_payout_event",{p_reference:ref,p_status:status,p_transfer_code:code||null,p_failure_reason:String(event.data?.reason||event.data?.message||"Transfer failed")});
  if(error){console.error("Paystack payout webhook update failed",error.message);return response(503,"Payout update failed");}
  if(applied!==true)return response(404,"Payout reference not found");
  if(status==="success"){
   const generated=await emitTaxDocument({event:"transfer.success",reference:ref});if(!generated)return response(503,"Payout saved; remittance generation will retry.");
   const {data:payout,error:payoutError}=await db.from("driver_payouts").select("driver_id,amount_zar,reference").eq("reference",ref).maybeSingle();
   if(payoutError)console.error("Payout notification lookup failed",payoutError.message);
   else if(payout){
    const [{data:driver},{data:user}]=await Promise.all([
     db.from("driver_profiles").select("phone").eq("user_id",payout.driver_id).maybeSingle(),
     db.from("user_profiles").select("full_name").eq("id",payout.driver_id).maybeSingle()
    ]);
    if(driver?.phone)await sendNotification({event_type:"payout_success",recipient_type:"driver",recipient_phone:driver.phone,payload_json:{amount_zar:Number(payout.amount_zar).toFixed(2),reference:payout.reference,driver_first_name:String(user?.full_name||"").split(/\\s+/)[0]}});
   }
  }
  return response(200,"OK");
 }
 return response(200,"Event ignored");
});