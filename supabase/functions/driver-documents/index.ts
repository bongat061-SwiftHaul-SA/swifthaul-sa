import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods":"POST, GET, OPTIONS", "Content-Type":"application/json" };
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers:cors});
const allowed=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(!["POST","GET"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:a,error:ae}=await auth.auth.getUser(token);if(ae||!a.user)return reply(401,{error:"invalid_or_expired_session"});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:p,error:pe}=await admin.from("user_profiles").select("role,account_status").eq("id",a.user.id).maybeSingle();
 if(pe)return reply(500,{error:"profile_lookup_failed"});
 const isAdmin=p?.role==="admin"&&p?.account_status==="active",isDriver=p?.role==="driver"&&p?.account_status==="active";
 if(!isAdmin&&!isDriver)return reply(403,{error:"active_driver_or_admin_required"});
 if(req.method==="GET"){
  if(!isDriver)return reply(403,{error:"driver_only"});
  const {data,error}=await admin.from("driver_documents").select("id,document_type,original_name,content_type,file_size_bytes,review_status,review_note,created_at").eq("driver_user_id",a.user.id).order("created_at",{ascending:false});
  if(error)return reply(500,{error:"document_list_failed"});return reply(200,{documents:data||[]});
 }
 const form=await req.formData(),target=form.get("driver_user_id"),owner=isAdmin&&typeof target==="string"?target:a.user.id;
 const type=String(form.get("document_type")||""),file=form.get("file");
 if(isAdmin&&typeof target!=="string")return reply(400,{error:"driver_user_id_required"});
 if(!["id_document","proof_of_address","bank_confirmation","drivers_licence","vehicle_document"].includes(type)||!(file instanceof File))return reply(400,{error:"valid_document_and_file_required"});
 if(!allowed.has(file.type)||file.size<1||file.size>10485760)return reply(413,{error:"file_must_be_pdf_or_image_up_to_10mb"});
 if(isDriver&&owner!==a.user.id)return reply(403,{error:"document_owner_mismatch"});
 const {data:driver}=await admin.from("driver_profiles").select("user_id").eq("user_id",owner).maybeSingle();
 if(!driver)return reply(404,{error:"driver_application_not_found"});
 const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100)||"document",path=owner+"/"+type+"/"+crypto.randomUUID()+"-"+safeName;
 const {error:up}=await admin.storage.from("driver-application-documents").upload(path,new Uint8Array(await file.arrayBuffer()),{contentType:file.type,upsert:false});
 if(up)return reply(500,{error:"secure_document_upload_failed"});
 const {data,error}=await admin.from("driver_documents").insert({driver_user_id:owner,document_type:type,storage_path:path,original_name:safeName,content_type:file.type,file_size_bytes:file.size}).select("id,document_type,original_name,review_status,created_at").single();
 if(error){await admin.storage.from("driver-application-documents").remove([path]);return reply(500,{error:"document_record_failed"});}
 return reply(201,{document:data});
});
