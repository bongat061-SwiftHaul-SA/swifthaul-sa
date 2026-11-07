import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!["GET", "POST"].includes(req.method)) return reply(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
  const user = authData.user;
  const { data: profile, error: profileError } = await userClient.from("user_profiles")
    .select("role,account_status").eq("id", user.id).maybeSingle();
  if (profileError) return reply(503, { error: "profile_lookup_failed" });
  if (!profile || profile.account_status !== "active" || !["driver", "admin"].includes(profile.role))
    return reply(403, { error: "active_driver_or_admin_required" });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  if (req.method === "GET") {
    if (profile.role === "admin") {
      const { data, error } = await admin.from("driver_cash_deposits")
        .select("id,driver_user_id,reference,amount_cents,channel,status,proof_object,driver_note,created_at,updated_at")
        .in("status", ["proof_submitted", "awaiting_deposit"]).order("created_at", { ascending: true }).limit(200);
      if (error) return reply(503, { error: "cash_deposit_queue_unavailable" });
      return reply(200, { deposits: data ?? [] });
    }
    const [ledger, deposits, receipts] = await Promise.all([
      userClient.from("driver_cash_clearing_ledger")
        .select("id,event_key,event_type,amount_cents,waybill,description,created_at")
        .eq("driver_user_id", user.id).order("created_at", { ascending: false }).limit(100),
      userClient.from("driver_cash_deposits")
        .select("id,reference,amount_cents,channel,status,created_at,updated_at")
        .eq("driver_user_id", user.id).order("created_at", { ascending: false }).limit(100),
      userClient.from("driver_cash_receipts")
        .select("id,waybill,amount_cents,receipt_reference,driver_confirmed_at")
        .eq("driver_user_id", user.id).order("created_at", { ascending: false }).limit(100),
    ]);
    if (ledger.error || deposits.error || receipts.error) return reply(503, { error: "cash_wallet_summary_unavailable" });
    const outstanding = (ledger.data ?? []).reduce((sum, row) => sum + Number(row.amount_cents), 0);
    return reply(200, { cash_held_cents: outstanding, ledger: ledger.data ?? [], deposits: deposits.data ?? [], receipts: receipts.data ?? [] });
  }

  const raw = await req.text();
  if (raw.length > 12000) return reply(413, { error: "request_too_large" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }

  const call = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await userClient.rpc(name, args);
    if (error) {
      const message = error.message || "";
      if (/not found|not eligible/i.test(message)) return reply(404, { error: "cash_record_not_found_or_not_eligible" });
      if (/already|duplicate|not awaiting/i.test(message)) return reply(409, { error: "cash_action_already_processed" });
      if (/administrator|required|assigned driver|active driver/i.test(message)) return reply(403, { error: "cash_action_not_authorized" });
      if (/amount|signature|deposit|valid|reason|reference/i.test(message)) return reply(400, { error: "cash_action_validation_failed", detail: message.slice(0, 180) });
      console.error("Driver cash operation failed", name, message);
      return reply(503, { error: "cash_operation_unavailable" });
    }
    return reply(200, { result: data });
  };

  if (body.action === "record_receipt" && profile.role === "driver") {
    if (typeof body.waybill !== "string" || !Number.isSafeInteger(body.amount_cents) ||
        typeof body.customer_signed_name !== "string" || typeof body.signature_object !== "string")
      return reply(400, { error: "invalid_cash_receipt_details" });
    return await call("record_driver_cash_receipt", {
      p_waybill: body.waybill, p_amount_cents: body.amount_cents,
      p_customer_signed_name: body.customer_signed_name, p_customer_signature_object: body.signature_object,
    });
  }
  if (body.action === "create_deposit" && profile.role === "driver") {
    if (!Number.isSafeInteger(body.amount_cents) || !["eft", "participating_store"].includes(String(body.channel)))
      return reply(400, { error: "invalid_deposit_instruction" });
    return await call("create_driver_cash_deposit", { p_amount_cents: body.amount_cents, p_channel: body.channel });
  }
  if (body.action === "submit_deposit_proof" && profile.role === "driver") {
    if (typeof body.deposit_id !== "string" || typeof body.proof_object !== "string")
      return reply(400, { error: "invalid_deposit_proof" });
    return await call("submit_driver_cash_deposit_proof", {
      p_deposit_id: body.deposit_id, p_proof_object: body.proof_object,
      p_driver_note: typeof body.driver_note === "string" ? body.driver_note : null,
    });
  }
  if (body.action === "reconcile_deposit" && profile.role === "admin") {
    if (typeof body.deposit_id !== "string" || !["reconcile", "reject"].includes(String(body.decision)))
      return reply(400, { error: "invalid_admin_reconciliation" });
    return await call("reconcile_driver_cash_deposit", {
      p_deposit_id: body.deposit_id, p_action: body.decision,
      p_bank_statement_reference: typeof body.bank_statement_reference === "string" ? body.bank_statement_reference : null,
      p_reason: typeof body.reason === "string" ? body.reason : null,
    });
  }
  return reply(403, { error: "cash_action_not_permitted_for_role" });
});
