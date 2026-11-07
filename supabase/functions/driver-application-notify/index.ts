import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods":"POST, OPTIONS", "Content-Type":"application/json" };
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers:cors});
const clean=(v:unknown,n=200)=>typeof v==="string"?v.trim().slice(0,n):"";
const escapeHtml=(v:unknown)=>String(v??"").replace(/[&<>"]/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]||ch));
async function sendEmail(key:string,from:string,to:string[],subject:string,html:string){
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from,to,subject,html})});
 if(!r.ok)throw new Error("email_provider_"+r.status);
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:a,error:ae}=await auth.auth.getUser(token);if(ae||!a.user)return reply(401,{error:"invalid_or_expired_session"});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:p}=await admin.from("user_profiles").select("role,account_status,full_name,phone").eq("id",a.user.id).maybeSingle();
 if(!p||p.role!=="driver"||p.account_status!=="active")return reply(403,{error:"active_driver_account_required"});
 const {data:d}=await admin.from("driver_profiles").select("phone,license_number,license_expiry,vehicle_type,vehicle_registration,verification_status").eq("user_id",a.user.id).maybeSingle();
 if(!d)return reply(404,{error:"driver_application_not_found"});
 const {data:docs}=await admin.from("driver_documents").select("document_type,review_status").eq("driver_user_id",a.user.id);
 const docSummary=(docs||[]).map(x=>x.document_type+":"+x.review_status).join(", ")||"No documents uploaded yet";
 const {data:row}=await admin.from("driver_application_notifications").select("*").eq("driver_user_id",a.user.id).maybeSingle();
 const now=new Date().toISOString();let welcome=!!row?.welcome_email_sent_at,adminEmail=!!row?.admin_email_sent_at,wa=!!row?.admin_whatsapp_sent_at;
 const key=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("DRIVER_EMAIL_FROM")||"SwiftHaul SA <onboarding@resend.dev>",email=a.user.email||"";
 const appUrl=Deno.env.get("DRIVER_APP_URL")||"https://bongat061-swifthaul-sa.github.io/swifthaul-sa-preview/apps/driver/public/";
 const name=clean(p.full_name||a.user.user_metadata?.full_name,120);
 const details=[["Name",name],["Email",email],["Phone",clean(d.phone,30)],["Licence",clean(d.license_number,80)],["Licence expiry",clean(d.license_expiry,20)],["Vehicle",clean(d.vehicle_type,30)],["Registration",clean(d.vehicle_registration,30)],["Documents",docSummary]];
 const welcomeHtml="<div style='font-family:Arial,sans-serif;color:#173d31'><h2>Welcome to SwiftHaul SA</h2><p>Your driver account is registered. Your application is awaiting administrator approval. You can sign in now, upload your documents and check your application status.</p><p><a href='"+escapeHtml(appUrl)+"'>Open SwiftHaul Driver</a></p><p>For security, SwiftHaul never emails passwords. Sign in with the email address and password you created.</p></div>";
 if(key&&email&&!welcome){try{await sendEmail(key,from,[email],"Welcome to SwiftHaul SA — application received",welcomeHtml);welcome=true;}catch(e){console.error("Driver welcome email failed",String(e));}}
 const adminTo=Deno.env.get("DRIVER_APPLICATION_NOTIFY_EMAIL")||"centurionfleetweb@gmail.com";
 const adminHtml="<div style='font-family:Arial,sans-serif;color:#173d31'><h2>New driver application</h2>"+details.map(x=>"<p><strong>"+escapeHtml(x[0])+":</strong> "+escapeHtml(x[1])+"</p>").join("")+"<p><a href='"+appUrl+"'>Open Driver platform</a></p></div>";
 if(key&&adminTo&&!adminEmail){try{await sendEmail(key,from,[adminTo],"New SwiftHaul driver application",adminHtml);adminEmail=true;}catch(e){console.error("Driver admin email failed",String(e));}}
 const waToken=Deno.env.get("WHATSAPP_ACCESS_TOKEN"),phoneId=Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"),recipient=Deno.env.get("WHATSAPP_ADMIN_RECIPIENT")||"27615083880";
 if(waToken&&phoneId&&recipient&&!wa){const message="New SwiftHaul driver application\n"+name+"\n"+email+"\n"+clean(d.phone,30)+"\nVehicle: "+clean(d.vehicle_type,30)+" "+clean(d.vehicle_registration,30)+"\nDocuments: "+docSummary+"\nReview in Company Admin.";
  try{const r=await fetch("https://graph.facebook.com/v22.0/"+phoneId+"/messages",{method:"POST",headers:{"Authorization":"Bearer "+waToken,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:recipient,type:"text",text:{body:message}})});if(!r.ok)throw new Error("whatsapp_provider_"+r.status);wa=true;}catch(e){console.error("Driver WhatsApp alert failed",String(e));}}
 await admin.from("driver_application_notifications").upsert({driver_user_id:a.user.id,welcome_email_sent_at:welcome?(row?.welcome_email_sent_at||now):null,admin_email_sent_at:adminEmail?(row?.admin_email_sent_at||now):null,admin_whatsapp_sent_at:wa?(row?.admin_whatsapp_sent_at||now):null,last_attempt_at:now,updated_at:now});
 return reply(200,{success:true,welcome_email_sent:welcome,admin_email_sent:adminEmail,admin_whatsapp_sent:wa});
});
