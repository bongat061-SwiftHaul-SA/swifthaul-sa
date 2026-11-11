import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, POST, PUT, DELETE, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
const valid=(v:unknown,max:number)=>typeof v==="string"&&v.length<=max;
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(!["GET","POST","PUT","DELETE"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),{data:a,error:ae}=await auth.auth.getUser(token);
 if(ae||!a.user)return reply(401,{error:"invalid_or_expired_session"});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}}),owner=a.user.id;
 const {data:p,error:pe}=await admin.from("user_profiles").select("role,account_status,full_name,phone").eq("id",owner).maybeSingle();
 if(pe)return reply(500,{error:"profile_lookup_failed"});
 if(!p||p.role!=="driver"||p.account_status!=="active")return reply(403,{error:"active_driver_account_required"});
 if(req.method==="GET"){
  const {data:d,error}=await admin.from("driver_profiles").select("phone,license_expiry,vehicle_type,vehicle_registration,emergency_contact_name,emergency_contact_phone").eq("user_id",owner).maybeSingle();
  if(error)return reply(500,{error:"driver_profile_lookup_failed"});
  const {data:photo}=await admin.storage.from("driver-profile-photos").createSignedUrl(owner+".jpg",300);
  return reply(200,{profile:{full_name:p.full_name||"",phone:d?.phone||p.phone||"",license_expiry:d?.license_expiry||"",vehicle_type:d?.vehicle_type||"",vehicle_registration:d?.vehicle_registration||"",emergency_contact_name:d?.emergency_contact_name||"",emergency_contact_phone:d?.emergency_contact_phone||""},photo_url:photo?.signedUrl||null});
 }
 if(req.method==="POST"){
  const form=await req.formData(),file=form.get("photo");
  if(!(file instanceof File)||!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size<1||file.size>2*1024*1024)return reply(400,{error:"upload_a_jpeg_png_or_webp_up_to_2mb"});
  const path=owner+".jpg",bytes=new Uint8Array(await file.arrayBuffer());
  const {error}=await admin.storage.from("driver-profile-photos").upload(path,bytes,{contentType:file.type,upsert:true});
  if(error)return reply(500,{error:"photo_upload_failed"});
  const {data}=await admin.storage.from("driver-profile-photos").createSignedUrl(path,300);
  return reply(200,{saved:true,photo_url:data?.signedUrl||null});
 }
 if(req.method==="DELETE"){
  const raw=await req.text();let b:Record<string,unknown>;try{b=raw?JSON.parse(raw):{}}catch{return reply(400,{error:"invalid_json"})}
  if(b.confirmation!=="DELETE")return reply(400,{error:"type_DELETE_to_confirm"});
  const {data:existing,error}=await admin.from("account_deletion_requests").select("id,status").eq("user_id",owner).eq("app_type","driver").in("status",["pending","reviewing"]).maybeSingle();
  if(error)return reply(500,{error:"deletion_request_lookup_failed"});
  if(existing)return reply(200,{requested:true,status:existing.status});
  const {error:insertError}=await admin.from("account_deletion_requests").insert({user_id:owner,app_type:"driver",reason:typeof b.reason==="string"?b.reason.slice(0,500):null});
  if(insertError)return reply(500,{error:"deletion_request_failed"});
  return reply(202,{requested:true,status:"pending",message:"Your request is queued for review. Your account remains active until deliveries, payouts and records are reconciled."});
 }
 const raw=await req.text();if(raw.length>8000)return reply(413,{error:"request_too_large"});
 let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return reply(400,{error:"invalid_json"})}
 const name=b.full_name??"",phone=b.phone??"",vehicle=b.vehicle_type??"",registration=b.vehicle_registration??"",expiry=b.license_expiry??"",emergencyName=b.emergency_contact_name??"",emergencyPhone=b.emergency_contact_phone??"";
 if(!valid(name,120)||!valid(phone,40)||!valid(registration,30)||!valid(emergencyName,120)||!valid(emergencyPhone,40)||!["","bike","bakkie","van","truck"].includes(String(vehicle))||!valid(expiry,10)||expiry&&!/^\d{4}-\d{2}-\d{2}$/.test(String(expiry)))return reply(400,{error:"check_profile_fields"});
 const {error:updateError}=await admin.from("driver_profiles").update({phone:String(phone).trim(),vehicle_type:vehicle||null,vehicle_registration:String(registration).trim().toUpperCase()||null,license_expiry:expiry||null,emergency_contact_name:String(emergencyName).trim()||null,emergency_contact_phone:String(emergencyPhone).trim()||null,updated_at:new Date().toISOString()}).eq("user_id",owner);
 if(updateError)return reply(500,{error:"driver_profile_save_failed"});
 const {error:userError}=await admin.from("user_profiles").update({full_name:String(name).trim(),phone:String(phone).trim(),updated_at:new Date().toISOString()}).eq("id",owner);
 if(userError)return reply(500,{error:"account_profile_sync_failed"});
 return reply(200,{saved:true});
});
