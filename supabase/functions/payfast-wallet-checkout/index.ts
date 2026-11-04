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
const PROCESS_URL = "https://sandbox.payfast.co.za/eng/process";
const PROJECT_URL = "https://jikstpnvsdjhcibtjilp.supabase.co";
const SITE_URL = "https://bongat061-swifthaul-sa.github.io/swifthaul-sa/public/customer.html";
function urlencode(value: string) {
  return encodeURIComponent(value.trim()).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%[0-9a-f]{2}/gi, m => m.toUpperCase()).replace(/%20/g, "+");
}
function signature(fields: Record<string,string>, passphrase: string) {
  const body = Object.entries(fields).filter(([,v]) => v !== "")
    .map(([k,v]) => k + "=" + urlencode(v)).join("&");
  return CryptoJS.MD5(body + "&passphrase=" + urlencode(passphrase)).toString();
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
  const user = authData.user;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role,account_status").eq("id", user.id).maybeSingle();
  if (profileError) return reply(500, { error: "profile_lookup_failed" });
  if (!profile || profile.role !== "customer" || profile.account_status !== "active")
    return reply(403, { error: "active_customer_account_required" });
  const { data: deletion, error: deletionError } = await admin.from("customer_deletions")
    .select("owner_hash").eq("owner_hash", user.id).maybeSingle();
  if (deletionError) return reply(500, { error: "account_status_check_failed" });
  if (deletion) return reply(403, { error: "profile_deletion_pending" });

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 2048) return reply(413, { error: "request_too_large" });
    body = JSON.parse(raw);
  } catch { return reply(400, { error: "invalid_json" }); }
  if (body.action !== "checkout" || typeof body.loan_id !== "string"
      || !/^[0-9a-f-]{36}$/i.test(body.loan_id))
    return reply(400, { error: "invalid_repayment_request" });

  const { data: wallet } = await admin.from("wallet_accounts").select("owner_hash")
    .eq("owner_hash", user.id).maybeSingle();
  if (!wallet) return reply(404, { error: "wallet_not_found" });
  const { data: loan, error: loanError } = await admin.from("wallet_loans")
    .select("id,owner_hash,waybill,amount_cents,paid_at")
    .eq("id", body.loan_id).eq("owner_hash", user.id).maybeSingle();
  if (loanError) return reply(500, { error: "loan_lookup_failed" });
  if (!loan) return reply(404, { error: "loan_not_found" });
  if (loan.paid_at) return reply(409, { error: "loan_already_repaid" });
  const cents = Number(loan.amount_cents);
  if (!Number.isSafeInteger(cents) || cents < 500 || cents > 50000)
    return reply(422, { error: "loan_amount_not_supported_for_payfast_sandbox" });

  const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID") || "10000100";
  const merchantKey = Deno.env.get("PAYFAST_MERCHANT_KEY") || "46f0cd694581a";
  const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") || "jt7NOE43FZPn";
  if (!/^\d{1,8}$/.test(merchantId) || !merchantKey || !passphrase)
    return reply(503, { error: "payfast_sandbox_credentials_not_configured" });

  let payment: { id: string; amount_cents: number } | null = null;
  const { data: pending, error: pendingError } = await admin.from("wallet_payfast_payments")
    .select("id,amount_cents").eq("loan_id", loan.id).eq("owner_hash", user.id)
    .eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pendingError) return reply(500, { error: "payment_attempt_lookup_failed" });
  if (pending && Number(pending.amount_cents) === cents) payment = pending;
  if (!payment) {
    const id = crypto.randomUUID();
    const { data: created, error } = await admin.from("wallet_payfast_payments").insert({
      id, owner_hash: user.id, loan_id: loan.id, m_payment_id: "SH-WALLET-PF-" + id,
      amount_cents: cents, currency: "ZAR", payment_mode: "sandbox", status: "pending",
    }).select("id,amount_cents").single();
    if (error || !created) {
      const { data: raced } = await admin.from("wallet_payfast_payments")
        .select("id,amount_cents").eq("loan_id", loan.id).eq("owner_hash", user.id)
        .eq("status", "pending").maybeSingle();
      if (!raced || Number(raced.amount_cents) !== cents)
        return reply(409, { error: "another_repayment_attempt_is_pending" });
      payment = raced;
    } else payment = created;
  }

  const paymentId = payment.id;
  const fields: Record<string,string> = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: SITE_URL + "?payment=wallet-return&payment_id=" + encodeURIComponent(paymentId),
    cancel_url: SITE_URL + "?payment=wallet-cancel&payment_id=" + encodeURIComponent(paymentId),
    notify_url: PROJECT_URL + "/functions/v1/payfast-itn",
    email_address: user.email || "",
    m_payment_id: "SH-WALLET-PF-" + paymentId,
    amount: (cents / 100).toFixed(2),
    item_name: "SwiftHaul pay-later repayment",
    item_description: "Loan repayment for delivery " + loan.waybill,
  };
  fields.signature = signature(fields, passphrase);
  return reply(200, { provider: "payfast", mode: "sandbox", process_url: PROCESS_URL, fields, payment_id: paymentId });
});
