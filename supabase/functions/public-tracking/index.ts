import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="GET")return reply(405,{error:"method_not_allowed"});
 const code=new URL(req.url).searchParams.get("code")||"";
 if(!/^[a-f0-9]{32}$/i.test(code))return reply(400,{error:"invalid_tracking_code"});
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!service)return reply(503,{error:"tracking_unavailable"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:b,error}=await db.from("customer_bookings").select("waybill,tracking_code,pickup,dropoff,vehicle,price,status,paid_at,driver_user_id,created_at,accepted_at,picked_up_at,in_transit_at,completed_at,refunded_at,pickup_latitude,pickup_longitude,dropoff_latitude,dropoff_longitude").eq("tracking_code",code).maybeSingle();
 if(error)return reply(503,{error:"tracking_lookup_failed"});
 if(!b||!b.paid_at||b.refunded_at)return reply(404,{error:"tracking_not_available"});
 const {data:events}=await db.from("delivery_status_events").select("new_status,created_at").eq("waybill",b.waybill).order("created_at",{ascending:true}).limit(30);
 let driver=null;
 if(b.driver_user_id){
  const [{data:u},{data:d}]=await Promise.all([
   db.from("user_profiles").select("full_name").eq("id",b.driver_user_id).maybeSingle(),
   db.from("driver_profiles").select("vehicle_make,vehicle_model,vehicle_registration").eq("user_id",b.driver_user_id).maybeSingle()
  ]);
  driver={first_name:String(u?.full_name||"Driver").trim().split(/\s+/)[0],vehicle_make:d?.vehicle_make||"",vehicle_model:d?.vehicle_model||"",number_plate:d?.vehicle_registration||""};
 }
 const {data:location}=await db.from("public_tracking_locations").select("latitude,longitude,updated_at").eq("tracking_code",code).maybeSingle();
 return reply(200,{tracking:{tracking_code:code,waybill:b.waybill,pickup:b.pickup,dropoff:b.dropoff,vehicle:b.vehicle,price_zar:Number(b.price),status:b.status,created_at:b.created_at,driver,location:location||null,pickup_pin:b.pickup_latitude==null?null:{latitude:b.pickup_latitude,longitude:b.pickup_longitude},dropoff_pin:b.dropoff_latitude==null?null:{latitude:b.dropoff_latitude,longitude:b.dropoff_longitude},timeline:(events||[]).map((e:any)=>({status:e.new_status,created_at:e.created_at}))}});
});