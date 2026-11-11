import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(!["GET","POST"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),{data:userData,error:authError}=await auth.auth.getUser(token);
 if(authError||!userData.user)return reply(401,{error:"invalid_or_expired_session"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}}),actor=userData.user.id;
 const {data:profile}=await db.from("user_profiles").select("role,account_status").eq("id",actor).maybeSingle();
 if(!profile||profile.account_status!=="active")return reply(403,{error:"account_not_active"});
 const isAdmin=["admin","company_admin","dispatcher"].includes(profile.role);
 const {data:ownedFleets}=await db.from("fleets").select("id").eq("owner_user_id",actor).eq("is_active",true);
 const fleetIds=(ownedFleets||[]).map((f:any)=>f.id);
 if(!isAdmin&&!fleetIds.length)return reply(403,{error:"emergency_response_access_required"});
 if(req.method==="GET"){
  let query=db.from("sos_incidents").select("id,driver_id,fleet_id,order_id,lat,lng,vehicle_plate,status,triggered_at,resolved_by,resolution_notes").order("triggered_at",{ascending:false}).limit(100);
  if(!isAdmin)query=query.in("fleet_id",fleetIds);
  const {data,error}=await query;if(error)return reply(500,{error:"sos_incident_list_failed"});
  const ids=(data||[]).map((x:any)=>x.id);
  const {data:actions}=ids.length?await db.from("sos_incident_actions").select("id,incident_id,actor_user_id,action_type,notes,created_at").in("incident_id",ids).order("created_at",{ascending:true}):{data:[]};
  const driverIds=[...new Set((data||[]).map((x:any)=>x.driver_id))];
  const {data:drivers}=driverIds.length?await db.from("user_profiles").select("id,full_name,phone").in("id",driverIds):{data:[]};
  const driverMap=new Map((drivers||[]).map((d:any)=>[d.id,{name:d.full_name,phone:d.phone}]));
  return reply(200,{success:true,incidents:(data||[]).map((x:any)=>({...x,driver:driverMap.get(x.driver_id)||null,actions:(actions||[]).filter((a:any)=>a.incident_id===x.id)}))});
 }
 let body:any;try{body=await req.json();}catch{return reply(400,{error:"invalid_json"});}
 const incidentId=String(body.incident_id||"").slice(0,64),action=String(body.action||"");
 if(!incidentId||!["acknowledged","contacted_driver","contacted_emergency_contact","dispatched_assistance","note","resolve"].includes(action))return reply(400,{error:"invalid_incident_action"});
 let incidentQuery=db.from("sos_incidents").select("*").eq("id",incidentId);
 if(!isAdmin)incidentQuery=incidentQuery.in("fleet_id",fleetIds);
 const {data:incident,error:incidentError}=await incidentQuery.maybeSingle();
 if(incidentError||!incident)return reply(404,{error:"incident_not_found"});
 const notes=typeof body.notes==="string"?body.notes.trim().slice(0,2000):null;
 if(action==="resolve"){
  const {error}=await db.from("sos_incidents").update({status:"resolved",resolved_by:actor,resolution_notes:notes,resolved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",incidentId);
  if(error)return reply(500,{error:"incident_resolution_failed"});
  await db.from("sos_incident_actions").insert({incident_id:incidentId,actor_user_id:actor,action_type:"resolved",notes});
 }else{
  if(incident.status==="resolved")return reply(409,{error:"incident_already_resolved"});
  const next=incident.status==="active"?"responding":incident.status;
  await db.from("sos_incidents").update({status:next,updated_at:new Date().toISOString()}).eq("id",incidentId);
  const {error}=await db.from("sos_incident_actions").insert({incident_id:incidentId,actor_user_id:actor,action_type:action,notes});
  if(error)return reply(500,{error:"incident_action_log_failed"});
 }
 return reply(200,{success:true});
});