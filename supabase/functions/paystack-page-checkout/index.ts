import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
  const configuredMode = Deno.env.get("PAYSTACK_MODE");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });
  // This branch is staging: refuse live credentials so test pages cannot charge real customers.
  if (!secret.startsWith("sk_test_") || (configuredMode && configuredMode !== "sandbox")) {
    return reply(503, { error: "staging_requires_paystack_test_mode" });
  }
  const mode = "sandbox";

  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
  const user = authData.user;
  if (!user.email) return reply(403, { error: "customer_email_required" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body.waybill !== "string" || !/^SH-[A-F0-9-]{20,60}$/i.test(body.waybill)) {
    return reply(400, { error: "valid_swifthaul_waybill_required" });
  }

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await db.from("user_profiles")
    .select("role,account_status").eq("id", user.id).maybeSingle();
  if (profileError) return reply(503, { error: "customer_profile_lookup_failed" });
  if (!profile || profile.role !== "customer" || profile.account_status !== "active") {
    return reply(403, { error: "active_customer_account_required" });
  }

  const { data: booking, error: bookingError } = await db.from("customer_bookings")
    .select("waybill,owner_hash,price,customer_total_cents,paid_at,refunded_at,status,counter_offer_status")
    .eq("waybill", body.waybill).eq("owner_hash", user.id).maybeSingle();
  if (bookingError) return reply(503, { error: "booking_lookup_failed" });
  if (!booking) return reply(404, { error: "booking_not_found" });
  if (booking.paid_at || booking.refunded_at || ["cancelled", "delivered"].includes(booking.status) ||
      booking.counter_offer_status === "pending") {
    return reply(409, { error: "booking_not_payable" });
  }

  const amountCents = booking.customer_total_cents==null?Math.round(Number(booking.price)*100):Number(booking.customer_total_cents);
  const amount = amountCents / 100;
  if (!Number.isSafeInteger(amountCents) || amountCents < 100 || amountCents > 100000000) {
    return reply(422, { error: "invalid_booking_amount" });
  }

  const { data: pending, error: pendingError } = await db.from("payment_transactions")
    .select("id,provider,amount,status").eq("booking_waybill", booking.waybill)
    .eq("status", "pending").maybeSingle();
  if (pendingError) return reply(503, { error: "pending_payment_lookup_failed" });

  let paymentId: string;
  if (pending) {
    if (pending.provider !== "paystack" || Math.round(Number(pending.amount) * 100) !== amountCents) {
      return reply(409, { error: "another_payment_is_pending_contact_dispatch_if_needed" });
    }
    paymentId = pending.id;
  } else {
    const marker = "SH_PAGE_" + crypto.randomUUID().replaceAll("-", "");
    const { data: created, error: createError } = await db.from("payment_transactions").insert({
      owner_id: user.id,
      booking_waybill: booking.waybill,
      provider: "paystack",
      m_payment_id: marker,
      provider_reference: null,
      amount,
      currency: "ZAR",
      status: "pending",
      payment_mode: mode,
    }).select("id").single();
    if (createError || !created) {
      console.error("Paystack Payment Page pending record could not be created", createError?.message);
      return reply(503, { error: "payment_record_create_failed" });
    }
    paymentId = created.id;
  }

  const page = new URL("https://paystack.shop/pay/swifthaul_waybill");
  page.searchParams.set("amount", amount.toFixed(2));
  page.searchParams.set("read-only", "amount");
  page.searchParams.set("swifthaul_waybill", booking.waybill);
  return reply(200, {
    provider: "paystack",
    currency: "ZAR",
    amount,
    waybill: booking.waybill,
    payment_id: paymentId,
    payment_url: page.toString(),
    mode,
    custom_field_variable: "swifthaul_waybill",
  });
});
