import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
async function ps(path:string,key:string,init:RequestInit={}){const r=await fetch("https://api.paystack.co"+path,{...init,headers:{Authorization:"Bearer "+key,Accept:"application/json","Content-Type":"application/json",...(init.headers||{})},signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>null);return {ok:r.ok&&j?.status===true,status:r.status,data:j?.data,message:String(j?.message||"Paystack request failed")};}
const norm=(v:string)=>v.toLowerCase().replace(/\b(bank|limited|ltd)\b/g,"").replace(/[^a-z0-9]/g,"");
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret=Deno.env.get("PAYSTACK_SECRET_KEY");
 if(!url||!anon||!service||!secret)return reply(503,{error:"server_configuration_error"});
 // Staging must never initiate live transfers.
 if(!secret.startsWith("sk_test_"))return reply(403,{error:"staging_test_key_required"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data:user,error:authError}=await auth.auth.getUser(token);if(authError||!user.user)return reply(401,{error:"invalid_session"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:pe}=await db.from("user_profiles").select("role,account_status").eq("id",user.user.id).maybeSingle();
 if(pe)return reply(503,{error:"profile_lookup_failed"});if(!profile||profile.role!=="admin"||profile.account_status!=="active")return reply(403,{error:"administrator_access_required"});
 const raw=await req.text();if(raw.length>4096)return reply(413,{error:"request_too_large"});let b:any;try{b=JSON.parse(raw)}catch{return reply(400,{error:"invalid_json"})}
 const id=String(b.request_id||"");if(!/^[0-9a-f-]{36}$/i.test(id))return reply(400,{error:"invalid_payout_request"});
 const {data:request,error:re}=await db.from("driver_payout_requests").select("id,driver_user_id,amount_cents,bank_name,account_holder,account_number,account_type,status").eq("id",id).maybeSingle();
 if(re)return reply(503,{error:"payout_request_lookup_failed"});if(!request)return reply(404,{error:"payout_request_not_found"});if(request.status!=="approved")return reply(409,{error:"payout_must_be_approved_first"});
 const {data:prior,error:priorError}=await db.from("paystack_driver_payout_records").select("*").eq("payout_request_id",id).order("attempt_number",{ascending:false}).limit(1);
 if(priorError)return reply(503,{error:"payout_history_lookup_failed"});
 if(prior?.[0]&&["initiating","pending","success"].includes(prior[0].status))return reply(200,{status:prior[0].status,reference:prior[0].reference,already_submitted:true});
 const {data:driver,error:driverError}=await db.from("driver_profiles").select("user_id").eq("user_id",request.driver_user_id).maybeSingle();
 if(driverError||!driver)return reply(503,{error:"driver_profile_lookup_failed"});
 // Reuse a recipient only for a retry of this exact payout request. A new payout uses the bank details the driver supplied for that request.
 let recipient=prior?.[0]?.recipient_code||null;
 if(!recipient){
  const banks=await ps("/bank?country=south%20africa&currency=ZAR&perPage=100",secret);
  if(!banks.ok||!Array.isArray(banks.data))return reply(502,{error:"paystack_bank_list_unavailable"});
  const bank=banks.data.find((x:any)=>norm(String(x.name||""))===norm(String(request.bank_name||""))&&String(x.code||"").length>0);
  if(!bank)return reply(409,{error:"bank_name_not_mapped_to_paystack",detail:"Driver bank name must match a Paystack South African bank listing."});
  const created=await ps("/transferrecipient",secret,{method:"POST",body:JSON.stringify({type:"basa",name:request.account_holder,account_number:request.account_number,bank_code:String(bank.code),currency:"ZAR",description:"SwiftHaul driver "+request.driver_user_id})});
  if(!created.ok||!created.data?.recipient_code)return reply(502,{error:"paystack_recipient_creation_failed",detail:created.message.slice(0,180)});
  recipient=String(created.data.recipient_code);
  const {error:saveError}=await db.from("driver_profiles").update({paystack_recipient_code:recipient,paystack_recipient_created_at:new Date().toISOString()}).eq("user_id",request.driver_user_id);
  if(saveError)return reply(503,{error:"recipient_created_but_not_saved_contact_admin"});
 }
 const attempt=(prior?.[0]?.attempt_number||0)+1;const reference="shp_"+id.replaceAll("-","").slice(0,24)+"_"+attempt;
 const amount=Number(request.amount_cents);if(!Number.isSafeInteger(amount)||amount<1000)return reply(400,{error:"invalid_payout_amount"});
 const {data:record,error:recordError}=await db.from("paystack_driver_payout_records").insert({payout_request_id:id,attempt_number:attempt,driver_user_id:request.driver_user_id,reference,recipient_code:recipient,amount_cents:amount,currency:"ZAR",status:"initiating",initiated_by:user.user.id}).select("*").single();
 if(recordError)return reply(409,{error:"payout_attempt_already_created"});
 const transfer=await ps("/transfer",secret,{method:"POST",body:JSON.stringify({source:"balance",amount,recipient,reference,reason:"SwiftHaul completed delivery driver payout",currency:"ZAR"})});
 if(!transfer.ok){await db.from("paystack_driver_payout_records").update({status:"failed",failure_message:transfer.message.slice(0,500),updated_at:new Date().toISOString()}).eq("id",record.id).eq("status","initiating");return reply(502,{error:"paystack_transfer_failed",detail:transfer.message.slice(0,180)});}
 const data=transfer.data||{};const status=String(data.status||"pending").toLowerCase();await db.from("paystack_driver_payout_records").update({status:status==="success"?"success":"pending",transfer_code:data.transfer_code||null,updated_at:new Date().toISOString()}).eq("id",record.id);
 return reply(200,{status,reference,transfer_code:data.transfer_code||null,amount_cents:amount});
});
