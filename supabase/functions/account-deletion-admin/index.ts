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
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: actor, error: actorError } = await admin.from("user_profiles")
    .select("role,account_status").eq("id", authData.user.id).maybeSingle();
  if (actorError) return reply(500, { error: "administrator_profile_lookup_failed" });
  if (!actor || actor.role !== "admin" || actor.account_status !== "active")
    return reply(403, { error: "administrator_access_required" });

  if (req.method === "GET") {
    const { data: rows, error } = await admin.from("account_deletion_requests")
      .select("id,user_id,app_type,reason,status,requested_at,reviewed_at,reviewed_by")
      .in("status", ["pending", "reviewing"]).order("requested_at", { ascending: true }).limit(200);
    if (error) return reply(500, { error: "deletion_request_list_failed" });
    const ids = [...new Set((rows ?? []).map((row: any) => row.user_id))];
    const { data: profiles, error: profilesError } = ids.length
      ? await admin.from("user_profiles").select("id,full_name,phone,role,account_status").in("id", ids)
      : { data: [], error: null };
    if (profilesError) return reply(500, { error: "account_profile_lookup_failed" });
    const profileById = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
    const requests = await Promise.all((rows ?? []).map(async (row: any) => {
      const { data } = await admin.auth.admin.getUserById(row.user_id);
      const profile = profileById.get(row.user_id) ?? null;
      return {
        id: row.id, user_id: row.user_id, app_type: row.app_type, reason: row.reason,
        status: row.status, requested_at: row.requested_at, reviewed_at: row.reviewed_at,
        full_name: profile?.full_name ?? "Account holder",
        phone: profile?.phone ?? "",
        email: data?.user?.email ?? "",
        account_status: profile?.account_status ?? "unknown",
      };
    }));
    return reply(200, { requests });
  }

  const raw = await req.text();
  if (raw.length > 4096) return reply(413, { error: "request_too_large" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body.request_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.request_id))
    return reply(400, { error: "valid_request_id_required" });
  const nextStatus = ({ start_review: "reviewing", approve: "approved", reject: "rejected" } as Record<string, string>)[String(body.action)];
  if (!nextStatus) return reply(400, { error: "unsupported_review_action" });
  const final = nextStatus !== "reviewing";
  const { data: updated, error: updateError } = await admin.from("account_deletion_requests")
    .update({
      status: nextStatus,
      reviewed_by: authData.user.id,
      reviewed_at: final ? new Date().toISOString() : null,
    })
    .eq("id", body.request_id).in("status", ["pending", "reviewing"])
    .select("id,status").maybeSingle();
  if (updateError) return reply(500, { error: "deletion_request_update_failed" });
  if (!updated) return reply(409, { error: "request_already_closed_or_not_found" });
  const message = nextStatus === "approved"
    ? "Request approved for closure after delivery, wallet, payout and legal-record reconciliation. The account has not been deleted."
    : nextStatus === "rejected"
      ? "Deletion request rejected. The account remains active."
      : "Request moved into review. The account remains active.";
  return reply(200, { updated: true, status: updated.status, message });
});
