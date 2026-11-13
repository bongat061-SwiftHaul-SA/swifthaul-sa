import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return reply(500,{error:"server_configuration_error"});
 const length=Number(req.headers.get("content-length")||0);if(length>12000)return reply(413,{error:"request_too_large"});
 let body:Record<string,unknown>;try{body=await req.json();}catch{return reply(400,{error:"invalid_json"});}
 if(typeof body.website==="string"&&body.website.trim())return reply(200,{ok:true});
 const fullName=String(body.full_name||"").trim(),email=String(body.email||"").trim().toLowerCase(),phone=String(body.phone||"").trim(),track=String(body.track||""),range=String(body.indicative_range_zar||"").trim(),message=String(body.message||"").trim();
 if(fullName.length<2||fullName.length>120||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||phone.length<7||phone.length>32||!["crowdfunding","fleet_asset","angel_seed"].includes(track)||message.length>1500||body.popia_consented!==true)return reply(400,{error:"Please check the required fields and consent."});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await db.from("investor_inquiries").insert({full_name:fullName,email,phone,track,indicative_range_zar:range||null,message:message||null,popia_consented:true});
 if(error){console.error("Investor EOI insert failed",error);return reply(500,{error:"We could not save your enquiry right now."});}
 return reply(201,{ok:true});
});