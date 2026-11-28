import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
const allowed=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const bucket="driver-application-documents";
const maxBytes=10*1024*1024;
const groups=new Set(["identity_personal","driver_licence","prdp","vehicle_registration","vehicle_licence_disc","residential_address","vehicle_insurance","other","licence_prdp","general"]);
const safeName=(name:string)=>name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100)||"document";

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const bearer=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
 if(!bearer)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:userData,error:authError}=await auth.auth.getUser(bearer);
 if(authError||!userData.user)return reply(401,{error:"invalid_or_expired_session"});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:profileError}=await admin.from("user_profiles").select("role,account_status").eq("id",userData.user.id).maybeSingle();
 if(profileError||profile?.role!=="driver"||profile?.account_status!=="active")return reply(403,{error:"active_driver_account_required"});

 // Opportunistically remove abandoned, incomplete tickets after 48 hours.
 // Completed uploads awaiting Admin classification are never touched.
 const cutoff=new Date(Date.now()-48*60*60*1000).toISOString();
 const {data:stale}=await admin.from("driver_document_upload_batches")
  .select("id,storage_path").eq("upload_completed",false).eq("classification_status","pending_classification").lt("created_at",cutoff).limit(100);
 for(const row of stale??[]){
  await admin.storage.from(bucket).remove([row.storage_path]);
  await admin.from("driver_document_upload_batches").delete().eq("id",row.id).eq("upload_completed",false);
 }
 let body:any;try{body=await req.json();}catch{return reply(400,{error:"invalid_json"});}
 if(body?.action==="prepare"){
  if(!Array.isArray(body.files)||body.files.length<1||body.files.length>15)return reply(400,{error:"select_between_1_and_15_files"});
  const files=body.files;
  for(const file of files){
   if(!file||typeof file.name!=="string"||file.name.length>255||typeof file.type!=="string"||!allowed.has(file.type)||!Number.isInteger(file.size)||file.size<1||file.size>maxBytes||!groups.has(file.document_group))return reply(400,{error:"each_file_must_have_a_valid_group_and_be_pdf_or_image_under_10mb"});
  }
  const prepared=[];
  for(const file of files){
   const name=safeName(file.name);
   const path=userData.user.id+"/onboarding/batch-"+crypto.randomUUID()+"/"+crypto.randomUUID()+"-"+name;
   const {data:signed,error:signedError}=await admin.storage.from(bucket).createSignedUploadUrl(path,{upsert:false});
   if(signedError||!signed?.token){for(const item of prepared)await admin.storage.from(bucket).remove([item.path]);return reply(500,{error:"secure_upload_ticket_creation_failed"});}
   const {data:row,error:insertError}=await admin.from("driver_document_upload_batches").insert({
    driver_user_id:userData.user.id,bucket_id:bucket,storage_path:path,original_filename:name,document_group:file.document_group,
    content_type:file.type,file_size_bytes:file.size
   }).select("id").single();
   if(insertError){await admin.storage.from(bucket).remove([path]);for(const item of prepared)await admin.storage.from(bucket).remove([item.path]);return reply(500,{error:"upload_batch_record_creation_failed"});}
   prepared.push({id:row.id,path,token:signed.token,name,type:file.type,size:file.size,document_group:file.document_group});
  }
  return reply(200,{uploads:prepared,chunk_size_bytes:6*1024*1024,retry_delays_ms:[0,3000,5000,10000,20000]});
 }

 if(body?.action==="resume"){
  if(!Array.isArray(body.upload_ids)||body.upload_ids.length<1||body.upload_ids.length>15||body.upload_ids.some((id:unknown)=>typeof id!=="string"))return reply(400,{error:"valid_upload_ids_required"});
  const {data:rows,error:rowsError}=await admin.from("driver_document_upload_batches")
   .select("id,storage_path,original_filename,content_type,file_size_bytes,upload_completed,classification_status,document_group")
   .eq("driver_user_id",userData.user.id).in("id",body.upload_ids)
   .eq("upload_completed",false).eq("classification_status","pending_classification");
  if(rowsError)return reply(500,{error:"upload_batch_lookup_failed"});
  if(!rows||rows.length!==body.upload_ids.length)return reply(409,{error:"saved_upload_expired_or_unavailable"});
  const uploads=[];
  for(const row of rows){
   const slash=row.storage_path.lastIndexOf("/"),folder=row.storage_path.slice(0,slash),filename=row.storage_path.slice(slash+1);
   const {data:objects,error:listError}=await admin.storage.from(bucket).list(folder,{search:filename,limit:10});
   if(listError)return reply(500,{error:"upload_resume_object_check_failed"});
   const alreadyUploaded=(objects||[]).some((item:any)=>item.name===filename);
   if(alreadyUploaded){uploads.push({id:row.id,path:row.storage_path,uploaded:true,name:row.original_filename,type:row.content_type,size:row.file_size_bytes,document_group:row.document_group});continue;}
   const {data:signed,error:signedError}=await admin.storage.from(bucket).createSignedUploadUrl(row.storage_path,{upsert:false});
   if(signedError||!signed?.token)return reply(500,{error:"secure_upload_resume_ticket_creation_failed"});
   uploads.push({id:row.id,path:row.storage_path,token:signed.token,uploaded:false,name:row.original_filename,type:row.content_type,size:row.file_size_bytes,document_group:row.document_group});
  }
  return reply(200,{uploads,chunk_size_bytes:6*1024*1024,retry_delays_ms:[0,3000,5000,10000,20000]});
 }
 if(body?.action==="finalize"){
  if(!Array.isArray(body.upload_ids)||body.upload_ids.length<1||body.upload_ids.length>15||body.upload_ids.some((id:unknown)=>typeof id!=="string"))return reply(400,{error:"valid_upload_ids_required"});
  const {data:rows,error:rowsError}=await admin.from("driver_document_upload_batches").select("id,storage_path,original_filename,content_type,file_size_bytes,classification_status").eq("driver_user_id",userData.user.id).in("id",body.upload_ids).eq("upload_completed",false);
  if(rowsError)return reply(500,{error:"upload_batch_lookup_failed"});
  if(!rows||rows.length!==body.upload_ids.length||rows.some((row:any)=>row.classification_status!=="pending_classification"))return reply(409,{error:"upload_batch_not_found_or_already_finalized"});
  for(const row of rows){
   const slash=row.storage_path.lastIndexOf("/");
   const folder=row.storage_path.slice(0,slash),filename=row.storage_path.slice(slash+1);
   const {data:objects,error:listError}=await admin.storage.from(bucket).list(folder,{search:filename,limit:10});
   const object=(objects||[]).find((item:any)=>item.name===filename);
   if(listError||!object)return reply(409,{error:"one_or_more_files_are_not_uploaded",file:row.original_filename});
   const actualSize=Number(object.metadata?.size??object.metadata?.contentLength??0);
   const actualType=String(object.metadata?.mimetype??object.metadata?.contentType??"");
   if(actualSize!==Number(row.file_size_bytes)||actualType&&actualType!==row.content_type)return reply(409,{error:"uploaded_file_metadata_mismatch",file:row.original_filename});
  }
  const {error:completeError}=await admin.from("driver_document_upload_batches").update({upload_completed:true}).eq("driver_user_id",userData.user.id).in("id",body.upload_ids).eq("upload_completed",false);
  if(completeError)return reply(500,{error:"upload_completion_record_failed"});
  return reply(200,{finalized:true,count:rows.length,message:"All files received securely and queued for SwiftHaul document review."});
 }
 return reply(400,{error:"unknown_action"});
});
