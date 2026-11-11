import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(s:number,b:Record<string,unknown>)=>new Response(JSON.stringify(b),{status:s,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="GET")return reply(405,{error:"method_not_allowed"});
 const token=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(401,{error:"missing_bearer_token"});
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return reply(500,{error:"server_configuration_error"});
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data:u,error:ae}=await auth.auth.getUser(token);if(ae||!u.user)return reply(401,{error:"invalid_session"});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:pe}=await db.from("user_profiles").select("role,account_status").eq("id",u.user.id).maybeSingle();
 if(pe||profile?.role!=="driver"||profile.account_status!=="active")return reply(403,{error:"active_driver_account_required"});
 const dateKey=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Johannesburg",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const dayStart=new Date(dateKey+"T00:00:00+02:00");const weekday=dayStart.getUTCDay();const weekStart=new Date(dayStart);weekStart.setUTCDate(weekStart.getUTCDate()-((weekday+6)%7));
 const todayStart=dayStart.toISOString(),weekStartIso=weekStart.toISOString();
 const [{data:trips,error:te},{data:ledger,error:le},{data:payouts,error:pe2}]=await Promise.all([
  db.from("customer_bookings").select("waybill,pickup,dropoff,price,completed_at,status").eq("driver_user_id",u.user.id).eq("status","delivered").gte("completed_at",weekStartIso).order("completed_at",{ascending:false}).limit(100),
  db.from("driver_earnings_ledger").select("amount_cents,event_type,created_at").eq("driver_user_id",u.user.id).gte("created_at",weekStartIso).limit(1000),
  db.from("driver_payout_requests").select("id,amount_cents,status,created_at,reviewed_at,paid_at,admin_reference").eq("driver_user_id",u.user.id).order("created_at",{ascending:false}).limit(10)
 ]);
 if(te||le||pe2)return reply(500,{error:"earnings_dashboard_unavailable"});
 const rows=(trips??[]).map((t:any)=>{const gross=Math.max(0,Math.round(Number(t.price||0)*100));const net=Math.round(gross*.75);return {waybill:t.waybill,pickup:t.pickup,dropoff:t.dropoff,completed_at:t.completed_at,gross_cents:gross,platform_fee_cents:gross-net,net_payout_cents:net};});
 const today=rows.filter(x=>x.completed_at&&x.completed_at>=todayStart).reduce((n,x)=>n+x.net_payout_cents,0);
 const weekly=rows.reduce((n,x)=>n+x.net_payout_cents,0);
 const ledgerAvailable=(ledger??[]).reduce((n:any,x:any)=>n+Number(x.amount_cents||0),0);
 return reply(200,{currency:"ZAR",today_net_cents:today,weekly_net_cents:weekly,ledger_week_movement_cents:ledgerAvailable,trips:rows,payouts:payouts??[],payout_status:payouts?.[0]?.status||"not_requested",payout_account_label:"Verified bank account on file"});
});