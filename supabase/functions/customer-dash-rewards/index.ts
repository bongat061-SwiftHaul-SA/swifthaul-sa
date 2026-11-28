import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(!["GET","POST"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return reply(401,{error:"sign_in_required"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(token);
 if(authError||!user)return reply(401,{error:"session_invalid"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:profileError}=await db.from("user_profiles").select("role,account_status,full_name").eq("id",user.id).maybeSingle();
 if(profileError)return reply(500,{error:"account_check_failed"});
 if(!profile||profile.account_status!=="active"||!["customer","admin"].includes(profile.role))return reply(403,{error:"active_customer_account_required"});
 const admin=profile.role==="admin";
 const pending=async()=>{
  const {data:rows,error}=await db.from("customer_dash_rounds").select("id,user_id,score,cycle_number,started_at,submitted_at,status").eq("status","submitted").order("submitted_at",{ascending:true}).limit(200);
  if(error)throw error;
  return await Promise.all((rows??[]).map(async row=>{
   const [{data:customer},{data:authUser}]=await Promise.all([
    db.from("user_profiles").select("full_name").eq("id",row.user_id).maybeSingle(),
    db.auth.admin.getUserById(row.user_id)
   ]);
   return {...row,customer_name:customer?.full_name||authUser?.user?.email||"Customer",customer_email:authUser?.user?.email||""};
  }));
 };
 try{
  if(req.method==="GET"){
   if(admin)return reply(403,{error:"customer_account_required"});
   const {data:summary,error:summaryError}=await db.from("customer_dash_rewards").select("lifetime_points,cycle_points,cycle_number,best_score,available_points,points_spent,updated_at").eq("user_id",user.id).maybeSingle();
   if(summaryError)throw summaryError;
   const {data:cashouts,error:cashoutError}=await db.from("customer_dash_cashouts").select("id,points_snapshot,amount_cents,status,requested_at,reviewed_at,admin_note").eq("user_id",user.id).order("requested_at",{ascending:false}).limit(10);
   if(cashoutError)throw cashoutError;
   const {data:milestones,error:milestoneError}=await db.from("customer_dash_milestones").select("id,cycle_number,milestone_points,reward_cents,status,voucher_code,voucher_applied_booking_waybill,voucher_applied_at,created_at,reviewed_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(30);
   if(milestoneError)throw milestoneError;
   return reply(200,{summary:summary??{lifetime_points:0,cycle_points:0,cycle_number:1,best_score:0,available_points:0,points_spent:0},milestones:milestones??[],cashouts:cashouts??[]});
  }
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=="object")return reply(400,{error:"invalid_json"});
  const action=String(body.action??"");
  if(action==="list_pending"){
   if(!admin)return reply(403,{error:"administrator_access_required"});
   return reply(200,{pending:await pending()});
  }
  if(action==="start_round"){
   if(admin)return reply(403,{error:"customer_account_required"});
   await db.from("customer_dash_rounds").update({status:"expired"}).eq("user_id",user.id).eq("status","started");
   const {data:round,error}=await db.from("customer_dash_rounds").insert({user_id:user.id,expires_at:new Date(Date.now()+3*60*1000).toISOString()}).select("id,started_at,expires_at").single();
   if(error)throw error;
   return reply(201,{round_id:round.id,started_at:round.started_at,expires_at:round.expires_at});
  }
  if(action==="submit_round"){
   if(admin)return reply(403,{error:"customer_account_required"});
   const roundId=String(body.round_id??""),score=Number(body.score);
   if(!/^[0-9a-f-]{36}$/i.test(roundId)||!Number.isInteger(score)||score<0||score>460)return reply(400,{error:"invalid_round_score"});
   const {data,error}=await db.rpc("customer_dash_submit_round",{p_user_id:user.id,p_round_id:roundId,p_score:score});
   if(error)return reply(400,{error:"round_not_eligible_or_already_submitted"});
   return reply(200,{ok:true,summary:data});
  }
  if(action==="redeem_coupon"){
   if(admin)return reply(403,{error:"customer_account_required"});
   const id=String(body.milestone_id??"");
   if(!/^[0-9a-f-]{36}$/i.test(id))return reply(400,{error:"invalid_milestone"});
   const {data,error}=await db.rpc("customer_dash_redeem_coupon",{p_user_id:user.id,p_milestone_id:id});
   if(error)return reply(400,{error:"coupon_not_redeemable_or_insufficient_points"});
   return reply(200,{ok:true,result:data});
  }
  if(action==="request_cashout"){
   if(admin)return reply(403,{error:"customer_account_required"});
   const {data,error}=await db.rpc("customer_dash_request_cashout",{p_user_id:user.id});
   if(error)return reply(400,{error:"cashout_threshold_not_met_or_request_pending"});
   return reply(201,{ok:true,result:data});
  }
  if(action==="review_round"){
   if(!admin)return reply(403,{error:"administrator_access_required"});
   const id=String(body.round_id??""),decision=String(body.decision??""),note=String(body.note??"").slice(0,500);
   if(!/^[0-9a-f-]{36}$/i.test(id)||!["approve","reject"].includes(decision))return reply(400,{error:"invalid_round_review"});
   const {data,error}=await db.rpc("customer_dash_review_round",{p_round_id:id,p_admin_id:user.id,p_decision:decision,p_note:note});
   if(error)return reply(400,{error:"round_review_failed"});
   return reply(200,{ok:true,result:data});
  }
  if(action==="list_admin_notifications"){
   if(!admin)return reply(403,{error:"administrator_access_required"});
   const {data,error}=await db.from("customer_dash_admin_notifications").select("id,notification_type,title,message,customer_user_id,related_id,created_at,read_at,resolved_at").is("resolved_at",null).order("created_at",{ascending:false}).limit(100);
   if(error)throw error;
   const enriched=await Promise.all((data??[]).map(async row=>{
    const [{data:customer},{data:authUser}]=await Promise.all([
     db.from("user_profiles").select("full_name").eq("id",row.customer_user_id).maybeSingle(),
     db.auth.admin.getUserById(row.customer_user_id)
    ]);
    return {...row,customer_name:customer?.full_name||authUser?.user?.email||"Customer",customer_email:authUser?.user?.email||""};
   }));
   return reply(200,{notifications:enriched});
  }
  if(action==="mark_admin_notification_read"){
   if(!admin)return reply(403,{error:"administrator_access_required"});
   const id=String(body.notification_id??"");
   if(!/^[0-9a-f-]{36}$/i.test(id))return reply(400,{error:"invalid_notification"});
   const {error}=await db.from("customer_dash_admin_notifications").update({read_at:new Date().toISOString()}).eq("id",id).is("resolved_at",null);
   if(error)throw error;
   return reply(200,{ok:true});
  }
  if(action==="list_cashouts"){
   if(!admin)return reply(403,{error:"administrator_access_required"});
   const {data,error}=await db.from("customer_dash_cashouts").select("id,user_id,points_snapshot,amount_cents,status,requested_at").eq("status","pending").order("requested_at",{ascending:true}).limit(200);
   if(error)throw error;
   const enriched=await Promise.all((data??[]).map(async row=>{
    const [{data:customer},{data:authUser}]=await Promise.all([
     db.from("user_profiles").select("full_name").eq("id",row.user_id).maybeSingle(),
     db.auth.admin.getUserById(row.user_id)
    ]);
    return {...row,customer_name:customer?.full_name||authUser?.user?.email||"Customer",customer_email:authUser?.user?.email||""};
   }));
   return reply(200,{pending_cashouts:enriched});
  }
  if(action==="review_cashout"){
   if(!admin)return reply(403,{error:"administrator_access_required"});
   const id=String(body.cashout_id??""),decision=String(body.decision??""),reference=String(body.payout_reference??"").slice(0,120),note=String(body.note??"").slice(0,500);
   if(!/^[0-9a-f-]{36}$/i.test(id)||!["paid","reject"].includes(decision))return reply(400,{error:"invalid_cashout_review"});
   const {data,error}=await db.rpc("customer_dash_review_cashout",{p_cashout_id:id,p_admin_id:user.id,p_decision:decision,p_payout_reference:reference,p_note:note});
   if(error)return reply(400,{error:"cashout_review_failed"});
   await db.from("customer_dash_admin_notifications").update({resolved_at:new Date().toISOString()}).eq("related_id",id).eq("notification_type","cashout_request").is("resolved_at",null);
   return reply(200,{ok:true,result:data});
  }
  return reply(400,{error:"unknown_action"});
 }catch(error){console.error("customer dash rewards error",error instanceof Error?error.message:String(error));return reply(503,{error:"rewards_service_unavailable"});}
});