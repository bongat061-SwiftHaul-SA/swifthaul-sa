import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return respond(405, { error: "method_not_allowed" });

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

  const token = match[1];
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return respond(401, { error: "invalid_or_expired_session" });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("id, full_name, phone, role, account_status, created_at")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Profile lookup failed", profileError.message);
    return respond(500, { error: "profile_lookup_failed" });
  }
  if (!profile) return respond(404, { error: "profile_not_found" });
  if (profile.account_status === "suspended") return respond(403, { error: "account_suspended" });

  let driverProfile = null;
  if (profile.role === "driver") {
    const { data, error } = await admin
      .from("driver_profiles")
      .select("phone, license_expiry, vehicle_type, vehicle_registration, verification_status, availability_status")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (error) {
      console.error("Driver profile lookup failed", error.message);
      return respond(500, { error: "driver_profile_lookup_failed" });
    }
    driverProfile = data;
  }

  return respond(200, {
    user: {
      id: authData.user.id,
      email: authData.user.email ?? null,
      name: profile.full_name || authData.user.email || "Account",
      phone: profile.phone,
      role: profile.role,
      accountStatus: profile.account_status,
      createdAt: profile.created_at,
    },
    driverProfile,
  });
});
