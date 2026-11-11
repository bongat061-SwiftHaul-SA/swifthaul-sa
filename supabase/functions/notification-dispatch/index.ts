import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { adminClient, formatSAPhoneNumber, sendQueued, type NotificationEvent, type RecipientType } from "./shared.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
const events = ["order_dispatched","delivery_otp","document_expiry","payout_success","document_rejected"];
const clean = (v: unknown, max = 200) => typeof v === "string" ? v.trim().slice(0,max) : "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply(405,{error:"method_not_allowed"});
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500,{error:"server_configuration_error"});
  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401,{error:"missing_bearer_token"});
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return reply(400,{error:"invalid_json"}); }
  const db = adminClient();
  const isInternal = token === service;
  let userId = "";
  if (!isInternal) {
    const auth = createClient(url, anon, { auth: { persistSession:false, autoRefreshToken:false } });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) return reply(401,{error:"invalid_or_expired_session"});
    userId = data.user.id;
    const { data: profile, error: profileError } = await db.from("user_profiles").select("role,account_status").eq("id",userId).maybeSingle();
    if (profileError || !profile || profile.account_status !== "active" || !["admin","company_admin"].includes(profile.role)) {
      return reply(403,{error:"company_admin_required"});
    }
  }

  if (body.action === "list") {
    const status = clean(body.status,30);
    let query = db.from("notification_logs").select("id,recipient_phone,recipient_type,channel,event_type,payload_json,provider_message_id,status,fallback_triggered,provider,last_error,attempt_count,created_at,sent_at,delivered_at,read_at,failed_at").order("created_at",{ascending:false}).limit(100);
    if (["queued","sent","delivered","read","failed"].includes(status)) query = query.eq("status",status);
    const { data, error } = await query;
    if (error) return reply(500,{error:"notification_logs_unavailable"});
    return reply(200,{success:true,notifications:data || []});
  }

  if (body.action === "process_queue") {
    const {data:queued,error}=await db.from("notification_logs").select("*").eq("status","queued").lte("next_attempt_at",new Date().toISOString()).order("created_at",{ascending:true}).limit(25);
    if(error)return reply(500,{error:"notification_queue_lookup_failed"});
    for(const row of queued||[])await sendQueued(db,row);
    return reply(200,{success:true,processed:(queued||[]).length});
  }

  if (body.action === "retry") {
    if (isInternal) return reply(403,{error:"admin_session_required"});
    const id = clean(body.id,80);
    const { data: old, error } = await db.from("notification_logs").select("*").eq("id",id).maybeSingle();
    if (error || !old) return reply(404,{error:"notification_not_found"});
    if (old.status !== "failed") return reply(409,{error:"only_failed_notifications_can_be_resent"});
    const { data: created, error: insertError } = await db.from("notification_logs").insert({
      recipient_phone:old.recipient_phone,recipient_type:old.recipient_type,channel:"whatsapp",
      event_type:old.event_type,payload_json:old.payload_json,status:"queued"
    }).select("*").single();
    if (insertError || !created) return reply(500,{error:"notification_retry_queue_failed"});
    await sendQueued(db,created);
    const { data: result } = await db.from("notification_logs").select("id,status,channel,fallback_triggered,last_error").eq("id",created.id).single();
    return reply(200,{success:true,notification:result});
  }

  if (body.action === "send") {
    if (!isInternal) return reply(403,{error:"trusted_backend_call_required"});
    const event = clean(body.event_type,40) as NotificationEvent;
    const recipientType = clean(body.recipient_type,20) as RecipientType;
    if (!events.includes(event)) return reply(400,{error:"invalid_notification_event"});
    if (!(event==="order_dispatched" && Array.isArray(body.recipients)) && !["sender","recipient","driver"].includes(recipientType)) return reply(400,{error:"invalid_notification_event"});
    if (event === "delivery_otp" && recipientType !== "recipient") return reply(400,{error:"delivery_otp_must_target_recipient"});
    const payload = body.payload_json && typeof body.payload_json === "object" && !Array.isArray(body.payload_json) ? body.payload_json : {};
    if(event==="order_dispatched"&&Array.isArray(body.recipients)){
      const recipients=body.recipients.filter((r:any)=>r&&["sender","recipient"].includes(r.recipient_type));
      if(recipients.length!==2||!recipients.some((r:any)=>r.recipient_type==="sender")||!recipients.some((r:any)=>r.recipient_type==="recipient"))return reply(400,{error:"sender_and_recipient_required"});
      const results=[];
      for(const recipient of recipients){
        let phone:string;try{phone=formatSAPhoneNumber(clean(recipient.recipient_phone,40));}catch{return reply(400,{error:"invalid_sa_phone_number"});}
        const {data:row,error}=await db.from("notification_logs").insert({recipient_phone:phone,recipient_type:recipient.recipient_type,channel:"whatsapp",event_type:event,payload_json:payload,status:"queued"}).select("*").single();
        if(error||!row)return reply(500,{error:"notification_queue_failed"});
        await sendQueued(db,row);
        const {data:result}=await db.from("notification_logs").select("id,status,channel,fallback_triggered,last_error").eq("id",row.id).single();
        results.push(result);
      }
      return reply(200,{success:true,notifications:results});
    }
    let phone: string;
    try { phone = formatSAPhoneNumber(clean(body.recipient_phone,40)); } catch { return reply(400,{error:"invalid_sa_phone_number"}); }
    if (event === "delivery_otp" && !/^\d{4}$/.test(String(payload.otp || ""))) return reply(400,{error:"valid_four_digit_otp_required"});
    const { data: row, error } = await db.from("notification_logs").insert({
      recipient_phone:phone,recipient_type:recipientType,channel:"whatsapp",event_type:event,payload_json:payload,status:"queued"
    }).select("*").single();
    if (error || !row) return reply(500,{error:"notification_queue_failed"});
    await sendQueued(db,row);
    const { data: result } = await db.from("notification_logs").select("id,status,channel,fallback_triggered,last_error").eq("id",row.id).single();
    return reply(200,{success:true,notification:result});
  }

  return reply(400,{error:"unknown_action"});
});
