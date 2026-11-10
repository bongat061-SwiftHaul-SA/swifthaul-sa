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
   const [{data:ledger,error:le},{data:rewards,error:we},{data:requests,error:re},{data:balance,error:be}]=await Promise.all([
    db.from("driver_earnings_ledger").select("event_type,amount_cents,description,created_at").eq("driver_user_id",id).order("created_at",{ascending:false}).limit(100),
    db.from("driver_reward_ledger").select("event_type,amount_cents,description,created_at").eq("driver_user_id",id).order("created_at",{ascending:false}).limit(100),
    db.from("driver_payout_requests").select("id,amount_cents,status,bank_name,account_holder,account_type,branch_code,created_at,reviewed_at,paid_at").eq("driver_user_id",id).order("created_at",{ascending:false}).limit(30),
    db.rpc("get_driver_available_balance",{p_driver_id:id})
   ]);
   if(le||we||re||be)return reply(500,{error:"payout_history_failed"});
   const combined=[...(ledger??[]),...(rewards??[])].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,100);
   return reply(200,{available_cents:Number(balance??0),ledger:combined,requests:requests??[]});
  }
  const raw=await req.text();if(raw.length>4096)return reply(413,{error:"request_too_large"});
  let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return reply(400,{error:"invalid_json"})}
  if(b.action!=="request"||typeof b.amount_cents!=="number"||!Number.isSafeInteger(b.amount_cents))return reply(400,{error:"invalid_payout_request"});
  const {data,error}=await db.rpc("request_driver_payout",{p_driver_id:id,p_amount_cents:b.amount_cents,p_bank_name:b.bank_name,p_account_holder:b.account_holder,p_account_number:b.account_number,p_account_type:b.account_type,p_branch_code:b.branch_code||null});
  if(error){const m=error.message||"";if(/Insufficient|Invalid payout/i.test(m))return reply(400,{error:"invalid_amount_or_bank_details"});if(/open payout/i.test(m))return reply(409,{error:"open_payout_already_exists"});if(/Approved active driver/i.test(m))return reply(403,{error:"driver_not_approved"});return reply(500,{error:"payout_request_failed"})}
  return reply(201,data);
 }
 if(req.method==="GET"){
  const {data,error}=await db.from("driver_payout_requests").select("id,driver_user_id,amount_cents,bank_name,account_holder,account_number,account_type,branch_code,status,admin_reference,created_at,reviewed_at,paid_at").order("created_at",{ascending:false}).limit(200);
  if(error)return reply(500,{error:"payout_list_failed"});
  return reply(200,{requests:(data??[]).map(x=>({...x,account_number_masked:"•".repeat(Math.max(0,x.account_number.length-4))+x.account_number.slice(-4),account_number:undefined}))});
 }
 const raw=await req.text();if(raw.length>4096)return reply(413,{error:"request_too_large"});
 let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return reply(400,{error:"invalid_json"})}
 if(typeof b.request_id!=="string"||!["approve","reject","paid"].includes(String(b.action)))return reply(400,{error:"invalid_review_action"});
 const {data,error}=await db.rpc("review_driver_payout",{p_admin_id:id,p_request_id:b.request_id,p_action:b.action,p_reference:typeof b.reference==="string"?b.reference:null});
 if(error){if(/not found/i.test(error.message))return reply(404,{error:"payout_not_found"});if(/not pending|Approved payout/i.test(error.message))return reply(409,{error:"payout_state_conflict"});return reply(500,{error:"payout_review_failed"})}
 return reply(200,data??{updated:true});
});