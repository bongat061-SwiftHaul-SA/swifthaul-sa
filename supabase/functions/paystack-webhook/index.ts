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
  const metadataOf=(value:any)=>{if(typeof value==="string"){try{return JSON.parse(value)}catch{return {}}}return value&&typeof value==="object"?value:{};};
  const waybillOf=(value:any):string|null=>{
   const metadata=metadataOf(value?.metadata);
   const fields=Array.isArray(metadata.custom_fields)?metadata.custom_fields:Array.isArray(value?.custom_fields)?value.custom_fields:[];
   const field=fields.find((item:any)=>item&&String(item.variable_name||"").toLowerCase()==="swifthaul_waybill");
   const candidate=field?.value??metadata.swifthaul_waybill??value?.swifthaul_waybill;
   return typeof candidate==="string"&&/^SH-[A-F0-9-]{20,60}$/i.test(candidate.trim())?candidate.trim():null;
  };
  const verify=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(ref),{headers:{Authorization:"Bearer "+secret},signal:AbortSignal.timeout(12000)});
  const v=await verify.json().catch(()=>null);
  if(!verify.ok||v?.status!==true||v?.data?.status!=="success"||v?.data?.reference!==ref||v?.data?.currency!=="ZAR"||Number(v.data.amount)!==amount)return response(400,"Transaction verification failed");
  const membershipIdOf=(value:any):string|null=>{
   const metadata=metadataOf(value?.metadata);
   const fields=Array.isArray(metadata.custom_fields)?metadata.custom_fields:Array.isArray(value?.custom_fields)?value.custom_fields:[];
   const field=fields.find((item:any)=>item&&String(item.variable_name||"").toLowerCase()==="driver_membership_id");
   const candidate=field?.value??metadata.driver_membership_id??value?.driver_membership_id;
   return typeof candidate==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.trim())?candidate.trim():null;
  };
  const eventMembershipId=membershipIdOf(event.data),verifiedMembershipId=membershipIdOf(v.data);
  if(eventMembershipId&&verifiedMembershipId&&eventMembershipId!==verifiedMembershipId)return response(400,"Webhook and verified membership IDs do not match");
  const membershipId=eventMembershipId||verifiedMembershipId;
  if(membershipId){
   const {data:m,error:lookupError}=await db.from("driver_memberships").select("id,plan,amount_cents,status,provider,provider_payment_id").eq("id",membershipId).maybeSingle();
   if(lookupError)return response(503,"Membership lookup failed");
   if(!m)return response(404,"Membership reference not found");
   if(m.provider!=="paystack")return response(409,"Membership payment provider mismatch");
   const expected=m.plan==="monthly"?25000:m.plan==="yearly"?180000:0;
   if(!expected||Number(m.amount_cents)!==expected||amount!==expected)return response(400,"Membership amount mismatch");
   if(m.status==="active"&&m.provider_payment_id===ref)return response(200,"OK");
   if(m.status!=="pending"||m.provider_payment_id)return response(409,"Membership is no longer pending");
   const {data:applied,error:applyError}=await db.rpc("apply_paystack_driver_membership",{p_membership_id:membershipId,p_reference:ref,p_amount_cents:amount});
   if(applyError){console.error("Paystack membership activation failed",applyError.message);return response(503,"Membership activation could not be saved");}
   if(applied!==true)return response(409,"Membership payment is no longer eligible");
   return response(200,"OK");
  }
  const eventWaybill=waybillOf(event.data);
  const verifiedWaybill=waybillOf(v.data);
  if(eventWaybill&&verifiedWaybill&&eventWaybill!==verifiedWaybill)return response(400,"Webhook and verified waybills do not match");
  const waybill=eventWaybill||verifiedWaybill;
  const {data:byReference,error:refError}=await db.from("payment_transactions").select("id,amount,status,booking_waybill,provider_reference").eq("provider","paystack").eq("provider_reference",ref).maybeSingle();
  if(refError)return response(503,"Payment lookup failed");
  let p=byReference;
  if(!p){
   if(!waybill)return response(400,"SwiftHaul Waybill custom field is missing or invalid");
   const {data:pending,error:pendingError}=await db.from("payment_transactions").select("id,amount,status,booking_waybill,provider_reference").eq("provider","paystack").eq("booking_waybill",waybill).eq("status","pending").maybeSingle();
   if(pendingError)return response(503,"Pending payment lookup failed");
   if(!pending)return response(404,"No pending SwiftHaul payment matches this waybill");
   p=pending;
  }
  if(waybill&&waybill!==p.booking_waybill)return response(400,"Verified waybill does not match pending booking");
  if(Math.round(Number(p.amount)*100)!==amount)return response(400,"Payment amount mismatch");
  if(p.status==="complete"){if(p.provider_reference!==ref)return response(409,"A separate payment reference already completed for this booking");const generated=await emitTaxDocument({event:"charge.success",reference:ref,waybill:String(p.booking_waybill)});return generated?response(200,"OK"):response(503,"Payment saved; tax document generation will retry.");}
  const {data:applied,error}=await db.rpc("apply_paystack_payment",{p_payment_id:p.id,p_reference:ref,p_amount_cents:amount,p_payload:{event:"charge.success",reference:ref,amount,currency}});
  if(error){console.error("Paystack payment apply failed",error.message);return response(503,"Payment confirmation could not be saved");}
  if(applied!==true)return response(409,"Payment is no longer eligible");
  const generated=await emitTaxDocument({event:"charge.success",reference:ref,waybill:String(p.booking_waybill)});
  return generated?response(200,"OK"):response(503,"Payment saved; tax document generation will retry.");
 }
 if(["refund.pending","refund.processing","refund.needs-attention","refund.processed","refund.failed"].includes(event.event)){
  const refundReference=String(event.data?.refund_reference||event.data?.reference||"");
  if(!refundReference)return response(400,"Missing refund reference");
  const status=event.event==="refund.pending"?"pending":event.event==="refund.processing"?"processing":event.event==="refund.needs-attention"?"needs-attention":event.event==="refund.processed"?"processed":"failed";
  const {data:record,error:recordError}=await db.from("paystack_refund_records").select("id,refund_request_id,waybill,transaction_reference,amount_cents").eq("refund_reference",refundReference).maybeSingle();
  if(recordError)return response(503,"Refund record lookup failed");
  if(!record)return response(200,"Unknown refund reference ignored");
  const {error:updateError}=await db.from("paystack_refund_records").update({status,provider_refund_id:event.data?.id||null,failure_message:status==="failed"?String(event.data?.message||event.data?.reason||"Refund failed").slice(0,500):null,updated_at:new Date().toISOString()}).eq("id",record.id);
  if(updateError)return response(503,"Refund status update failed");
  if(status==="processed"){
   const {data:payment,error:paymentError}=await db.from("payment_transactions").select("amount").eq("booking_waybill",record.waybill).eq("provider","paystack").eq("provider_reference",record.transaction_reference).maybeSingle();
   if(paymentError)return response(503,"Original payment lookup failed");
   const full=payment&&Number(record.amount_cents)>=Math.round(Number(payment.amount)*100);
   if(full){
    const {error:bookingError}=await db.from("customer_bookings").update({refunded_at:new Date().toISOString()}).eq("waybill",record.waybill).is("refunded_at",null);
    if(bookingError)return response(503,"Booking refund status update failed");
    const {error:paymentUpdateError}=await db.from("payment_transactions").update({status:"refunded",refunded_at:new Date().toISOString(),refund_reference:refundReference,updated_at:new Date().toISOString()}).eq("booking_waybill",record.waybill).eq("provider","paystack").eq("provider_reference",record.transaction_reference);
    if(paymentUpdateError)return response(503,"Payment refund status update failed");
   }else{
    const {error:paymentUpdateError}=await db.from("payment_transactions").update({refund_reference:refundReference,updated_at:new Date().toISOString()}).eq("booking_waybill",record.waybill).eq("provider","paystack").eq("provider_reference",record.transaction_reference);
    if(paymentUpdateError)return response(503,"Partial refund audit update failed");
   }
   const {error:requestUpdateError}=await db.from("booking_refund_requests").update({status:"completed",provider_reference:refundReference,updated_at:new Date().toISOString()}).eq("id",record.refund_request_id);
   if(requestUpdateError)return response(503,"Refund request completion update failed");
  }
  return response(200,"OK");
 }
 if(["transfer.success","transfer.failed","transfer.reversed"].includes(event.event)){
  const ref=String(event.data?.reference||"");const code=String(event.data?.transfer_code||"");
  if(!ref)return response(400,"Missing transfer reference");
  const transferStatus=event.event==="transfer.success"?"success":event.event==="transfer.reversed"?"reversed":"failed";
  const {data:driverTransfer,error:driverTransferError}=await db.from("paystack_driver_payout_records").select("id,payout_request_id,amount_cents,status").eq("reference",ref).maybeSingle();
  if(driverTransferError)return response(503,"Driver payout lookup failed");
  if(driverTransfer){
   if(["success","failed","reversed"].includes(driverTransfer.status))return response(200,"Driver payout event already finalized");
   const {error:transferUpdateError}=await db.from("paystack_driver_payout_records").update({status:transferStatus,transfer_code:code||null,failure_message:transferStatus==="success"?null:String(event.data?.reason||event.data?.message||"Transfer failed").slice(0,500),updated_at:new Date().toISOString()}).eq("id",driverTransfer.id);
   if(transferUpdateError)return response(503,"Driver payout event could not be saved");
   if(transferStatus==="success"){
    const {error:requestUpdateError}=await db.from("driver_payout_requests").update({status:"paid",admin_reference:ref,paid_at:new Date().toISOString(),reviewed_at:new Date().toISOString()}).eq("id",driverTransfer.payout_request_id).eq("status","approved");
    if(requestUpdateError)return response(503,"Driver payout request could not be completed");
   }else{
    const {data:request,error:requestError}=await db.from("driver_payout_requests").select("driver_user_id").eq("id",driverTransfer.payout_request_id).maybeSingle();
    if(requestError||!request)return response(503,"Driver payout request lookup failed");
    const {error:releaseError}=await db.from("driver_earnings_ledger").insert({driver_user_id:request.driver_user_id,event_key:"paystack-payout-release:"+ref,event_type:"payout_released",amount_cents:driverTransfer.amount_cents,payout_request_id:driverTransfer.payout_request_id,description:"Released reserved earnings after Paystack transfer "+transferStatus}).select().maybeSingle();
    if(releaseError&&!String(releaseError.message||"").toLowerCase().includes("duplicate"))return response(503,"Driver payout reserve could not be released");
    const {error:requestUpdateError}=await db.from("driver_payout_requests").update({status:"approved"}).eq("id",driverTransfer.payout_request_id).eq("status","approved");
    if(requestUpdateError)return response(503,"Driver payout retry state could not be saved");
   }
   return response(200,"OK");
  }
  const status=event.event==="transfer.success"?"success":"failed";
  const {data:applied,error}=await db.rpc("apply_paystack_payout_event",{p_reference:ref,p_status:status,p_transfer_code:code||null,p_failure_reason:String(event.data?.reason||event.data?.message||"Transfer failed")});
  if(error){console.error("Paystack payout webhook update failed",error.message);return response(503,"Payout update failed");}
  if(applied!==true){
   const {data:fleetTransfer,error:fleetLookupError}=await db.from("fleet_payout_transfers").select("id,status").eq("reference",ref).maybeSingle();
   if(fleetLookupError){console.error("Fleet payout lookup failed",fleetLookupError.message);return response(503,"Fleet payout lookup failed");}
   if(!fleetTransfer)return response(404,"Payout reference not found");
   const {error:fleetUpdateError}=await db.from("fleet_payout_transfers").update({status,transfer_code:code||null,failure_reason:status==="failed"?String(event.data?.reason||event.data?.message||"Transfer failed"):null,updated_at:new Date().toISOString()}).eq("id",fleetTransfer.id);
   if(fleetUpdateError){console.error("Fleet payout status update failed",fleetUpdateError.message);return response(503,"Fleet payout update failed");}
  }
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