import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret=Deno.env.get("PAYSTACK_SECRET_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 if(!secret)return reply(503,{error:"paystack_secret_not_configured"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),{data:u,error:ue}=await auth.auth.getUser(token);
 if(ue||!u.user)return reply(401,{error:"invalid_session"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:pe}=await db.from("user_profiles").select("role,account_status").eq("id",u.user.id).maybeSingle();
 if(pe||!profile)return reply(403,{error:"active_customer_account_required"});
 if(profile.role!=="customer"||profile.account_status!=="active")return reply(403,{error:"active_customer_account_required"});
 let body:Record<string,unknown>;try{body=await req.json()}catch{return reply(400,{error:"invalid_json"})}
 if(typeof body.waybill!=="string"||body.waybill.length>100)return reply(400,{error:"booking_reference_required"});
 const {data:b,error:be}=await db.from("customer_bookings").select("waybill,owner_hash,price,paid_at,refunded_at,status,counter_offer_status,payment_method").eq("waybill",body.waybill).eq("owner_hash",u.user.id).maybeSingle();
 if(be||!b)return reply(404,{error:"booking_not_found"});
 if(b.payment_method!=="card"||b.paid_at||b.refunded_at||["cancelled","delivered"].includes(b.status)||b.counter_offer_status==="pending")return reply(409,{error:"booking_not_payable"});
 const amountCents=Math.round(Number(b.price)*100);
 if(!Number.isSafeInteger(amountCents)||amountCents<100||amountCents>100000000)return reply(422,{error:"invalid_booking_amount"});
 const mode=Deno.env.get("PAYSTACK_MODE")==="live"?"live":"sandbox";
 const reference="sh_"+crypto.randomUUID().replaceAll("-","");
 const callback=Deno.env.get("SWIFTHAUL_CUSTOMER_URL");
 if(!callback)return reply(503,{error:"customer_return_url_not_configured"});
 const {data:created,error:ce}=await db.from("payment_transactions").insert({owner_id:u.user.id,booking_waybill:b.waybill,provider:"paystack",m_payment_id:reference,provider_reference:reference,amount:amountCents/100,currency:"ZAR",status:"pending",payment_mode:mode}).select("id").single();
 if(ce||!created)return reply(503,{error:"payment_record_create_failed"});
 const response=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{"Authorization":"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email:u.user.email,amount:amountCents,currency:"ZAR",reference,callback_url:callback+"?payment=paystack_return&reference="+encodeURIComponent(reference),metadata:{booking_waybill:b.waybill,payment_id:created.id,platform:"swifthaul_sa"}}),signal:AbortSignal.timeout(15000)});
 const payload=await response.json().catch(()=>null);
 if(!response.ok||payload?.status!==true||!payload?.data?.authorization_url){await db.from("payment_transactions").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",created.id).eq("status","pending");return reply(502,{error:"paystack_initialization_failed"});}
 await db.from("payment_transactions").update({paystack_access_code:payload.data.access_code,provider_reference:reference,updated_at:new Date().toISOString()}).eq("id",created.id);
 return reply(200,{provider:"paystack",currency:"ZAR",amount_cents:amountCents,reference,authorization_url:payload.data.authorization_url,access_code:payload.data.access_code,mode});
});