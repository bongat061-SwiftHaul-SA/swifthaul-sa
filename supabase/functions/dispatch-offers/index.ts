import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods":"GET, POST, OPTIONS", "Content-Type":"application/json" };
const reply = (status:number, body:Record<string,unknown>) => new Response(JSON.stringify(body),{status,headers});
const distance = (a:number,b:number,c:number,d:number) => { const r=Math.PI/180, x=(c-a)*r,y=(d-b)*r; const q=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2; return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q)); };

Deno.serve(async req => {
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  if(!["GET","POST"].includes(req.method)) return reply(405,{error:"method_not_allowed"});
  const token=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token) return reply(401,{error:"missing_bearer_token"});
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) return reply(500,{error:"server_configuration_error"});
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:u,error:ae}=await auth.auth.getUser(token);
  if(ae||!u.user) return reply(401,{error:"invalid_or_expired_session"});
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const actor=u.user.id;
  const {data:p,error:pe}=await db.from("user_profiles").select("role,account_status").eq("id",actor).maybeSingle();
  if(pe) return reply(500,{error:"profile_lookup_failed"});
  if(!p||p.account_status!=="active") return reply(403,{error:"account_not_active"});
  const driver=p.role==="driver", dispatcher=["admin","dispatcher"].includes(p.role);
  if(!driver&&!dispatcher) return reply(403,{error:"dispatch_access_required"});

  if(req.method==="GET") {
    if(!driver) return reply(403,{error:"driver_account_required"});
    const {data:profile}=await db.from("driver_profiles").select("is_online,online_updated_at,verification_status,allow_stacked_orders,vehicle_type").eq("user_id",actor).maybeSingle();
    const {data:offers,error}=await db.from("driver_delivery_offers").select("id,waybill,priority_tier,distance_meters,offered_at,expires_at,status,customer_bookings(pickup,dropoff,vehicle,price,pickup_latitude,pickup_longitude,dropoff_latitude,dropoff_longitude,pickup_plus_code,dropoff_plus_code)").eq("driver_user_id",actor).eq("status","offered").gt("expires_at",new Date().toISOString()).order("offered_at",{ascending:false});
    if(error) return reply(500,{error:"offer_list_failed"});
    const {data:stops}=await db.from("driver_route_stops").select("lat,lng,sequence_order").eq("driver_id",actor).neq("status","completed").order("sequence_order");
    const distanceKm=(a:any,b:any)=>{const r=Math.PI/180,dl=(b.lat-a.lat)*r,dg=(b.lng-a.lng)*r,x=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dg/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};
    const route=(stops??[]).filter((x:any)=>x.lat!=null&&x.lng!=null).map((x:any)=>({lat:Number(x.lat),lng:Number(x.lng)}));
    const routeLength=(points:any[])=>points.slice(1).reduce((sum:any,p:any,i:number)=>sum+distanceKm(points[i],p),0);
    const baseline=routeLength(route);
    const enriched=(offers??[]).map((offer:any)=>{
      const b=offer.customer_bookings||{},pickup={lat:Number(b.pickup_latitude),lng:Number(b.pickup_longitude)},dropoff={lat:Number(b.dropoff_latitude),lng:Number(b.dropoff_longitude)};
      let detour:number|null=null;
      if(route.length&&Number.isFinite(pickup.lat)&&Number.isFinite(pickup.lng)&&Number.isFinite(dropoff.lat)&&Number.isFinite(dropoff.lng)){
        const appended=[...route,pickup,dropoff];
        const added=routeLength(appended)-baseline;
        detour=Number.isFinite(added)?Math.max(0,Number(added.toFixed(2))):null;
      }
      return {...offer,add_on_order:offer.priority_tier==="add_on",net_payout_zar:Number((Number(b.price||0)*0.75).toFixed(2)),extra_detour_km:detour};
    });
    return reply(200,{driver:profile,offers:enriched,active_stop_count:route.length});
  }

  let body:Record<string,unknown>;
  try { body=await req.json(); } catch { return reply(400,{error:"invalid_json"}); }
  if(body.action==="set_stacked_orders") {
    if(!driver||typeof body.enabled!=="boolean")return reply(400,{error:"invalid_stacked_order_preference"});
    const {error}=await db.from("driver_profiles").update({allow_stacked_orders:body.enabled}).eq("user_id",actor);
    if(error)return reply(500,{error:"stacked_order_preference_update_failed"});
    return reply(200,{allow_stacked_orders:body.enabled});
  }
  if(body.action==="set_online") {
    if(!driver||typeof body.online!=="boolean") return reply(400,{error:"invalid_online_preference"});
    const {data:profile}=await db.from("driver_profiles").select("verification_status").eq("user_id",actor).maybeSingle();
    if(!profile||profile.verification_status!=="approved") return reply(403,{error:"approved_driver_required"});
    const {error}=await db.from("driver_profiles").update({is_online:body.online,online_updated_at:new Date().toISOString()}).eq("user_id",actor);
    if(error) return reply(500,{error:"online_status_update_failed"});
    return reply(200,{is_online:body.online});
  }
  if(body.action==="respond_offer") {
    if(!driver||typeof body.offer_id!=="string"||!["accept","decline"].includes(String(body.response))) return reply(400,{error:"invalid_offer_response"});
    const {data:offer,error}=await db.from("driver_delivery_offers").select("id,waybill,status,expires_at").eq("id",body.offer_id).eq("driver_user_id",actor).maybeSingle();
    if(error||!offer) return reply(404,{error:"offer_not_found"});
    if(offer.status!=="offered"||new Date(offer.expires_at).getTime()<=Date.now()) return reply(409,{error:"offer_expired_or_closed"});
    if(body.response==="decline") {
      await db.from("driver_delivery_offers").update({status:"declined",responded_at:new Date().toISOString()}).eq("id",offer.id).eq("status","offered");
      return reply(200,{declined:true});
    }
    const {data:accepted,error:acceptError}=await db.rpc("accept_driver_delivery_offer",{p_driver_user_id:actor,p_waybill:offer.waybill,p_offer_id:offer.id});
    if(acceptError||!accepted?.accepted) return reply(409,{error:acceptError?.message||"delivery_already_assigned"});
    await db.from("delivery_status_events").insert({waybill:offer.waybill,actor_user_id:actor,previous_status:"pending",new_status:"assigned",notes:"Accepted driver dispatch offer"});
    return reply(200,{accepted:true,waybill:offer.waybill});
  }
  if(body.action==="next_offer") {
    if(!dispatcher||typeof body.waybill!=="string") return reply(403,{error:"dispatcher_access_required"});
    const {data:booking,error:be}=await db.from("customer_bookings").select("waybill,status,driver_user_id,refunded_at,vehicle,price,pickup_latitude,pickup_longitude,dropoff_latitude,dropoff_longitude").eq("waybill",body.waybill).maybeSingle();
    if(be||!booking) return reply(404,{error:"delivery_not_found"});
    if(booking.status!=="pending"||booking.driver_user_id||booking.refunded_at) return reply(409,{error:"delivery_not_open_for_offers"});
    const now=new Date().toISOString();
    await db.from("driver_delivery_offers").update({status:"expired"}).eq("waybill",booking.waybill).eq("status","offered").lte("expires_at",now);
    const {data:sent}=await db.from("driver_delivery_offers").select("driver_user_id,status").eq("waybill",booking.waybill);
    if((sent??[]).some(x=>x.status==="accepted")) return reply(409,{error:"delivery_offer_already_accepted"});
    const excluded=new Set((sent??[]).map(x=>x.driver_user_id));
    const {data:drivers,error:de}=await db.from("driver_profiles").select("user_id,vehicle_type,is_online,verification_status,allow_stacked_orders").eq("is_online",true).eq("verification_status","approved");
    if(de) return reply(500,{error:"driver_candidate_lookup_failed"});
    const vehicleType=(value:string)=>{const v=value.toLowerCase();if(v.includes("motor"))return "motorbike";if(v.includes("bakkie")||v.includes("van")||v.includes("panel"))return "bakkie/panel van";if(v.includes("truck")||v.includes("ton"))return "truck";return "hatchback/sedan";};
    const {data:classes}=await db.from("vehicle_classes").select("vehicle_type,max_concurrent_orders");
    const capacity=new Map((classes??[]).map((v:any)=>[v.vehicle_type,Number(v.max_concurrent_orders)]));
    const allDriverIds=(drivers??[]).map(d=>d.user_id);
    const {data:activeOrders,error:activeError}=await db.from("customer_bookings").select("waybill,driver_user_id,pickup_latitude,pickup_longitude,dropoff_latitude,dropoff_longitude").in("driver_user_id",allDriverIds).in("status",["assigned","accepted","picked_up","in_transit"]).is("completed_at",null);
    if(activeError)return reply(500,{error:"active_order_count_failed"});
    const activeByDriver=new Map<string,any[]>();
    for(const order of activeOrders??[]){const key=order.driver_user_id;activeByDriver.set(key,[...(activeByDriver.get(key)||[]),order]);}
    const {data:routeStops}=await db.from("driver_route_stops").select("driver_id,lat,lng,status,sequence_order").in("driver_id",allDriverIds).neq("status","completed").order("sequence_order");
    const stopsByDriver=new Map<string,any[]>();
    for(const stop of routeStops??[]){stopsByDriver.set(stop.driver_id,[...(stopsByDriver.get(stop.driver_id)||[]),stop]);}
    const pointSegmentDistanceKm=(p:any,a:any,b:any)=>{const lat0=p.lat*Math.PI/180,scaleX=Math.cos(lat0)*111.32,scaleY=110.574;const x=(v:any)=>v.lng*scaleX,y=(v:any)=>v.lat*scaleY;const px=x(p),py=y(p),ax=x(a),ay=y(a),bx=x(b),by=y(b);const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));};
    const withinCorridor=(driverId:string)=>{const stops=(stopsByDriver.get(driverId)||[]).filter(x=>x.lat!=null&&x.lng!=null);if(stops.length<2)return false;const points=[{lat:Number(booking.pickup_latitude),lng:Number(booking.pickup_longitude)},{lat:Number(booking.dropoff_latitude),lng:Number(booking.dropoff_longitude)}];if(points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)))return false;return points.every(p=>stops.slice(0,-1).some((a,i)=>pointSegmentDistanceKm(p,a,stops[i+1])<=3));};
    const eligible=(drivers??[]).filter(d=>{
      if(excluded.has(d.user_id)||!d.is_online)return false;
      if(booking.vehicle&&vehicleType(String(d.vehicle_type||""))!==vehicleType(String(booking.vehicle)))return false;
      const count=(activeByDriver.get(d.user_id)||[]).length,cap=capacity.get(vehicleType(String(d.vehicle_type||"")))||1;
      if(count>=cap)return false;
      if(count>0&&(!d.allow_stacked_orders||!withinCorridor(d.user_id)))return false;
      return true;
    });
    if(!eligible.length) return reply(404,{error:"no_eligible_online_drivers"});
    const ids=eligible.map(d=>d.user_id);
    const {data:members,error:me}=await db.from("driver_memberships").select("driver_user_id").in("driver_user_id",ids).eq("status","active").lte("starts_at",now).gt("ends_at",now);
    if(me) return reply(500,{error:"membership_lookup_failed"});
    const premium=new Set((members??[]).map(m=>m.driver_user_id));
    const {data:history}=await db.from("driver_delivery_offers").select("driver_user_id,offered_at").in("driver_user_id",ids).order("offered_at",{ascending:false}).limit(500);
    const last=new Map<string,number>();
    for(const h of history??[]) if(!last.has(h.driver_user_id)) last.set(h.driver_user_id,new Date(h.offered_at).getTime());
    const ranked=eligible.map(d=>({d,premium:premium.has(d.user_id),meters:booking.pickup_latitude!=null&&booking.pickup_longitude!=null?Number.POSITIVE_INFINITY:undefined})).map(x=>{
      const candidate=(drivers??[]).find(d=>d.user_id===x.d.user_id)!;
      return {...x,rotation:last.get(candidate.user_id)??0};
    }).sort((a,b)=>Number(b.premium)-Number(a.premium)||a.rotation-b.rotation);
    const chosen=ranked[0];
    const expires=new Date(Date.now()+30_000).toISOString();
    const activeCount=(activeByDriver.get(chosen.d.user_id)||[]).length;
    const {data:offer,error:oe}=await db.from("driver_delivery_offers").insert({waybill:booking.waybill,driver_user_id:chosen.d.user_id,priority_tier:activeCount>0?"add_on":chosen.premium?"premium":"standard",expires_at:expires}).select("id,driver_user_id,priority_tier,expires_at").single();
    if(oe) return reply(500,{error:"offer_create_failed"});
    const payout=Number(booking.price||0)*0.75;
    return reply(200,{offer,add_on:activeCount>0,net_payout_zar:Number(payout.toFixed(2)),active_order_count:activeCount,capacity:capacity.get(vehicleType(String(chosen.d.vehicle_type||"")))||1,rotation:"least-recently-offered",priority:"active premium drivers before standard drivers"});
  }
  return reply(400,{error:"unknown_action"});
});
