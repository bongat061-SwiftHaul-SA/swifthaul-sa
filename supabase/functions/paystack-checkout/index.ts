import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const mode = Deno.env.get("PAYSTACK_MODE");
  const callbackUrl = Deno.env.get("PAYSTACK_CALLBACK_URL");
  if (!url || !anon || !service || !secret || !callbackUrl ||
      (mode !== "test" && mode !== "live") ||
      (mode === "test" && !secret.startsWith("sk_test_")) ||
      (mode === "live" && !secret.startsWith("sk_live_")) ||
      !callbackUrl.startsWith("https://")) {
    console.error("Paystack checkout configuration is incomplete or mode/key mismatch");
    return reply(503, { error: "paystack_not_configured" });
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return reply(413, { error: "request_too_large" });
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "invalid_json" });
  }
  if (typeof body.waybill !== "string" || !/^SH-[A-Z0-9-]{10,80}$/.test(body.waybill))
    return reply(400, { error: "valid_waybill_required" });

  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  const user = authData.user;
  if (authError || !user?.email) return reply(401, { error: "valid_customer_session_required" });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role,account_status").eq("id", user.id).maybeSingle();
  if (profileError) return reply(503, { error: "customer_profile_lookup_failed" });
  if (!profile || profile.role !== "customer" || profile.account_status !== "active")
    return reply(403, { error: "active_customer_account_required" });

  const { data: booking, error: bookingError } = await admin.from("customer_bookings")
    .select("waybill,owner_hash,price,status,paid_at,refunded_at,assistance_requested,assistance_fee_cents,assistance_status")
    .eq("waybill", body.waybill).eq("owner_hash", user.id).maybeSingle();
  if (bookingError) return reply(503, { error: "booking_lookup_failed" });
  if (!booking) return reply(404, { error: "booking_not_found" });
  if (booking.paid_at || booking.refunded_at || !["pending", "assigned"].includes(booking.status))
    return reply(409, { error: "booking_not_eligible_for_online_payment" });
  if (booking.assistance_requested && booking.assistance_status === "requested_pending_dispatch_confirmation")
    return reply(409, { error: "dispatch_must_confirm_assistance_before_payment" });

  const base = Number(booking.price);
  const assistance = booking.assistance_status === "accepted" ? Number(booking.assistance_fee_cents || 0) / 100 : 0;
  const amount = Math.round((base + assistance) * 100);
  if (!Number.isSafeInteger(amount) || amount < 500)
    return reply(422, { error: "booking_amount_invalid_or_below_gateway_minimum" });

  const reference = "SHPS-" + crypto.randomUUID().replaceAll("-", "");
  const { error: insertError } = await admin.from("payment_transactions").insert({
    owner_id: user.id,
    booking_waybill: booking.waybill,
    provider: "paystack",
    m_payment_id: reference,
    amount: amount / 100,
    currency: "ZAR",
    status: "pending",
    payment_mode: mode === "test" ? "sandbox" : "live",
    provider_reference: reference,
  });
  if (insertError) {
    console.error("Could not create pending Paystack transaction", insertError.message);
    return reply(503, { error: "payment_session_create_failed" });
  }

  const initialized = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      amount: String(amount),
      currency: "ZAR",
      reference,
      callback_url: callbackUrl,
      metadata: { waybill: booking.waybill, customer_id: user.id, provider: "swifthaul-sa" },
    }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);

  if (!initialized?.ok) {
    await admin.from("payment_transactions").update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("provider", "paystack").eq("provider_reference", reference).eq("status", "pending");
    console.error("Paystack initialization request failed");
    return reply(502, { error: "paystack_initialization_failed" });
  }
  const result = await initialized.json().catch(() => null);
  if (!result?.status || typeof result?.data?.authorization_url !== "string" ||
      result?.data?.reference !== reference) {
    await admin.from("payment_transactions").update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("provider", "paystack").eq("provider_reference", reference).eq("status", "pending");
    return reply(502, { error: "paystack_invalid_initialization_response" });
  }
  return reply(200, { authorization_url: result.data.authorization_url, reference });
});
