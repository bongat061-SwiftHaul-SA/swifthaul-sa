import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return reply(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });

  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await db.from("user_profiles")
    .select("role,account_status").eq("id", authData.user.id).maybeSingle();
  if (profileError) return reply(500, { error: "profile_lookup_failed" });
  if (!profile || profile.role !== "driver") return reply(403, { error: "driver_account_required" });
  const { data: driverProfile, error: driverProfileError } = await db.from("driver_profiles").select("verification_status").eq("user_id", authData.user.id).maybeSingle();
  if (driverProfileError) return reply(500, { error: "driver_profile_lookup_failed" });
  if (!driverProfile || driverProfile.verification_status !== "approved") return reply(403, { error: "approved_driver_required" });
  if (profile.account_status !== "active") {
    return reply(200, {
      eligible: false, insurance_active: false, eligibility_basis: null,
      coverage_status: "account_inactive", reason: "An active SwiftHaul driver account is required.",
      benefits: { vehicle_cover_limit_cents: 3000000, accidental_disability_cover_limit_cents: 10000000, daily_accident_benefit_cents: 100000 },
      policy: null,
    });
  }

  const now = new Date();
  const { data: membership, error: membershipError } = await db.from("driver_memberships")
    .select("id,plan,status,starts_at,ends_at,provider_payment_id")
    .eq("driver_user_id", authData.user.id).eq("status", "active")
    .not("provider_payment_id", "is", null).lte("starts_at", now.toISOString())
    .gt("ends_at", now.toISOString()).order("starts_at", { ascending: false }).limit(1).maybeSingle();
  if (membershipError) return reply(500, { error: "membership_lookup_failed" });

  let eligible = false;
  let basis: string | null = null;
  let reason = "A verified active Premium subscription is required.";
  if (membership?.plan === "yearly") {
    eligible = true;
    basis = "yearly_prepaid";
    reason = "Your verified annual Premium payment meets the subscription requirement.";
  } else if (membership?.plan === "monthly") {
    const startsAt = Date.parse(membership.starts_at);
    const previousWindow = new Date(startsAt - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: previous, error: previousError } = await db.from("driver_memberships")
      .select("id,ends_at,provider_payment_id").eq("driver_user_id", authData.user.id)
      .eq("plan", "monthly").not("provider_payment_id", "is", null)
      .lt("ends_at", membership.starts_at).gte("ends_at", previousWindow)
      .order("ends_at", { ascending: false }).limit(1).maybeSingle();
    if (previousError) return reply(500, { error: "membership_history_lookup_failed" });
    if (previous) {
      eligible = true;
      basis = "second_consecutive_monthly_payment";
      reason = "Your second consecutive verified monthly Premium payment meets the subscription requirement.";
    } else {
      reason = "Monthly insurance eligibility begins after your second consecutive verified monthly Premium payment.";
    }
  }

  const { data: policy, error: policyError } = await db.from("driver_insurance_policies")
    .select("insurer_name,policy_reference,status,vehicle_cover_limit_cents,accidental_disability_cover_limit_cents,daily_accident_benefit_cents,coverage_starts_at,coverage_ends_at")
    .eq("driver_user_id", authData.user.id).maybeSingle();
  if (policyError && policyError.code !== "42P01") return reply(500, { error: "insurance_policy_lookup_failed" });

  const policyActive = Boolean(
    eligible && policy?.status === "active" && policy.policy_reference &&
    policy.coverage_starts_at && policy.coverage_ends_at &&
    Date.parse(policy.coverage_starts_at) <= now.getTime() &&
    Date.parse(policy.coverage_ends_at) > now.getTime()
  );
  let coverageStatus = "not_eligible";
  if (policyActive) coverageStatus = "active";
  else if (eligible) coverageStatus = policy?.status === "suspended" ? "policy_suspended" : "eligible_policy_activation_pending";
  else if (policy?.status === "suspended") coverageStatus = "policy_suspended";

  return reply(200, {
    eligible,
    insurance_active: policyActive,
    eligibility_basis: basis,
    reason,
    membership: membership ? { plan: membership.plan, starts_at: membership.starts_at, ends_at: membership.ends_at } : null,
    coverage_status: coverageStatus,
    benefits: {
      vehicle_cover_limit_cents: policy?.vehicle_cover_limit_cents ?? 3000000,
      accidental_disability_cover_limit_cents: policy?.accidental_disability_cover_limit_cents ?? 10000000,
      daily_accident_benefit_cents: policy?.daily_accident_benefit_cents ?? 100000,
      daily_accident_benefit_max_days: 5,
      dispatch_trip_only: true,
    },
    policy: policyActive && policy ? {
      insurer_name: policy.insurer_name,
      coverage_starts_at: policy.coverage_starts_at,
      coverage_ends_at: policy.coverage_ends_at,
    } : null,
  });
});
