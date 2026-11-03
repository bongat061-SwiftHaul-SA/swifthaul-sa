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
const validText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 500;
const baseFees = { bike: 40, van: 80, truck: 180 } as const;
type Vehicle = keyof typeof baseFees;
class InputError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }

function calculateLoad(input: unknown) {
  const p = input as Record<string, unknown> | null;
  const keys = ["weight", "length", "width", "height"] as const;
  if (!p || keys.some(k => typeof p[k] !== "number" || !Number.isFinite(p[k]) || Number(p[k]) <= 0 || Number(p[k]) > 100000))
    throw new InputError("Enter a positive actual weight and all three packed dimensions.");
  const weight = Number(p.weight), length = Number(p.length), width = Number(p.width), height = Number(p.height);
  const volumetric = length * width * height / 5000, chargeable = Math.max(weight, volumetric);
  if (chargeable > 8000) throw new InputError("Loads above 8,000 chargeable kg require a manual quote. Contact dispatch.", 422);
  const vehicle: Vehicle = chargeable <= 20 ? "bike" : chargeable <= 1000 ? "van" : "truck";
  const truckClass = vehicle === "truck" ? (chargeable <= 4000 ? "4-ton" : "8-ton") : null;
  const included = vehicle === "bike" ? 5 : vehicle === "van" ? 50 : 1000;
  const rate = vehicle === "bike" ? 8.5 : vehicle === "van" ? 5 : truckClass === "4-ton" ? 0.45 : 0.5;
  const extra = Math.max(0, chargeable - included);
  const weightFee = Math.round((extra * rate + Number.EPSILON) * 100) / 100;
  return { weight, length, width, height, volumetric, chargeable, vehicle, truckClass, included, rate, extra, weightFee, divisor: 5000 };
}
function pin(value: unknown) {
  if (value == null) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.latitude !== "number" || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 ||
      typeof p.longitude !== "number" || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180)
    throw new InputError("Select a valid pickup or drop-off map pin.");
  return { latitude: p.latitude, longitude: p.longitude };
}
async function routeFor(pickupAddress: string, dropoffAddress: string, pickupPin: ReturnType<typeof pin>, dropoffPin: ReturnType<typeof pin>) {
  const getJSON = async (url: URL) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("Map provider unavailable");
    return await r.json();
  };
  const geocode = async (address: string) => {
    const url = new URL("https://photon.komoot.io/api/");
    url.search = new URLSearchParams({ q: address, limit: "1", bbox: "16,-35,33,-22" }).toString();
    const data = await getJSON(url), feature = data.features?.[0], coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2 || !coords.every(Number.isFinite) ||
        coords[0] < 16 || coords[0] > 33 || coords[1] < -35 || coords[1] > -22) return null;
    const p = feature.properties || {};
    const label = [p.name, [p.housenumber, p.street].filter(Boolean).join(" "), p.city || p.town || p.district, p.country].filter(Boolean).join(", ");
    return { longitude: coords[0], latitude: coords[1], label: label || address };
  };
  const [pickup, dropoff] = await Promise.all([
    pickupPin ? Promise.resolve({ ...pickupPin, label: pickupAddress }) : geocode(pickupAddress),
    dropoffPin ? Promise.resolve({ ...dropoffPin, label: dropoffAddress }) : geocode(dropoffAddress),
  ]);
  if (!pickup || !dropoff) throw new InputError("We could not locate one of these addresses in South Africa. Enter a fuller address or choose a map pin.", 422);
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${pickup.longitude},${pickup.latitude};${dropoff.longitude},${dropoff.latitude}`);
  url.search = new URLSearchParams({ overview: "simplified", geometries: "geojson", alternatives: "false", steps: "false" }).toString();
  const data = await getJSON(url), r = data.routes?.[0], coordinates = r?.geometry?.coordinates;
  if (data.code === "NoRoute") throw new InputError("No driving route was found. Check the locations or select different pins.", 422);
  if (data.code !== "Ok" || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 20000 ||
      !coordinates.every((c: unknown) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite)) ||
      !Number.isFinite(r?.distance) || !Number.isFinite(r?.duration) || r.distance < 0 || r.duration < 0)
    throw new Error("Invalid route response");
  return { pickup, dropoff, coordinates, distance: r.distance, duration: r.duration };
}
function parseLocation(body: Record<string, unknown>, prefix: "pickup" | "dropoff") {
  const lat = body[prefix + "_latitude"], lng = body[prefix + "_longitude"], code = body[prefix + "_plus_code"], hash = body[prefix + "_geohash"];
  const supplied = [lat, lng, code, hash].some(v => v !== undefined && v !== null && v !== "");
  if (!supplied) return { latitude: null, longitude: null, plus_code: null, geohash: null };
  if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
      typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
      typeof code !== "string" || code.length < 4 || code.length > 16 || !code.includes("+") ||
      typeof hash !== "string" || !/^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(hash))
    throw new InputError("Choose a valid map pin with its Plus Code and Geohash.");
  return { latitude: lat, longitude: lng, plus_code: code, geohash: hash };
}
function futureTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()) return null;
  return new Date(value).toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!["GET", "POST"].includes(req.method)) return reply(405, { error: "method_not_allowed" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "missing_bearer_token" });
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "server_configuration_error" });
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "invalid_or_expired_session" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const user = authData.user, owner = user.id;
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role,account_status").eq("id", owner).maybeSingle();
  if (profileError) return reply(500, { error: "profile_lookup_failed" });
  if (!profile || profile.role !== "customer" || profile.account_status !== "active") return reply(403, { error: "active_customer_account_required" });
  const { data: deletion } = await admin.from("customer_deletions").select("owner_hash").eq("owner_hash", owner).maybeSingle();
  if (deletion) return reply(403, { error: "profile_deletion_pending" });

  if (req.method === "GET") {
    const { data, error } = await admin.from("customer_bookings")
      .select("waybill,pin,pickup,dropoff,recipient,vehicle,price,distance_meters,price_band,load,distance_fee,scheduled_at,return_address,return_at,payment_method,counter_offer,counter_offer_status,original_price,paid_at,completed_at,payment_source,assigned_driver,pickup_latitude,pickup_longitude,pickup_plus_code,pickup_geohash,dropoff_latitude,dropoff_longitude,dropoff_plus_code,dropoff_geohash,refunded_at,created_at,status")
      .eq("owner_hash", owner).order("created_at", { ascending: false }).limit(100);
    if (error) return reply(500, { error: "booking_list_failed" });
    return reply(200, { orders: data ?? [], canImport: false });
  }

  const raw = await req.text();
  if (raw.length > 8192) return reply(413, { error: "request_too_large" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }

  if (body.action === "quote") {
    if (!validText(body.pickup) || !validText(body.dropoff)) return reply(400, { error: "enter_pickup_and_dropoff" });
    try {
      const pickupPin = pin(body.pickup_location), dropoffPin = pin(body.dropoff_location), load = calculateLoad(body.parcel);
      const route = await routeFor(body.pickup.trim(), body.dropoff.trim(), pickupPin, dropoffPin);
      const band = Math.floor(route.distance / 12000), distanceFee = baseFees[load.vehicle] * (2 ** band);
      if (!Number.isSafeInteger(distanceFee)) throw new InputError("This route requires a manual quote. Contact dispatch.", 422);
      const cents = Math.round(distanceFee * 100) + Math.round(load.weightFee * 100);
      if (!Number.isSafeInteger(cents)) throw new InputError("This load and route require a manual quote.", 422);
      const id = crypto.randomUUID();
      const { data: quote, error } = await admin.from("delivery_quotes").insert({
        id, owner_hash: owner, pickup: body.pickup.trim(), dropoff: body.dropoff.trim(),
        vehicle: load.vehicle, distance_meters: route.distance, price_band: band, price: cents / 100,
        route, load, distance_fee: distanceFee,
      }).select("id,expires_at").single();
      if (error || !quote) return reply(503, { error: "quote_save_failed" });
      return reply(200, { quote: { id: quote.id, expires_at: quote.expires_at, price: cents / 100, band, vehicle: load.vehicle, route, load, distanceFee } });
    } catch (e) {
      return reply(e instanceof InputError ? e.status : 502, { error: e instanceof Error ? e.message : "route_quote_failed" });
    }
  }

  if (body.action !== "book" || typeof body.quote_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.quote_id) ||
      typeof body.recipient !== "string" || !body.recipient.trim() || body.recipient.length > 500)
    return reply(400, { error: "calculate_a_quote_and_enter_recipient" });
  const { data: existing } = await admin.from("customer_bookings")
    .select("waybill,pin,pickup,dropoff,recipient,vehicle,price,distance_meters,price_band,load,distance_fee,scheduled_at,return_address,return_at,payment_method,counter_offer,counter_offer_status,original_price,paid_at,completed_at,payment_source,assigned_driver,pickup_latitude,pickup_longitude,pickup_plus_code,pickup_geohash,dropoff_latitude,dropoff_longitude,dropoff_plus_code,dropoff_geohash,refunded_at,created_at")
    .eq("quote_id", body.quote_id).eq("owner_hash", owner).maybeSingle();
  if (existing) return reply(200, { order: existing });
  const { data: quote, error: quoteError } = await admin.from("delivery_quotes")
    .select("id,pickup,dropoff,vehicle,distance_meters,price_band,price,load,distance_fee")
    .eq("id", body.quote_id).eq("owner_hash", owner).gt("expires_at", new Date().toISOString()).not("load", "is", null).maybeSingle();
  if (quoteError || !quote) return reply(409, { error: "quote_expired_recalculate_route" });

  const distance = Number(quote.distance_meters);
  const method = body.payment_method ?? "dispatch";
  if (method !== "cash" && method !== "dispatch") return reply(400, { error: "choose_cash_or_dispatch_payment" });
  if (method === "cash" && distance >= 12000) return reply(400, { error: "cash_available_only_below_12km" });
  let offer: number | null = null;
  let offerStatus = "none";
  if (body.counter_offer !== undefined && body.counter_offer !== null && body.counter_offer !== "") {
    if (typeof body.counter_offer !== "string" || !/^\\d{1,10}(?:\\.\\d{1,2})?$/.test(body.counter_offer) ||
        Number(body.counter_offer) <= 0 || distance >= 24000)
      return reply(400, { error: "counter_offer_not_eligible_or_invalid_amount" });
    offer = Number(body.counter_offer);
    offerStatus = "pending";
  }
  let pickup, dropoff;
  try { pickup = parseLocation(body, "pickup"); dropoff = parseLocation(body, "dropoff"); }
  catch (e) { return reply(400, { error: e instanceof Error ? e.message : "invalid_location_pin" }); }
  const scheduled = body.scheduled_at ? futureTime(body.scheduled_at) : null;
  const returnAddress = typeof body.return_address === "string" ? body.return_address.trim() : "";
  const returnAt = body.return_at ? futureTime(body.return_at) : null;
  if ((body.scheduled_at && !scheduled) || returnAddress.length > 500 ||
      (body.return_at && (!returnAt || !returnAddress)) || (scheduled && returnAt && Date.parse(returnAt) < Date.parse(scheduled)))
    return reply(400, { error: "use_valid_future_pickup_and_return_times" });

  const waybill = "SH-" + crypto.randomUUID().toUpperCase();
  const pinCode = String(crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000);
  const insert = {
    waybill, owner_hash: owner, pin: pinCode, pickup: quote.pickup, dropoff: quote.dropoff,
    recipient: body.recipient.trim(), vehicle: quote.vehicle, price: quote.price,
    distance_meters: distance, price_band: quote.price_band, quote_id: quote.id,
    load: quote.load, distance_fee: quote.distance_fee, scheduled_at: scheduled,
    return_address: returnAddress || null, return_at: returnAt, payment_method: method,
    counter_offer: offer, counter_offer_status: offerStatus,
    pickup_latitude: pickup.latitude, pickup_longitude: pickup.longitude, pickup_plus_code: pickup.plus_code, pickup_geohash: pickup.geohash,
    dropoff_latitude: dropoff.latitude, dropoff_longitude: dropoff.longitude, dropoff_plus_code: dropoff.plus_code, dropoff_geohash: dropoff.geohash,
  };
  const { data: order, error: insertError } = await admin.from("customer_bookings").insert(insert).select("*").single();
  if (insertError) {
    const { data: retry } = await admin.from("customer_bookings")
      .select("waybill,pin,pickup,dropoff,recipient,vehicle,price,distance_meters,price_band,load,distance_fee,scheduled_at,return_address,return_at,payment_method,counter_offer,counter_offer_status,original_price,paid_at,completed_at,payment_source,assigned_driver,pickup_latitude,pickup_longitude,pickup_plus_code,pickup_geohash,dropoff_latitude,dropoff_longitude,dropoff_plus_code,dropoff_geohash,refunded_at,created_at")
      .eq("quote_id", body.quote_id).eq("owner_hash", owner).maybeSingle();
    if (retry) return reply(200, { order: retry });
    console.error("Customer booking insert failed", insertError.message);
    return reply(503, { error: "booking_save_failed" });
  }
  return reply(201, { order });
});
