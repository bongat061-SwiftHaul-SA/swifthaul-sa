import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status:number, body:Record<string,unknown>) =>
  new Response(JSON.stringify(body), {status, headers});
const clean = (v:unknown, max:number) => String(v ?? "").trim().slice(0,max);
const validEmail = (v:string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

Deno.serve(async (req:Request) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers});
  if (!["GET","POST"].includes(req.method)) return reply(405,{error:"method_not_allowed"});
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401,{error:"missing_bearer_token"});
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) return reply(500,{error:"server_configuration_error"});
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await auth.auth.getUser(token);
  if(authError||!authData.user) return reply(401,{error:"invalid_or_expired_session"});
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:admin,error:adminError}=await db.from("user_profiles").select("role,account_status").eq("id",authData.user.id).maybeSingle();
  if(adminError) return reply(500,{error:"administrator_check_failed"});
  if(!admin||admin.role!=="admin"||admin.account_status!=="active") return reply(403,{error:"administrator_access_required"});

  try {
    if(req.method==="GET"){
      const [profiles,metrics,updates]=await Promise.all([
        db.from("investor_profiles").select("id,user_id,display_name,shares_owned,ownership_percentage,investment_amount_zar,share_class,status,created_at,updated_at").order("created_at",{ascending:false}),
        db.from("investor_company_metrics").select("*").order("display_order").order("created_at",{ascending:false}),
        db.from("investor_updates").select("*").order("created_at",{ascending:false})
      ]);
      if(profiles.error||metrics.error||updates.error) throw new Error("investor_data_read_failed");
      return reply(200,{profiles:profiles.data,metrics:metrics.data,updates:updates.data});
    }
    const body=await req.json().catch(()=>null);
    if(!body||typeof body!=="object") return reply(400,{error:"invalid_json"});
    const action=clean(body.action,40);
    if(action==="invite"){
      const email=clean(body.email,254).toLowerCase(), name=clean(body.display_name,160);
      if(!validEmail(email)||name.length<2) return reply(400,{error:"valid_email_and_name_required"});
      const {data,error}=await auth.auth.admin.inviteUserByEmail(email,{data:{app_type:"investor",full_name:name}});
      if(error||!data.user) return reply(400,{error:error?.message||"invitation_failed"});
      const {error:insertError}=await db.from("investor_profiles").upsert({user_id:data.user.id,display_name:name,shares_owned:0,ownership_percentage:0,investment_amount_zar:0,status:"active"},{onConflict:"user_id"});
      if(insertError) return reply(500,{error:"investor_profile_create_failed"});
      return reply(201,{ok:true,invited:true});
    }
    if(action==="save_profile"){
      const userId=clean(body.user_id,64), name=clean(body.display_name,160), shares=Number(body.shares_owned), ownership=Number(body.ownership_percentage), amount=Number(body.investment_amount_zar), status=clean(body.status,16), shareClass=clean(body.share_class,80);
      if(!userId||name.length<2||![shares,ownership,amount].every(Number.isFinite)||shares<0||ownership<0||ownership>100||amount<0||!["active","suspended","closed"].includes(status)) return reply(400,{error:"invalid_investor_profile"});
      const {error}=await db.from("investor_profiles").update({display_name:name,shares_owned:shares,ownership_percentage:ownership,investment_amount_zar:amount,share_class:shareClass||null,status,updated_at:new Date().toISOString()}).eq("user_id",userId);
      if(error) return reply(500,{error:"investor_profile_save_failed"});
      return reply(200,{ok:true});
    }
    if(action==="save_metric"){
      const key=clean(body.metric_key,80), label=clean(body.metric_label,100), value=Number(body.metric_value), format=clean(body.value_format,16), period=clean(body.period_label,80), order=Number(body.display_order)||100;
      if(!key||!label||!Number.isFinite(value)||!["number","currency","percent"].includes(format)) return reply(400,{error:"invalid_metric"});
      const row={metric_key:key,metric_label:label,metric_value:value,value_format:format,period_label:period||null,display_order:order,is_published:false,published_at:null};
      const {error}=await db.from("investor_company_metrics").insert(row);
      if(error) return reply(500,{error:"metric_save_failed"});
      return reply(201,{ok:true,draft:true});
    }
    if(action==="publish_metric"||action==="hide_metric"){
      const id=clean(body.id,64); if(!id) return reply(400,{error:"metric_id_required"});
      const published=action==="publish_metric";
      const {error}=await db.from("investor_company_metrics").update({is_published:published,published_at:published?new Date().toISOString():null}).eq("id",id);
      if(error) return reply(500,{error:"metric_publish_failed"});
      return reply(200,{ok:true});
    }
    if(action==="save_update"){
      const title=clean(body.title,180), content=clean(body.body,12000), category=clean(body.category,24);
      if(title.length<3||!content||!["company","financial","operations","shareholder","notice"].includes(category)) return reply(400,{error:"invalid_update"});
      const {error}=await db.from("investor_updates").insert({title,body:content,category,is_published:false,published_at:null});
      if(error) return reply(500,{error:"update_save_failed"});
      return reply(201,{ok:true,draft:true});
    }
    if(action==="publish_update"||action==="hide_update"){
      const id=clean(body.id,64); if(!id) return reply(400,{error:"update_id_required"});
      const published=action==="publish_update";
      const {error}=await db.from("investor_updates").update({is_published:published,published_at:published?new Date().toISOString():null}).eq("id",id);
      if(error) return reply(500,{error:"update_publish_failed"});
      return reply(200,{ok:true});
    }
    return reply(400,{error:"unknown_action"});
  } catch(error) {
    console.error("Investor admin operation failed",error instanceof Error?error.message:error);
    return reply(503,{error:"investor_admin_unavailable"});
  }
});