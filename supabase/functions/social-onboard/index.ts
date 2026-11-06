import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const authorization = req.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return respond(401, { error: "missing_bearer_token" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("Missing required Supabase function environment variables");
    return respond(500, { error: "server_configuration_error" });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(match[1]);
  if (authError || !authData.user) return respond(401, { error: "invalid_or_expired_session" });
  const linkedProviders = Array.isArray(authData.user.app_metadata?.providers)
    ? authData.user.app_metadata.providers
    : [authData.user.app_metadata?.provider].filter(Boolean);
  if (!linkedProviders.some((provider: string) => provider === "google" || provider === "apple")) {
    return respond(403, { error: "google_or_apple_identity_required" });
  }
  if (!authData.user.email_confirmed_at && !authData.user.confirmed_at) {
    return respond(403, { error: "verified_provider_email_required" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: "invalid_json" });
  }

  const appType = body.app_type;
  if (appType !== "customer" && appType !== "driver") {
    return respond(400, { error: "unsupported_onboarding_type" });
  }
  if (body.terms_accepted !== true) return respond(400, { error: "terms_acceptance_required" });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("id, role, account_status, created_at")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Social onboarding profile lookup failed", profileError.message);
    return respond(500, { error: "profile_lookup_failed" });
  }
  if (!profile) return respond(404, { error: "profile_not_found" });
  if (profile.account_status !== "active") return respond(403, { error: "account_not_active" });

  if (appType === "customer") {
    if (profile.role !== "customer") return respond(403, { error: "customer_account_required" });
    const ageMs = Date.now() - new Date(profile.created_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 20 * 60 * 1000) {
      return respond(409, { error: "customer_profile_already_exists_use_sign_in" });
    }
    const fullName = clean(body.full_name, 120);
    if (fullName.length < 2) return respond(400, { error: "full_name_required" });
    const { error } = await admin.from("user_profiles")
      .update({ full_name: fullName, updated_at: new Date().toISOString() })
      .eq("id", authData.user.id)
      .eq("role", "customer");
    if (error) {
      console.error("Customer social profile update failed", error.message);
      return respond(500, { error: "customer_profile_update_failed" });
    }
  } else {
    const existingDriver = await admin.from("driver_profiles")
      .select("user_id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (existingDriver.error) {
      console.error("Driver social profile lookup failed", existingDriver.error.message);
      return respond(500, { error: "driver_profile_lookup_failed" });
    }
    if (profile.role === "driver" && existingDriver.data) {
      return respond(200, { success: true, role: "driver", verification_status: "pending_or_existing" });
    }
    if (profile.role !== "customer") return respond(403, { error: "driver_self_registration_not_permitted_for_this_role" });

    const ageMs = Date.now() - new Date(profile.created_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 20 * 60 * 1000) {
      return respond(409, { error: "existing_customer_account_cannot_be_converted_here" });
    }

    const fullName = clean(body.full_name, 120);
    const phone = clean(body.phone, 30);
    const licenseNumber = clean(body.license_number, 80);
    const licenseExpiry = clean(body.license_expiry, 10);
    const vehicleType = clean(body.vehicle_type, 20);
    const vehicleRegistration = clean(body.vehicle_registration, 30).toUpperCase();
    const southAfricaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

    if (fullName.length < 2) return respond(400, { error: "full_name_required" });
    if (phone.length < 7 || phone.length > 30) return respond(400, { error: "valid_phone_required" });
    if (licenseNumber.length < 3) return respond(400, { error: "valid_license_number_required" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry) || licenseExpiry <= southAfricaToday) {
      return respond(400, { error: "future_license_expiry_required" });
    }
    if (!["bike", "bakkie", "van", "truck"].includes(vehicleType)) {
      return respond(400, { error: "valid_vehicle_type_required" });
    }
    if (vehicleRegistration.length < 3) return respond(400, { error: "valid_vehicle_registration_required" });

    const { error: driverUpsertError } = await admin.from("driver_profiles").upsert({
      user_id: authData.user.id,
      phone,
      license_number: licenseNumber,
      license_expiry: licenseExpiry,
      vehicle_type: vehicleType,
      vehicle_registration: vehicleRegistration,
      verification_status: "pending",
      availability_status: "offline",
      is_online: false,
    }, { onConflict: "user_id" });
    if (driverUpsertError) {
      console.error("Driver social profile creation failed", driverUpsertError.message);
      return respond(500, { error: "driver_profile_creation_failed" });
    }

    const { error: roleUpdateError } = await admin.from("user_profiles")
      .update({ full_name: fullName, phone, role: "driver", updated_at: new Date().toISOString() })
      .eq("id", authData.user.id)
      .eq("role", "customer");
    if (roleUpdateError) {
      console.error("Driver role assignment failed", roleUpdateError.message);
      return respond(500, { error: "driver_role_assignment_failed_retry" });
    }
  }

  const metadata = {
    ...(authData.user.user_metadata ?? {}),
    terms_accepted: true,
    terms_version: clean(body.terms_version, 40) || "2026-11-06-social-auth",
  };
  if (appType === "driver") metadata.app_type = "driver";
  const { error: metadataError } = await admin.auth.admin.updateUserById(authData.user.id, {
    user_metadata: metadata,
  });
  if (metadataError) console.warn("Social onboarding metadata audit update failed", metadataError.message);

  return respond(200, {
    success: true,
    role: appType,
    verification_status: appType === "driver" ? "pending" : "active",
  });
});
