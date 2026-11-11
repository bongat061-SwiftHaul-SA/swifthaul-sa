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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("account-pin missing required environment configuration");
    return respond(500, { error: "server_configuration_error" });
  }

  // The login action is intentionally public at the gateway, but still requires
  // this project's publishable/anon API key. All privileged work stays server-side.
  if (!req.headers.get("apikey")) return respond(401, { error: "unauthorized" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return respond(400, { error: "invalid_json" }); }

  const action = String(body.action ?? "");
  const appType = String(body.app_type ?? "");
  if (!["customer", "driver"].includes(appType)) return respond(400, { error: "invalid_app_type" });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === "login") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const pin = String(body.pin ?? "");
    if (!email || email.length > 254 || !/^\d{6}$/.test(pin)) {
      return respond(400, { error: "Enter your email address and six-digit PIN." });
    }

    const { data: rows, error: verifyError } = await admin.rpc("verify_account_login_pin", {
      p_email: email,
      p_app_type: appType,
      p_pin: pin,
    });
    if (verifyError) {
      console.error("PIN verification failed", verifyError.message);
      return respond(500, { error: "PIN sign-in is temporarily unavailable." });
    }

    const result = Array.isArray(rows) ? rows[0] : rows;
    if (result?.locked_until && new Date(result.locked_until).getTime() > Date.now()) {
      return respond(429, { error: "Too many incorrect PIN attempts. Try again in 15 minutes or use password recovery." });
    }
    if (!result?.authenticated || !result?.user_id) {
      return respond(401, { error: "Email or PIN is incorrect, or a PIN has not been set up." });
    }

    const { data: userResult, error: userError } = await admin.auth.admin.getUserById(result.user_id);
    const emailForLink = userResult?.user?.email;
    if (userError || !emailForLink || userResult.user.email_confirmed_at == null) {
      return respond(401, { error: "This account cannot use PIN sign-in. Please use password sign-in." });
    }

    // Mint a real Supabase Auth session using a one-time magic-link token.
    // The PIN itself is never used as a JWT secret or returned to the client.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: emailForLink,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error("Could not mint PIN session", linkError?.message ?? "missing token hash");
      return respond(500, { error: "Unable to start a secure session. Please use password sign-in." });
    }

    const { data: sessionData, error: sessionError } = await admin.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    if (sessionError || !sessionData.session) {
      console.error("Could not exchange PIN token for session", sessionError?.message ?? "missing session");
      return respond(500, { error: "Unable to start a secure session. Please use password sign-in." });
    }

    return respond(200, {
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_in: sessionData.session.expires_in,
        token_type: sessionData.session.token_type,
      },
    });
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return respond(401, { error: "missing_bearer_token" });

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(match[1]);
  if (authError || !authData.user) return respond(401, { error: "invalid_or_expired_session" });

  if (action === "status") {
    const { data, error } = await admin.rpc("account_login_pin_status", {
      p_user_id: authData.user.id,
      p_app_type: appType,
    });
    if (error) {
      console.error("PIN status lookup failed", error.message);
      return respond(500, { error: "pin_status_unavailable" });
    }
    return respond(200, { has_pin: data === true });
  }

  if (action === "set") {
    const pin = String(body.pin ?? "");
    if (!/^\d{6}$/.test(pin)) return respond(400, { error: "PIN must contain exactly six digits." });
    const { error } = await admin.rpc("set_account_login_pin", {
      p_user_id: authData.user.id,
      p_app_type: appType,
      p_pin: pin,
    });
    if (error) {
      console.error("PIN setup failed", error.message);
      if (error.message.includes("account_not_eligible")) return respond(403, { error: "This account is not eligible to set up a PIN." });
      if (error.message.includes("email_not_confirmed")) return respond(403, { error: "Confirm your email address before setting up a PIN." });
      return respond(500, { error: "Unable to save your PIN. Please try again." });
    }
    return respond(200, { success: true });
  }

  return respond(400, { error: "unsupported_action" });
});
