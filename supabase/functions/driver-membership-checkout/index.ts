import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import CryptoJS from "npm:crypto-js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
const SANDBOX_PROCESS_URL = "https://sandbox.payfast.co.za/eng/process";
const PROJECT_URL = Deno.env.get("SUPABASE_URL") || "https://jikstpnvsdjhcibtjilp.supabase.co";
const DRIVER_URL = Deno.env.get("DRIVER_APP_URL") || "https://bongat061-swifthaul-sa.github.io/swifthaul-sa-preview/driver.html";
function urlencode(value: string) {
  return encodeURIComponent(value.trim()).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%[0-9a-f]{2}/gi, m => m.toUpperCase()).replace(/%20/g, "+");
}
function signature(fields: Record<string, string>, passphrase: string) {
  const body = Object.entries(fields).filter(([, value]) => value !== "")
    .map(([key, value]) => key + "=" + urlencode(value)).join("&");
  return CryptoJS.MD5(body + "&passphrase=" + urlencode(passphrase)).toString();
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await db.from("user_profiles")
    .select("role,account_status").eq("id", authData.user.id).maybeSingle();
  if (profileError) return reply(500, { error: "profile_lookup_failed" });
  if (!profile || profile.role !== "driver" || profile.account_status !== "active")
    return reply(403, { error: "active_driver_account_required" });
  const { data: driver, error: driverError } = await db.from("driver_profiles")
    .select("verification_status").eq("user_id", authData.user.id).maybeSingle();
  if (driverError) return reply(500, { error: "driver_profile_lookup_failed" });
  if (!driver || driver.verification_status !== "approved") return reply(403, { error: "approved_driver_required" });

  let body: Record<string, unknown>;
  try { const raw = await req.text(); if (raw.length > 2048) return reply(413, { error: "request_too_large" }); body = JSON.parse(raw); }
  catch { return reply(400, { error: "invalid_json" }); }
  if (body.plan !== "monthly" && body.plan !== "yearly") return reply(400, { error: "invalid_membership_plan" });
  const plan = body.plan;
  const amount = plan === "monthly" ? 25000 : 180000;
  const now = new Date().toISOString();
  const { error: expireError } = await db.from("driver_memberships").update({ status: "expired", updated_at: now })
    .eq("driver_user_id", authData.user.id).eq("status", "active").lte("ends_at", now);
  if (expireError) return reply(500, { error: "membership_expiry_update_failed" });
  const { data: activeMembership, error: activeError } = await db.from("driver_memberships")
    .select("id").eq("driver_user_id", authData.user.id).eq("status", "active").gt("ends_at", now).limit(1).maybeSingle();
  if (activeError) return reply(500, { error: "active_membership_lookup_failed" });
  if (activeMembership) return reply(409, { error: "premium_membership_already_active" });
  const { data: pending, error: pendingError } = await db.from("driver_memberships")
    .select("id,created_at").eq("driver_user_id", authData.user.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pendingError) return reply(500, { error: "pending_membership_lookup_failed" });
  if (pending && Date.parse(pending.created_at) > Date.now() - 30 * 60 * 1000)
    return reply(409, { error: "membership_payment_already_pending" });
  if (pending) {
    const { error } = await db.from("driver_memberships").update({ status: "cancelled", updated_at: now })
      .eq("id", pending.id).eq("status", "pending");
    if (error) return reply(500, { error: "stale_membership_cleanup_failed" });
  }
  const id = crypto.randomUUID();
  const { error: insertError } = await db.from("driver_memberships").insert({
    id, driver_user_id: authData.user.id, plan, amount_cents: amount,
    status: "pending", provider: "payfast_sandbox", auto_renew: false,
  });
  if (insertError) return reply(500, { error: "membership_initialization_failed" });

  const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID") || "10000100";
  const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") || "jt7NOE43FZPn";
  if (!/^\d{1,8}$/.test(merchantId) || !passphrase) {
    await db.from("driver_memberships").update({ status: "payment_failed", updated_at: new Date().toISOString() }).eq("id", id);
    return reply(503, { error: "payfast_sandbox_credentials_not_configured" });
  }
  const planName = plan === "monthly" ? "Monthly" : "Annual";
  const fields: Record<string, string> = {
    merchant_id: merchantId,
    return_url: DRIVER_URL + "?membership=return&membership_id=" + encodeURIComponent(id),
    cancel_url: DRIVER_URL + "?membership=cancel&membership_id=" + encodeURIComponent(id),
    notify_url: PROJECT_URL + "/functions/v1/payfast-itn",
    email_address: authData.user.email || "",
    m_payment_id: "SH-MEMBER-PF-" + id,
    amount: (amount / 100).toFixed(2),
    item_name: "SwiftHaul Driver Premium " + planName,
    item_description: plan === "monthly" ? "One month of SwiftHaul Driver Premium" : "Twelve months of SwiftHaul Driver Premium",
  };
  fields.signature = signature(fields, passphrase);
  return reply(200, { provider: "payfast", mode: "sandbox", process_url: SANDBOX_PROCESS_URL, fields, membership_id: id });
});
