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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (!["GET", "POST"].includes(req.method)) return reply(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\\s+(.+)$/i)?.[1];
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

  if (req.method === "GET") {
    const { data: payments, error } = await db.from("customer_eft_payments")
      .select("id,owner_id,waybill,payment_reference,customer_reference,amount_cents,proof_object_path,status,admin_reference,rejection_reason,created_at,reviewed_at")
      .order("created_at", { ascending: false }).limit(100);
    if (error) return reply(500, { error: "eft_queue_unavailable" });
    const waybills = [...new Set((payments ?? []).map(row => row.waybill))];
    const { data: bookings, error: bookingError } = waybills.length
      ? await db.from("customer_bookings").select("waybill,pickup,dropoff,recipient,price,status").in("waybill", waybills)
      : { data: [], error: null };
    if (bookingError) return reply(500, { error: "eft_booking_details_unavailable" });
    const byWaybill = new Map((bookings ?? []).map(row => [row.waybill, row]));
    const queue = await Promise.all((payments ?? []).map(async row => {
      const { data: signed, error: signedError } = await db.storage.from("customer-eft-proofs")
        .createSignedUrl(row.proof_object_path, 300);
      return {
        id: row.id, waybill: row.waybill, payment_reference: row.payment_reference,
        customer_reference: row.customer_reference, amount_cents: row.amount_cents,
        status: row.status, admin_reference: row.admin_reference,
        rejection_reason: row.rejection_reason, created_at: row.created_at,
        reviewed_at: row.reviewed_at, booking: byWaybill.get(row.waybill) ?? null,
        proof_url: signedError ? null : signed?.signedUrl ?? null,
      };
    }));
    return reply(200, { submissions: queue });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id))
    return reply(400, { error: "valid_submission_id_required" });
  const decision = body.decision;
  if (decision !== "verified" && decision !== "rejected")
    return reply(400, { error: "invalid_review_decision" });
  if (decision === "verified" && (typeof body.admin_reference !== "string" || body.admin_reference.trim().length < 3 || body.admin_reference.trim().length > 120))
    return reply(400, { error: "bank_statement_reference_required" });
  if (decision === "rejected" && (typeof body.rejection_reason !== "string" || body.rejection_reason.trim().length < 3 || body.rejection_reason.trim().length > 500))
    return reply(400, { error: "rejection_reason_required" });

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data, error } = await userClient.rpc("review_customer_eft_payment", {
    p_payment_id: body.id,
    p_decision: decision,
    p_admin_reference: decision === "verified" ? body.admin_reference.trim() : null,
    p_rejection_reason: decision === "rejected" ? body.rejection_reason.trim() : null,
  });
  if (error) {
    console.error("EFT review failed", error.message);
    return reply(409, { error: error.message.includes("administrator_access_required") ? "administrator_access_required" : "eft_review_failed" });
  }
  return reply(200, { result: data });
});
