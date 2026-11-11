import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
const esc=(v:unknown)=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]||c));
async function send(key:string,from:string,to:string[],subject:string,html:string,id:string){
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":id},body:JSON.stringify({from,to,subject,html})});
 if(!r.ok)throw new Error("email_provider_"+r.status);
}
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
 const {data:row,error:re}=await admin.from("customer_welcome_notifications").select("welcome_email_sent_at,admin_email_sent_at").eq("customer_user_id",a.user.id).maybeSingle();
 if(re)return reply(500,{error:"notification_status_unavailable"});
 const key=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("CUSTOMER_EMAIL_FROM")||Deno.env.get("AUTH_EMAIL_FROM")||Deno.env.get("DRIVER_EMAIL_FROM")||"SwiftHaul SA <onboarding@resend.dev>";
 if(!key||!a.user.email)return reply(200,{success:true,welcome_email_sent:!!row?.welcome_email_sent_at,admin_email_sent:!!row?.admin_email_sent_at,reason:"email_provider_not_configured"});
 const name=esc(p.full_name||a.user.user_metadata?.full_name||"there"),appUrl=Deno.env.get("CUSTOMER_APP_URL")||"https://bongat061-swifthaul-sa.github.io/swifthaul-sa-preview/customer.html";
 let welcome=!!row?.welcome_email_sent_at,adminSent=!!row?.admin_email_sent_at;
 if(!welcome){const html="<div style='font-family:Arial,sans-serif;color:#20242a'><h2>Welcome to SwiftHaul SA</h2><p>Hello "+name+",</p><p>Your Customer account is ready. You can now arrange deliveries, manage bookings and track orders.</p><p><a href='"+esc(appUrl)+"'>Open SwiftHaul Customer</a></p><p>SwiftHaul will never email your password or PIN.</p></div>";
  try{await send(key,from,[a.user.email],"Welcome to SwiftHaul SA",html,"customer-welcome-"+a.user.id);welcome=true;}catch(e){console.error("Customer welcome email failed",String(e));}}
 const recipients=(Deno.env.get("SWIFTHAUL_SIGNUP_NOTIFY_EMAILS")||"centurionfleetweb@gmail.com,bongzthombeni@gmail.com").split(",").map(x=>x.trim()).filter(x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
 if(!adminSent&&recipients.length){const html="<div style='font-family:Arial,sans-serif;color:#20242a'><h2>New SwiftHaul Customer sign-up</h2><p>A new Customer account has completed its first verified sign-in.</p><p><strong>Name:</strong> "+name+"</p><p><strong>Email:</strong> "+esc(a.user.email)+"</p><p><strong>Registered:</strong> "+esc(a.user.created_at||"Not available")+"</p><p>Review the account in Company Admin.</p></div>";
  try{await send(key,from,recipients,"New SwiftHaul Customer sign-up",html,"customer-signup-admin-"+a.user.id);adminSent=true;}catch(e){console.error("Customer signup admin notification failed",String(e));}}
 const sentAt=new Date().toISOString();
 const {error:saveError}=await admin.from("customer_welcome_notifications").upsert({customer_user_id:a.user.id,welcome_email_sent_at:welcome?(row?.welcome_email_sent_at||sentAt):null,admin_email_sent_at:adminSent?(row?.admin_email_sent_at||sentAt):null,updated_at:sentAt});
 if(saveError)return reply(500,{error:"notification_tracking_failed"});
 return reply(200,{success:true,welcome_email_sent:welcome,admin_email_sent:adminSent});
});