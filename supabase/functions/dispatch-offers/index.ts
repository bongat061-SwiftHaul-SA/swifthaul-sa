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
    const {data:profile}=await db.from("driver_profiles").select("is_online,online_updated_at,verification_status,onboarding_status,can_go_online").eq("user_id",actor).maybeSingle();
    const {data:offers,error}=await db.from("driver_delivery_offers").select("id,waybill,priority_tier,distance_meters,offered_at,expires_at,status,customer_bookings(pickup,dropoff,vehicle,price,distance_meters,pickup_plus_code,dropoff_plus_code)").eq("driver_user_id",actor).eq("status","offered").gt("expires_at",new Date().toISOString()).order("offered_at",{ascending:false});
    if(error) return reply(500,{error:"offer_list_failed"});
    return reply(200,{driver:profile,offers:(offers??[]).map((o:any)=>({...o,distance_meters:o.distance_meters??o.customer_bookings?.distance_meters??null,gross_zar:Number(o.customer_bookings?.price??0),net_payout_zar:Math.round(Number(o.customer_bookings?.price??0)*75)/100}))});
  }

  let body:Record<string,unknown>;
  try { body=await req.json(); } catch { return reply(400,{error:"invalid_json"}); }
  if(body.action==="set_online") {
    if(!driver||typeof body.online!=="boolean") return reply(400,{error:"invalid_online_preference"});
    if(body.online){
      const {data:eligible,error:eligibilityError}=await db.rpc("driver_can_accept_work",{p_driver_user_id:actor});
      if(eligibilityError||eligible!==true) return reply(403,{error:"driver_onboarding_documents_or_background_clearance_incomplete"});
    }
    const {error}=await db.from("driver_profiles").update({is_online:body.online,online_updated_at:new Date().toISOString(),availability_status:body.online?"available":"offline"}).eq("user_id",actor);
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
    const {data:eligible,error:eligibilityError}=await db.rpc("driver_can_accept_work",{p_driver_user_id:actor});
    if(eligibilityError||eligible!==true) return reply(403,{error:"driver_not_cleared_to_accept_trips"});
    const {data:booking,error:be}=await db.from("customer_bookings").select("waybill,status,driver_user_id,refunded_at").eq("waybill",offer.waybill).maybeSingle();
    if(be||!booking||booking.status!=="pending"||booking.driver_user_id||booking.refunded_at) return reply(409,{error:"delivery_no_longer_available"});
    const {data:updated,error:ue}=await db.from("customer_bookings").update({driver_user_id:actor,assigned_driver:actor,status:"assigned"}).eq("waybill",offer.waybill).eq("status","pending").is("driver_user_id",null).select("waybill").maybeSingle();
    if(ue||!updated) return reply(409,{error:"delivery_already_assigned"});
    await db.from("driver_delivery_offers").update({status:"accepted",responded_at:new Date().toISOString()}).eq("id",offer.id);
    await db.from("driver_delivery_offers").update({status:"cancelled",responded_at:new Date().toISOString()}).eq("waybill",offer.waybill).eq("status","offered").neq("id",offer.id);
    await db.from("delivery_status_events").insert({waybill:offer.waybill,actor_user_id:actor,previous_status:"pending",new_status:"assigned",notes:"Accepted driver dispatch offer"});
    return reply(200,{accepted:true,waybill:offer.waybill});
  }
  if(body.action==="next_offer") {
    if(!dispatcher||typeof body.waybill!=="string") return reply(403,{error:"dispatcher_access_required"});
    const {data:booking,error:be}=await db.from("customer_bookings").select("waybill,status,driver_user_id,refunded_at,vehicle,pickup_latitude,pickup_longitude").eq("waybill",body.waybill).maybeSingle();
    if(be||!booking) return reply(404,{error:"delivery_not_found"});
    if(booking.status!=="pending"||booking.driver_user_id||booking.refunded_at) return reply(409,{error:"delivery_not_open_for_offers"});
    const now=new Date().toISOString();
    await db.from("driver_delivery_offers").update({status:"expired"}).eq("waybill",booking.waybill).eq("status","offered").lte("expires_at",now);
    const {data:sent}=await db.from("driver_delivery_offers").select("driver_user_id,status").eq("waybill",booking.waybill);
    if((sent??[]).some(x=>x.status==="accepted")) return reply(409,{error:"delivery_offer_already_accepted"});
    const excluded=new Set((sent??[]).map(x=>x.driver_user_id));
    const {data:drivers,error:de}=await db.from("driver_profiles").select("user_id,vehicle_type,is_online,verification_status").eq("is_online",true).eq("verification_status","approved").eq("can_go_online",true);
    if(de) return reply(500,{error:"driver_candidate_lookup_failed"});
    const eligible=(drivers??[]).filter(d=>!excluded.has(d.user_id)&&(!booking.vehicle||String(d.vehicle_type).toLowerCase()===String(booking.vehicle).toLowerCase()));
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
    const {data:offer,error:oe}=await db.from("driver_delivery_offers").insert({waybill:booking.waybill,driver_user_id:chosen.d.user_id,priority_tier:chosen.premium?"premium":"standard",expires_at:expires}).select("id,driver_user_id,priority_tier,expires_at").single();
    if(oe) return reply(500,{error:"offer_create_failed"});
    return reply(200,{offer,rotation:"least-recently-offered",priority:"active premium drivers before standard drivers"});
  }
  return reply(400,{error:"unknown_action"});
});
