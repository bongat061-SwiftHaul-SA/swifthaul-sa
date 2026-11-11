import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(!["GET","POST"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const bearer=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||"";
 let actorId:string|null=null,role="recipient";
 if(bearer){const {data,error}=await auth.auth.getUser(bearer);if(!error&&data.user){actorId=data.user.id;const {data:p}=await db.from("user_profiles").select("role,account_status").eq("id",actorId).maybeSingle();if(!p||p.account_status!=="active")return reply(403,{error:"account_not_active"});role=p.role;}}
 let body:Record<string,unknown>={};if(req.method==="POST"){try{body=await req.json();}catch{return reply(400,{error:"invalid_json"});}}
 const requestedWaybill=String(req.method==="GET"?new URL(req.url).searchParams.get("order_id")||"":body.order_id||"").trim().slice(0,100);
 const tracking=String(req.method==="GET"?new URL(req.url).searchParams.get("tracking_code")||"":body.tracking_code||"").trim().slice(0,100);
 if(!tracking)return reply(400,{error:"tracking_code_required"});
 let bookingQuery=db.from("customer_bookings").select("waybill,tracking_code,driver_user_id,status,completed_at,cancelled_at,pickup,dropoff,vehicle,created_at").eq("tracking_code",tracking);
 if(requestedWaybill)bookingQuery=bookingQuery.eq("waybill",requestedWaybill);
 const {data:booking,error:bookingError}=await bookingQuery.maybeSingle();
 if(bookingError||!booking)return reply(404,{error:"tracking_credentials_invalid"});
 const waybill=String(booking.waybill);
 if(actorId&&role==="driver"&&booking.driver_user_id!==actorId)return reply(403,{error:"not_assigned_to_order"});
 if(actorId&&!["driver","customer","admin","company_admin","dispatcher"].includes(role))return reply(403,{error:"chat_access_required"});
 const senderRole=role==="driver"?"driver":["admin","company_admin","dispatcher"].includes(role)?"admin":actorId?"customer":"recipient";
 const terminalAt=booking.status==="delivered"?booking.completed_at:booking.status==="cancelled"?booking.cancelled_at:null;
 const archiveAt=terminalAt?new Date(new Date(terminalAt).getTime()+15*60*1000):null;
 const readOnly=!!archiveAt&&Date.now()>=archiveAt.getTime();
 if(req.method==="GET"||body.action==="list"){
  const {data,error}=await db.from("order_messages").select("id,order_id,sender_role,sender_id,message_text,attachment_url,is_read,created_at").eq("order_id",waybill).order("created_at",{ascending:true}).limit(100);
  if(error)return reply(500,{error:"chat_history_unavailable"});
  if(actorId){await db.from("order_messages").update({is_read:true}).eq("order_id",waybill).neq("sender_id",actorId).eq("is_read",false)};
  return reply(200,{success:true,order:{waybill,status:booking.status,pickup:booking.pickup,dropoff:booking.dropoff,vehicle:booking.vehicle},messages:data||[],read_only:readOnly,archive_at:archiveAt?.toISOString()||null,server_time:new Date().toISOString()});
 }
 if(readOnly)return reply(423,{error:"chat_archived",archive_at:archiveAt?.toISOString()||null});
 const message=typeof body.message_text==="string"?body.message_text.trim():"";
 if(!message||message.length>2000)return reply(400,{error:"message_text_required_max_2000"});
 const since=new Date(Date.now()-60000).toISOString();
 const {count:recentCount,error:rateError}=await db.from("order_messages").select("id",{count:"exact",head:true}).eq("order_id",waybill).eq("sender_role",senderRole).gte("created_at",since);
 if(rateError)return reply(500,{error:"chat_rate_check_failed"});
 if((recentCount||0)>=10)return reply(429,{error:"chat_rate_limit_exceeded"});
 const {data:created,error}=await db.from("order_messages").insert({order_id:waybill,sender_role:senderRole,sender_id:actorId,message_text:message}).select("id,order_id,sender_role,sender_id,message_text,is_read,created_at").single();
 if(error||!created)return reply(500,{error:"chat_message_send_failed"});
 try{await fetch(url+"/realtime/v1/api/broadcast/order:"+waybill+"/events/new_message?private=true",{method:"POST",headers:{apikey:service,Authorization:"Bearer "+service,"Content-Type":"application/json"},body:JSON.stringify({id:created.id,order_id:waybill,sender_role:senderRole,message_text:message,created_at:created.created_at})});}catch(e){console.error("chat realtime broadcast failed",String(e));}
 return reply(201,{success:true,message:created,read_only:false});
});