import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:cors});
const safeEndpoint=(value:unknown)=>{
  if(typeof value!=="string"||value.length>3000)return null;
  try{
    const u=new URL(value);
    if(u.protocol!=="https:")return null;
    const host=u.hostname.toLowerCase();
    const allowed=host==="fcm.googleapis.com"||host.endsWith(".fcm.googleapis.com")||
      host==="updates.push.services.mozilla.com"||host.endsWith(".push.apple.com")||
      host.endsWith(".notify.windows.com");
    return allowed?u.toString():null;
  }catch{return null;}
};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
  const token=(req.headers.get("Authorization")||"").match(/^Bearer\\s+(.+)$/i)?.[1];
  if(!token)return reply(401,{error:"missing_bearer_token"});
  let body:Record<string,any>;try{body=await req.json();}catch{return reply(400,{error:"invalid_json"});}
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const internal=token===service;
  if(body.action==="send"){
    if(!internal)return reply(403,{error:"trusted_backend_call_required"});
    const userId=String(body.user_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(userId))return reply(400,{error:"invalid_user_id"});
    const title=String(body.title||"SwiftHaul SA").slice(0,100);
    const message=String(body.body||"").slice(0,300);
    const target=typeof body.url==="string"&&body.url.startsWith("/")?body.url:"./";
    if(!message)return reply(400,{error:"notification_body_required"});
    const {data:config,error:configError}=await admin.rpc("get_swifthaul_vapid_config");
    if(configError||!config?.public_key||!config?.private_key)return reply(503,{error:"web_push_not_configured"});
    webpush.setVapidDetails("mailto:notifications@swifthaul-sa.co.za",config.public_key,config.private_key);
    const {data:subscriptions,error}=await admin.from("web_push_subscriptions")
      .select("id,endpoint,p256dh,auth").eq("user_id",userId);
    if(error)return reply(500,{error:"push_subscription_lookup_failed"});
    let sent=0,removed=0,failed=0;
    for(const sub of subscriptions||[]){
      try{
        await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
          JSON.stringify({title,body:message,url:target,tag:String(body.tag||"swifthaul-update").slice(0,80)}),{TTL:3600});
        sent++;
      }catch(error){
        const status=Number((error as any)?.statusCode||0);
        if(status===404||status===410){await admin.from("web_push_subscriptions").delete().eq("id",sub.id);removed++;}
        else{failed++;console.error("Web push delivery failed",status,String(error).slice(0,180));}
      }
    }
    return reply(200,{success:true,sent,removed,failed});
  }
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await auth.auth.getUser(token);
  if(authError||!authData.user)return reply(401,{error:"invalid_or_expired_session"});
  const userId=authData.user.id;
  const {data:config,error:configError}=await admin.rpc("get_swifthaul_vapid_config");
  if(configError||!config?.public_key)return reply(503,{error:"web_push_not_configured"});
  if(body.action==="public_key")return reply(200,{public_key:config.public_key});
  if(body.action==="subscribe"){
    const endpoint=safeEndpoint(body.subscription?.endpoint);
    const p256dh=String(body.subscription?.keys?.p256dh||"");
    const authKey=String(body.subscription?.keys?.auth||"");
    if(!endpoint||p256dh.length<20||p256dh.length>200||authKey.length<8||authKey.length>100)
      return reply(400,{error:"invalid_push_subscription"});
    const {error}=await admin.from("web_push_subscriptions").upsert({
      user_id:userId,endpoint,p256dh,auth:authKey,
      user_agent:String(req.headers.get("user-agent")||"").slice(0,500),
      updated_at:new Date().toISOString(),last_seen_at:new Date().toISOString()
    },{onConflict:"endpoint"});
    if(error)return reply(500,{error:"push_subscription_save_failed"});
    return reply(200,{success:true,subscribed:true});
  }
  if(body.action==="unsubscribe"){
    const endpoint=safeEndpoint(body.endpoint);
    if(!endpoint)return reply(400,{error:"invalid_push_endpoint"});
    const {error}=await admin.from("web_push_subscriptions").delete().eq("user_id",userId).eq("endpoint",endpoint);
    if(error)return reply(500,{error:"push_subscription_delete_failed"});
    return reply(200,{success:true,unsubscribed:true});
  }
  return reply(400,{error:"unknown_action"});
});
