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
 const fromB64=(v:string)=>Uint8Array.from(atob(v),x=>x.charCodeAt(0));
 const decryptGcm=async(cipher:string|null)=>{if(!cipher)return null;const parts=cipher.split(":");if(parts.length!==3||parts[0]!=="v1")throw new Error("driver_gcm_ciphertext_invalid");const {data:keyText,error:keyError}=await admin.rpc("get_driver_pii_aes256_gcm_key");if(keyError||typeof keyText!=="string")throw new Error("driver_gcm_key_unavailable");const key=await crypto.subtle.importKey("raw",fromB64(keyText),{name:"AES-GCM"},false,["decrypt"]);const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(parts[1]),tagLength:128},key,fromB64(parts[2]));return new TextDecoder().decode(plain);};
 const decrypt=async(cipher:string|null,fallback:unknown)=>{
  if(!cipher)return fallback??{};
  const {data,error}=await admin.rpc("decrypt_driver_pii",{p_ciphertext:cipher});
  if(error||typeof data!=="string")throw new Error("driver_pii_decryption_failed");
  try{return JSON.parse(data);}catch{return {};}
 };
 if(req.method==="GET"){
  const {data:drivers,error}=await admin.from("driver_profiles")
   .select("user_id,phone,license_number,license_expiry,vehicle_type,vehicle_registration,verification_status,availability_status,created_at,onboarding_status,can_go_online,identity_type,licence_code,prdp_holder,prdp_category,prdp_expiry,vehicle_make,vehicle_model,vehicle_year,vehicle_gvm_kg,bank_name,bank_account_holder,universal_branch_code,sa_id_number_aesgcm,passport_number_aesgcm,account_number_aesgcm,criminal_background_clearance,criminal_background_reviewed_at,user_profiles!inner(full_name)")
   .order("created_at",{ascending:false}).limit(200);
  if(error)return reply(500,{error:"driver_list_failed"});
  const ids=(drivers??[]).map((d:any)=>d.user_id);
  const {data:docs,error:docsError}=ids.length?await admin.from("driver_documents")
   .select("id,driver_user_id,document_type,original_name,review_status,verification_status,expiry_date,issued_at,rejection_reason,review_note,reviewed_by,reviewed_at,created_at,storage_path,content_type")
   .in("driver_user_id",ids).order("created_at",{ascending:false}):{data:[],error:null};
  if(docsError)return reply(500,{error:"driver_documents_lookup_failed"});
  const grouped:Record<string,unknown[]>={};
  for(const doc of docs??[]){
   const {data:signed,error:signedError}=await admin.storage.from("driver-application-documents").createSignedUrl(doc.storage_path,600);
   if(signedError||!signed?.signedUrl)return reply(500,{error:"driver_document_link_failed"});
   const {error:accessLogError}=await admin.from("document_access_logs").insert({admin_id:authResult.user.id,driver_id:doc.driver_user_id,document_id:doc.id,document_type:doc.document_type,access_action:"admin_dashboard_signed_read_url"});
   if(accessLogError)return reply(500,{error:"document_access_audit_failed"});
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
   const profile=(drivers??[]).find((d:any)=>d.user_id===app.driver_user_id);
   if(profile){const id=await decryptGcm(profile.sa_id_number_aesgcm),passport=await decryptGcm(profile.passport_number_aesgcm),account=await decryptGcm(profile.account_number_aesgcm);if(id)identity.id_number=id;if(passport)identity.passport_number=passport;if(account)banking.account_number=account;}
   appMap.set(app.driver_user_id,{driver_user_id:app.driver_user_id,identity_type:app.identity_type,identity_details:identity,
    licence_details:app.licence_details,vehicle_details:app.vehicle_details,banking_details:banking,
    verification_status:app.verification_status,submitted_at:app.submitted_at,review_note:app.review_note});
  }
  return reply(200,{drivers:(drivers??[]).map((d:any)=>{const {sa_id_number_aesgcm,passport_number_aesgcm,account_number_aesgcm,...safe}=d;return {...safe,documents:grouped[d.user_id]??[],application:appMap.get(d.user_id)??null};})});
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
  const {data:doc,error:lookupError}=await admin.from("driver_documents").select("id,driver_user_id,document_type,expiry_date,issued_at").eq("id",body.document_id).maybeSingle();
  if(lookupError)return reply(500,{error:"document_lookup_failed"});
  if(!doc||doc.driver_user_id!==body.user_id)return reply(404,{error:"driver_document_not_found"});
  if(state==="approved"){
   const expiryRequired=["licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","passport","work_permit","enatis_certificate","fleet_lease_agreement","prdp"].includes(doc.document_type);
   if(expiryRequired&&(!doc.expiry_date||doc.expiry_date<today()))return reply(409,{error:"current_document_expiry_required"});
   if(doc.document_type==="proof_of_address"&&(!doc.issued_at||doc.issued_at<new Date(Date.now()-92*86400000).toISOString().slice(0,10)||doc.issued_at>today()))return reply(409,{error:"proof_of_residence_must_be_under_three_months_old"});
  }
  const {data:updated,error}=await admin.from("driver_documents").update({
   verification_status:state,review_status:state==="approved"?"accepted":"rejected",rejection_reason:state==="rejected"?reason:null,
   review_note:state==="rejected"?reason:null,reviewed_by:actorId,reviewed_at:new Date().toISOString()
  }).eq("id",doc.id).select("id,driver_user_id,document_type,verification_status,expiry_date,rejection_reason,reviewed_at").maybeSingle();
  if(error||!updated)return reply(500,{error:"document_review_update_failed"});
  await admin.from("driver_verification_audit").insert({driver_user_id:doc.driver_user_id,document_id:doc.id,actor_user_id:actorId,event_type:state==="approved"?"document_approved":"document_rejected",details:{document_type:doc.document_type,rejection_reason:reason||null}});
  if(state==="rejected")await admin.from("driver_onboarding_notifications").insert({driver_user_id:doc.driver_user_id,document_id:doc.id,notification_type:"document_rejected_"+new Date().toISOString(),title:"Document needs attention",message:"Your "+doc.document_type.replaceAll("_"," ")+" was rejected: "+reason+". Please upload a replacement document."});
  if(state==="rejected"){
   const {data:driverContact}=await admin.from("driver_profiles").select("phone").eq("user_id",doc.driver_user_id).maybeSingle();
   if(driverContact?.phone)await sendNotification({event_type:"document_rejected",recipient_type:"driver",recipient_phone:driverContact.phone,payload_json:{document_name:doc.document_type.replaceAll("_"," "),rejection_reason:reason}});
  }
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
  const {data:profile,error:profileError}=await admin.from("driver_profiles").select("user_id,identity_type,prdp_holder,criminal_background_clearance,license_expiry,bank_details_encrypted,account_number_aesgcm,sa_id_number_aesgcm,passport_number_aesgcm,paystack_recipient_code").eq("user_id",driverId).maybeSingle();
  if(profileError)return reply(500,{error:"driver_profile_lookup_failed"});
  if(!profile)return reply(404,{error:"driver_not_found"});
  if(!profile.criminal_background_clearance)return reply(409,{error:"criminal_background_clearance_required"});
  if(!profile.license_expiry||profile.license_expiry<today())return reply(409,{error:"valid_driver_licence_required"});
  const required=profile.identity_type==="sa_citizen"?["id_front","id_back","profile_selfie","licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","proof_of_address"]:["passport","work_permit","licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","proof_of_address"];
  const {data:documents,error:docError}=await admin.from("driver_documents").select("document_type,verification_status,expiry_date").eq("driver_user_id",driverId);
  if(docError)return reply(500,{error:"driver_documents_lookup_failed"});
  const valid=(d:any)=>{const expiryRequired=["licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","passport","work_permit","enatis_certificate","fleet_lease_agreement","prdp"].includes(d.document_type);return d.verification_status==="approved"&&(!expiryRequired||(!!d.expiry_date&&d.expiry_date>=today()))&&(!d.expiry_date||d.expiry_date>=today())&&(d.document_type!=="proof_of_address"||!!d.issued_at&&d.issued_at>=new Date(Date.now()-92*86400000).toISOString().slice(0,10)&&d.issued_at<=today());};
  const missing=required.filter(t=>!(documents??[]).some((d:any)=>d.document_type===t&&valid(d)));
  if(!(documents??[]).some((d:any)=>["enatis_certificate","fleet_lease_agreement","vehicle_document"].includes(d.document_type)&&valid(d)))missing.push("eNaTIS certificate or fleet lease agreement");
  if(profile.prdp_holder&&!(documents??[]).some((d:any)=>d.document_type==="prdp"&&valid(d)))missing.push("PrDP");
  if(missing.length)return reply(409,{error:"required_documents_not_approved",missing_documents:missing});
  const {error:updateError}=await admin.from("driver_profiles").update({onboarding_status:"approved",verification_status:"approved",is_online:false,availability_status:"offline"}).eq("user_id",driverId);
  if(updateError)return reply(500,{error:"driver_activation_failed"});
  await admin.from("driver_onboarding_applications").update({verification_status:"approved",reviewed_by:actorId,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("driver_user_id",driverId);
  const {data:eligible,error:eligibilityError}=await admin.rpc("driver_can_accept_work",{p_driver_user_id:driverId});
  if(eligibilityError||eligible!==true){await admin.from("driver_profiles").update({onboarding_status:"pending_review",verification_status:"pending",can_go_online:false}).eq("user_id",driverId);return reply(409,{error:"driver_activation_checks_failed"});}
  let payoutSetup="pending_paystack_credentials";
  const paystackSecret=Deno.env.get("PAYSTACK_SECRET_KEY");
  if(profile.paystack_recipient_code)payoutSetup="ready";
  else if(paystackSecret){
   try{
    const banking=await decrypt(profile.bank_details_encrypted,null);
    const account=await decryptGcm(profile.account_number_aesgcm);
    const bankName=String(banking.bank_name||banking.bank||"").trim();
    const holder=String(banking.account_holder||banking.account_holder_name||"").trim();
    if(bankName&&holder&&account){
     let bankCode:string|null=null;
     for(let page=1;page<=5&&!bankCode;page++){
      const br=await fetch("https://api.paystack.co/bank?currency=ZAR&perPage=100&page="+page,{headers:{Authorization:"Bearer "+paystackSecret},signal:AbortSignal.timeout(10000)});
      const bd=await br.json().catch(()=>null);if(!br.ok||bd?.status!==true)break;
      const normalizedBank=bankName.toLowerCase().replace(/[^a-z]/g,"");
      const aliases:Record<string,string[]>={"fnb":["fnb","firstnationalbank"],"nedbank":["nedbank"],"standardbank":["standardbank"],"absa":["absa"],"capitec":["capitec"],"tymebank":["tymebank"]};
      const bankAliases=aliases[normalizedBank]||[normalizedBank];
      const match=(bd.data||[]).find((item:any)=>{const n=String(item.name||"").toLowerCase().replace(/[^a-z]/g,"");return item.active!==false&&bankAliases.some(a=>n===a||n.startsWith(a)||a.startsWith(n));});
      if(match)bankCode=String(match.code);
      if(!(bd.data||[]).length)break;
     }
     if(bankCode){
      let bankValidation="not_supported";
      const idNumber=profile.identity_type==="sa_citizen"?await decryptGcm(profile.sa_id_number_aesgcm):await decryptGcm(profile.passport_number_aesgcm);
      const documentType=profile.identity_type==="sa_citizen"?"identityNumber":"passportNumber";
      if(idNumber){
       const vr=await fetch("https://api.paystack.co/bank?currency=ZAR&enabled_for_verification=true&perPage=100&page=1",{headers:{Authorization:"Bearer "+paystackSecret},signal:AbortSignal.timeout(10000)});
       const vd=await vr.json().catch(()=>null);
       const supported=(vd?.data||[]).find((item:any)=>String(item.code)===bankCode&&(item.supported_types||[]).includes("personal"));
       if(supported){
        const validation=await fetch("https://api.paystack.co/bank/validate",{method:"POST",headers:{Authorization:"Bearer "+paystackSecret,"Content-Type":"application/json"},body:JSON.stringify({bank_code:bankCode,country_code:"ZA",account_number:account,account_name:holder,account_type:"personal",document_type:documentType,document_number:idNumber}),signal:AbortSignal.timeout(15000)});
        const check=await validation.json().catch(()=>null);
        if(!validation.ok||check?.status!==true||check?.data?.verified!==true||check?.data?.accountAcceptsCredits===false||check?.data?.accountOpen===false||check?.data?.accountHolderMatch===false){payoutSetup="bank_account_validation_failed";bankCode=null;}
        else bankValidation="verified";
       }
      }
      if(bankCode){
       const rr=await fetch("https://api.paystack.co/transferrecipient",{method:"POST",headers:{Authorization:"Bearer "+paystackSecret,"Content-Type":"application/json"},body:JSON.stringify({type:"basa",name:holder,account_number:account,bank_code:bankCode,currency:"ZAR",description:"SwiftHaul verified driver payout"}),signal:AbortSignal.timeout(12000)});
       const rd=await rr.json().catch(()=>null);
       if(rr.ok&&rd?.status===true&&rd?.data?.recipient_code){
        const {error:saveRecipientError}=await admin.from("driver_profiles").update({paystack_recipient_code:rd.data.recipient_code,paystack_recipient_created_at:new Date().toISOString()}).eq("user_id",driverId);
        payoutSetup=saveRecipientError?"recipient_save_failed":bankValidation==="verified"?"ready":"recipient_ready_manual_bank_check";
       }else payoutSetup="recipient_creation_failed";
      }
     }else payoutSetup="paystack_bank_code_not_found";
    }else payoutSetup="verified_bank_details_missing";
   }catch(e){console.error("Paystack recipient setup failed",e instanceof Error?e.message:"unknown");payoutSetup="recipient_creation_failed";}
  }
  await admin.from("driver_verification_audit").insert({driver_user_id:driverId,actor_user_id:actorId,event_type:"driver_activated",details:{}});
  await admin.from("driver_onboarding_notifications").insert({driver_user_id:driverId,notification_type:"driver_activated",title:"Driver account activated",message:"Your driver documents and background clearance have been approved. You can now go online."});
  return reply(200,{activated:true,can_go_online:true,payout_setup:payoutSetup});
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
