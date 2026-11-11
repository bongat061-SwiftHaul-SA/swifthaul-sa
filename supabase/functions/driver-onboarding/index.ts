import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, GET, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
const allowed=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const docTypes=new Set(["id_front","id_back","profile_selfie","passport","work_permit","licence_front","licence_back","prdp","vehicle_licence_disc","enatis_certificate","fleet_lease_agreement","vehicle_insurance","proof_of_address"]);
const text=(v:FormDataEntryValue|null,max=200)=>typeof v==="string"?v.trim().slice(0,max):"";
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+"T00:00:00"));
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
  const {data,error}=await db.from("driver_onboarding_applications").select("identity_type,verification_status,submitted_at,review_note").eq("driver_user_id",u.user.id).maybeSingle();
  if(error)return reply(500,{error:"application_status_unavailable"});
  return reply(200,{application:data||null});
 }
 const form=await req.formData();
 const identityType=text(form.get("identity_type"),30),fullName=text(form.get("full_name"),120),phone=text(form.get("phone"),20),email=text(form.get("email"),254);
 const licenceCode=text(form.get("licence_code"),5),licenceExpiry=text(form.get("licence_expiry"),10),vehicleType=text(form.get("vehicle_type"),30);
 const plate=text(form.get("registration_plate"),20),year=Number(text(form.get("vehicle_year"),4));
 const idNumber=text(form.get("id_number"),13),dob=text(form.get("date_of_birth"),10),passport=text(form.get("passport_number"),30),trn=text(form.get("traffic_register_number"),30);
 const prdp=text(form.get("prdp_holder"),5)==="true",gvm=Number(text(form.get("vehicle_gvm_kg"),8)),prdpCategory=text(form.get("prdp_category"),30),prdpExpiry=text(form.get("prdp_expiry"),10);
 const requiredFiles=identityType==="sa_citizen"?["id_front","id_back","profile_selfie"]:["passport","work_permit"];
 requiredFiles.push("licence_front","licence_back","vehicle_licence_disc","vehicle_insurance","proof_of_address");
 if(identityType==="sa_citizen"&&(!/^\d{13}$/.test(idNumber)||!luhn(idNumber)||!validDate(dob)))return reply(400,{error:"valid_luhn_sa_id_and_date_of_birth_required"});
 if(identityType==="foreign_national"&&(!passport||!trn))return reply(400,{error:"passport_and_traffic_register_number_required"});
 if(!/^\+27[0-9]{9}$/.test(phone.replace(/[\s-]/g,"").replace(/^0/,"+27"))&&!/^0[0-9]{9}$/.test(phone.replace(/[\s-]/g,"")))return reply(400,{error:"valid_sa_mobile_required"});
 if(!/^\S+@\S+\.\S+$/.test(email)||!["A1","A","B","EB","C1","C","EC1","EC"].includes(licenceCode)||!validDate(licenceExpiry)||Date.parse(licenceExpiry+"T00:00:00")<=Date.now())return reply(400,{error:"valid_email_licence_code_and_future_expiry_required"});
 if(!["motorbike","hatchback_sedan","bakkie_panel_van","truck"].includes(vehicleType)||!fullName||!plate||year<1980||year>new Date().getFullYear()+1)return reply(400,{error:"complete_vehicle_and_personal_details"});
 const heavy=vehicleType==="truck"||(vehicleType==="bakkie_panel_van"&&gvm>3500);
 if((vehicleType==="bakkie_panel_van"&&(!Number.isFinite(gvm)||gvm<=0))||(heavy&&!prdp)|| (prdp&&(!["goods","passengers","dangerous_goods"].includes(prdpCategory)||!validDate(prdpExpiry)||Date.parse(prdpExpiry+"T00:00:00")<=Date.now())))return reply(400,{error:"valid_prdp_details_required"});
 const proofDate=text(form.get("proof_of_address_date"),10),discExpiry=text(form.get("vehicle_disc_expiry"),10),insuranceExpiry=text(form.get("insurance_expiry"),10);
 if(!validDate(discExpiry)||Date.parse(discExpiry+"T00:00:00")<=Date.now()||!validDate(insuranceExpiry)||Date.parse(insuranceExpiry+"T00:00:00")<=Date.now())return reply(400,{error:"vehicle_disc_and_insurance_must_be_current"});
 if(!form.get("enatis_certificate")&&!form.get("fleet_lease_agreement"))return reply(400,{error:"enatis_or_fleet_lease_document_required"});
 if(!validDate(proofDate)||Date.now()-Date.parse(proofDate+"T00:00:00")>92*86400000||Date.parse(proofDate+"T00:00:00")>Date.now())return reply(400,{error:"proof_of_residence_must_be_under_three_months_old"});
 for(const t of requiredFiles){const f=form.get(t);if(!(f instanceof File)||f.size<1||f.size>10485760||!allowed.has(f.type))return reply(400,{error:"missing_or_invalid_document_"+t});}
 if(prdp){const f=form.get("prdp");if(!(f instanceof File)||f.size<1||f.size>10485760||!allowed.has(f.type))return reply(400,{error:"prdp_document_required"});}
 const bank=text(form.get("bank_name"),40),holder=text(form.get("account_holder"),120),account=text(form.get("account_number"),30);
 if(!["FNB","Nedbank","Standard Bank","Absa","Capitec","TymeBank"].includes(bank)||!holder||!/^\d{6,20}$/.test(account))return reply(400,{error:"valid_sa_bank_details_required"});
 const files=[...requiredFiles,...(prdp?["prdp"]:[])],uploaded:string[]=[];
 try{
  for(const type of files){
   const file=form.get(type) as File;
   const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100)||"document";
   const path=u.user.id+"/onboarding/"+type+"/"+crypto.randomUUID()+"-"+safe;
   const {error}=await db.storage.from("driver-application-documents").upload(path,new Uint8Array(await file.arrayBuffer()),{contentType:file.type,upsert:false});
   if(error)throw new Error("document_upload_failed");
   uploaded.push(path);
   const {error:recordError}=await db.from("driver_documents").insert({driver_user_id:u.user.id,document_type:type,storage_path:path,original_name:safe,content_type:file.type,file_size_bytes:file.size});
   if(recordError)throw new Error("document_record_failed");
  }
  const identity={full_name:fullName,phone,email,citizenship:identityType,id_number:identityType==="sa_citizen"?idNumber:null,date_of_birth:identityType==="sa_citizen"?dob:null,passport_number:identityType==="foreign_national"?passport:null,traffic_register_number:identityType==="foreign_national"?trn:null};
  const licence={code:licenceCode,expiry:licenceExpiry,prdp_holder:prdp,prdp_category:prdp?prdpCategory:null,prdp_expiry:prdp?prdpExpiry:null};
  const vehicle={type:vehicleType,gross_vehicle_mass_kg:gvm,make:text(form.get("vehicle_make"),60),model:text(form.get("vehicle_model"),60),year,registration_plate:plate.toUpperCase(),vehicle_licence_disc_expiry:text(form.get("vehicle_disc_expiry"),10),insurance_expiry:text(form.get("insurance_expiry"),10)};
  const banking={bank_name:bank,account_holder:holder,account_number:account,universal_branch_code:text(form.get("branch_code"),10)};
  const {error:saveError}=await db.from("driver_onboarding_applications").upsert({driver_user_id:u.user.id,identity_type:identityType,identity_details:identity,licence_details:licence,vehicle_details:vehicle,banking_details:banking,verification_status:"pending",submitted_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"driver_user_id"});
  if(saveError)throw new Error("application_save_failed");
  await db.from("driver_profiles").update({verification_status:"pending",is_online:false,availability_status:"offline",phone,license_expiry:licenceExpiry,vehicle_type:vehicleType==="motorbike"?"bike":vehicleType==="truck"?"truck":vehicleType==="bakkie_panel_van"?"van":"van",vehicle_registration:plate.toUpperCase()}).eq("user_id",u.user.id);
  return reply(201,{submitted:true,status:"pending",message:"Application submitted. You cannot go online until SwiftHaul approves your documents."});
 }catch(e){
  if(uploaded.length)await db.storage.from("driver-application-documents").remove(uploaded);
  return reply(500,{error:e instanceof Error?e.message:"application_submission_failed"});
 }
});
