import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, fallbackToSms } from "../_shared/notifications.ts";

const headers = { "Content-Type":"application/json", "Cache-Control":"no-store" };
const reply = (status:number, body:Record<string,unknown>) => new Response(JSON.stringify(body),{status,headers});

async function verifySignature(raw:string, signature:string, secret:string) {
  if (!signature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw)));
  const expected = "sha256=" + [...digest].map(x=>x.toString(16).padStart(2,"0")).join("");
  if (expected.length !== signature.length) return false;
  let mismatch = 0; for(let i=0;i<expected.length;i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}

async function verifyTwilioSignature(url:string, params:URLSearchParams, signature:string, authToken:string) {
  const keys=[...new Set([...params.keys()])].sort();
  const data=url+keys.map(key=>key+params.get(key)).join("");
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(authToken),{name:"HMAC",hash:"SHA-1"},false,["sign"]);
  const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(data)));
  const expected=btoa(String.fromCharCode(...digest));
  if(expected.length!==signature.length)return false;
  let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^signature.charCodeAt(i);
  return mismatch===0;
}

Deno.serve(async(req:Request) => {
  const verifyToken = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") || "";
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("hub.mode") === "subscribe" && verifyToken && u.searchParams.get("hub.verify_token") === verifyToken) {
      return new Response(u.searchParams.get("hub.challenge") || "",{status:200,headers:{"Content-Type":"text/plain"}});
    }
    return new Response("forbidden",{status:403});
  }
  if (req.method !== "POST") return reply(405,{error:"method_not_allowed"});
  const contentType=req.headers.get("content-type")||"";
  if(contentType.includes("application/x-www-form-urlencoded")) {
    const rawForm=await req.text();const params=new URLSearchParams(rawForm);
    const callbackUrl=Deno.env.get("TWILIO_STATUS_CALLBACK_URL")||"";
    const authToken=Deno.env.get("TWILIO_AUTH_TOKEN")||"";
    const signature=req.headers.get("x-twilio-signature")||"";
    if(!callbackUrl||!authToken||!signature)return reply(503,{error:"twilio_receipt_verification_not_configured"});
    const actual=new URL(req.url),expectedUrl=new URL(callbackUrl);
    if(actual.origin+actual.pathname!==expectedUrl.origin+expectedUrl.pathname||!await verifyTwilioSignature(callbackUrl,params,signature,authToken))return reply(401,{error:"invalid_twilio_signature"});
    const sid=params.get("MessageSid")||"",state=params.get("MessageStatus")||"";
    const mapped=state==="delivered"?"delivered":state==="read"?"read":(["failed","undelivered"].includes(state)?"failed":(["queued","accepted","sending","sent"].includes(state)?"sent":null));
    if(!sid||!mapped)return reply(200,{success:true,ignored:true});
    const db=adminClient();const now=new Date().toISOString();
    const patch:any={status:mapped,updated_at:now};
    if(mapped==="delivered"||mapped==="read")patch.delivered_at=now;
    if(mapped==="read")patch.read_at=now;
    if(mapped==="failed"){patch.failed_at=now;patch.last_error=(params.get("ErrorMessage")||state).slice(0,500);}
    const {error}=await db.from("notification_logs").update(patch).eq("provider_message_id",sid);
    if(error)return reply(500,{error:"twilio_receipt_update_failed"});
    return reply(200,{success:true});
  }
  const secret = Deno.env.get("WHATSAPP_APP_SECRET") || "";
  if (!secret) return reply(503,{error:"webhook_secret_not_configured"});
  const raw = await req.text();
  if (!await verifySignature(raw,req.headers.get("x-hub-signature-256") || "",secret)) return reply(401,{error:"invalid_signature"});
  let body:any; try { body=JSON.parse(raw); } catch { return reply(400,{error:"invalid_json"}); }
  const db=adminClient();
  let updated=0, fallbacks=0;
  for (const entry of body.entry || []) for (const change of entry.changes || []) for (const status of change.value?.statuses || []) {
    const providerId=String(status.id || "");
    if (!providerId) continue;
    const state=String(status.status || "");
    const mapped=state==="delivered"?"delivered":state==="read"?"read":state==="failed"?"failed":state==="sent"?"sent":null;
    if (!mapped) continue;
    const {data:row}=await db.from("notification_logs").select("*").eq("provider_message_id",providerId).maybeSingle();
    if (!row) continue;
    const now=new Date().toISOString();
    const patch:any={status:mapped,updated_at:now};
    if(mapped==="delivered" || mapped==="read") patch.delivered_at=row.delivered_at || now;
    if(mapped==="read") patch.read_at=now;
    if(mapped==="failed") { patch.failed_at=now; patch.last_error=JSON.stringify(status.errors || []).slice(0,500); }
    await db.from("notification_logs").update(patch).eq("id",row.id);
    updated++;
    if(mapped==="failed" && row.channel==="whatsapp" && !row.fallback_triggered) {
      await fallbackToSms(db,{...row,status:"failed"},patch.last_error || "whatsapp_delivery_failed");
      fallbacks++;
    }
  }
  return reply(200,{success:true,updated,fallbacks});
});
