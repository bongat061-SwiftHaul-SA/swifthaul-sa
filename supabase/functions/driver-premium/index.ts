import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });
const cents = (value: unknown) => Math.round(Number(value ?? 0));
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (!["GET", "POST"].includes(req.method)) return reply(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user, error: userError } = await db.from("user_profiles")
    .select("role,account_status,created_at").eq("id", authData.user.id).maybeSingle();
  if (userError) return reply(500, { error: "profile_lookup_failed" });
  if (!user || user.role !== "driver") return reply(403, { error: "driver_account_required" });
  if (user.account_status !== "active") return reply(403, { error: "active_driver_account_required" });
  const { data: driver, error: driverError } = await db.from("driver_profiles")
    .select("verification_status,created_at,bonus_availability_opt_in").eq("user_id", authData.user.id).maybeSingle();
  if (driverError) return reply(500, { error: "driver_profile_lookup_failed" });
  if (!driver) return reply(404, { error: "driver_profile_not_found" });

  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try { const raw = await req.text(); if (raw.length > 2048) return reply(413, { error: "request_too_large" }); body = JSON.parse(raw); }
    catch { return reply(400, { error: "invalid_json" }); }
    if (body.action !== "set_bonus_availability" || typeof body.enabled !== "boolean")
      return reply(400, { error: "invalid_premium_action" });
    const { error } = await db.from("driver_profiles").update({ bonus_availability_opt_in: body.enabled })
      .eq("user_id", authData.user.id);
    if (error) return reply(500, { error: "bonus_preference_update_failed" });
    return reply(200, { success: true, bonus_availability_opt_in: body.enabled });
  }

  const now = new Date();
  const { error: expireError } = await db.from("driver_memberships").update({ status: "expired", updated_at: now.toISOString() })
    .eq("driver_user_id", authData.user.id).eq("status", "active").lte("ends_at", now.toISOString());
  if (expireError) return reply(500, { error: "membership_expiry_update_failed" });
  const [activeResult, pendingResult, rewardsResult, deliveryResult, loansResult, earningsResult, settingsResult] = await Promise.all([
    db.from("driver_memberships").select("id,plan,status,starts_at,ends_at,provider_payment_id")
      .eq("driver_user_id", authData.user.id).eq("status", "active").lte("starts_at", now.toISOString())
      .gt("ends_at", now.toISOString()).order("starts_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("driver_memberships").select("id,plan,status,created_at").eq("driver_user_id", authData.user.id)
      .eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("driver_reward_ledger").select("event_type,amount_cents,created_at")
      .eq("driver_user_id", authData.user.id).gte("created_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
    db.from("customer_bookings").select("waybill", { count: "exact", head: true })
      .eq("driver_user_id", authData.user.id).eq("status", "delivered"),
    db.from("driver_micro_loans").select("balance_cents,status").eq("driver_user_id", authData.user.id),
    db.from("driver_earnings_ledger").select("amount_cents,event_type,created_at")
      .eq("driver_user_id", authData.user.id).eq("event_type", "earning")
      .gte("created_at", new Date(now.getTime() - 14 * 86400000).toISOString()),
    db.from("driver_finance_settings").select("micro_loan_min_tenure_days,micro_loan_min_deliveries,micro_loan_advance_rate,micro_loan_max_cents,micro_loans_enabled").eq("id", true).maybeSingle(),
  ]);
  if (activeResult.error || pendingResult.error || rewardsResult.error || deliveryResult.error || loansResult.error || earningsResult.error || settingsResult.error)
    return reply(500, { error: "premium_summary_lookup_failed" });
  const rewards = rewardsResult.data ?? [];
  const sumType = (type: string) => rewards.filter(r => r.event_type === type).reduce((n, r) => n + cents(r.amount_cents), 0);
  const outstanding = (loansResult.data ?? []).filter(r => !["repaid", "cancelled"].includes(String(r.status)))
    .reduce((n, r) => n + cents(r.balance_cents), 0);
  const earnings14d = (earningsResult.data ?? []).reduce((n, r) => n + Math.max(0, cents(r.amount_cents)), 0);
  const settings = settingsResult.data;
  const tenureDays = Math.max(0, Math.floor((now.getTime() - Date.parse(driver.created_at || user.created_at)) / 86400000));
  const deliveries = deliveryResult.count ?? 0;
  const loanLimit = settings ? Math.min(cents(settings.micro_loan_max_cents), Math.max(0, Math.round(earnings14d * Number(settings.micro_loan_advance_rate)) - outstanding)) : 0;
  return reply(200, {
    verified: driver.verification_status === "approved",
    membership: activeResult.data ? { ...activeResult.data, is_active: true } : pendingResult.data ? { ...pendingResult.data, is_active: false } : null,
    fuel_rebates_this_month_cents: sumType("fuel_rebate"),
    milestone_bonuses_this_month_cents: sumType("milestone_bonus"),
    bonus_availability_opt_in: driver.bonus_availability_opt_in === true,
    tenure_days: tenureDays,
    lifetime_completed_deliveries: deliveries,
    micro_loan: {
      eligible: tenureDays >= Number(settings?.micro_loan_min_tenure_days ?? 45) && deliveries >= Number(settings?.micro_loan_min_deliveries ?? 15),
      eligible_limit_cents: loanLimit,
      outstanding_balance_cents: outstanding,
      lending_enabled: settings?.micro_loans_enabled === true,
    },
  });
});
