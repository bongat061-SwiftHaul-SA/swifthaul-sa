import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });

  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = authData.user.id;
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("id, role, account_status").eq("id", userId).maybeSingle();
  if (profileError || !profile) return reply(404, { error: "account_profile_not_found" });
  if (profile.role !== "driver") return reply(403, { error: "driver_account_required" });
  if (profile.account_status !== "active") return reply(403, { error: "account_not_active" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }

  if (body.action === "update-profile") {
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (fullName.length < 2 || fullName.length > 120) return reply(400, { error: "Enter a name between 2 and 120 characters." });
    if (phone.length < 7 || phone.length > 30) return reply(400, { error: "Enter a valid phone number." });

    const { error: updateError } = await admin.from("user_profiles").update({
      full_name: fullName, phone, updated_at: new Date().toISOString(),
    }).eq("id", userId);
    if (updateError) {
      console.error("Driver profile update failed", updateError.message);
      return reply(500, { error: "profile_update_failed" });
    }
    const { error: driverError } = await admin.from("driver_profiles").update({
      phone, updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
    if (driverError) {
      console.error("Driver contact update failed", driverError.message);
      return reply(500, { error: "driver_contact_update_failed" });
    }
    return reply(200, { success: true, full_name: fullName, phone });
  }

  if (body.action === "delete-account") {
    if (body.confirmation !== "DELETE") return reply(400, { error: "type_DELETE_to_confirm" });
    // Preserve delivery, payout and compliance history; anonymise personal profile data,
    // suspend the account and permanently block sign-in rather than cascading financial records.
    const { error: driverError } = await admin.from("driver_profiles").update({
      phone: "0000000",
      license_number: "REDACTED",
      vehicle_registration: "REDACTED",
      emergency_contact_name: null,
      emergency_contact_phone: null,
      is_online: false,
      availability_status: "offline",
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
    if (driverError) {
      console.error("Driver account deactivation failed", driverError.message);
      return reply(500, { error: "account_deactivation_failed" });
    }
    const { error: profileUpdateError } = await admin.from("user_profiles").update({
      full_name: "Deleted Driver",
      phone: "0000000",
      account_status: "suspended",
      updated_at: new Date().toISOString(),
    }).eq("id", userId);
    if (profileUpdateError) {
      console.error("Account anonymisation failed", profileUpdateError.message);
      return reply(500, { error: "account_anonymisation_failed" });
    }
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "876000h",
      user_metadata: { account_deleted: true, deleted_at: new Date().toISOString() },
    });
    if (banError) {
      console.error("Driver sign-in block failed", banError.message);
      return reply(500, { error: "account_signin_block_failed" });
    }
    return reply(200, {
      success: true,
      message: "Your driver account has been closed and personal profile details anonymised. Financial and delivery records are retained where required for business, legal and reconciliation purposes.",
    });
  }

  return reply(400, { error: "unsupported_action" });
});
