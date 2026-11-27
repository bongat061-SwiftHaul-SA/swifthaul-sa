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
const roundCell = (value: number) => Math.round(value * 100) / 100;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (!["GET", "POST"].includes(req.method)) return reply(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  if (req.method === "POST") {
    const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return reply(401, { error: "sign_in_required" });
    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
    const raw = await req.text();
    if (raw.length > 1024) return reply(413, { error: "request_too_large" });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }
    if (body.action !== "get_consent" && (body.action !== "set_consent" || typeof body.opt_in !== "boolean"))
      return reply(400, { error: "invalid_consent_request" });

    const actorId = authData.user.id;
    const { data: profile, error: profileError } = await admin.from("user_profiles")
      .select("role,account_status").eq("id", actorId).maybeSingle();
    if (profileError) return reply(500, { error: "profile_lookup_failed" });
    if (!profile || profile.role !== "driver" || profile.account_status !== "active")
      return reply(403, { error: "active_driver_account_required" });
    const { data: driver, error: driverError } = await admin.from("driver_profiles")
      .select("verification_status").eq("user_id", actorId).maybeSingle();
    if (driverError) return reply(500, { error: "driver_profile_lookup_failed" });
    if (!driver || driver.verification_status !== "approved")
      return reply(403, { error: "approved_driver_required" });

    if (body.action === "get_consent") {
      const { data: consent, error: consentError } = await admin.from("driver_profiles")
        .select("customer_availability_map_opt_in").eq("user_id", actorId).maybeSingle();
      if (consentError) return reply(500, { error: "consent_lookup_failed" });
      return reply(200, { opt_in: consent?.customer_availability_map_opt_in === true });
    }

    const { error: updateError } = await admin.from("driver_profiles").update({
      customer_availability_map_opt_in: body.opt_in,
      customer_availability_map_opt_in_at: body.opt_in ? new Date().toISOString() : null,
    }).eq("user_id", actorId);
    if (updateError) return reply(500, { error: "consent_update_failed" });
    if (!body.opt_in) {
      await admin.from("driver_online_locations").delete().eq("driver_user_id", actorId);
    }
    return reply(200, { saved: true, opt_in: body.opt_in });
  }

  const params = new URL(req.url).searchParams;
  const south = Number(params.get("south"));
  const west = Number(params.get("west"));
  const north = Number(params.get("north"));
  const east = Number(params.get("east"));
  if (![south, west, north, east].every(Number.isFinite) ||
      south < -90 || north > 90 || west < -180 || east > 180 ||
      south >= north || west >= east || north - south > 1.5 || east - west > 1.5)
    return reply(400, { error: "valid_bounded_map_view_required" });

  const cutoff = new Date(Date.now() - 120_000).toISOString();
  const { data: eligible, error: eligibleError } = await admin.from("driver_profiles")
    .select("user_id")
    .eq("verification_status", "approved")
    .eq("is_online", true)
    .eq("can_go_online", true)
    .eq("customer_availability_map_opt_in", true)
    .limit(500);
  if (eligibleError) return reply(500, { error: "availability_lookup_failed" });
  const ids = (eligible ?? []).map((row: { user_id: string }) => row.user_id);
  if (!ids.length) return reply(200, { points: [], onlineCount: 0, updatedAt: new Date().toISOString() });

  const { data: locations, error: locationError } = await admin.from("driver_online_locations")
    .select("latitude,longitude,updated_at")
    .in("driver_user_id", ids)
    .gte("updated_at", cutoff)
    .gte("latitude", south).lte("latitude", north)
    .gte("longitude", west).lte("longitude", east)
    .limit(500);
  if (locationError) return reply(500, { error: "location_lookup_failed" });

  const buckets = new Map<string, { latitude: number; longitude: number; count: number }>();
  for (const location of locations ?? []) {
    const latitude = roundCell(Number(location.latitude));
    const longitude = roundCell(Number(location.longitude));
    const key = latitude.toFixed(2) + ":" + longitude.toFixed(2);
    const bucket = buckets.get(key) ?? { latitude, longitude, count: 0 };
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return reply(200, {
    points: [...buckets.values()],
    onlineCount: (locations ?? []).length,
    updatedAt: new Date().toISOString(),
    freshnessSeconds: 120,
    precision: "approximate_grid",
  });
});