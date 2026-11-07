import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
const esc=(v:unknown)=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]||c));
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:a,error:ae}=await auth.auth.getUser(token);if(ae||!a.user)return reply(401,{error:"invalid_or_expired_session"});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:p,error:pe}=await admin.from("user_profiles").select("role,account_status,full_name").eq("id",a.user.id).maybeSingle();
 if(pe||!p)return reply(403,{error:"customer_profile_not_found"});
 if(p.role!=="customer"||p.account_status!=="active")return reply(403,{error:"active_customer_account_required"});
 const {data:row,error:re}=await admin.from("customer_welcome_notifications").select("welcome_email_sent_at").eq("customer_user_id",a.user.id).maybeSingle();
 if(re)return reply(500,{error:"notification_status_unavailable"});
 if(row?.welcome_email_sent_at)return reply(200,{success:true,welcome_email_sent:true,already_sent:true});
 const key=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("CUSTOMER_EMAIL_FROM")||Deno.env.get("DRIVER_EMAIL_FROM")||"SwiftHaul SA <onboarding@resend.dev>";
 if(!key||!a.user.email)return reply(200,{success:true,welcome_email_sent:false,reason:"email_provider_not_configured"});
 const name=esc(p.full_name||a.user.user_metadata?.full_name||"there");
 const appUrl=Deno.env.get("CUSTOMER_APP_URL")||"https://bongat061-swifthaul-sa.github.io/swifthaul-sa-preview/customer.html";
 const html="<div style='font-family:Arial,sans-serif;color:#173d31'><h2>Welcome to SwiftHaul SA</h2><p>Hello "+name+",</p><p>Your customer account is ready. You can now arrange deliveries, manage your bookings and track your orders.</p><p><a href='"+esc(appUrl)+"'>Open SwiftHaul Customer</a></p><p>For your security, SwiftHaul will never email your password. Sign in using the email address and password you created.</p></div>";
 const sentAt=new Date().toISOString();
 try{
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from,to:[a.user.email],subject:"Welcome to SwiftHaul SA",html})});
  if(!response.ok)throw new Error("email_provider_"+response.status);
 }catch(e){console.error("Customer welcome email failed",String(e));return reply(200,{success:false,welcome_email_sent:false,reason:"email_delivery_failed"});}
 const {error:saveError}=await admin.from("customer_welcome_notifications").upsert({customer_user_id:a.user.id,welcome_email_sent_at:sentAt,updated_at:sentAt});
 if(saveError)return reply(500,{error:"notification_tracking_failed"});
 return reply(200,{success:true,welcome_email_sent:true});
});
