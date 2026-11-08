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
const BENEFITS = {
  vehicle_cover_limit_cents: 3000000,
  accidental_disability_cover_limit_cents: 10000000,
  daily_accident_benefit_cents: 100000,
};
type Membership = { id: string; driver_user_id: string; plan: string; status: string; starts_at: string; ends_at: string; provider_payment_id: string | null };
async function subscriptionEligibility(db: any, userId: string, now: Date) {
  const { data: active, error } = await db.from("driver_memberships")
    .select("id,plan,status,starts_at,ends_at,provider_payment_id")
    .eq("driver_user_id", userId).eq("status", "active").not("provider_payment_id", "is", null)
    .lte("starts_at", now.toISOString()).gt("ends_at", now.toISOString())
    .order("starts_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("membership_lookup_failed");
  if (!active) return { eligible: false, basis: null as string | null, membership: null };
  if (active.plan === "yearly") return { eligible: true, basis: "yearly_prepaid", membership: active };
  if (active.plan !== "monthly") return { eligible: false, basis: null, membership: active };
  const previousWindow = new Date(Date.parse(String(active.starts_at)) - 7 * 86400000).toISOString();
  const { data: previous, error: previousError } = await db.from("driver_memberships")
    .select("id").eq("driver_user_id", userId).eq("plan", "monthly")
    .not("provider_payment_id", "is", null).lt("ends_at", active.starts_at)
    .gte("ends_at", previousWindow).order("ends_at", { ascending: false }).limit(1).maybeSingle();
  if (previousError) throw new Error("membership_history_lookup_failed");
  return {
    eligible: Boolean(previous),
    basis: previous ? "second_consecutive_monthly_payment" : null,
    membership: active,
  };
}
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
  const { data: actor, error: actorError } = await db.from("user_profiles")
    .select("role,account_status").eq("id", authData.user.id).maybeSingle();
  if (actorError) return reply(500, { error: "administrator_profile_lookup_failed" });
  if (!actor || actor.role !== "admin" || actor.account_status !== "active")
    return reply(403, { error: "administrator_access_required" });

  if (req.method === "GET") {
    const { data: drivers, error: driversError } = await db.from("driver_profiles")
      .select("user_id,phone,verification_status,created_at,user_profiles!inner(full_name,account_status)")
      .order("created_at", { ascending: false }).limit(200);
    if (driversError) return reply(500, { error: "driver_insurance_list_failed" });
    const ids = (drivers ?? []).map((d: any) => d.user_id);
    if (!ids.length) return reply(200, { drivers: [], benefits: BENEFITS });
    const [{ data: memberships, error: membershipsError }, { data: policies, error: policiesError }] = await Promise.all([
      db.from("driver_memberships").select("id,driver_user_id,plan,status,starts_at,ends_at,provider_payment_id")
        .in("driver_user_id", ids).eq("status", "active").not("provider_payment_id", "is", null)
        .lte("starts_at", new Date().toISOString()).gt("ends_at", new Date().toISOString()),
      db.from("driver_insurance_policies").select("id,driver_user_id,insurer_name,policy_reference,status,coverage_starts_at,coverage_ends_at,created_at,updated_at")
        .in("driver_user_id", ids),
    ]);
    if (membershipsError || policiesError) return reply(500, { error: "insurance_records_lookup_failed" });
    const policyByDriver = new Map((policies ?? []).map((p: any) => [p.driver_user_id, p]));
    const now = new Date();
    const results = [];
    for (const driver of drivers ?? []) {
      const profile = Array.isArray(driver.user_profiles) ? driver.user_profiles[0] : driver.user_profiles;
      const active = (memberships ?? []).filter((m: Membership) => m.driver_user_id === driver.user_id)
        .sort((a: Membership, b: Membership) => Date.parse(b.starts_at) - Date.parse(a.starts_at))[0] ?? null;
      let eligibility = { eligible: false, basis: null as string | null };
      if (profile?.account_status === "active" && driver.verification_status === "approved" && active) {
        if (active.plan === "yearly") eligibility = { eligible: true, basis: "yearly_prepaid" };
        else if (active.plan === "monthly") {
          const previousWindow = new Date(Date.parse(active.starts_at) - 7 * 86400000).toISOString();
          const { data: previous, error } = await db.from("driver_memberships").select("id")
            .eq("driver_user_id", driver.user_id).eq("plan", "monthly").not("provider_payment_id", "is", null)
            .lt("ends_at", active.starts_at).gte("ends_at", previousWindow).limit(1).maybeSingle();
          if (error) return reply(500, { error: "membership_history_lookup_failed" });
          if (previous) eligibility = { eligible: true, basis: "second_consecutive_monthly_payment" };
        }
      }
      const policy = policyByDriver.get(driver.user_id) as any;
      const insuranceActive = Boolean(eligibility.eligible && policy?.status === "active" &&
        policy?.policy_reference && policy?.coverage_starts_at && policy?.coverage_ends_at &&
        Date.parse(policy.coverage_starts_at) <= now.getTime() && Date.parse(policy.coverage_ends_at) > now.getTime());
      results.push({
        user_id: driver.user_id,
        full_name: profile?.full_name || "Driver",
        phone: driver.phone,
        account_status: profile?.account_status || "unknown",
        verification_status: driver.verification_status,
        membership: active ? { plan: active.plan, starts_at: active.starts_at, ends_at: active.ends_at } : null,
        eligible: eligibility.eligible,
        eligibility_basis: eligibility.basis,
        insurance_active: insuranceActive,
        policy: policy ? {
          id: policy.id, insurer_name: policy.insurer_name, policy_reference: policy.policy_reference,
          status: policy.status, coverage_starts_at: policy.coverage_starts_at, coverage_ends_at: policy.coverage_ends_at,
        } : null,
      });
    }
    return reply(200, { drivers: results, benefits: BENEFITS });
  }

  let body: Record<string, unknown>;
  try { const raw = await req.text(); if (raw.length > 4096) return reply(413, { error: "request_too_large" }); body = JSON.parse(raw); }
  catch { return reply(400, { error: "invalid_json" }); }
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const action = body.action;
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !["activate", "suspend", "expire", "pending"].includes(String(action)))
    return reply(400, { error: "invalid_insurance_action" });
  const { data: target, error: targetError } = await db.from("user_profiles")
    .select("role,account_status").eq("id", userId).maybeSingle();
  if (targetError) return reply(500, { error: "driver_profile_lookup_failed" });
  if (!target || target.role !== "driver") return reply(404, { error: "driver_not_found" });
  if (action === "activate") {
    const { data: approvedDriver, error: approvedDriverError } = await db.from("driver_profiles").select("verification_status").eq("user_id", userId).maybeSingle();
    if (approvedDriverError) return reply(500, { error: "driver_verification_lookup_failed" });
    if (!approvedDriver || approvedDriver.verification_status !== "approved") return reply(409, { error: "approved_driver_required" });
  }

  let values: Record<string, unknown> = { driver_user_id: userId, updated_at: new Date().toISOString() };
  if (action === "activate") {
    if (target.account_status !== "active") return reply(409, { error: "driver_account_inactive" });
    let eligibility;
    try { eligibility = await subscriptionEligibility(db, userId, new Date()); }
    catch (error) { return reply(500, { error: error instanceof Error ? error.message : "membership_lookup_failed" }); }
    if (!eligibility.eligible) return reply(409, { error: "active_insurance_subscription_not_eligible" });
    const insurer = typeof body.insurer_name === "string" ? body.insurer_name.trim() : "";
    const reference = typeof body.policy_reference === "string" ? body.policy_reference.trim() : "";
    const starts = typeof body.coverage_starts_at === "string" ? Date.parse(body.coverage_starts_at) : NaN;
    const ends = typeof body.coverage_ends_at === "string" ? Date.parse(body.coverage_ends_at) : NaN;
    if (insurer.length < 2 || insurer.length > 160 || reference.length < 3 || reference.length > 120 ||
      !Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts)
      return reply(400, { error: "valid_insurer_policy_and_coverage_dates_required" });
    values = { ...values, insurer_name: insurer, policy_reference: reference, status: "active",
      vehicle_cover_limit_cents: BENEFITS.vehicle_cover_limit_cents,
      accidental_disability_cover_limit_cents: BENEFITS.accidental_disability_cover_limit_cents,
      daily_accident_benefit_cents: BENEFITS.daily_accident_benefit_cents,
      coverage_starts_at: new Date(starts).toISOString(), coverage_ends_at: new Date(ends).toISOString(), activated_by: authData.user.id, activated_at: new Date().toISOString() };
  } else {
    const status = action === "suspend" ? "suspended" : action === "expire" ? "expired" : "pending";
    values.status = status;
    if (action === "pending") {
      values.insurer_name = null; values.policy_reference = null;
      values.coverage_starts_at = null; values.coverage_ends_at = null; values.activated_by = null; values.activated_at = null;
    }
  }
  const { error: saveError } = await db.from("driver_insurance_policies").upsert(values, { onConflict: "driver_user_id" });
  if (saveError) {
    if (saveError.code === "23505") return reply(409, { error: "policy_reference_already_in_use" });
    console.error("Driver insurance policy update failed", saveError.message);
    return reply(500, { error: "insurance_policy_update_failed" });
  }
  return reply(200, { success: true, user_id: userId, status: values.status });
});
