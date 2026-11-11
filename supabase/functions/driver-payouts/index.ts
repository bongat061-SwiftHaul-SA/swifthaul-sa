import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(!["GET","POST"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!secret)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:u,error:ue}=await auth.auth.getUser(token);if(ue||!u.user)return reply(401,{error:"invalid_session"});
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const id=u.user.id;
 const {data:p,error:pe}=await db.from("user_profiles").select("role,account_status").eq("id",id).maybeSingle();
 if(pe)return reply(500,{error:"profile_lookup_failed"});
 if(!p||p.account_status!=="active"||!["driver","admin"].includes(p.role))return reply(403,{error:"payout_access_required"});
 if(p.role==="driver"){
  if(req.method==="GET"){
   const [{data:ledger,error:le},{data:requests,error:re}]=await Promise.all([
    db.from("driver_earnings_ledger").select("event_type,amount_cents,description,created_at").eq("driver_user_id",id).order("created_at",{ascending:false}).limit(100),
    db.from("driver_payout_requests").select("id,amount_cents,status,bank_name,account_holder,account_type,branch_code,created_at,reviewed_at,paid_at").eq("driver_user_id",id).order("created_at",{ascending:false}).limit(30)
   ]);
   if(le||re)return reply(500,{error:"payout_history_failed"});
   const balance=(ledger??[]).reduce((n,x)=>n+Number(x.amount_cents),0);
   return reply(200,{available_cents:balance,ledger:ledger??[],requests:requests??[]});
  }
  const raw=await req.text();if(raw.length>4096)return reply(413,{error:"request_too_large"});
  let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return reply(400,{error:"invalid_json"})}
  if(b.action!=="request"||typeof b.amount_cents!=="number"||!Number.isSafeInteger(b.amount_cents))return reply(400,{error:"invalid_payout_request"});
  const {data:bankProfile,error:bankError}=await db.from("driver_profiles").select("bank_details_encrypted,account_number_aesgcm").eq("user_id",id).maybeSingle();
  if(bankError||!bankProfile?.bank_details_encrypted||!bankProfile?.account_number_aesgcm)return reply(409,{error:"verified_bank_account_required"});
  const {data:bankJson,error:decryptError}=await db.rpc("decrypt_driver_pii",{p_ciphertext:bankProfile.bank_details_encrypted});
  if(decryptError||typeof bankJson!=="string")return reply(500,{error:"verified_bank_details_unavailable"});
  let bank:Record<string,unknown>;try{bank=JSON.parse(bankJson)}catch{return reply(500,{error:"verified_bank_details_invalid"})}
  const cipher=String(bankProfile.account_number_aesgcm),parts=cipher.split(":");
  if(parts.length!==3||parts[0]!=="v1")return reply(500,{error:"verified_account_encryption_invalid"});
  const fromB64=(v:string)=>Uint8Array.from(atob(v),x=>x.charCodeAt(0));
  const {data:keyText,error:keyError}=await db.rpc("get_driver_pii_aes256_gcm_key");
  if(keyError||typeof keyText!=="string")return reply(500,{error:"verified_account_key_unavailable"});
  const key=await crypto.subtle.importKey("raw",fromB64(keyText),{name:"AES-GCM"},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(parts[1]),tagLength:128},key,fromB64(parts[2]));
  const accountNumber=new TextDecoder().decode(plain);
  const {data,error}=await db.rpc("request_driver_payout_secure",{p_driver_id:id,p_amount_cents:b.amount_cents,p_bank_name:bank.bank_name,p_account_holder:bank.account_holder,p_account_number_ciphertext:cipher,p_account_number_last4:accountNumber.slice(-4),p_account_type:bank.account_type,p_branch_code:bank.universal_branch_code||null});
  if(error){const m=error.message||"";if(/Insufficient|Invalid verified payout/i.test(m))return reply(400,{error:"invalid_amount_or_verified_bank_details"});if(/open payout/i.test(m))return reply(409,{error:"open_payout_already_exists"});if(/Approved active driver/i.test(m))return reply(403,{error:"driver_not_approved"});return reply(500,{error:"payout_request_failed"})}
  return reply(201,{...data,bank_name:bank.bank_name,account_number_masked:"••••"+accountNumber.slice(-4)});
 }
 if(req.method==="GET"){
  const {data,error}=await db.from("driver_payout_requests").select("id,driver_user_id,amount_cents,bank_name,account_holder,account_number,account_number_last4,account_type,branch_code,status,admin_reference,created_at,reviewed_at,paid_at").order("created_at",{ascending:false}).limit(200);
  if(error)return reply(500,{error:"payout_list_failed"});
  return reply(200,{requests:(data??[]).map(x=>({...x,account_number_masked:"••••"+(x.account_number_last4||String(x.account_number||"").slice(-4)),account_number:undefined,account_number_last4:undefined}))});
 }
 const raw=await req.text();if(raw.length>4096)return reply(413,{error:"request_too_large"});
 let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return reply(400,{error:"invalid_json"})}
 if(typeof b.request_id!=="string"||!["approve","reject","paid"].includes(String(b.action)))return reply(400,{error:"invalid_review_action"});
 const {data,error}=await db.rpc("review_driver_payout",{p_admin_id:id,p_request_id:b.request_id,p_action:b.action,p_reference:typeof b.reference==="string"?b.reference:null});
 if(error){if(/not found/i.test(error.message))return reply(404,{error:"payout_not_found"});if(/not pending|Approved payout/i.test(error.message))return reply(409,{error:"payout_state_conflict"});return reply(500,{error:"payout_review_failed"})}
 return reply(200,data??{updated:true});
});