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
const activeStatuses = ["accepted", "picked_up", "in_transit"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!["GET", "POST"].includes(req.method)) return reply(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });

  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const actorId = authData.user.id;
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role,account_status").eq("id", actorId).maybeSingle();
  if (profileError) return reply(500, { error: "profile_lookup_failed" });
  if (!profile || profile.account_status !== "active") return reply(403, { error: "account_not_active" });

  if (req.method === "POST") {
    if (profile.role !== "driver") return reply(403, { error: "driver_account_required" });
    const { data: driverProfile, error: driverProfileError } = await admin.from("driver_profiles")
      .select("verification_status").eq("user_id", actorId).maybeSingle();
    if (driverProfileError) return reply(500, { error: "driver_profile_lookup_failed" });
    if (!driverProfile || driverProfile.verification_status !== "approved")
      return reply(403, { error: "approved_driver_required" });
    const raw = await req.text();
    if (raw.length > 2048) return reply(413, { error: "request_too_large" });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }
    if (typeof body.waybill !== "string" || !body.waybill.trim() || body.waybill.length > 100)
      return reply(400, { error: "invalid_waybill" });
    const { data: booking, error: bookingError } = await admin.from("customer_bookings")
      .select("waybill,status,driver_user_id,refunded_at").eq("waybill", body.waybill).maybeSingle();
    if (bookingError) return reply(500, { error: "delivery_lookup_failed" });
    if (!booking || booking.driver_user_id !== actorId) return reply(404, { error: "delivery_not_found" });
    if (booking.refunded_at || !activeStatuses.includes(booking.status))
      return reply(409, { error: "delivery_not_active" });

    if (body.sharing === false) {
      const { error } = await admin.from("driver_live_locations").delete()
        .eq("waybill", booking.waybill).eq("driver_user_id", actorId);
      if (error) return reply(500, { error: "location_sharing_stop_failed" });
      return reply(200, { sharing: false });
    }
    const lat = body.latitude, lng = body.longitude, accuracy = body.accuracy_m;
    if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
        typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
        (accuracy !== undefined && (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000)))
      return reply(400, { error: "invalid_location" });
    const { data: previousLocation, error: previousError } = await admin.from("driver_live_locations")
      .select("updated_at").eq("waybill", booking.waybill).maybeSingle();
    if (previousError) return reply(500, { error: "location_rate_check_failed" });
    if (previousLocation && Date.now() - Date.parse(previousLocation.updated_at) < 5000)
      return reply(429, { error: "location_update_too_frequent" });
    const updatedAt = new Date().toISOString();
    const { error } = await admin.from("driver_live_locations").upsert({
      waybill: booking.waybill, driver_user_id: actorId, latitude: lat, longitude: lng,
      accuracy_m: accuracy ?? null, updated_at: updatedAt,
    }, { onConflict: "waybill" });
    if (error) return reply(500, { error: "location_update_failed" });
    return reply(200, { sharing: true, updated_at: new Date().toISOString() });
  }

  const waybill = new URL(req.url).searchParams.get("waybill");
  if (!waybill || waybill.length > 100) return reply(400, { error: "waybill_required" });
  const { data: booking, error: bookingError } = await admin.from("customer_bookings")
    .select("waybill,status,driver_user_id,owner_hash,refunded_at")
    .eq("waybill", waybill).maybeSingle();
  if (bookingError) return reply(500, { error: "delivery_lookup_failed" });
  if (!booking || booking.refunded_at || !activeStatuses.includes(booking.status))
    return reply(404, { error: "active_delivery_not_found" });

  const isCustomerOwner = profile.role === "customer" && booking.owner_hash === actorId.toString();
  const isAssignedDriver = profile.role === "driver" && booking.driver_user_id === actorId;
  const isDispatcher = ["admin", "dispatcher"].includes(profile.role);
  if (!isCustomerOwner && !isAssignedDriver && !isDispatcher)
    return reply(404, { error: "delivery_not_found" });

  const { data: location, error } = await admin.from("driver_live_locations")
    .select("latitude,longitude,accuracy_m,updated_at").eq("waybill", waybill)
    .eq("driver_user_id", booking.driver_user_id).maybeSingle();
  if (error) return reply(500, { error: "location_lookup_failed" });
  if (!location || Date.now() - Date.parse(location.updated_at) > 120000) {
    if (location) await admin.from("driver_live_locations").delete().eq("waybill", waybill);
    return reply(200, { sharing: false, location: null, message: "Driver location is not currently being shared." });
  }
  return reply(200, { sharing: true, location });
});
