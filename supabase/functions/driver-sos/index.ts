import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
const clean=(v:unknown,n=200)=>typeof v==="string"?v.trim().slice(0,n):"";
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return reply(401,{error:"missing_bearer_token"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:userData,error:authError}=await auth.auth.getUser(token);
 if(authError||!userData.user)return reply(401,{error:"invalid_or_expired_session"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const driverId=userData.user.id;
 const {data:profile,error:profileError}=await db.from("user_profiles").select("role,account_status").eq("id",driverId).maybeSingle();
 if(profileError||!profile||profile.role!=="driver"||profile.account_status!=="active")return reply(403,{error:"active_driver_account_required"});
 let body:Record<string,unknown>;try{body=await req.json();}catch{return reply(400,{error:"invalid_json"});}
 const lat=Number(body.lat),lng=Number(body.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180)return reply(400,{error:"valid_gps_coordinates_required"});
 const orderId=clean(body.order_id,100)||null;
 const {data:driver,error:driverError}=await db.from("driver_profiles").select("emergency_contact_name,emergency_contact_phone,vehicle_registration").eq("user_id",driverId).maybeSingle();
 if(driverError||!driver)return reply(404,{error:"driver_profile_not_found"});
 if(orderId){const {data:order,error}=await db.from("customer_bookings").select("waybill,status,driver_user_id").eq("waybill",orderId).eq("driver_user_id",driverId).maybeSingle();if(error||!order||!["assigned","accepted","picked_up","in_transit"].includes(order.status))return reply(403,{error:"order_not_assigned_to_driver"});}
 const {data:vehicle}=await db.from("fleet_vehicles").select("fleet_id,registration_plate").eq("assigned_driver_id",driverId).eq("is_active",true).maybeSingle();
 const fleetId=vehicle?.fleet_id||null,plate=vehicle?.registration_plate||driver.vehicle_registration||null;
 const {data:incident,error:insertError}=await db.from("sos_incidents").insert({driver_id:driverId,fleet_id:fleetId,order_id:orderId,lat,lng,vehicle_plate:plate,status:"active"}).select("id,triggered_at,status").single();
 if(insertError||!incident)return reply(500,{error:"sos_incident_create_failed"});
 const mapUrl="https://www.google.com/maps?q="+encodeURIComponent(lat+","+lng);
 const payload={incident_id:incident.id,driver_name:userData.user.user_metadata?.full_name||"SwiftHaul driver",vehicle_plate:plate||"Unknown",order_id:orderId||"Not linked",map_link:mapUrl,alert_text:"URGENT: SwiftHaul driver SOS activated. Location: "+mapUrl};
 const recipients:{phone:string;type:string}[]=[];
 if(driver.emergency_contact_phone)recipients.push({phone:driver.emergency_contact_phone,type:"emergency_contact"});
 if(fleetId){const {data:fleet}=await db.from("fleets").select("owner_user_id").eq("id",fleetId).maybeSingle();if(fleet?.owner_user_id){const {data:owner}=await db.from("user_profiles").select("phone").eq("id",fleet.owner_user_id).maybeSingle();if(owner?.phone)recipients.push({phone:owner.phone,type:"fleet_owner"});}}
 const opsPhone=Deno.env.get("SWIFTHAUL_SOS_OPERATIONS_PHONE");if(opsPhone)recipients.push({phone:opsPhone,type:"operations"});
 const unique=[...new Map(recipients.map(r=>[r.phone,r])).values()];
 const notifyResults=[];
 for(const recipient of unique){
  try{const n=await fetch(url+"/functions/v1/notification-dispatch",{method:"POST",headers:{Authorization:"Bearer "+service,apikey:anon,"Content-Type":"application/json"},body:JSON.stringify({action:"send",event_type:"sos_alert",recipient_type:"driver",recipient_phone:recipient.phone,payload_json:{...payload,recipient_type:recipient.type}})});
   const result=await n.json().catch(()=>({}));notifyResults.push({recipient_type:recipient.type,queued:n.ok,status:n.status,detail:n.ok?undefined:result.error});
  }catch{notifyResults.push({recipient_type:recipient.type,queued:false});}
 }
 try{await fetch(url+"/realtime/v1/api/broadcast/sos:"+incident.id+"/events/sos_triggered?private=true",{method:"POST",headers:{apikey:service,Authorization:"Bearer "+service,"Content-Type":"application/json"},body:JSON.stringify({incident_id:incident.id,lat,lng,vehicle_plate:plate,status:"active",triggered_at:incident.triggered_at})});}catch(e){console.error("SOS realtime broadcast failed",String(e));}
 return reply(201,{success:true,incident:{id:incident.id,status:incident.status,triggered_at:incident.triggered_at},notifications:notifyResults,emergency_services:{saps:"tel:10111",ambulance:"tel:10177"}});
});