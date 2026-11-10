import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import CryptoJS from "npm:crypto-js@4.2.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const SANDBOX_PROCESS_URL = "https://sandbox.payfast.co.za/eng/process";
const PROJECT_URL = Deno.env.get("SUPABASE_URL") || "https://tagkbropgzthsbjlhyvz.supabase.co";
const SITE_URL = Deno.env.get("SWIFTHAUL_CUSTOMER_URL") || "https://bongat061-swifthaul-sa.github.io/swifthaul-sa-preview/public/customer.html";
function urlencode(value: string) {
  return encodeURIComponent(value.trim()).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%[0-9a-f]{2}/gi, m => m.toUpperCase()).replace(/%20/g, "+");
}
function signature(fields: Record<string,string>, passphrase: string) {
  const body = Object.entries(fields).filter(([,v]) => v !== "").map(([k,v]) => k + "=" + urlencode(v)).join("&");
  return CryptoJS.MD5(body + "&passphrase=" + urlencode(passphrase)).toString();
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const user = authData.user;
  const { data: profile } = await admin.from("user_profiles").select("role,account_status").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "customer" || profile.account_status !== "active") return reply(403, { error: "active_customer_account_required" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  if (body.action !== "checkout" || typeof body.waybill !== "string" || body.waybill.length > 100)
    return reply(400, { error: "invalid_payment_request" });

  const { data: booking, error: bookingError } = await admin.from("customer_bookings")
    .select("waybill,owner_hash,price,payment_method,paid_at,refunded_at,status,counter_offer_status")
    .eq("waybill", body.waybill).eq("owner_hash", user.id).maybeSingle();
  if (bookingError || !booking) return reply(404, { error: "booking_not_found" });
  if (booking.payment_method !== "card") return reply(409, { error: "booking_not_set_to_card_payment" });
  if (booking.paid_at || booking.refunded_at || ["cancelled","completed"].includes(booking.status))
    return reply(409, { error: "booking_not_payable" });
  if (booking.counter_offer_status === "pending")
    return reply(409, { error: "counter_offer_pending_dispatch_decision" });
  const { data: deletion } = await admin.from("customer_deletions").select("owner_hash").eq("owner_hash", user.id).maybeSingle();
  if (deletion) return reply(403, { error: "profile_deletion_pending" });
  const amount = Number(booking.price);
  if (!Number.isFinite(amount) || amount < 5 || amount > 1000000)
    return reply(422, { error: "payfast_sandbox_requires_a_valid_amount_of_at_least_R5" });

  const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID") || "10000100";
  const merchantKey = Deno.env.get("PAYFAST_MERCHANT_KEY") || "46f0cd694581a";
  const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") || "jt7NOE43FZPn";
  if (!/^\d{1,8}$/.test(merchantId) || !merchantKey || !passphrase)
    return reply(503, { error: "payfast_sandbox_credentials_not_configured" });

  let payment = null;
  const { data: pending } = await admin.from("payment_transactions")
    .select("id,amount").eq("owner_id", user.id).eq("booking_waybill", booking.waybill)
    .eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pending && Number(pending.amount) === amount) payment = pending;
  else if (pending) {
    await admin.from("payment_transactions").update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", pending.id).eq("status", "pending");
  }
  if (!payment) {
    const id = crypto.randomUUID();
    const { data: created, error } = await admin.from("payment_transactions").insert({
      id, owner_id: user.id, booking_waybill: booking.waybill,
      m_payment_id: "SH-PF-" + id, amount, provider: "payfast", payment_mode: "sandbox", status: "pending",
    }).select("id,amount").single();
    if (error || !created) {
      const { data: raced } = await admin.from("payment_transactions")
        .select("id,amount").eq("owner_id", user.id).eq("booking_waybill", booking.waybill)
        .eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!raced || Number(raced.amount) !== amount) return reply(503, { error: "payment_initialization_failed" });
      payment = raced;
    } else payment = created;
  }

  const paymentId = String(payment.id);
  const fields: Record<string,string> = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: SITE_URL + "?payment=return&payment_id=" + encodeURIComponent(paymentId),
    cancel_url: SITE_URL + "?payment=cancel&payment_id=" + encodeURIComponent(paymentId),
    notify_url: PROJECT_URL + "/functions/v1/payfast-itn",
    email_address: user.email || "",
    m_payment_id: "SH-PF-" + paymentId,
    amount: amount.toFixed(2),
    item_name: "SwiftHaul delivery " + booking.waybill,
    item_description: "Delivery booking " + booking.waybill,
  };
  fields.signature = signature(fields, passphrase);
  return reply(200, { provider: "payfast", mode: "sandbox", process_url: SANDBOX_PROCESS_URL, fields, payment_id: paymentId });
});
