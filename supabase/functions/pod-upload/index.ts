import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:cors});
const mimeExt:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
  const token=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return reply(401,{error:"missing_bearer_token"});
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await auth.auth.getUser(token);
  if(authError||!authData.user)return reply(401,{error:"invalid_or_expired_session"});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const actorId=authData.user.id;
  const {data:profile}=await admin.from("user_profiles").select("role,account_status").eq("id",actorId).maybeSingle();
  if(!profile||profile.role!=="driver"||profile.account_status!=="active")return reply(403,{error:"active_driver_access_required"});
  const raw=await req.text();if(raw.length>4096)return reply(413,{error:"request_too_large"});
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return reply(400,{error:"invalid_json"});}
  if(typeof body.waybill!=="string"||body.waybill.length>100)return reply(400,{error:"invalid_waybill"});
  const {data:order,error:orderError}=await admin.from("customer_bookings")
    .select("waybill,status,driver_user_id").eq("waybill",body.waybill).maybeSingle();
  if(orderError)return reply(500,{error:"delivery_lookup_failed"});
  if(!order||order.driver_user_id!==actorId)return reply(404,{error:"delivery_not_found"});
  if(order.status!=="in_transit")return reply(409,{error:"proof_only_allowed_while_in_transit"});
  const {data:existing}=await admin.from("proof_of_delivery").select("id").eq("waybill",order.waybill).maybeSingle();

  if(body.action==="create"){
    if(existing)return reply(409,{error:"proof_already_uploaded"});
    if(typeof body.content_type!=="string"||!mimeExt[body.content_type])return reply(400,{error:"unsupported_image_type"});
    if(typeof body.size!=="number"||body.size<=0||body.size>10485760)return reply(413,{error:"image_must_be_10mb_or_less"});
    const path=`${actorId}/${order.waybill}/${crypto.randomUUID()}.${mimeExt[body.content_type]}`;
    const {data,error}=await admin.storage.from("delivery-proof").createSignedUploadUrl(path,{upsert:false});
    if(error){console.error("Signed upload creation failed",error.message);return reply(500,{error:"upload_initialization_failed"});}
    return reply(200,{path,token:data.token});
  }

  if(body.action==="confirm"){
    if(existing)return reply(409,{error:"proof_already_uploaded"});
    if(typeof body.path!=="string"||!body.path.startsWith(`${actorId}/${order.waybill}/`)||body.path.length>300)
      return reply(400,{error:"invalid_proof_path"});
    const parts=body.path.split("/");
    const folder=parts.slice(0,2).join("/");
    const {data:objects,error:listError}=await admin.storage.from("delivery-proof").list(folder);
    if(listError)return reply(500,{error:"proof_verification_failed"});
    if(!objects?.some(item=>item.name===parts[2]))return reply(400,{error:"uploaded_image_not_found"});
    const recipient=typeof body.recipient_name==="string"?body.recipient_name.trim().slice(0,120):"";
    const notes=typeof body.notes==="string"?body.notes.trim().slice(0,500):"";
    const {error:insertError}=await admin.from("proof_of_delivery").insert({
      waybill:order.waybill,driver_user_id:actorId,storage_path:body.path,
      recipient_name:recipient||null,notes:notes||null
    });
    if(insertError){console.error("Proof record insert failed",insertError.message);return reply(500,{error:"proof_record_save_failed"});}
    return reply(200,{uploaded:true});
  }
  return reply(400,{error:"unknown_proof_action"});
});
