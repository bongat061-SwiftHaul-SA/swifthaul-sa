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

async function allRows(client: ReturnType<typeof createClient>, table: string, columns: string) {
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(table + ":" + error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
    if (from >= 49000) throw new Error(table + ":pagination_limit");
  }
  return rows;
}
const sum = (rows: Record<string, any>[], field: string, predicate = (_r: Record<string, any>) => true) =>
  rows.filter(predicate).reduce((n, r) => n + Number(r[field] ?? 0), 0);
const cents = (n: number) => Math.round(n);

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
  if (!profile || profile.role !== "admin" || profile.account_status !== "active")
    return reply(403, { error: "administrator_access_required" });

  try {
    const [bookings, payments, eftPayments, memberships, refunds, earnings, rewards, payouts, loans] = await Promise.all([
      allRows(db, "customer_bookings", "waybill,status,price,completed_at,paid_at,refunded_at"),
      allRows(db, "payment_transactions", "amount,status,refunded_at,completed_at,provider"),
      allRows(db, "customer_eft_payments", "amount_cents,status,admin_reference,reviewed_at"),
      allRows(db, "driver_memberships", "amount_cents,status,provider,provider_payment_id,starts_at,ends_at"),
      allRows(db, "booking_refund_requests", "refund_amount_cents,status,refund_source"),
      allRows(db, "driver_earnings_ledger", "amount_cents,event_type,event_key"),
      allRows(db, "driver_reward_ledger", "amount_cents,event_type"),
      allRows(db, "driver_payout_requests", "amount_cents,status,created_at,paid_at"),
      allRows(db, "driver_micro_loans", "principal_cents,balance_cents,status"),
    ]);

    const completed = bookings.filter(r => r.status === "delivered");
    const grossDeliveryCents = cents(sum(completed, "price", () => true) * 100);
    const providerPaidCents = cents(sum(payments, "amount", r => r.status === "complete") * 100);
    const eftVerifiedCents = cents(sum(eftPayments, "amount_cents", r => r.status === "verified"));
    const paidCustomerCents = providerPaidCents + eftVerifiedCents;
    const completedPaymentRefundCents = cents(sum(payments, "amount", r => r.status === "complete" && !!r.refunded_at) * 100);
    const approvedRefunds = refunds.filter(r => ["refunded", "completed", "paid"].includes(String(r.status)));
    const refundCents = Math.max(completedPaymentRefundCents,
      sum(approvedRefunds, "refund_amount_cents", r => r.refund_source !== "wallet"));
    const membershipPaid = memberships.filter(r => !!r.provider_payment_id && ["active", "expired", "cancelled"].includes(String(r.status)));
    const membershipRevenueCents = sum(membershipPaid, "amount_cents");
    const deliveryEarningsCents = sum(earnings, "amount_cents", r => String(r.event_key ?? "").startsWith("delivery-earning:"));
    const driverShareCents = Math.round(grossDeliveryCents * 0.75);
    const platformShareCents = grossDeliveryCents - driverShareCents;
    const fuelRebateCents = sum(rewards, "amount_cents", r => String(r.event_type).includes("fuel"));
    const milestoneCents = sum(rewards, "amount_cents", r => String(r.event_type).includes("milestone"));
    const payoutPendingCents = sum(payouts, "amount_cents", r => r.status === "pending");
    const payoutApprovedCents = sum(payouts, "amount_cents", r => r.status === "approved");
    const payoutPaidCents = sum(payouts, "amount_cents", r => r.status === "paid");
    const totalCreditsCents = Math.max(0, deliveryEarningsCents) + sum(rewards, "amount_cents", r => Number(r.amount_cents) > 0);
    const outstandingPayoutCents = payoutPendingCents + payoutApprovedCents;
    const driverLiabilityCents = Math.max(0, totalCreditsCents - payoutPaidCents);
    const loanPrincipalCents = sum(loans, "principal_cents");
    const loanBalanceCents = sum(loans, "balance_cents", r => !["repaid", "cancelled"].includes(String(r.status)));
    return reply(200, {
      generated_at: new Date().toISOString(),
      currency: "ZAR",
      bookings: { total: bookings.length, completed: completed.length },
      customer_payments: { gross_received_cents: paidCustomerCents, provider_received_cents: providerPaidCents, eft_verified_cents: eftVerifiedCents, refunds_cents: refundCents, net_received_cents: Math.max(0, paidCustomerCents - refundCents) },
      delivery: { completed_gross_charge_cents: grossDeliveryCents, driver_share_75_cents: driverShareCents, swift_haul_share_25_cents: platformShareCents, ledger_driver_earnings_cents: deliveryEarningsCents },
      premium: { verified_membership_revenue_cents: membershipRevenueCents, paid_memberships: membershipPaid.length, fuel_rebates_cents: fuelRebateCents, milestone_bonuses_cents: milestoneCents, total_rewards_cents: fuelRebateCents + milestoneCents },
      payouts: { pending_cents: payoutPendingCents, approved_reserved_cents: payoutApprovedCents, paid_cents: payoutPaidCents, outstanding_requests_cents: outstandingPayoutCents, driver_liability_estimate_cents: driverLiabilityCents },
      loans: { disbursed_principal_cents: loanPrincipalCents, outstanding_balance_cents: loanBalanceCents, active_count: loans.filter(r => !["repaid", "cancelled"].includes(String(r.status))).length, compliance_enabled: false },
      notes: [
        "Customer cash receipts combine completed payment_transactions and verified customer EFT submissions. Booking prices are reported separately and are not added to cash receipts.",
        "EFT amounts are counted only after Company Admin verification and are reconciled by the recorded bank statement reference.",
        "Membership revenue includes records with a provider payment ID and a paid lifecycle status; refunds or chargebacks on memberships are not yet reconciled.",
        "Refund totals include recorded external refund requests and fully refunded completed transactions; wallet-only refunds are excluded from cash refunds.",
        "Driver liability is an estimate from positive delivery and reward credits less paid payout requests. Pending and approved payout requests are shown separately and are not double-subtracted.",
        "Loan repayments are not yet represented by a dedicated repayment ledger; loan balances reflect the current loan table only."
      ]
    });
  } catch (error) {
    console.error("Financial dashboard aggregation failed", error instanceof Error ? error.message : error);
    return reply(503, { error: "financial_summary_unavailable" });
  }
});
