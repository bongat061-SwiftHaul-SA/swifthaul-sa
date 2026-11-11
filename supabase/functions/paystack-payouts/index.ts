import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-payout-cron-secret","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
const ref=()=>"shp_"+crypto.randomUUID().replaceAll("-","");
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(!["GET","POST"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret=Deno.env.get("PAYSTACK_SECRET_KEY");
 if(!url||!service)return reply(500,{error:"server_configuration_error"});if(!secret)return reply(503,{error:"paystack_secret_not_configured"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const cronSecret=Deno.env.get("PAYSTACK_PAYOUT_CRON_SECRET"),cron=req.headers.get("x-payout-cron-secret");
 let actorId:string|null=null,role="system";
 if(cronSecret&&cron&&cron===cronSecret){role="cron";}
 else{
  const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token||!anon)return reply(401,{error:"missing_bearer_token"});
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),{data:u,error}=await auth.auth.getUser(token);
  if(error||!u.user)return reply(401,{error:"invalid_session"});actorId=u.user.id;
  const {data:p}=await db.from("user_profiles").select("role,account_status").eq("id",actorId).maybeSingle();
  if(!p||p.account_status!=="active"||!["driver","admin"].includes(p.role))return reply(403,{error:"payout_access_required"});role=p.role;
 }
 if(req.method==="GET"){
  if(!actorId)return reply(403,{error:"authenticated_driver_required"});
  const {data,error}=await db.from("driver_payouts").select("id,amount_zar,reference,status,paystack_transfer_code,created_at,completed_at,failure_reason").eq("driver_id",actorId).order("created_at",{ascending:false}).limit(50);
  if(error)return reply(500,{error:"payout_history_failed"});return reply(200,{payouts:data||[]});
 }
 let body:Record<string,unknown>={};try{body=await req.json()}catch{return reply(400,{error:"invalid_json"})}
 const send=async(driverId:string,amountCents:number,periodStart?:string,periodEnd?:string)=>{
  if(!Number.isSafeInteger(amountCents)||amountCents<100||amountCents>100000000)return {error:"payout_amount_out_of_range"};
  const {data:profile,error:pe}=await db.from("driver_profiles").select("paystack_recipient_code,verification_status,can_go_online").eq("user_id",driverId).maybeSingle();
  if(pe||!profile?.paystack_recipient_code||profile.verification_status!=="approved"||profile.can_go_online!==true)return {error:"driver_or_paystack_recipient_not_eligible"};
  const reference=ref();
  const {data:reserved,error:re}=await db.rpc("reserve_paystack_driver_payout",{p_driver_id:driverId,p_amount_cents:amountCents,p_reference:reference});
  if(re||!reserved)return {error:"payout_reservation_failed"};
  const response=await fetch("https://api.paystack.co/transfer",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({source:"balance",amount:amountCents,recipient:profile.paystack_recipient_code,reference,currency:"ZAR",reason:"SwiftHaul SA driver earnings"}),signal:AbortSignal.timeout(15000)});
  const payload=await response.json().catch(()=>null);
  if(!response.ok||payload?.status!==true||!payload?.data){await db.rpc("apply_paystack_payout_event",{p_reference:reference,p_status:"failed",p_transfer_code:null,p_failure_reason:String(payload?.message||"Paystack transfer initiation failed")});return {error:"paystack_transfer_start_failed",reference};}
  const status=payload.data.status==="success"?"success":payload.data.status==="failed"?"failed":"processing";
  await db.from("driver_payouts").update({status,paystack_transfer_code:payload.data.transfer_code||null,updated_at:new Date().toISOString(),completed_at:status==="success"?new Date().toISOString():null}).eq("reference",reference);
  if(status==="failed")await db.rpc("apply_paystack_payout_event",{p_reference:reference,p_status:"failed",p_transfer_code:payload.data.transfer_code||null,p_failure_reason:"Paystack returned failed"});
  return {reference,amount_cents:amountCents,status,transfer_code:payload.data.transfer_code||null,period_start:periodStart||null,period_end:periodEnd||null};
 };
 if(role==="cron"||(role==="admin"&&body.action==="weekly_batch")){
  if(role==="admin"&&body.action==="weekly_batch"&&!actorId)return reply(403,{error:"admin_required"});
  const {data:drivers,error}=await db.from("driver_profiles").select("user_id").eq("verification_status","approved").eq("can_go_online",true).not("paystack_recipient_code","is",null).limit(500);
  if(error)return reply(500,{error:"weekly_driver_list_failed"});
  const today=new Date(),end=today.toISOString().slice(0,10),start=new Date(today.getTime()-7*86400000).toISOString().slice(0,10),results=[];
  for(const d of drivers||[]){const {data:ledger,error:le}=await db.from("driver_earnings_ledger").select("amount_cents").eq("driver_user_id",d.user_id);if(le)continue;const balance=(ledger||[]).reduce((n,x)=>n+Number(x.amount_cents),0);if(balance<100)continue;const result=await send(d.user_id,balance,start,end);results.push({driver_id:d.user_id,...result});}
  return reply(200,{processed:results.length,results});
 }
 if(role==="driver"){
  if(body.action!=="withdraw"||typeof body.amount_cents!=="number")return reply(400,{error:"invalid_withdrawal_request"});
  const result=await send(actorId!,body.amount_cents);return reply(result.error?409:201,result);
 }
 return reply(403,{error:"payout_action_not_allowed"});
});