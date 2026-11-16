import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
const paystackFetch=async(path:string,secret:string,init:RequestInit={})=>{const r=await fetch("https://api.paystack.co"+path,{...init,headers:{Authorization:"Bearer "+secret,Accept:"application/json","Content-Type":"application/json",...(init.headers||{})},signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>null);return {ok:r.ok&&j?.status===true,status:r.status,data:j?.data,message:String(j?.message||"Paystack request failed")};};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret=Deno.env.get("PAYSTACK_SECRET_KEY");
 if(!url||!anon||!service||!secret)return reply(503,{error:"server_configuration_error"});
 if(!secret.startsWith("sk_test_"))return reply(403,{error:"staging_test_key_required"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data:user,error:authError}=await auth.auth.getUser(token);
 if(authError||!user.user)return reply(401,{error:"invalid_session"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:profileError}=await db.from("user_profiles").select("role,account_status").eq("id",user.user.id).maybeSingle();
 if(profileError)return reply(503,{error:"profile_lookup_failed"});
 if(!profile||profile.role!=="admin"||profile.account_status!=="active")return reply(403,{error:"administrator_access_required"});
 const raw=await req.text();if(raw.length>4096)return reply(413,{error:"request_too_large"});
 let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return reply(400,{error:"invalid_json"})}
 const requestId=String(body.request_id||"");if(!/^[0-9a-f-]{36}$/i.test(requestId))return reply(400,{error:"invalid_refund_request"});
 const {data:request,error:requestError}=await db.from("booking_refund_requests").select("id,owner_id,waybill,reason,refund_source,refund_amount_cents,status").eq("id",requestId).maybeSingle();
 if(requestError)return reply(503,{error:"refund_request_lookup_failed"});if(!request)return reply(404,{error:"refund_request_not_found"});
 if(request.refund_source!=="provider"||Number(request.refund_amount_cents)<=0)return reply(409,{error:"request_is_not_a_paystack_refund"});
 const {data:booking,error:bookingError}=await db.from("customer_bookings").select("payment_source,refunded_at").eq("waybill",request.waybill).maybeSingle();
 if(bookingError||!booking)return reply(503,{error:"booking_lookup_failed"});
 if(booking.payment_source!=="paystack")return reply(409,{error:"original_payment_was_not_paystack"});
 if(booking.refunded_at)return reply(409,{error:"booking_already_refunded"});
 if(!["pending","provider_pending"].includes(request.status))return reply(409,{error:"refund_request_not_approved"});
 const {data:payment,error:paymentError}=await db.from("payment_transactions").select("provider_reference,amount,currency,status").eq("booking_waybill",request.waybill).eq("provider","paystack").eq("status","complete").maybeSingle();
 if(paymentError)return reply(503,{error:"original_payment_lookup_failed"});
 if(!payment?.provider_reference||payment.currency!=="ZAR")return reply(409,{error:"successful_zar_paystack_transaction_not_found"});
 const cents=Number(request.refund_amount_cents),original=Math.round(Number(payment.amount)*100);
 if(!Number.isSafeInteger(cents)||cents<=0||cents>original)return reply(409,{error:"refund_amount_exceeds_original_payment"});
 const {data:allRefunds,error:allRefundsError}=await db.from("paystack_refund_records").select("amount_cents,status").eq("transaction_reference",payment.provider_reference).neq("refund_request_id",request.id).in("status",["initiating","pending","processing","needs-attention","processed"]);
 if(allRefundsError)return reply(503,{error:"refund_total_lookup_failed"});
 const alreadyRefunded=(allRefunds||[]).reduce((n:any,x:any)=>n+Number(x.amount_cents||0),0);
 if(alreadyRefunded+cents>original)return reply(409,{error:"cumulative_refunds_exceed_original_payment"});
 if(request.status==="pending"){
  const {error}=await db.rpc("review_booking_refund",{p_admin_id:user.user.id,p_request_id:request.id,p_action:"approve",p_provider_reference:null});
  if(error)return reply(409,{error:"refund_request_could_not_be_approved"});
 }
 const {data:records,error:recordsError}=await db.from("paystack_refund_records").select("*").eq("refund_request_id",request.id).order("attempt_number",{ascending:false}).limit(1);
 if(recordsError)return reply(503,{error:"refund_attempt_lookup_failed"});
 let record=records?.[0];
 if(record&&["pending","processing","needs-attention","processed"].includes(record.status))return reply(200,{status:record.status,refund_reference:record.refund_reference,amount_cents:record.amount_cents,already_submitted:true});
 if(record?.status==="initiating"){
  const existing=await paystackFetch("/refund?reference="+encodeURIComponent(record.refund_reference),secret);
  const found=Array.isArray(existing.data)?existing.data[0]:null;
  if(found){await db.from("paystack_refund_records").update({provider_refund_id:found.id||null,status:found.status||"pending",updated_at:new Date().toISOString()}).eq("id",record.id);return reply(200,{status:found.status||"pending",refund_reference:record.refund_reference,already_submitted:true});}
 }else{
  const attempt=(record?.attempt_number||0)+1;
  const reference="shr_"+request.id.replaceAll("-","").slice(0,24)+"_"+attempt;
  const {data:inserted,error:insertError}=await db.from("paystack_refund_records").insert({refund_request_id:request.id,attempt_number:attempt,waybill:request.waybill,transaction_reference:payment.provider_reference,refund_reference:reference,amount_cents:cents,currency:"ZAR",status:"initiating",initiated_by:user.user.id}).select("*").single();
  if(insertError)return reply(503,{error:"refund_attempt_could_not_be_recorded"});
  record=inserted;
 }
 const submitted=await paystackFetch("/refund",secret,{method:"POST",body:JSON.stringify({transaction:payment.provider_reference,amount:cents,currency:"ZAR",reference:record.refund_reference,customer_note:String(request.reason||"SwiftHaul booking refund").slice(0,200),merchant_note:"SwiftHaul refund "+request.waybill})});
 if(!submitted.ok){
  if(submitted.status===409){const existing=await paystackFetch("/refund?reference="+encodeURIComponent(record.refund_reference),secret);const found=Array.isArray(existing.data)?existing.data[0]:null;if(found){await db.from("paystack_refund_records").update({provider_refund_id:found.id||null,status:found.status||"pending",updated_at:new Date().toISOString()}).eq("id",record.id);return reply(200,{status:found.status||"pending",refund_reference:record.refund_reference,already_submitted:true});}}
  await db.from("paystack_refund_records").update({failure_message:submitted.message.slice(0,500),updated_at:new Date().toISOString()}).eq("id",record.id);
  return reply(502,{error:"paystack_refund_submission_failed",detail:submitted.message.slice(0,180)});
 }
 const data=submitted.data||{};const state=String(data.status||"pending").toLowerCase();
 await db.from("paystack_refund_records").update({provider_refund_id:data.id||null,status:["pending","processing","needs-attention","processed","failed"].includes(state)?state:"pending",updated_at:new Date().toISOString()}).eq("id",record.id);
 return reply(200,{status:state,refund_reference:record.refund_reference,amount_cents:cents,submitted:true});
});
