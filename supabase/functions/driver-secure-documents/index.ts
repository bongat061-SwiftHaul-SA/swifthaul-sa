import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-upload-ticket","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers:cors});
const allowed=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const types=new Set(["id_front","id_back","profile_selfie","passport","work_permit","licence_front","licence_back","prdp","vehicle_licence_disc","enatis_certificate","fleet_lease_agreement","vehicle_insurance","proof_of_address"]);
const sha=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,"0")).join("");
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const ticket=req.headers.get("x-upload-ticket");
 if(ticket){
  if(ticket.length<40||ticket.length>200)return reply(401,{error:"invalid_upload_ticket"});
  const hash=await sha(ticket);
  const {data:t,error:te}=await db.from("driver_upload_tickets").select("*").eq("token_hash",hash).maybeSingle();
  if(te||!t||t.consumed_at||new Date(t.expires_at).getTime()<=Date.now())return reply(401,{error:"upload_ticket_expired_or_used"});
  const type=req.headers.get("content-type")||"";
  if(type!==t.content_type||!allowed.has(type))return reply(415,{error:"upload_content_type_mismatch"});
  const bytes=new Uint8Array(await req.arrayBuffer());
  if(bytes.length<1||bytes.length>10485760)return reply(413,{error:"document_file_size_invalid"});
  const {data:consumed,error:consumeError}=await db.from("driver_upload_tickets").update({consumed_at:new Date().toISOString()}).eq("id",t.id).is("consumed_at",null).gt("expires_at",new Date().toISOString()).select("id").maybeSingle();
  if(consumeError||!consumed)return reply(409,{error:"upload_ticket_already_consumed"});
  const {error:uploadError}=await db.storage.from("driver-application-documents").upload(t.object_path,bytes,{contentType:type,upsert:false});
  if(uploadError)return reply(500,{error:"secure_document_upload_failed"});
  const {data:doc,error:docError}=await db.from("driver_documents").insert({driver_user_id:t.driver_user_id,document_type:t.document_type,storage_path:t.object_path,file_url:t.object_path,original_name:t.original_name,content_type:type,file_size_bytes:bytes.length,expiry_date:t.expiry_date,issued_at:t.issued_at,verification_status:"pending",review_status:"pending"}).select("id").single();
  if(docError){await db.storage.from("driver-application-documents").remove([t.object_path]);return reply(500,{error:"document_record_create_failed"});}
  await db.from("driver_verification_audit").insert({driver_user_id:t.driver_user_id,document_id:doc.id,event_type:"secure_document_uploaded",details:{document_type:t.document_type}});
  await db.from("driver_profiles").update({onboarding_status:"pending_review",verification_status:"pending",can_go_online:false,is_online:false,availability_status:"offline"}).eq("user_id",t.driver_user_id);
  return reply(201,{uploaded:true,document_id:doc.id,verification_status:"pending"});
 }
 const bearer=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
 if(!bearer)return reply(401,{error:"missing_bearer_token"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:u,error:authError}=await auth.auth.getUser(bearer);
 if(authError||!u.user)return reply(401,{error:"invalid_or_expired_session"});
 const {data:actor,error:actorError}=await db.from("user_profiles").select("role,account_status").eq("id",u.user.id).maybeSingle();
 if(actorError||!actor||actor.account_status!=="active")return reply(403,{error:"active_account_required"});
 const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
 if(!body||typeof body.action!=="string")return reply(400,{error:"invalid_request"});
 if(body.action==="create_upload_ticket"){
  if(actor.role!=="driver")return reply(403,{error:"driver_account_required"});
  const docType=String(body.document_type||"");const contentType=String(body.content_type||"");const original=String(body.original_name||"document").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100);
  if(!types.has(docType)||!allowed.has(contentType))return reply(400,{error:"unsupported_document_type_or_content_type"});
  const expiry=typeof body.expiry_date==="string"?body.expiry_date:null,issued=typeof body.issued_at==="string"?body.issued_at:null;
  const expRequired=["licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","passport","work_permit","enatis_certificate","fleet_lease_agreement","prdp"].includes(docType);
  if(expRequired&&(!expiry||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(expiry)||expiry<=new Date().toISOString().slice(0,10)))return reply(400,{error:"future_expiry_date_required"});
  if(docType==="proof_of_address"&&(!issued||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(issued)||issued>new Date().toISOString().slice(0,10)||Date.now()-Date.parse(issued+"T00:00:00")>92*86400000))return reply(400,{error:"recent_proof_of_address_issue_date_required"});
  const raw=crypto.getRandomValues(new Uint8Array(32)),token=btoa(Array.from(raw).map(x=>String.fromCharCode(x)).join(""));
  const objectPath=u.user.id+"/onboarding/"+docType+"/"+crypto.randomUUID()+"-"+original;
  const expires=new Date(Date.now()+5*60*1000).toISOString();
  const {error}=await db.from("driver_upload_tickets").insert({token_hash:await sha(token),driver_user_id:u.user.id,document_type:docType,object_path:objectPath,content_type:contentType,original_name:original,expiry_date:expiry,issued_at:issued,expires_at:expires});
  if(error)return reply(500,{error:"upload_ticket_create_failed"});
  return reply(201,{upload_url:url+"/functions/v1/driver-secure-documents",upload_ticket:token,expires_at:expires,method:"POST",required_header:"x-upload-ticket"});
 }
 if(body.action==="create_read_url"){
  if(actor.role!=="admin")return reply(403,{error:"administrator_access_required"});
  if(typeof body.document_id!=="string")return reply(400,{error:"document_id_required"});
  const {data:doc,error}=await db.from("driver_documents").select("id,driver_user_id,document_type,storage_path").eq("id",body.document_id).maybeSingle();
  if(error||!doc)return reply(404,{error:"driver_document_not_found"});
  const {data:signed,error:signedError}=await db.storage.from("driver-application-documents").createSignedUrl(doc.storage_path,600);
  if(signedError||!signed?.signedUrl)return reply(500,{error:"document_preview_url_failed"});
  const {error:logError}=await db.from("document_access_logs").insert({admin_id:u.user.id,driver_id:doc.driver_user_id,document_id:doc.id,document_type:doc.document_type,access_action:"signed_read_url"});
  if(logError)return reply(500,{error:"document_access_audit_failed"});
  return reply(200,{signed_url:signed.signedUrl,expires_in_seconds:600});
 }
 return reply(400,{error:"unknown_action"});
});