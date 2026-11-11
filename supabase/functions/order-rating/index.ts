import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
const allowedTags=["On time","Friendly driver","Careful handling","Great communication","Damaged Parcel","Asked for Extra Cash","Late delivery","Poor communication","Parcel mishandled","Other"];
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(!["GET","POST"].includes(req.method))return reply(405,{error:"method_not_allowed"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 let body:any={};if(req.method==="POST"){try{body=await req.json();}catch{return reply(400,{error:"invalid_json"});}}
 const params=new URL(req.url).searchParams;
 const tracking=String(req.method==="GET"?params.get("tracking_code")||"":body.tracking_code||"").trim().slice(0,100);
 if(!tracking)return reply(400,{error:"tracking_code_required"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:order,error}=await db.from("customer_bookings").select("waybill,tracking_code,status,driver_user_id,completed_at").eq("tracking_code",tracking).maybeSingle();
 if(error||!order)return reply(404,{error:"tracking_code_invalid"});
 if(order.status!=="delivered")return reply(409,{error:"rating_available_after_delivery"});
 const {data:vehicle}=await db.from("fleet_vehicles").select("fleet_id").eq("assigned_driver_id",order.driver_user_id).eq("is_active",true).maybeSingle();
 if(req.method==="GET"){
  const {data:ratings,error:rError}=await db.from("delivery_ratings").select("rater_role,stars,tags,comment,created_at").eq("order_id",order.waybill);
  if(rError)return reply(500,{error:"rating_lookup_failed"});
  return reply(200,{success:true,ratings:ratings||[],can_rate_sender:!(ratings||[]).some(x=>x.rater_role==="sender"),can_rate_recipient:!(ratings||[]).some(x=>x.rater_role==="recipient")});
 }
 const role=String(body.rater_role||"recipient");
 if(!["sender","recipient"].includes(role))return reply(400,{error:"invalid_rater_role"});
 const stars=Number(body.stars);
 if(!Number.isInteger(stars)||stars<1||stars>5)return reply(400,{error:"stars_must_be_1_to_5"});
 const positiveTags=["On time","Friendly driver","Careful handling","Great communication"];
 const issueTags=["Damaged Parcel","Asked for Extra Cash","Late delivery","Poor communication","Parcel mishandled","Other"];
 const permitted=stars>=4?positiveTags:issueTags;
 const tags=Array.isArray(body.tags)?[...new Set(body.tags.filter((x:any)=>typeof x==="string"&&permitted.includes(x)))] : [];
 const comment=typeof body.comment==="string"?body.comment.trim().slice(0,1200):null;
 const {data:created,error:insertError}=await db.from("delivery_ratings").insert({order_id:order.waybill,driver_id:order.driver_user_id,fleet_id:vehicle?.fleet_id||null,rater_role:role,stars,tags,comment}).select("id,order_id,driver_id,rater_role,stars,tags,created_at").single();
 if(insertError?.code==="23505")return reply(409,{error:"rating_already_submitted_for_this_role"});
 if(insertError||!created)return reply(500,{error:"rating_save_failed"});
 const {data:score,error:scoreError}=await db.rpc("recalculate_driver_score",{p_driver_id:order.driver_user_id});
 if(scoreError)console.error("Driver score recalculation failed after rating insert",scoreError.message);
 return reply(201,{success:true,rating:created,performance:score||null,score_recalculation_pending:!!scoreError});
});