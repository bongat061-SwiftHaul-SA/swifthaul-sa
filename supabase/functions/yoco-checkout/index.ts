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

  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("YOCO_SECRET_KEY");
  const mode = Deno.env.get("YOCO_MODE");
  const callbackUrl = Deno.env.get("YOCO_CALLBACK_URL");
  if (!url || !anon || !service || !secret || !callbackUrl ||
      (mode !== "test" && mode !== "live") ||
      (mode === "test" && !secret.startsWith("sk_test_")) ||
      (mode === "live" && !secret.startsWith("sk_live_")) ||
      !callbackUrl.startsWith("https://")) {
    console.error("Yoco checkout configuration is incomplete or mode/key mismatch");
    return reply(503, { error: "yoco_not_configured" });
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
  const assistance = booking.assistance_status === "accepted"
    ? Number(booking.assistance_fee_cents || 0) / 100 : 0;
  const amount = Math.round((base + assistance) * 100);
  if (!Number.isSafeInteger(amount) || amount < 200)
    return reply(422, { error: "booking_amount_invalid_or_below_yoco_minimum" });

  const reference = "SHYO-" + crypto.randomUUID().replaceAll("-", "");
  const { error: insertError } = await admin.from("payment_transactions").insert({
    owner_id: user.id,
    booking_waybill: booking.waybill,
    provider: "yoco",
    m_payment_id: reference,
    amount: amount / 100,
    currency: "ZAR",
    status: "pending",
    payment_mode: mode === "test" ? "sandbox" : "live",
    provider_reference: reference,
  });
  if (insertError) {
    console.error("Could not create pending Yoco transaction", insertError.message);
    return reply(503, { error: "payment_session_create_failed" });
  }

  const callback = new URL(callbackUrl);
  callback.searchParams.set("waybill", booking.waybill);
  const checkoutResponse = await fetch("https://payments.yoco.com/api/checkouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "Idempotency-Key": reference,
    },
    body: JSON.stringify({
      amount,
      currency: "ZAR",
      successUrl: callback.toString(),
      cancelUrl: callback.toString(),
      failureUrl: callback.toString(),
      clientReferenceId: reference,
      externalId: reference,
      metadata: {
        swiftHaulReference: reference,
        waybill: booking.waybill,
        customerId: user.id,
      },
    }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);

  if (!checkoutResponse?.ok) {
    await admin.from("payment_transactions").update({
      status: "failed", updated_at: new Date().toISOString(),
    }).eq("provider", "yoco").eq("provider_reference", reference).eq("status", "pending");
    console.error("Yoco checkout creation request failed");
    return reply(502, { error: "yoco_checkout_initialization_failed" });
  }

  const checkout = await checkoutResponse.json().catch(() => null);
  const redirect = typeof checkout?.redirectUrl === "string" ? new URL(checkout.redirectUrl) : null;
  const expectedMode = mode === "test" ? "test" : "live";
  if (!checkout?.id || !redirect || redirect.protocol !== "https:" ||
      redirect.hostname !== "c.yoco.com" || checkout.amount !== amount ||
      checkout.currency !== "ZAR" || checkout.processingMode !== expectedMode) {
    await admin.from("payment_transactions").update({
      status: "failed", updated_at: new Date().toISOString(),
    }).eq("provider", "yoco").eq("provider_reference", reference).eq("status", "pending");
    console.error("Yoco returned an invalid checkout response");
    return reply(502, { error: "yoco_invalid_checkout_response" });
  }

  const { error: updateError } = await admin.from("payment_transactions")
    .update({ provider_checkout_id: checkout.id, updated_at: new Date().toISOString() })
    .eq("provider", "yoco").eq("provider_reference", reference).eq("status", "pending");
  if (updateError) {
    console.error("Could not save Yoco checkout ID", updateError.message);
    return reply(503, { error: "payment_session_persistence_failed" });
  }

  return reply(200, { redirect_url: redirect.toString(), reference });
});
