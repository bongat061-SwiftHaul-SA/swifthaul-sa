import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="GET")return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")??"").match(/^Bearer\\s+(.+)$/i)?.[1];
 if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),paystack=Deno.env.get("PAYSTACK_SECRET_KEY");
 if(!url||!anon||!secret)return reply(503,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:user,error:authError}=await auth.auth.getUser(token);
 if(authError||!user.user)return reply(401,{error:"invalid_session"});
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:profileError}=await db.from("user_profiles").select("role,account_status").eq("id",user.user.id).maybeSingle();
 if(profileError)return reply(503,{error:"profile_lookup_failed"});
 if(!profile||profile.role!=="admin"||profile.account_status!=="active")return reply(403,{error:"administrator_access_required"});
 if(!paystack)return reply(503,{error:"paystack_secret_not_configured"});
 try{const response=await fetch("https://api.paystack.co/balance",{headers:{Authorization:"Bearer "+paystack,Accept:"application/json"},signal:AbortSignal.timeout(12000)});const result=await response.json().catch(()=>null);if(!response.ok||result?.status!==true||!Array.isArray(result?.data)){console.error("Paystack balance lookup failed",response.status,result?.message);return reply(502,{error:"paystack_balance_unavailable"});}return reply(200,{balances:result.data.map((item:any)=>({currency:String(item.currency||""),balance:Number(item.balance||0)})),checked_at:new Date().toISOString()});}catch(error){console.error("Paystack balance request failed",String(error));return reply(502,{error:"paystack_balance_unavailable"});}
});
