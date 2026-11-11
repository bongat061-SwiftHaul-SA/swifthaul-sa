import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, GET, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
const allowed=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const docTypes=new Set(["id_front","id_back","profile_selfie","passport","work_permit","licence_front","licence_back","prdp","vehicle_licence_disc","enatis_certificate","fleet_lease_agreement","vehicle_insurance","proof_of_address"]);
const text=(v:FormDataEntryValue|null,max=200)=>typeof v==="string"?v.trim().slice(0,max):"";
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+"T00:00:00"));
const b64=(bytes:Uint8Array)=>btoa(Array.from(bytes).map(x=>String.fromCharCode(x)).join(""));
const fromB64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const piiKey=async(db:any)=>{const {data,error}=await db.rpc("get_driver_pii_aes256_gcm_key");if(error||typeof data!=="string")throw new Error("secure_pii_key_unavailable");return crypto.subtle.importKey("raw",fromB64(data),{name:"AES-GCM"},false,["encrypt","decrypt"]);};
const encryptGcm=async(db:any,value:string)=>{const key=await piiKey(db),iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv,tagLength:128},key,new TextEncoder().encode(value)));return "v1:"+b64(iv)+":"+b64(cipher);};
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const luhn=(v:string)=>{let sum=0,alt=false;for(let i=v.length-1;i>=0;i--){let n=Number(v[i]);if(alt){n*=2;if(n>9)n-=9;}sum+=n;alt=!alt;}return sum%10===0;};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(!["POST","GET"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:u,error:ae}=await auth.auth.getUser(token);if(ae||!u.user)return reply(401,{error:"invalid_or_expired_session"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:p,error:pe}=await db.from("user_profiles").select("role,account_status").eq("id",u.user.id).maybeSingle();
 if(pe||p?.role!=="driver"||p?.account_status!=="active")return reply(403,{error:"active_driver_account_required"});
 if(req.method==="GET"){
  const {data:application,error}=await db.from("driver_onboarding_applications").select("identity_type,verification_status,submitted_at,review_note").eq("driver_user_id",u.user.id).maybeSingle();
  if(error)return reply(500,{error:"application_status_unavailable"});
  const {data:allDocuments, error:documentsError}=await db.from("driver_documents").select("id,document_type,verification_status,expiry_date,issued_at,rejection_reason,reviewed_at,created_at").eq("driver_user_id",u.user.id).order("created_at",{ascending:false});
  if(documentsError)return reply(500,{error:"driver_document_status_unavailable"});
  const seenTypes=new Set<string>();const documents=(allDocuments||[]).filter((d:any)=>{if(seenTypes.has(d.document_type))return false;seenTypes.add(d.document_type);return ["rejected","expired"].includes(d.verification_status);});
  const {data:notifications,error:notificationError}=await db.from("driver_onboarding_notifications").select("id,title,message,notification_type,created_at,read_at").eq("driver_user_id",u.user.id).order("created_at",{ascending:false}).limit(20);
  if(notificationError)return reply(500,{error:"driver_notifications_unavailable"});
  return reply(200,{application:application||null,rejected_documents:documents,notifications:notifications||[]});
 }
 const form=await req.formData();
 const action=text(form.get("action"),50);
 if(action==="replace_document"){
  const type=text(form.get("document_type"),50),file=form.get("file"),expiry=text(form.get("expiry_date"),10),issued=text(form.get("issued_at"),10);
  if(!docTypes.has(type))return reply(400,{error:"unsupported_document_type"});
  if(!(file instanceof File)||file.size<1||file.size>10485760||!allowed.has(file.type))return reply(400,{error:"upload_a_valid_document_file"});
  const {data:rejected,error:rejectedError}=await db.from("driver_documents").select("id").eq("driver_user_id",u.user.id).eq("document_type",type).in("verification_status",["rejected","expired"]).limit(1);
  if(rejectedError)return reply(500,{error:"rejected_document_lookup_failed"});
  if(!rejected?.length)return reply(409,{error:"document_not_marked_for_reupload"});
  const expiring=["licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","prdp","passport","work_permit","enatis_certificate","fleet_lease_agreement"].includes(type);
  if(expiring&&(!validDate(expiry)||Date.parse(expiry+"T00:00:00")<=Date.now()))return reply(400,{error:"replacement_document_expiry_must_be_in_future"});
  if(type==="proof_of_address"&&(!validDate(issued)||Date.now()-Date.parse(issued+"T00:00:00")>92*86400000||Date.parse(issued+"T00:00:00")>Date.now()))return reply(400,{error:"proof_of_residence_must_be_under_three_months_old"});
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100)||"document",storagePath=u.user.id+"/onboarding/"+type+"/"+crypto.randomUUID()+"-"+safe;
  const {error:uploadError}=await db.storage.from("driver-application-documents").upload(storagePath,new Uint8Array(await file.arrayBuffer()),{contentType:file.type,upsert:false});
  if(uploadError)return reply(500,{error:"replacement_document_upload_failed"});
  const {data:created,error:createError}=await db.from("driver_documents").insert({driver_user_id:u.user.id,document_type:type,storage_path:storagePath,file_url:storagePath,original_name:safe,content_type:file.type,file_size_bytes:file.size,expiry_date:expiring?expiry||null:null,issued_at:type==="proof_of_address"?issued:null,verification_status:"pending",review_status:"pending"}).select("id").single();
  if(createError){await db.storage.from("driver-application-documents").remove([storagePath]);return reply(500,{error:"replacement_document_record_failed"});}
  await db.from("driver_profiles").update({onboarding_status:"pending_review",verification_status:"pending",can_go_online:false,is_online:false,availability_status:"offline"}).eq("user_id",u.user.id);
  await db.from("driver_onboarding_applications").update({verification_status:"pending",updated_at:new Date().toISOString()}).eq("driver_user_id",u.user.id);
  await db.from("driver_verification_audit").insert({driver_user_id:u.user.id,document_id:created.id,event_type:"replacement_document_submitted",details:{document_type:type}});
  await db.from("driver_onboarding_notifications").insert({driver_user_id:u.user.id,document_id:created.id,notification_type:"replacement_submitted",title:"Replacement document received",message:"Your replacement "+type.replaceAll("_"," ")+" has been submitted for review."});
  return reply(201,{submitted:true,document_id:created.id,status:"pending"});
 }
 const identityType=text(form.get("identity_type"),30),fullName=text(form.get("full_name"),120),phone=text(form.get("phone"),20),email=text(form.get("email"),254);
 const licenceCode=text(form.get("licence_code"),5),licenceExpiry=text(form.get("licence_expiry"),10),vehicleType=text(form.get("vehicle_type"),30);
 const plate=text(form.get("registration_plate"),20),year=Number(text(form.get("vehicle_year"),4));
 const idNumber=text(form.get("id_number"),13),dob=text(form.get("date_of_birth"),10),passport=text(form.get("passport_number"),30),trn=text(form.get("traffic_register_number"),30);
 const prdp=["on","true"].includes(text(form.get("prdp_holder"),5)),gvm=Number(text(form.get("vehicle_gvm_kg"),8)),prdpCategory=text(form.get("prdp_category"),30),prdpExpiry=text(form.get("prdp_expiry"),10);
 const requiredFiles=identityType==="sa_citizen"?["id_front","id_back","profile_selfie"]:["passport","work_permit"];
 requiredFiles.push("licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","proof_of_address");
if(!["sa_citizen","foreign_national"].includes(identityType))return reply(400,{error:"valid_identity_type_required"});
 if(text(form.get("background_consent"),5)!=="on")return reply(400,{error:"background_verification_consent_required"});
 if(email.toLowerCase()!==(u.user.email||"").toLowerCase())return reply(400,{error:"application_email_must_match_signed_in_account"});
 if(!validDate(dob)||Date.parse(dob+"T00:00:00")>Date.now())return reply(400,{error:"valid_date_of_birth_required"});
 const birth=new Date(dob+"T00:00:00"),today=new Date();let applicantAge=today.getFullYear()-birth.getFullYear();if(today.getMonth()<birth.getMonth()||(today.getMonth()===birth.getMonth()&&today.getDate()<birth.getDate()))applicantAge--;if(applicantAge<18)return reply(400,{error:"driver_must_be_at_least_18"});
 if(identityType==="sa_citizen"&&(!/^\d{13}$/.test(idNumber)||!luhn(idNumber)||idNumber.slice(0,6)!==dob.slice(2,4)+dob.slice(5,7)+dob.slice(8,10)))return reply(400,{error:"valid_luhn_sa_id_matching_birth_date_required"});
  const saIdHash=identityType==="sa_citizen"?await sha256(idNumber):null;
  if(saIdHash){const {data:duplicate,error:duplicateError}=await db.from("driver_profiles").select("user_id").eq("sa_id_hash",saIdHash).neq("user_id",u.user.id).maybeSingle();if(duplicateError)return reply(500,{error:"identity_duplicate_check_failed"});if(duplicate)return reply(409,{error:"sa_id_already_registered"});}
 if(identityType==="foreign_national"&&(!passport||!trn))return reply(400,{error:"passport_and_traffic_register_number_required"});
 if(!/^\+27[0-9]{9}$/.test(phone.replace(/[\s-]/g,"").replace(/^0/,"+27"))&&!/^0[0-9]{9}$/.test(phone.replace(/[\s-]/g,"")))return reply(400,{error:"valid_sa_mobile_required"});
 if(!/^\S+@\S+\.\S+$/.test(email)||!["A1","A","B","EB","C1","C","EC1","EC"].includes(licenceCode)||!validDate(licenceExpiry)||Date.parse(licenceExpiry+"T00:00:00")<=Date.now())return reply(400,{error:"valid_email_licence_code_and_future_expiry_required"});
 if(!["motorbike","hatchback_sedan","bakkie_panel_van","truck"].includes(vehicleType)||!fullName||!plate||year<1980||year>new Date().getFullYear()+1)return reply(400,{error:"complete_vehicle_and_personal_details"});
 const heavy=vehicleType==="truck"||(vehicleType==="bakkie_panel_van"&&gvm>3500);
 if((vehicleType==="bakkie_panel_van"&&(!Number.isFinite(gvm)||gvm<=0))||(heavy&&!prdp)|| (prdp&&(!["goods","passengers","dangerous_goods"].includes(prdpCategory)||!validDate(prdpExpiry)||Date.parse(prdpExpiry+"T00:00:00")<=Date.now())))return reply(400,{error:"valid_prdp_details_required"});
 const proofDate=text(form.get("proof_of_address_date"),10),discExpiry=text(form.get("vehicle_disc_expiry"),10),insuranceExpiry=text(form.get("insurance_expiry"),10);
 if(!validDate(discExpiry)||Date.parse(discExpiry+"T00:00:00")<=Date.now()||!validDate(insuranceExpiry)||Date.parse(insuranceExpiry+"T00:00:00")<=Date.now())return reply(400,{error:"vehicle_disc_and_insurance_must_be_current"});
 const enatisFile=form.get("enatis_certificate"),leaseFile=form.get("fleet_lease_agreement");
 if(!(enatisFile instanceof File&&enatisFile.size>0)&&!(leaseFile instanceof File&&leaseFile.size>0))return reply(400,{error:"enatis_or_fleet_lease_document_required"});
 if(!validDate(proofDate)||Date.now()-Date.parse(proofDate+"T00:00:00")>92*86400000||Date.parse(proofDate+"T00:00:00")>Date.now())return reply(400,{error:"proof_of_residence_must_be_under_three_months_old"});
 if(identityType==="foreign_national"&&(!validDate(text(form.get("passport_expiry"),10))||Date.parse(text(form.get("passport_expiry"),10)+"T00:00:00")<=Date.now()||!validDate(text(form.get("work_permit_expiry"),10))||Date.parse(text(form.get("work_permit_expiry"),10)+"T00:00:00")<=Date.now()))return reply(400,{error:"passport_and_work_permit_must_be_current"});
 if(!validDate(text(form.get("registration_document_expiry"),10))||Date.parse(text(form.get("registration_document_expiry"),10)+"T00:00:00")<=Date.now())return reply(400,{error:"registration_document_must_be_current"});
 for(const t of requiredFiles){const f=form.get(t);if(!(f instanceof File)||f.size<1||f.size>10485760||!allowed.has(f.type))return reply(400,{error:"missing_or_invalid_document_"+t});}
 if(prdp){const f=form.get("prdp");if(!(f instanceof File)||f.size<1||f.size>10485760||!allowed.has(f.type))return reply(400,{error:"prdp_document_required"});}
 if(text(form.get("background_consent"),5)!=="on")return reply(400,{error:"background_verification_consent_required"});
 const bank=text(form.get("bank_name"),40),holder=text(form.get("account_holder"),120),account=text(form.get("account_number"),30);
 if(!["FNB","Nedbank","Standard Bank","Absa","Capitec","TymeBank"].includes(bank)||!holder||!/^\d{6,20}$/.test(account))return reply(400,{error:"valid_sa_bank_details_required"});
 const files=[...requiredFiles,...(form.get("enatis_certificate") instanceof File&&(form.get("enatis_certificate") as File).size>0?["enatis_certificate"]:[]),...(form.get("fleet_lease_agreement") instanceof File&&(form.get("fleet_lease_agreement") as File).size>0?["fleet_lease_agreement"]:[]),...(prdp?["prdp"]:[])],uploaded:string[]=[];
 const expiryFor=(type:string):string|null=>({licence_front:licenceExpiry,licence_back:licenceExpiry,vehicle_licence_disc:discExpiry,vehicle_insurance:insuranceExpiry,prdp:prdpExpiry,passport:text(form.get("passport_expiry"),10)||null,work_permit:text(form.get("work_permit_expiry"),10)||null,enatis_certificate:text(form.get("registration_document_expiry"),10)||null,fleet_lease_agreement:text(form.get("registration_document_expiry"),10)||null}[type]??null);
 const issuedFor=(type:string):string|null=>type==="proof_of_address"?proofDate:null;
 try{
  for(const type of files){
   const file=form.get(type) as File;
   const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100)||"document";
   const path=u.user.id+"/onboarding/"+type+"/"+crypto.randomUUID()+"-"+safe;
   const {error}=await db.storage.from("driver-application-documents").upload(path,new Uint8Array(await file.arrayBuffer()),{contentType:file.type,upsert:false});
   if(error)throw new Error("document_upload_failed");
   uploaded.push(path);
   const expiry=expiryFor(type);if(expiry&&(!validDate(expiry)||Date.parse(expiry+"T00:00:00")<=Date.now()))throw new Error("document_expiry_must_be_in_future_"+type);
   const {error:recordError}=await db.from("driver_documents").insert({driver_user_id:u.user.id,document_type:type,storage_path:path,file_url:path,original_name:safe,content_type:file.type,file_size_bytes:file.size,expiry_date:expiry,issued_at:issuedFor(type),verification_status:"pending",review_status:"pending"});
   if(recordError)throw new Error("document_record_failed");
  }
  const identity={full_name:fullName,phone,email,citizenship:identityType,date_of_birth:dob,traffic_register_number:identityType==="foreign_national"?trn:null};
  const licence={code:licenceCode,expiry:licenceExpiry,prdp_holder:prdp,prdp_category:prdp?prdpCategory:null,prdp_expiry:prdp?prdpExpiry:null};
  const vehicle={type:vehicleType,gross_vehicle_mass_kg:gvm,make:text(form.get("vehicle_make"),60),model:text(form.get("vehicle_model"),60),year,registration_plate:plate.toUpperCase(),vehicle_licence_disc_expiry:text(form.get("vehicle_disc_expiry"),10),insurance_expiry:text(form.get("insurance_expiry"),10)};
  const universalCodes:Record<string,string>={"FNB":"250655","Nedbank":"198765","Standard Bank":"051001","Absa":"632005","Capitec":"470010","TymeBank":"678910"};
 if(text(form.get("branch_code"),10)!==universalCodes[bank])return reply(400,{error:"bank_universal_branch_code_mismatch"});
 const banking={bank_name:bank,account_holder:holder,universal_branch_code:universalCodes[bank]};
  const [identityCipher,bankCipher,idCipher,passportCipher,accountCipher]=await Promise.all([
   db.rpc("encrypt_driver_pii",{p_plaintext:JSON.stringify(identity)}),
   db.rpc("encrypt_driver_pii",{p_plaintext:JSON.stringify(banking)}),
   identityType==="sa_citizen"?encryptGcm(db,idNumber):Promise.resolve(null),
   identityType==="foreign_national"?encryptGcm(db,passport):Promise.resolve(null),
   encryptGcm(db,account)
  ]);
  if(identityCipher.error||bankCipher.error||!identityCipher.data||!bankCipher.data)throw new Error("secure_pii_encryption_unavailable");
  const {error:saveError}=await db.from("driver_onboarding_applications").upsert({driver_user_id:u.user.id,identity_type:identityType,identity_details:{},identity_details_encrypted:identityCipher,licence_details:licence,vehicle_details:vehicle,banking_details:{},banking_details_encrypted:bankCipher,verification_status:"pending",submitted_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"driver_user_id"});
  if(saveError)throw new Error("application_save_failed");
  const bankDetailsCipher=bankCipher;
  if(bankDetailsCipher.error)throw new Error("secure_profile_pii_encryption_failed");
  const {error:profileSaveError}=await db.from("driver_profiles").update({
   verification_status:"pending",onboarding_status:"pending_review",can_go_online:false,is_online:false,availability_status:"offline",
   phone,license_expiry:licenceExpiry,
   vehicle_type:vehicleType==="motorbike"?"bike":vehicleType==="truck"?"truck":vehicleType==="hatchback_sedan"?"car":"van",
   vehicle_registration:plate.toUpperCase(),identity_type:identityType,identity_number_encrypted:null,
   passport_number_encrypted:null,sa_id_number_aesgcm:idCipher,passport_number_aesgcm:passportCipher,account_number_aesgcm:accountCipher,sa_id_hash:saIdHash,identity_last4:identityType==="sa_citizen"?idNumber.slice(-4):passport.slice(-4),
   licence_code:licenceCode,prdp_holder:prdp,prdp_category:prdp?prdpCategory:null,prdp_expiry:prdp?prdpExpiry:null,
   vehicle_make:vehicle.make,vehicle_model:vehicle.model,vehicle_year:year,vehicle_gvm_kg:gvm||null,
   bank_name:null,bank_account_holder:null,bank_account_encrypted:null,bank_details_encrypted:bankDetailsCipher.data,universal_branch_code:null
  }).eq("user_id",u.user.id);
  if(profileSaveError)throw new Error("driver_profile_onboarding_update_failed");
  await db.from("driver_verification_audit").insert({driver_user_id:u.user.id,event_type:"onboarding_submitted",details:{identity_type:identityType,document_count:files.length}});
  await db.from("driver_onboarding_notifications").insert({driver_user_id:u.user.id,notification_type:"application_submitted",title:"Application received",message:"Your driver onboarding application is pending document and background verification."});
  return reply(201,{submitted:true,status:"pending",message:"Application submitted. You cannot go online until SwiftHaul approves your documents."});
 }catch(e){
  if(uploaded.length){await db.from("driver_documents").delete().eq("driver_user_id",u.user.id).in("storage_path",uploaded);await db.storage.from("driver-application-documents").remove(uploaded);}
  return reply(500,{error:e instanceof Error?e.message:"application_submission_failed"});
 }
});
