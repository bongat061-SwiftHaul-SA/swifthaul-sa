import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
type StopInput={waybill:string;stop_type:"pickup"|"dropoff"};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(!["GET","POST"].includes(req.method))return reply(405,{error:"method_not_allowed"});
  const token=(req.headers.get("Authorization")??"").match(/^Bearer\\s+(.+)$/i)?.[1];
  if(!token)return reply(401,{error:"missing_bearer_token"});
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:user,error:authError}=await auth.auth.getUser(token);
  if(authError||!user.user)return reply(401,{error:"invalid_or_expired_session"});
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const actor=user.user.id;
  const {data:profile,error:profileError}=await db.from("user_profiles").select("role,account_status").eq("id",actor).maybeSingle();
  if(profileError)return reply(500,{error:"profile_lookup_failed"});
  if(!profile||profile.account_status!=="active")return reply(403,{error:"account_not_active"});
  const driver=profile.role==="driver",dispatcher=["admin","dispatcher"].includes(profile.role);
  if(!driver&&!dispatcher)return reply(403,{error:"dispatch_access_required"});

  if(req.method==="GET"){
    let query=db.from("dispatch_routes").select("id,driver_user_id,status,route_distance_meters,estimated_duration_seconds,routing_provider,route_calculated_at,created_at,started_at,completed_at").order("created_at",{ascending:false}).limit(50);
    if(driver)query=query.eq("driver_user_id",actor).in("status",["assigned","in_progress"]);
    const {data:routes,error}=await query;
    if(error)return reply(500,{error:"route_list_failed"});
    const ids=(routes??[]).map(r=>r.id);
    const {data:stops,error:stopError}=ids.length?await db.from("dispatch_route_stops").select("id,route_id,waybill,sequence_no,stop_type,status,completed_at,customer_bookings(pickup,dropoff,recipient,vehicle,status,pickup_latitude,pickup_longitude,dropoff_latitude,dropoff_longitude)").in("route_id",ids).order("sequence_no",{ascending:true}):{data:[],error:null};
    if(stopError)return reply(500,{error:"route_stops_lookup_failed"});
    const grouped=new Map<string,Record<string,unknown>[]>();
    for(const stop of stops??[]){const key=String(stop.route_id);grouped.set(key,[...(grouped.get(key)??[]),stop as Record<string,unknown>]);}
    return reply(200,{routes:(routes??[]).map(route=>({...route,stops:grouped.get(String(route.id))??[]}))});
  }

  const raw=await req.text();if(raw.length>12000)return reply(413,{error:"request_too_large"});
  let body:Record<string,unknown>;try{body=JSON.parse(raw);}catch{return reply(400,{error:"invalid_json"});}

  if(body.action==="create_route"){
    if(!dispatcher)return reply(403,{error:"dispatcher_access_required"});
    if(typeof body.driver_user_id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.driver_user_id)||!Array.isArray(body.stops)||body.stops.length<2||body.stops.length>30)return reply(400,{error:"provide_driver_and_two_to_thirty_stops"});
    const stops=body.stops as StopInput[];
    if(stops.some(s=>!s||typeof s.waybill!=="string"||s.waybill.length>100||!["pickup","dropoff"].includes(s.stop_type)))return reply(400,{error:"invalid_route_stop"});
    const unique=[...new Set(stops.map(s=>s.waybill))];
    if(stops.length!==unique.length*2)return reply(400,{error:"each_delivery_requires_one_pickup_and_one_dropoff"});
    for(const waybill of unique){const pickup=stops.findIndex(s=>s.waybill===waybill&&s.stop_type==="pickup"),dropoff=stops.findIndex(s=>s.waybill===waybill&&s.stop_type==="dropoff");if(pickup<0||dropoff<=pickup)return reply(400,{error:"each_pickup_must_precede_its_dropoff"});}
    const {data:driverProfile,error:driverError}=await db.from("driver_profiles").select("user_id,verification_status").eq("user_id",body.driver_user_id).maybeSingle();
    const {data:driverAccount}=await db.from("user_profiles").select("account_status").eq("id",body.driver_user_id).maybeSingle();
    if(driverError)return reply(500,{error:"driver_lookup_failed"});
    if(!driverProfile||driverProfile.verification_status!=="approved"||driverAccount?.account_status!=="active")return reply(409,{error:"approved_active_driver_required"});
    const {data:bookings,error:bookingError}=await db.from("customer_bookings").select("waybill,status,driver_user_id,refunded_at").in("waybill",unique);
    if(bookingError)return reply(500,{error:"booking_lookup_failed"});
    if((bookings??[]).length!==unique.length||bookings!.some(b=>b.status!=="pending"||b.driver_user_id||b.refunded_at))return reply(409,{error:"all_route_deliveries_must_be_unassigned_pending_bookings"});
    const {data:route,error:routeError}=await db.from("dispatch_routes").insert({driver_user_id:body.driver_user_id,created_by:actor,status:"assigned"}).select("id").single();
    if(routeError||!route)return reply(500,{error:"route_create_failed"});
    const rows=stops.map((s,i)=>({route_id:route.id,waybill:s.waybill,sequence_no:i+1,stop_type:s.stop_type}));
    const {error:stopsError}=await db.from("dispatch_route_stops").insert(rows);
    if(stopsError){await db.from("dispatch_routes").delete().eq("id",route.id);return reply(500,{error:"route_stops_create_failed"});}
    const assigned:string[]=[];
    for(const waybill of unique){
      const {data:updated,error:updateError}=await db.from("customer_bookings").update({driver_user_id:body.driver_user_id,assigned_driver:body.driver_user_id,status:"assigned"}).eq("waybill",waybill).eq("status","pending").is("driver_user_id",null).select("waybill").maybeSingle();
      if(updateError||!updated){
        for(const prior of assigned)await db.from("customer_bookings").update({driver_user_id:null,assigned_driver:null,status:"pending"}).eq("waybill",prior).eq("driver_user_id",body.driver_user_id).eq("status","assigned");
        await db.from("dispatch_routes").delete().eq("id",route.id);
        return reply(409,{error:"route_assignment_conflict_retry_dispatch"});
      }
      assigned.push(waybill);
      await db.from("delivery_status_events").insert({waybill,actor_user_id:actor,previous_status:"pending",new_status:"assigned",notes:"Assigned in multi-stop route "+route.id});
    }
    return reply(201,{route_id:route.id,assigned_waybills:assigned,stop_count:rows.length});
  }

  if(body.action==="reorder_route"){
    if(!dispatcher||typeof body.route_id!=="string"||!Array.isArray(body.stop_ids))return reply(403,{error:"dispatcher_route_reorder_required"});
    const {data:route}=await db.from("dispatch_routes").select("id,status").eq("id",body.route_id).maybeSingle();
    if(!route||!["assigned"].includes(route.status))return reply(404,{error:"editable_route_not_found"});
    const {data:existing,error}=await db.from("dispatch_route_stops").select("id").eq("route_id",route.id).order("sequence_no");
    if(error)return reply(500,{error:"route_stops_lookup_failed"});
    const ids=(existing??[]).map(x=>x.id);
    if(body.stop_ids.length!==ids.length||new Set(body.stop_ids).size!==ids.length||body.stop_ids.some((id:string)=>!ids.includes(id)))return reply(400,{error:"reorder_must_include_every_route_stop_once"});
    const {error:shiftError}=await db.from("dispatch_route_stops").update({sequence_no:31}).eq("route_id",route.id);
    if(shiftError)return reply(500,{error:"route_reorder_prepare_failed"});
    for(let i=0;i<body.stop_ids.length;i++){const {error:updateError}=await db.from("dispatch_route_stops").update({sequence_no:i+1}).eq("id",body.stop_ids[i]).eq("route_id",route.id);if(updateError)return reply(500,{error:"route_reorder_failed"});}
    return reply(200,{reordered:true});
  }

  if(body.action==="start_route"){
    if(!driver||typeof body.route_id!=="string")return reply(403,{error:"assigned_driver_required"});
    const {data:route,error}=await db.from("dispatch_routes").update({status:"in_progress",started_at:new Date().toISOString()}).eq("id",body.route_id).eq("driver_user_id",actor).eq("status","assigned").select("id").maybeSingle();
    if(error||!route)return reply(409,{error:"route_not_available_to_start"});
    return reply(200,{started:true});
  }

  if(body.action==="sync_waybill"){
    if(!driver||typeof body.waybill!=="string")return reply(403,{error:"assigned_driver_required"});
    const {data:booking,error}=await db.from("customer_bookings").select("status,driver_user_id").eq("waybill",body.waybill).maybeSingle();
    if(error||!booking||booking.driver_user_id!==actor)return reply(404,{error:"delivery_not_found"});
    const completedTypes=booking.status==="delivered"?["pickup","dropoff"]:["picked_up","in_transit"].includes(booking.status)?["pickup"]:[];
    if(!completedTypes.length)return reply(200,{updated:0});
    const {data:stops,error:stopError}=await db.from("dispatch_route_stops").select("id,route_id,stop_type").eq("waybill",body.waybill).in("stop_type",completedTypes).eq("status","pending");
    if(stopError)return reply(500,{error:"route_stop_sync_failed"});
    for(const stop of stops??[])await db.from("dispatch_route_stops").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",stop.id).eq("status","pending");
    const routeIds=[...new Set((stops??[]).map(s=>s.route_id))];
    for(const routeId of routeIds){const {count}=await db.from("dispatch_route_stops").select("id",{count:"exact",head:true}).eq("route_id",routeId).neq("status","completed");if(count===0)await db.from("dispatch_routes").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",routeId);}
    return reply(200,{updated:(stops??[]).length});
  }

  return reply(400,{error:"unknown_route_action"});
});
