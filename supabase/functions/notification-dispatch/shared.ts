import { createClient } from "npm:@supabase/supabase-js@2.49.1";

export type NotificationEvent = "order_dispatched" | "delivery_otp" | "document_expiry" | "payout_success" | "document_rejected" | "sos_alert";
export type RecipientType = "sender" | "recipient" | "driver";

export function formatSAPhoneNumber(input: string): string {
  const raw = String(input ?? "").trim();
  const compact = raw.replace(/[\s().-]/g, "");
  let digits = compact.replace(/^\+/, "");
  if (digits.startsWith("0027")) digits = digits.slice(2);
  if (digits.startsWith("27")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[6-8][0-9]{8}$/.test(digits)) throw new Error("invalid_sa_phone_number");
  return "+27" + digits;
}

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("server_configuration_error");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function sendWhatsApp(phone: string, event: NotificationEvent, payload: Record<string, unknown>) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const template = Deno.env.get("WHATSAPP_TEMPLATE_" + event.toUpperCase());
  if (!token || !phoneId || !template) throw new Error("whatsapp_template_or_credentials_not_configured");
  const values = Object.values(payload).filter(v => typeof v === "string" || typeof v === "number").map(v => ({ type: "text", text: String(v).slice(0, 1024) }));
  const response = await fetch("https://graph.facebook.com/v22.0/" + phoneId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone.replace("+", ""),
      type: "template",
      template: { name: template, language: { code: Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") || "en_ZA" }, components: values.length ? [{ type: "body", parameters: values }] : [] }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("whatsapp_provider_" + response.status + ":" + String(body?.error?.code || body?.error?.message || "send_failed").slice(0, 160));
  return { id: body?.messages?.[0]?.id as string | undefined, provider: "whatsapp_cloud" };
}

async function sendSms(phone: string, text: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_SMS_FROM");
  if (!sid || !token || !from) throw new Error("sms_fallback_provider_not_configured");
  const callback = Deno.env.get("TWILIO_STATUS_CALLBACK_URL");
  const form = new URLSearchParams({ To: phone, From: from, Body: text.slice(0, 1500), ...(callback ? { StatusCallback: callback } : {}) });
  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(sid + ":" + token), "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("sms_provider_" + response.status + ":" + String(body?.message || "send_failed").slice(0, 160));
  return { id: body?.sid as string | undefined, provider: "twilio_sms" };
}

export function plainTextFor(event: NotificationEvent, payload: Record<string, unknown>) {
  const p = (key: string) => String(payload[key] ?? "");
  switch (event) {
    case "order_dispatched": return "SwiftHaul: Your delivery is dispatched. Driver " + p("driver_first_name") + ", vehicle " + p("vehicle_registration") + ". Track: " + p("tracking_url");
    case "delivery_otp": return "SwiftHaul delivery OTP: " + p("otp") + ". Share this code only with your driver when your parcel is delivered.";
    case "document_expiry": return "SwiftHaul driver alert: " + p("document_name") + " " + p("expiry_message") + ". Please update your document in the Driver app.";
    case "document_rejected": return "SwiftHaul: Your " + p("document_name") + " was not approved. Reason: " + p("rejection_reason") + ". Please upload a replacement in the Driver app.";
    case "payout_success": return "SwiftHaul payout completed: R" + p("amount_zar") + " has been transferred to your verified bank account. Reference: " + p("reference");
    case "sos_alert": return "URGENT SwiftHaul SOS (" + p("recipient_type") + "). " + p("alert_text") + " Incident: " + p("incident_id") + ". Vehicle: " + p("vehicle_plate") + ". Order: " + p("order_id");
  }
}

export async function fallbackToSms(db: ReturnType<typeof adminClient>, row: Record<string, any>, reason: string) {
  if (row.fallback_triggered || row.channel !== "whatsapp") return;
  try {
    const sent = await sendSms(row.recipient_phone, plainTextFor(row.event_type, row.payload_json || {}));
    await db.from("notification_logs").update({
      channel: "sms", provider: sent.provider, provider_message_id: sent.id || null,
      status: "sent", fallback_triggered: true, attempt_count: (row.attempt_count || 0) + 1,
      last_error: reason.slice(0, 500), sent_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", row.id);
  } catch (error) {
    await db.from("notification_logs").update({
      status: "failed", fallback_triggered: true, attempt_count: (row.attempt_count || 0) + 1,
      last_error: (reason + "; " + String(error)).slice(0, 500), failed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", row.id);
  }
}

export async function sendQueued(db: ReturnType<typeof adminClient>, row: Record<string, any>) {
  try {
    const sent = await sendWhatsApp(row.recipient_phone, row.event_type, row.payload_json || {});
    await db.from("notification_logs").update({
      provider: sent.provider, provider_message_id: sent.id || null, status: "sent",
      attempt_count: (row.attempt_count || 0) + 1, sent_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", row.id);
  } catch (error) {
    await fallbackToSms(db, row, String(error));
  }
}
