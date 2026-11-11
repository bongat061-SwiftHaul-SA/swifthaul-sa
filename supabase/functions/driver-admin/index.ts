import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:cors});
const today=()=>new Date().toISOString().slice(0,10);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(!["GET","POST"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:authResult,error:authError}=await auth.auth.getUser(token);
 if(authError||!authResult.user)return reply(401,{error:"invalid_or_expired_session"});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:actor,error:actorError}=await admin.from("user_profiles").select("role,account_status").eq("id",authResult.user.id).maybeSingle();
 if(actorError)return reply(500,{error:"profile_lookup_failed"});
 if(!actor||actor.role!=="admin"||actor.account_status!=="active")return reply(403,{error:"administrator_access_required"});
 const decrypt=async(cipher:string|null,fallback:unknown)=>{
  if(!cipher)return fallback??{};
  const {data,error}=await admin.rpc("decrypt_driver_pii",{p_ciphertext:cipher});
  if(error||typeof data!=="string")throw new Error("driver_pii_decryption_failed");
  try{return JSON.parse(data);}catch{return {};}
 };
 if(req.method==="GET"){
  const {data:drivers,error}=await admin.from("driver_profiles")
   .select("user_id,phone,license_number,license_expiry,vehicle_type,vehicle_registration,verification_status,availability_status,created_at,onboarding_status,can_go_online,identity_type,licence_code,prdp_holder,prdp_category,prdp_expiry,vehicle_make,vehicle_model,vehicle_year,vehicle_gvm_kg,bank_name,bank_account_holder,universal_branch_code,criminal_background_clearance,criminal_background_reviewed_at,user_profiles!inner(full_name)")
   .order("created_at",{ascending:false}).limit(200);
  if(error)return reply(500,{error:"driver_list_failed"});
  const ids=(drivers??[]).map((d:any)=>d.user_id);
  const {data:docs,error:docsError}=ids.length?await admin.from("driver_documents")
   .select("id,driver_user_id,document_type,original_name,review_status,verification_status,expiry_date,issued_at,rejection_reason,review_note,reviewed_by,reviewed_at,created_at,storage_path")
   .in("driver_user_id",ids).order("created_at",{ascending:false}):{data:[],error:null};
  if(docsError)return reply(500,{error:"driver_documents_lookup_failed"});
  const grouped:Record<string,unknown[]>={};
  for(const doc of docs??[]){
   const {data:signed,error:signedError}=await admin.storage.from("driver-application-documents").createSignedUrl(doc.storage_path,300);
   if(signedError||!signed?.signedUrl)return reply(500,{error:"driver_document_link_failed"});
   (grouped[doc.driver_user_id]??=[]).push({id:doc.id,document_type:doc.document_type,original_name:doc.original_name,
    review_status:doc.review_status,verification_status:doc.verification_status,expiry_date:doc.expiry_date,issued_at:doc.issued_at,
    rejection_reason:doc.rejection_reason,review_note:doc.review_note,reviewed_by:doc.reviewed_by,reviewed_at:doc.reviewed_at,
    created_at:doc.created_at,signed_url:signed.signedUrl,content_type:doc.content_type});
  }
  const {data:apps,error:appError}=ids.length?await admin.from("driver_onboarding_applications")
   .select("driver_user_id,identity_type,identity_details,identity_details_encrypted,licence_details,vehicle_details,banking_details,banking_details_encrypted,verification_status,submitted_at,review_note")
   .in("driver_user_id",ids):{data:[],error:null};
  if(appError)return reply(500,{error:"driver_application_details_lookup_failed"});
  const appMap=new Map<string,any>();
  for(const app of apps??[]){
   const identity=await decrypt(app.identity_details_encrypted,app.identity_details);
   const banking=await decrypt(app.banking_details_encrypted,app.banking_details);
   appMap.set(app.driver_user_id,{driver_user_id:app.driver_user_id,identity_type:app.identity_type,identity_details:identity,
    licence_details:app.licence_details,vehicle_details:app.vehicle_details,banking_details:banking,
    verification_status:app.verification_status,submitted_at:app.submitted_at,review_note:app.review_note});
  }
  return reply(200,{drivers:(drivers??[]).map((d:any)=>({...d,documents:grouped[d.user_id]??[],application:appMap.get(d.user_id)??null}))});
 }
 const raw=await req.text();if(raw.length>8192)return reply(413,{error:"request_too_large"});
 let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return reply(400,{error:"invalid_json"});}
 const actorId=authResult.user.id;
 if(body.action==="review_document"){
  if(typeof body.document_id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.document_id)||typeof body.user_id!=="string")return reply(400,{error:"invalid_document_review_request"});
  const state=String(body.review_status);
  if(!["approved","rejected"].includes(state))return reply(400,{error:"invalid_document_verification_status"});
  const reason=typeof body.rejection_reason==="string"?body.rejection_reason.trim().slice(0,500):"";
  if(state==="rejected"&&reason.length<3)return reply(400,{error:"rejection_reason_required"});
  const {data:doc,error:lookupError}=await admin.from("driver_documents").select("id,driver_user_id,document_type").eq("id",body.document_id).maybeSingle();
  if(lookupError)return reply(500,{error:"document_lookup_failed"});
  if(!doc||doc.driver_user_id!==body.user_id)return reply(404,{error:"driver_document_not_found"});
  const {data:updated,error}=await admin.from("driver_documents").update({
   verification_status:state,review_status:state==="approved"?"accepted":"rejected",rejection_reason:state==="rejected"?reason:null,
   review_note:state==="rejected"?reason:null,reviewed_by:actorId,reviewed_at:new Date().toISOString()
  }).eq("id",doc.id).select("id,driver_user_id,document_type,verification_status,expiry_date,rejection_reason,reviewed_at").maybeSingle();
  if(error||!updated)return reply(500,{error:"document_review_update_failed"});
  await admin.from("driver_verification_audit").insert({driver_user_id:doc.driver_user_id,document_id:doc.id,actor_user_id:actorId,event_type:state==="approved"?"document_approved":"document_rejected",details:{document_type:doc.document_type,rejection_reason:reason||null}});
  if(state==="rejected")await admin.from("driver_onboarding_notifications").insert({driver_user_id:doc.driver_user_id,document_id:doc.id,notification_type:"document_rejected_"+new Date().toISOString(),title:"Document needs attention",message:"Your "+doc.document_type.replaceAll("_"," ")+" was rejected: "+reason+". Please upload a replacement document."});
  return reply(200,{document:updated});
 }
 if(typeof body.user_id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.user_id))return reply(400,{error:"invalid_driver_id"});
 const driverId=body.user_id;
 if(body.action==="set_background_clearance"){
  if(typeof body.cleared!=="boolean")return reply(400,{error:"background_clearance_boolean_required"});
  const {data,error}=await admin.from("driver_profiles").update({criminal_background_clearance:body.cleared,criminal_background_reviewed_by:actorId,criminal_background_reviewed_at:new Date().toISOString()}).eq("user_id",driverId).select("user_id,criminal_background_clearance").maybeSingle();
  if(error||!data)return reply(500,{error:"background_clearance_update_failed"});
  await admin.from("driver_verification_audit").insert({driver_user_id:driverId,actor_user_id:actorId,event_type:body.cleared?"background_clearance_confirmed":"background_clearance_revoked",details:{}});
  const {data:eligible}=await admin.rpc("driver_can_accept_work",{p_driver_user_id:driverId});
  return reply(200,{criminal_background_clearance:data.criminal_background_clearance,can_go_online:eligible===true});
 }
 if(body.action==="activate"){
  const {data:profile,error:profileError}=await admin.from("driver_profiles").select("user_id,identity_type,prdp_holder,criminal_background_clearance,license_expiry").eq("user_id",driverId).maybeSingle();
  if(profileError)return reply(500,{error:"driver_profile_lookup_failed"});
  if(!profile)return reply(404,{error:"driver_not_found"});
  if(!profile.criminal_background_clearance)return reply(409,{error:"criminal_background_clearance_required"});
  if(!profile.license_expiry||profile.license_expiry<today())return reply(409,{error:"valid_driver_licence_required"});
  const required=profile.identity_type==="sa_citizen"?["id_front","id_back","profile_selfie","licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","proof_of_address"]:["passport","work_permit","licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","proof_of_address"];
  const {data:documents,error:docError}=await admin.from("driver_documents").select("document_type,verification_status,expiry_date").eq("driver_user_id",driverId);
  if(docError)return reply(500,{error:"driver_documents_lookup_failed"});
  const valid=(d:any)=>d.verification_status==="approved"&&(!d.expiry_date||d.expiry_date>=today());
  const missing=required.filter(t=>!(documents??[]).some((d:any)=>d.document_type===t&&valid(d)));
  if(!(documents??[]).some((d:any)=>["enatis_certificate","fleet_lease_agreement","vehicle_document"].includes(d.document_type)&&valid(d)))missing.push("eNaTIS certificate or fleet lease agreement");
  if(profile.prdp_holder&&!(documents??[]).some((d:any)=>d.document_type==="prdp"&&valid(d)))missing.push("PrDP");
  if(missing.length)return reply(409,{error:"required_documents_not_approved",missing_documents:missing});
  const {error:updateError}=await admin.from("driver_profiles").update({onboarding_status:"approved",verification_status:"approved",is_online:false,availability_status:"offline"}).eq("user_id",driverId);
  if(updateError)return reply(500,{error:"driver_activation_failed"});
  await admin.from("driver_onboarding_applications").update({verification_status:"approved",reviewed_by:actorId,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("driver_user_id",driverId);
  const {data:eligible,error:eligibilityError}=await admin.rpc("driver_can_accept_work",{p_driver_user_id:driverId});
  if(eligibilityError||eligible!==true){await admin.from("driver_profiles").update({onboarding_status:"pending_review",verification_status:"pending",can_go_online:false}).eq("user_id",driverId);return reply(409,{error:"driver_activation_checks_failed"});}
  await admin.from("driver_verification_audit").insert({driver_user_id:driverId,actor_user_id:actorId,event_type:"driver_activated",details:{}});
  await admin.from("driver_onboarding_notifications").insert({driver_user_id:driverId,notification_type:"driver_activated",title:"Driver account activated",message:"Your driver documents and background clearance have been approved. You can now go online."});
  return reply(200,{activated:true,can_go_online:true});
 }
 if(body.action==="reject"||body.action==="suspend"){
  const reason=typeof body.reason==="string"?body.reason.trim().slice(0,500):"";
  if(body.action==="reject"&&reason.length<3)return reply(400,{error:"application_rejection_reason_required"});
  const next=body.action==="suspend"?"suspended":"rejected";
  const {error}=await admin.from("driver_profiles").update({onboarding_status:body.action==="suspend"?"suspended":"incomplete",verification_status:next,can_go_online:false,is_online:false,availability_status:"offline"}).eq("user_id",driverId);
  if(error)return reply(500,{error:"driver_status_update_failed"});
  await admin.from("driver_onboarding_applications").update({verification_status:next,review_note:reason,reviewed_by:actorId,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("driver_user_id",driverId);
  await admin.from("driver_verification_audit").insert({driver_user_id:driverId,actor_user_id:actorId,event_type:"application_"+next,details:{reason}});
  await admin.from("driver_onboarding_notifications").insert({driver_user_id:driverId,notification_type:"application_"+next+"_"+new Date().toISOString(),title:next==="rejected"?"Application needs changes":"Driver account suspended",message:reason||"Please contact SwiftHaul support for details."});
  return reply(200,{updated:true,status:next});
 }
 return reply(400,{error:"unknown_admin_action"});
});
