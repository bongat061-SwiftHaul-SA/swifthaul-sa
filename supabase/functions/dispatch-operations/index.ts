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
const validStatuses = ["pending", "assigned", "accepted", "picked_up", "in_transit", "delivered", "failed", "cancelled"];

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
  const { data: profile, error: profileError } = await admin
    .from("user_profiles").select("role,account_status").eq("id", actorId).maybeSingle();
  if (profileError) return reply(500, { error: "profile_lookup_failed" });
  if (!profile || profile.account_status !== "active") return reply(403, { error: "account_not_active" });
  const isDriver = profile.role === "driver";
  const isDispatcher = ["admin", "dispatcher"].includes(profile.role);
  if (!isDriver && !isDispatcher) return reply(403, { error: "dispatch_access_required" });

  if (req.method === "GET") {
    let query = admin.from("customer_bookings")
      .select("waybill,pickup,dropoff,recipient,vehicle,price,payment_method,paid_at,completed_at,scheduled_at,return_address,status,driver_user_id,created_at,failure_reason")
      .order("created_at", { ascending: false }).limit(100);
    if (isDriver) query = query.eq("driver_user_id", actorId);
    const { data, error } = await query;
    if (error) {
      console.error("Dispatch list failed", error.message);
      return reply(500, { error: "dispatch_list_failed" });
    }
    const { data: driver } = isDriver
      ? await admin.from("driver_profiles").select("verification_status,availability_status").eq("user_id", actorId).maybeSingle()
      : { data: null };
    return reply(200, { orders: data ?? [], driverProfile: driver });
  }

  const raw = await req.text();
  if (raw.length > 4096) return reply(413, { error: "request_too_large" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body.waybill !== "string" || body.waybill.length > 100) return reply(400, { error: "invalid_waybill" });

  const { data: order, error: orderError } = await admin.from("customer_bookings")
    .select("waybill,status,driver_user_id,pin,pin_attempts,pin_locked_until,completed_at,refunded_at")
    .eq("waybill", body.waybill).maybeSingle();
  if (orderError) return reply(500, { error: "delivery_lookup_failed" });
  if (!order) return reply(404, { error: "delivery_not_found" });

  const setStatus = async (next: string, notes?: string) => {
    const update: Record<string, unknown> = { status: next };
    if (next === "accepted") update.accepted_at = new Date().toISOString();
    if (next === "picked_up") update.picked_up_at = new Date().toISOString();
    if (next === "in_transit") update.in_transit_at = new Date().toISOString();
    if (next === "failed") {
      update.failed_at = new Date().toISOString();
      update.failure_reason = notes ?? "Delivery failed";
    }
    if (next === "delivered") update.completed_at = new Date().toISOString();
    const { error } = await admin.from("customer_bookings").update(update).eq("waybill", order.waybill);
    if (error) throw error;
    const { error: eventError } = await admin.from("delivery_status_events").insert({
      waybill: order.waybill, actor_user_id: actorId, previous_status: order.status,
      new_status: next, notes: notes ?? null,
    });
    if (eventError) console.error("Status event insert failed", eventError.message);
  };

  if (isDispatcher && body.action === "assign") {
    if (["delivered", "failed", "cancelled"].includes(order.status) || order.refunded_at)
      return reply(409, { error: "delivery_is_closed" });
    if (typeof body.driver_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.driver_id))
      return reply(400, { error: "enter_valid_driver_account_id" });
    const { data: driver, error } = await admin.from("driver_profiles")
      .select("user_id,verification_status").eq("user_id", body.driver_id).maybeSingle();
    if (error) return reply(500, { error: "driver_lookup_failed" });
    if (!driver || driver.verification_status !== "approved") return reply(409, { error: "driver_not_approved" });
    const { error: updateError } = await admin.from("customer_bookings")
      .update({ driver_user_id: driver.user_id, assigned_driver: driver.user_id, status: "assigned" })
      .eq("waybill", order.waybill);
    if (updateError) return reply(500, { error: "assignment_failed" });
    await admin.from("delivery_status_events").insert({
      waybill: order.waybill, actor_user_id: actorId, previous_status: order.status,
      new_status: "assigned", notes: "Assigned by dispatch",
    });
    return reply(200, { assigned: true });
  }

  if (!isDriver) return reply(403, { error: "driver_action_required" });
  if (order.driver_user_id !== actorId) return reply(404, { error: "delivery_not_found" });
  if (order.refunded_at || ["delivered", "failed", "cancelled"].includes(order.status))
    return reply(409, { error: "delivery_is_closed" });

  const transitions: Record<string, { from: string[]; to: string }> = {
    accept: { from: ["assigned"], to: "accepted" },
    pickup: { from: ["accepted"], to: "picked_up" },
    in_transit: { from: ["picked_up"], to: "in_transit" },
  };
  if (typeof body.action === "string" && transitions[body.action]) {
    const transition = transitions[body.action];
    if (!transition.from.includes(order.status)) return reply(409, { error: "invalid_status_transition" });
    await setStatus(transition.to);
    return reply(200, { updated: true, status: transition.to });
  }
  if (body.action === "fail") {
    if (!["accepted", "picked_up", "in_transit"].includes(order.status)) return reply(409, { error: "invalid_status_transition" });
    if (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 300)
      return reply(400, { error: "provide_delivery_failure_reason" });
    await setStatus("failed", body.reason.trim());
    return reply(200, { updated: true, status: "failed" });
  }
  if (body.action === "complete") {
    if (order.status !== "in_transit") return reply(409, { error: "delivery_must_be_in_transit" });
    if (typeof body.pin !== "string" || !/^\d{4}$/.test(body.pin)) return reply(400, { error: "enter_recipient_four_digit_pin" });
    if (order.pin_locked_until && new Date(order.pin_locked_until).getTime() > Date.now())
      return reply(429, { error: "pin_entry_locked_retry_later" });
    if (order.pin !== body.pin) {
      const attempts = Number(order.pin_attempts ?? 0) + 1;
      await admin.from("customer_bookings").update({
        pin_attempts: attempts,
        pin_locked_until: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
      }).eq("waybill", order.waybill);
      return reply(400, { error: "incorrect_recipient_pin" });
    }
    await admin.from("customer_bookings").update({
      status: "delivered", completed_at: new Date().toISOString(),
      pin_attempts: 0, pin_locked_until: null,
    }).eq("waybill", order.waybill);
    await admin.from("delivery_status_events").insert({
      waybill: order.waybill, actor_user_id: actorId, previous_status: order.status,
      new_status: "delivered", notes: "Recipient PIN verified",
    });
    return reply(200, { completed: true });
  }
  return reply(400, { error: "unknown_dispatch_action" });
});
