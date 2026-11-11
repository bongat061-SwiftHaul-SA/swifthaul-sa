import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
const esc=(v:unknown)=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]||c));
function sessionId(token:string):string|null{try{const p=token.split(".")[1];if(!p)return null;const b=p.replace(/-/g,"+").replace(/_/g,"/");const j=JSON.parse(atob(b+"=".repeat((4-b.length%4)%4)));return typeof j.session_id==="string"?j.session_id:null;}catch{return null;}}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:a,error:ae}=await auth.auth.getUser(token);if(ae||!a.user?.email)return reply(401,{error:"invalid_or_expired_session"});
 const sid=sessionId(token);if(!sid)return reply(400,{error:"session_identifier_unavailable"});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:p,error:pe}=await admin.from("user_profiles").select("role,account_status,full_name").eq("id",a.user.id).maybeSingle();
 if(pe)return reply(500,{error:"account_profile_lookup_failed"});
 if(!p||p.account_status!=="active"||!["customer","driver","admin","dispatcher"].includes(p.role))return reply(403,{error:"active_account_required"});
 const {data:old,error:oe}=await admin.from("account_signin_notifications").select("email_sent_at").eq("user_id",a.user.id).eq("session_id",sid).maybeSingle();
 if(oe)return reply(500,{error:"notification_status_unavailable"});
 if(old?.email_sent_at)return reply(200,{success:true,email_sent:true,already_sent:true});
 const {error:ie}=await admin.from("account_signin_notifications").upsert({user_id:a.user.id,session_id:sid},{onConflict:"user_id,session_id",ignoreDuplicates:true});
 if(ie)return reply(500,{error:"notification_tracking_unavailable"});
 const key=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("AUTH_EMAIL_FROM")||Deno.env.get("CUSTOMER_EMAIL_FROM")||Deno.env.get("DRIVER_EMAIL_FROM")||"SwiftHaul SA <onboarding@resend.dev>";
 if(!key)return reply(200,{success:true,email_sent:false,reason:"email_provider_not_configured"});
 const role=p.role==="admin"||p.role==="dispatcher"?"Company Admin":p.role.charAt(0).toUpperCase()+p.role.slice(1);
 const when=new Date().toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg",dateStyle:"medium",timeStyle:"short"});
 const html="<div style='font-family:Arial,sans-serif;color:#20242a'><h2>New sign-in to SwiftHaul SA</h2><p>Hello "+esc(p.full_name||"there")+",</p><p>Your "+esc(role)+" account was just signed in successfully.</p><p><strong>Time:</strong> "+esc(when)+" (South Africa)</p><p>If this was you, no action is needed. If you do not recognise this activity, change your password and contact SwiftHaul support.</p><p>SwiftHaul will never email your password or PIN.</p></div>";
 try{const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":"swifthaul-signin-"+sid},body:JSON.stringify({from,to:[a.user.email],subject:"New sign-in to your SwiftHaul SA account",html})});if(!r.ok)throw new Error("email_provider_"+r.status);}
 catch(e){console.error("Sign-in email failed",String(e));return reply(200,{success:false,email_sent:false,reason:"email_delivery_failed"});}
 const sentAt=new Date().toISOString();
 const {error:se}=await admin.from("account_signin_notifications").update({email_sent_at:sentAt}).eq("user_id",a.user.id).eq("session_id",sid);
 if(se)return reply(200,{success:false,email_sent:true,tracking_saved:false});
 return reply(200,{success:true,email_sent:true});
});