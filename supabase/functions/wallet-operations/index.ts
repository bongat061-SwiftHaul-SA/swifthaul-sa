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
const fail = (status: number, error: string) => reply(status, { error });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return fail(405, "method_not_allowed");

  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\\s+(.+)$/i)?.[1];
  if (!token) return fail(401, "missing_bearer_token");

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return fail(500, "server_configuration_error");

  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return fail(401, "invalid_or_expired_session");

  const user = authData.user;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role,account_status").eq("id", user.id).maybeSingle();
  if (profileError) return fail(500, "profile_lookup_failed");
  if (!profile || profile.role !== "customer" || profile.account_status !== "active")
    return fail(403, "active_customer_account_required");

  const { data: deletion, error: deletionError } = await admin.from("customer_deletions")
    .select("owner_hash").eq("owner_hash", user.id).maybeSingle();
  if (deletionError) return fail(500, "account_status_check_failed");
  if (deletion) return fail(403, "profile_deletion_pending");

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return fail(413, "request_too_large");
    body = JSON.parse(raw);
  } catch { return fail(400, "invalid_json"); }
  if (body.action !== "summary") return fail(501, "wallet_actions_not_yet_migrated");

  let { data: wallet, error: walletError } = await admin.from("wallet_accounts")
    .select("owner_hash,referral_code,refund_cents,promo_cents,promo_debt_cents")
    .eq("owner_hash", user.id).maybeSingle();
  if (walletError) return fail(500, "wallet_lookup_failed");
  if (!wallet) {
    const referral = typeof user.app_metadata?.signup_referral === "string"
      ? user.app_metadata.signup_referral.trim().slice(0, 32) : "";
    let referredBy: string | null = null;
    if (referral) {
      const { data: referrer } = await admin.from("wallet_accounts")
        .select("owner_hash").eq("referral_code", referral).neq("owner_hash", user.id).maybeSingle();
      referredBy = referrer?.owner_hash ?? null;
    }
    const code = "SH" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    const { error: insertError } = await admin.from("wallet_accounts")
      .insert({ owner_hash: user.id, referral_code: code, referred_by: referredBy });
    if (insertError && insertError.code !== "23505") return fail(500, "wallet_initialization_failed");
    const result = await admin.from("wallet_accounts")
      .select("owner_hash,referral_code,refund_cents,promo_cents,promo_debt_cents")
      .eq("owner_hash", user.id).maybeSingle();
    wallet = result.data;
    walletError = result.error;
    if (walletError || !wallet) return fail(500, "wallet_initialization_failed");
  }

  const [entriesResult, loansResult, withdrawalsResult, completedResult] = await Promise.all([
    admin.from("wallet_ledger").select("id,refund_delta,promo_delta,promo_debt_delta,description,created_at")
      .eq("owner_hash", user.id).order("created_at", { ascending: false }).limit(100),
    admin.from("wallet_loans").select("id,waybill,amount_cents,due_at,paid_at,created_at")
      .eq("owner_hash", user.id).order("created_at", { ascending: false }).limit(100),
    admin.from("wallet_withdrawals").select("reference,gross_cents,fee_cents,net_cents,speed,state,created_at")
      .eq("owner_hash", user.id).order("created_at", { ascending: false }).limit(100),
    admin.from("customer_bookings").select("waybill", { count: "exact", head: true })
      .eq("owner_hash", user.id).not("completed_at", "is", null),
  ]);
  if (entriesResult.error || loansResult.error || withdrawalsResult.error || completedResult.error)
    return fail(500, "wallet_activity_lookup_failed");

  const loans = loansResult.data ?? [];
  const now = Date.now();
  const outstanding = loans.filter(row => !row.paid_at)
    .reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const overdue = loans.filter(row => !row.paid_at && Date.parse(row.due_at) < now).length;

  return reply(200, {
    wallet,
    entries: entriesResult.data ?? [],
    loans,
    withdrawals: withdrawalsResult.data ?? [],
    eligibility: {
      completed: completedResult.count ?? 0,
      verified: Boolean(user.email_confirmed_at),
      outstanding,
      overdue,
      limit_cents: 50000,
    },
    provider_ready: false,
    actions_ready: false,
  });
});
