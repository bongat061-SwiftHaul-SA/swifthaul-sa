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

  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authResult, error: authError } = await auth.auth.getUser(token);
  if (authError || !authResult.user) return reply(401, { error: "invalid_or_expired_session" });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const actorId = authResult.user.id;
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role,account_status").eq("id", actorId).maybeSingle();
  if (profileError) return reply(500, { error: "profile_lookup_failed" });
  if (!profile || profile.role !== "admin" || profile.account_status !== "active")
    return reply(403, { error: "administrator_access_required" });

  if (req.method === "GET") {
    const { data, error } = await admin.from("booking_refund_requests")
      .select("id,owner_id,waybill,request_type,reason,refund_source,refund_amount_cents,refund_wallet_refund_cents,refund_wallet_promo_cents,status,provider_reference,created_at,reviewed_at,customer_bookings!inner(pickup,dropoff,recipient,price,payment_source,status,paid_at,refunded_at)")
      .order("created_at", { ascending: false }).limit(200);
    if (error) {
      console.error("Refund request list failed", error.message);
      return reply(500, { error: "refund_list_failed" });
    }
    return reply(200, { requests: data ?? [] });
  }

  const raw = await req.text();
  if (raw.length > 4096) return reply(413, { error: "request_too_large" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body.request_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.request_id) ||
      !["approve", "reject", "provider_complete"].includes(String(body.action)))
    return reply(400, { error: "invalid_refund_review_action" });
  if (body.action === "provider_complete" &&
      (typeof body.provider_reference !== "string" || body.provider_reference.trim().length < 3 || body.provider_reference.length > 200))
    return reply(400, { error: "external_provider_refund_reference_required" });

  const { data, error } = await admin.rpc("review_booking_refund", {
    p_admin_id: actorId,
    p_request_id: body.request_id,
    p_action: body.action,
    p_provider_reference: typeof body.provider_reference === "string" ? body.provider_reference.trim() : null,
  });
  if (error) {
    const message = error.message || "refund_review_failed";
    if (/not found/i.test(message)) return reply(404, { error: "refund_request_not_found" });
    if (/not awaiting review|already marked refunded/i.test(message)) return reply(409, { error: "refund_request_already_processed" });
    if (/Provider refund reference required/i.test(message)) return reply(400, { error: "external_provider_refund_reference_required" });
    console.error("Refund review failed", message);
    return reply(503, { error: "refund_review_failed" });
  }
  return reply(200, data ?? { reviewed: true });
});
