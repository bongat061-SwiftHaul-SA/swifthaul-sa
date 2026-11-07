import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
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
  const { data: actor, error: actorError } = await admin.from("user_profiles")
    .select("role,account_status").eq("id", authResult.user.id).maybeSingle();
  if (actorError) return reply(500, { error: "profile_lookup_failed" });
  if (!actor || actor.role !== "admin" || actor.account_status !== "active")
    return reply(403, { error: "administrator_access_required" });

  if (req.method === "GET") {
    const { data, error } = await admin.from("driver_profiles")
      .select("user_id,phone,license_number,license_expiry,vehicle_type,vehicle_registration,verification_status,availability_status,created_at,user_profiles!inner(full_name)")
      .order("created_at", { ascending: false }).limit(200);
    if (error) {
      console.error("Driver review list failed", error.message);
      return reply(500, { error: "driver_list_failed" });
    }
    const ids = (data ?? []).map((driver: any) => driver.user_id);
    const { data: docs, error: docsError } = ids.length
      ? await admin.from("driver_documents").select("id,driver_user_id,document_type,original_name,review_status,created_at,storage_path").in("driver_user_id", ids).order("created_at", { ascending: false })
      : { data: [], error: null };
    if (docsError) return reply(500, { error: "driver_documents_lookup_failed" });
    const grouped: Record<string, unknown[]> = {};
    for (const doc of docs ?? []) {
      const { data: signed, error: signedError } = await admin.storage.from("driver-application-documents").createSignedUrl(doc.storage_path, 300);
      if (signedError || !signed?.signedUrl) {
        console.error("Driver document signed URL failed", signedError?.message);
        return reply(500, { error: "driver_document_link_failed" });
      }
      const safeDoc = { id: doc.id, document_type: doc.document_type, original_name: doc.original_name,
        review_status: doc.review_status, created_at: doc.created_at, signed_url: signed.signedUrl };
      (grouped[doc.driver_user_id] ??= []).push(safeDoc);
    }
    return reply(200, { drivers: (data ?? []).map((driver: any) => ({ ...driver, documents: grouped[driver.user_id] ?? [] })) });
  }

  const raw = await req.text();
  if (raw.length > 2048) return reply(413, { error: "request_too_large" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }
  if (body.action === "review_document") {
    if (typeof body.document_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.document_id))
      return reply(400, { error: "invalid_document_id" });
    if (!["accepted", "rejected"].includes(String(body.review_status)))
      return reply(400, { error: "invalid_document_review_status" });
    const note = typeof body.review_note === "string" ? body.review_note.trim().slice(0, 500) : "";
    const { data: document, error: documentError } = await admin.from("driver_documents")
      .select("id,driver_user_id,review_status").eq("id", body.document_id).maybeSingle();
    if (documentError) return reply(500, { error: "document_lookup_failed" });
    if (!document) return reply(404, { error: "driver_document_not_found" });
    if (typeof body.user_id !== "string" || document.driver_user_id !== body.user_id)
      return reply(409, { error: "document_driver_mismatch" });
    const { data: reviewed, error: reviewError } = await admin.from("driver_documents")
      .update({ review_status: body.review_status, review_note: note || null,
        reviewed_by: authResult.user.id, reviewed_at: new Date().toISOString() })
      .eq("id", body.document_id).select("id,driver_user_id,document_type,review_status,review_note,reviewed_at").maybeSingle();
    if (reviewError) return reply(500, { error: "document_review_update_failed" });
    if (!reviewed) return reply(404, { error: "driver_document_not_found" });
    return reply(200, { document: reviewed });
  }

  if (typeof body.user_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.user_id))
    return reply(400, { error: "invalid_driver_id" });
  if (!["approve", "reject", "suspend"].includes(String(body.action)))
    return reply(400, { error: "invalid_review_action" });
  if (body.action === "approve") {
    const required = ["id_document", "proof_of_address", "bank_confirmation", "drivers_licence", "vehicle_document"];
    const { data: documents, error: documentsError } = await admin.from("driver_documents")
      .select("document_type,review_status").eq("driver_user_id", body.user_id);
    if (documentsError) return reply(500, { error: "driver_documents_lookup_failed" });
    const missing = required.filter((type) => !documents?.some((doc) => doc.document_type === type && doc.review_status === "accepted"));
    if (missing.length) return reply(409, { error: "required_documents_not_approved", missing_documents: missing });
  }
  const next = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "suspended";
  const { data, error } = await admin.from("driver_profiles")
    .update({ verification_status: next, updated_at: new Date().toISOString() })
    .eq("user_id", body.user_id).select("user_id,verification_status").maybeSingle();
  if (error) return reply(500, { error: "driver_review_update_failed" });
  if (!data) return reply(404, { error: "driver_not_found" });
  return reply(200, { driver: data });
});
