import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

const allowedFields = new Set([
  "full_name", "phone", "email", "identity_type", "date_of_birth",
  "id_number", "passport_number", "traffic_register_number",
  "passport_expiry", "work_permit_expiry", "licence_code", "licence_expiry",
  "prdp_holder", "prdp_category", "prdp_expiry", "vehicle_type",
  "vehicle_gvm_kg", "vehicle_make", "vehicle_model", "vehicle_year",
  "registration_plate", "vehicle_disc_expiry", "insurance_expiry",
  "proof_of_address_date", "registration_document_expiry", "bank_name",
  "account_holder", "account_number", "account_type", "branch_code",
  "background_consent"
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET" && req.method !== "POST") {
    return reply(405, { error: "method_not_allowed" });
  }

  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });

  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: authError } = await auth.auth.getUser(token);
  if (authError || !userData.user) return reply(401, { error: "invalid_or_expired_session" });

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await db
    .from("user_profiles")
    .select("role,account_status")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || profile?.role !== "driver" || profile?.account_status !== "active") {
    return reply(403, { error: "active_driver_account_required" });
  }

  if (req.method === "GET") {
    const { data: row, error } = await db
      .from("driver_onboarding_drafts")
      .select("draft_payload_encrypted,updated_at")
      .eq("driver_user_id", userData.user.id)
      .maybeSingle();
    if (error) return reply(500, { error: "driver_onboarding_draft_unavailable" });

    if (!row) return reply(200, { draft: null, draft_updated_at: null });
    const { data: plaintext, error: decryptError } = await db.rpc("decrypt_driver_pii", {
      p_ciphertext: row.draft_payload_encrypted
    });
    if (decryptError || typeof plaintext !== "string") {
      return reply(500, { error: "driver_onboarding_draft_decryption_failed" });
    }
    try {
      const draft = JSON.parse(plaintext);
      if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
        return reply(500, { error: "driver_onboarding_draft_invalid" });
      }
      return reply(200, { draft, draft_updated_at: row.updated_at });
    } catch {
      return reply(500, { error: "driver_onboarding_draft_invalid" });
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply(400, { error: "invalid_form_data" });
  }
  if (form.get("action") !== "save_draft") {
    return reply(400, { error: "unsupported_draft_action" });
  }

  const draft: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key === "action" || value instanceof File || !allowedFields.has(key)) continue;
    if (typeof value === "string") draft[key] = value.slice(0, 2000);
  }

  const serialized = JSON.stringify(draft);
  if (serialized.length > 50000) return reply(413, { error: "draft_too_large" });

  const { data: ciphertext, error: encryptError } = await db.rpc("encrypt_driver_pii", {
    p_plaintext: serialized
  });
  if (encryptError || typeof ciphertext !== "string" || !ciphertext) {
    return reply(500, { error: "secure_draft_encryption_failed" });
  }

  const { error: saveError } = await db.from("driver_onboarding_drafts").upsert({
    driver_user_id: userData.user.id,
    draft_payload_encrypted: ciphertext,
    updated_at: new Date().toISOString()
  }, { onConflict: "driver_user_id" });

  if (saveError) return reply(500, { error: "driver_onboarding_draft_save_failed" });
  return reply(200, {
    saved: true,
    updated_at: new Date().toISOString(),
    message: "Your form details have been saved securely. Uploaded files must still be selected when you submit."
  });
});
