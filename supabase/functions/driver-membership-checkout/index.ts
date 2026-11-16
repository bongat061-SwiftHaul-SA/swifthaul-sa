import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")??"").match(/^Bearer\\s+(.+)$/i)?.[1];
 if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret=Deno.env.get("PAYSTACK_SECRET_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 if(!secret)return reply(503,{error:"paystack_secret_not_configured"});
 const configuredMode=Deno.env.get("PAYSTACK_MODE");
 if(!secret.startsWith("sk_test_")||(configuredMode&&configuredMode!=="sandbox"))return reply(503,{error:"staging_requires_paystack_test_mode"});
 const callback=Deno.env.get("SWIFTHAUL_DRIVER_URL");
 if(!callback)return reply(503,{error:"driver_return_url_not_configured"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:authData,error:authError}=await auth.auth.getUser(token);
 if(authError||!authData.user)return reply(401,{error:"invalid_or_expired_session"});
 const user=authData.user;if(!user.email)return reply(400,{error:"verified_email_required"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:profileError}=await db.from("user_profiles").select("role,account_status").eq("id",user.id).maybeSingle();
 if(profileError)return reply(503,{error:"profile_lookup_failed"});
 if(!profile||profile.role!=="driver"||profile.account_status!=="active")return reply(403,{error:"active_driver_account_required"});
 const {data:driver,error:driverError}=await db.from("driver_profiles").select("verification_status").eq("user_id",user.id).maybeSingle();
 if(driverError)return reply(503,{error:"driver_profile_lookup_failed"});
 if(!driver||driver.verification_status!=="approved")return reply(403,{error:"approved_driver_required"});
 let body:Record<string,unknown>;try{const raw=await req.text();if(raw.length>2048)return reply(413,{error:"request_too_large"});body=JSON.parse(raw);}catch{return reply(400,{error:"invalid_json"});}
 if(body.plan!=="monthly"&&body.plan!=="yearly")return reply(400,{error:"invalid_membership_plan"});
 const plan=body.plan,amount=plan==="monthly"?25000:180000,now=new Date().toISOString();
 const {error:expireError}=await db.from("driver_memberships").update({status:"expired",updated_at:now}).eq("driver_user_id",user.id).eq("status","active").lte("ends_at",now);
 if(expireError)return reply(503,{error:"membership_expiry_update_failed"});
 const {data:active,error:activeError}=await db.from("driver_memberships").select("id").eq("driver_user_id",user.id).eq("status","active").gt("ends_at",now).limit(1).maybeSingle();
 if(activeError)return reply(503,{error:"active_membership_lookup_failed"});
 if(active)return reply(409,{error:"premium_membership_already_active"});
 const {data:pending,error:pendingError}=await db.from("driver_memberships").select("id,created_at").eq("driver_user_id",user.id).eq("status","pending").order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(pendingError)return reply(503,{error:"pending_membership_lookup_failed"});
 if(pending&&Date.parse(pending.created_at)>Date.now()-30*60*1000)return reply(409,{error:"membership_payment_already_pending"});
 if(pending){const {error}=await db.from("driver_memberships").update({status:"cancelled",updated_at:now}).eq("id",pending.id).eq("status","pending");if(error)return reply(503,{error:"stale_membership_cleanup_failed"});}
 const membershipId=crypto.randomUUID();
 const {error:insertError}=await db.from("driver_memberships").insert({id:membershipId,driver_user_id:user.id,plan,amount_cents:amount,status:"pending",provider:"paystack",auto_renew:false});
 if(insertError){console.error("Driver membership insert failed",insertError.message);return reply(503,{error:"membership_initialization_failed"});}
 const reference="sh_drv_"+crypto.randomUUID().replaceAll("-","");
 const callbackUrl=new URL(callback);callbackUrl.searchParams.set("membership","return");callbackUrl.searchParams.set("reference",reference);
 const initialized=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{"Authorization":"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email:user.email,amount,currency:"ZAR",reference,callback_url:callbackUrl.toString(),metadata:{driver_membership_id:membershipId,driver_user_id:user.id,plan,platform:"swifthaul_sa"}}),signal:AbortSignal.timeout(15000)});
 const payload=await initialized.json().catch(()=>null);
 if(!initialized.ok||payload?.status!==true||!payload?.data?.authorization_url){
  await db.from("driver_memberships").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("id",membershipId).eq("status","pending");
  console.error("Paystack driver membership initialization failed",initialized.status);
  return reply(502,{error:"paystack_initialization_failed"});
 }
 return reply(200,{provider:"paystack",mode:"sandbox",currency:"ZAR",amount_cents:amount,plan,membership_id:membershipId,reference,authorization_url:payload.data.authorization_url,payment_url:payload.data.authorization_url,access_code:payload.data.access_code});
});