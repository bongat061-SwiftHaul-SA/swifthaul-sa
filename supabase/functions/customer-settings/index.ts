import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, POST, PUT, DELETE, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers:cors});
const limit=(v:unknown,n:number)=>typeof v==="string"&&v.length<=n;
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(!["GET","POST","PUT","DELETE"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:a,error:ae}=await auth.auth.getUser(token);if(ae||!a.user)return reply(401,{error:"invalid_or_expired_session"});
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}}),owner=a.user.id;
 const {data:p,error:pe}=await admin.from("user_profiles").select("role,account_status").eq("id",owner).maybeSingle();
 if(pe)return reply(500,{error:"profile_lookup_failed"});
 if(!p||p.role!=="customer"||p.account_status!=="active")return reply(403,{error:"active_customer_account_required"});
 if(req.method==="GET"){
  const {data,error}=await admin.from("customer_profiles").select("full_name,phone,details,bank_name,account_holder,account_number,branch_code").eq("owner_hash",owner).maybeSingle();
  if(error)return reply(500,{error:"profile_lookup_failed"});
  const {data:userProfile,error:userProfileError}=await admin.from("user_profiles").select("full_name,phone").eq("id",owner).maybeSingle();
  if(userProfileError)return reply(500,{error:"account_profile_lookup_failed"});
  const profile={...(userProfile||{}),...(data||{})};
  const {data:photo}=await admin.storage.from("customer-photos").createSignedUrl(owner+".jpg",300);
  return reply(200,{profile:{full_name:profile.full_name||"",phone:profile.phone||"",details:profile.details||"",bank_name:profile.bank_name||"",bank_last_four:profile.account_number?String(profile.account_number).slice(-4):""},photo_url:photo?.signedUrl||null});
 }
 if(req.method==="POST"){
  const form=await req.formData(),file=form.get("photo");
  if(!(file instanceof File)||!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size<1||file.size>2*1024*1024)return reply(400,{error:"upload_a_jpeg_png_or_webp_up_to_2mb"});
  const bytes=new Uint8Array(await file.arrayBuffer()),path=owner+".jpg";
  const {error}=await admin.storage.from("customer-photos").upload(path,bytes,{contentType:file.type,upsert:true});
  if(error)return reply(500,{error:"photo_upload_failed"});
  const {data}=await admin.storage.from("customer-photos").createSignedUrl(path,300);
  return reply(200,{saved:true,photo_url:data?.signedUrl||null});
 }
 if(req.method==="DELETE")return reply(409,{error:"For account deletion, please contact SwiftHaul support so outstanding bookings, wallet balances and financial records can be safely reconciled."});
 const raw=await req.text();if(raw.length>12000)return reply(413,{error:"request_too_large"});
 let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return reply(400,{error:"invalid_json"})}
 const fields=["full_name","phone","details","bank_name","account_holder","account_number","branch_code"] as const;
 const values=fields.map(k=>b[k]??"");
 if(fields.some((k,i)=>!limit(values[i],({full_name:120,phone:40,details:2000,bank_name:120,account_holder:120,account_number:30,branch_code:12} as Record<string,number>)[k])))return reply(400,{error:"check_profile_field_lengths"});
 const [full_name,phone,details,bank_name,account_holder,account_number,branch_code]=values as string[];
 if(account_number&&!/^\d{5,30}$/.test(account_number)||branch_code&&!/^\d{3,12}$/.test(branch_code))return reply(400,{error:"bank_account_and_branch_code_must_be_digits"});
 if(typeof b.replace_bank!=="boolean")return reply(400,{error:"choose_whether_to_replace_banking_details"});
 const bank=[bank_name,account_holder,account_number,branch_code];
 if(b.replace_bank&&bank.some(x=>x.trim())&&!bank.every(x=>x.trim()))return reply(400,{error:"complete_all_bank_fields_or_leave_all_empty"});
 // Preserve the existing bank fields when a customer edits only their profile details.
 const {data:existing,error:existingError}=await admin.from("customer_profiles").select("bank_name,account_holder,account_number,branch_code").eq("owner_hash",owner).maybeSingle();
 if(existingError)return reply(500,{error:"profile_lookup_failed"});
 const bankFields=b.replace_bank
  ? {bank_name:bank_name.trim()||null,account_holder:account_holder.trim()||null,account_number:account_number||null,branch_code:branch_code||null}
  : {bank_name:existing?.bank_name??null,account_holder:existing?.account_holder??null,account_number:existing?.account_number??null,branch_code:existing?.branch_code??null};
 const {error}=await admin.from("customer_profiles").upsert({owner_hash:owner,full_name:full_name.trim(),phone:phone.trim(),details:details.trim(),...bankFields},{onConflict:"owner_hash"});
 if(error)return reply(500,{error:"profile_save_failed"});
 const {error:userUpdateError}=await admin.from("user_profiles").update({full_name:full_name.trim(),phone:phone.trim()}).eq("id",owner);
 if(userUpdateError)return reply(500,{error:"account_profile_sync_failed"});
 return reply(200,{saved:true});
});
