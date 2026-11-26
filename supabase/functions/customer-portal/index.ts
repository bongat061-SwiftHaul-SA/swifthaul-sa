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
const tariffClasses = {
  motorbike: { label: "Motorbike", capacity: 0, callOutFee: 60, distanceRate: 5, freeMinutes: 0, vehicle: "bike" },
  light_commercial: { label: "Mini-Van / Light Commercial", capacity: 600, callOutFee: 250, distanceRate: 8.5, freeMinutes: 20, vehicle: "van" },
  one_ton_bakkie: { label: "1-Ton Bakkie / Panel Van", capacity: 1000, callOutFee: 220, distanceRate: 11, freeMinutes: 30, vehicle: "van" },
  closed_truck: { label: "1.5-Ton – 3-Ton Closed Truck", capacity: 3000, callOutFee: 450, distanceRate: 16.5, freeMinutes: 45, vehicle: "truck" },
  freight_truck: { label: "4-Ton – 8-Ton Freight Truck", capacity: 8000, callOutFee: 850, distanceRate: 24, freeMinutes: 60, vehicle: "truck" },
} as const;
type VehicleClass = keyof typeof tariffClasses;
type Vehicle = "bike" | "van" | "truck";
class InputError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }

function recommendedVehicleClass(chargeable: number): VehicleClass {
  if (chargeable <= 600) return "light_commercial";
  if (chargeable <= 1000) return "one_ton_bakkie";
  if (chargeable <= 3000) return "closed_truck";
  return "freight_truck";
}
function calculateLoad(input: unknown, selectedClass: unknown) {
  if (typeof selectedClass !== "string" || !Object.hasOwn(tariffClasses, selectedClass) || selectedClass === "freight_truck")
    throw new InputError("Choose an available vehicle before calculating the fare.");
  const vehicleClass = selectedClass as VehicleClass;
  const tariff = tariffClasses[vehicleClass];
  // Item weights and dimensions are descriptive only; they do not affect price or block the customer's vehicle choice.
  return {
    weight: 0, length: 0, width: 0, height: 0, volumetric: 0, chargeable: 0,
    vehicle: tariff.vehicle, vehicleClass, truckClass: tariff.label,
    recommendedVehicleClass: vehicleClass, capacity: tariff.capacity,
    callOutFee: tariff.callOutFee, distanceRate: tariff.distanceRate,
    freeMinutes: tariff.freeMinutes, divisor: 5000
  };
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
      .select("waybill,pin,pickup,dropoff,recipient,vehicle,price,distance_meters,price_band,load,distance_fee,scheduled_at,return_address,return_at,payment_method,counter_offer,counter_offer_status,original_price,paid_at,completed_at,payment_source,wallet_refund_used,wallet_promo_used,assigned_driver,pickup_latitude,pickup_longitude,pickup_plus_code,pickup_geohash,dropoff_latitude,dropoff_longitude,dropoff_plus_code,dropoff_geohash,tracking_code,refunded_at,created_at,assistance_requested,assistance_minutes,assistance_fee_cents,assistance_status,status")
      .eq("owner_hash", owner).order("created_at", { ascending: false }).limit(100);
    if (error) return reply(500, { error: "booking_list_failed" });
    const { data: wallet, error: walletError } = await admin.from("wallet_accounts")
      .select("refund_cents,promo_cents,promo_debt_cents").eq("owner_hash", owner).maybeSingle();
    const { data: refundRequests, error: refundError } = await admin.from("booking_refund_requests")
      .select("id,waybill,request_type,reason,refund_amount_cents,refund_source,status,created_at,reviewed_at")
      .eq("owner_id", owner).order("created_at", { ascending: false }).limit(50);
    if (refundError) return reply(500, { error: "refund_request_list_failed" });
    if (walletError) return reply(500, { error: "wallet_balance_lookup_failed" });
    const walletAvailable = wallet ? Number(wallet.refund_cents) + Math.max(0, Number(wallet.promo_cents) - Number(wallet.promo_debt_cents)) : 0;
    return reply(200, { orders: data ?? [], refundRequests: refundRequests ?? [], canImport: false, wallet: {
      refund_cents: wallet ? Number(wallet.refund_cents) : 0,
      promo_cents: wallet ? Number(wallet.promo_cents) : 0,
      promo_debt_cents: wallet ? Number(wallet.promo_debt_cents) : 0,
      available_cents: walletAvailable,
    } });
  }

  const raw = await req.text();
  if (raw.length > 8192) return reply(413, { error: "request_too_large" });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }

  if (body.action === "refund_request") {
    if (typeof body.waybill !== "string" || body.waybill.length > 100 ||
        (body.request_type !== "cancellation" && body.request_type !== "refund") ||
        !validText(body.reason)) return reply(400, { error: "enter_valid_refund_request_details" });
    const { data, error } = await admin.rpc("request_booking_refund", {
      p_owner_id: owner,
      p_waybill: body.waybill,
      p_request_type: body.request_type,
      p_reason: body.reason.trim(),
    });
    if (error || !data?.request) {
      const message = error?.message || "refund_request_failed";
      if (/Booking not found/i.test(message)) return reply(404, { error: "booking_not_found" });
      if (/can no longer be cancelled|Refund requests are available|already refunded/i.test(message))
        return reply(409, { error: "booking_not_eligible_for_this_request" });
      console.error("Refund request failed", message);
      return reply(503, { error: "refund_request_failed" });
    }
    return reply(data.already_requested ? 200 : 201, data);
  }

  if (body.action === "quote") {
    if (!validText(body.pickup) || !validText(body.dropoff)) return reply(400, { error: "enter_pickup_and_dropoff" });
    try {
      const pickupPin = pin(body.pickup_location), dropoffPin = pin(body.dropoff_location), load = calculateLoad(body.parcel, body.selected_vehicle);
      if (body.item_description !== undefined && (typeof body.item_description !== "string" || body.item_description.length > 1000)) return reply(400, { error: "item_description_too_long_or_invalid" });
      const itemDescription = typeof body.item_description === "string" ? body.item_description.trim() : "";
      if (itemDescription) load.customer_description = itemDescription;
      const route = await routeFor(body.pickup.trim(), body.dropoff.trim(), pickupPin, dropoffPin);
      let approachDriverId: string | null = null;
      let approachDistanceMeters = 0;
      let approachFee = 0;
      const approachRate = load.vehicleClass === "motorbike" ? 5 : load.vehicleClass === "light_commercial" ? 8 : 0;
      if (approachRate > 0) {
        // A route/fare quote must not depend on a driver being online at this exact moment.
        // When a suitable live driver is available, retain the existing pickup-approach calculation.
        const { data: onlineDrivers, error: onlineError } = await admin.from("driver_profiles")
          .select("user_id,vehicle_type,is_online,verification_status")
          .eq("is_online", true).eq("verification_status", "approved");
        if (!onlineError) {
          const matching = (onlineDrivers ?? []).filter((d: any) => {
            const type = String(d.vehicle_type || "").toLowerCase();
            return load.vehicleClass === "motorbike" ? type.includes("motor") :
              (type.includes("van") || type.includes("bakkie") || type.includes("panel") || type.includes("light_commercial"));
          });
          const ids = matching.map((d: any) => d.user_id);
          if (ids.length) {
            const { data: activeOrders, error: activeError } = await admin.from("customer_bookings")
              .select("driver_user_id").in("driver_user_id", ids)
              .in("status", ["assigned", "accepted", "picked_up", "in_transit"]).is("completed_at", null);
            if (!activeError) {
              const busyIds = new Set((activeOrders ?? []).map((x: any) => x.driver_user_id));
              await admin.from("driver_online_locations").delete().lt("updated_at", new Date(Date.now() - 90000).toISOString());
              const { data: locations, error: locationError } = await admin.from("driver_online_locations")
                .select("driver_user_id,latitude,longitude,updated_at").in("driver_user_id", ids)
                .gte("updated_at", new Date(Date.now() - 90000).toISOString());
              if (!locationError) {
                const fresh = (locations ?? []).filter((x: any) => !busyIds.has(x.driver_user_id) &&
                  Number.isFinite(Number(x.latitude)) && Number.isFinite(Number(x.longitude)));
                if (fresh.length) {
                  const haversine = (a: number, b: number, c: number, d: number) => {
                    const rad = Math.PI / 180, dl = (c-a)*rad, dg = (d-b)*rad;
                    const q = Math.sin(dl/2)**2 + Math.cos(a*rad)*Math.cos(c*rad)*Math.sin(dg/2)**2;
                    return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1-q));
                  };
                  const pickupLat = route.pickup.latitude, pickupLng = route.pickup.longitude;
                  const nearestFirst = fresh.map((x: any) => ({...x, approx: haversine(Number(x.latitude),Number(x.longitude),pickupLat,pickupLng)}))
                    .sort((a: any,b: any) => a.approx-b.approx).slice(0, 12);
                  const routed = await Promise.all(nearestFirst.map(async (d: any) => {
                    try {
                      const url = new URL(`https://router.project-osrm.org/route/v1/driving/${d.longitude},${d.latitude};${pickupLng},${pickupLat}`);
                      url.search = new URLSearchParams({overview:"false",alternatives:"false",steps:"false"}).toString();
                      const response = await fetch(url, {signal:AbortSignal.timeout(8000),headers:{Accept:"application/json"}});
                      if (!response.ok) return null;
                      const data = await response.json(), meters = Number(data.routes?.[0]?.distance);
                      return data.code === "Ok" && Number.isFinite(meters) && meters >= 0 ? {driverId:d.driver_user_id,meters} : null;
                    } catch { return null; }
                  }));
                  const ranked = routed.filter((x: any) => x && Number.isFinite(x.meters))
                    .sort((a: any,b: any) => a.meters-b.meters);
                  const waitForCloser = body.wait_for_closer_driver === true;
                  const chosen = waitForCloser ? ranked.find((x: any) => x.meters <= 8000) : ranked[0];
                  if (!chosen && waitForCloser && ranked.length)
                    throw new InputError("No suitable driver is currently within the included 8 km. You can keep waiting and check again.", 409);
                  if (chosen) {
                    approachDriverId = chosen.driverId;
                    approachDistanceMeters = chosen.meters;
                    approachFee = Math.round((Math.max(0, approachDistanceMeters / 1000 - 8) * approachRate + Number.EPSILON) * 100) / 100;
                  }
                }
              }
            }
          }
        }
      }
      const band = 0;
      let callOutFee = load.callOutFee;
      let distanceFee = 0;
      if (load.vehicleClass === "motorbike") {
        const distanceTotal = route.distance / 1000 * load.distanceRate;
        const total = Math.max(load.callOutFee, distanceTotal);
        distanceFee = Math.round((total - load.callOutFee + Number.EPSILON) * 100) / 100;
      } else {
        callOutFee = load.vehicleClass === "light_commercial"
          ? (route.distance >= 24000 ? 450 : route.distance > 8000 ? 350 : 250)
          : load.callOutFee;
        distanceFee = Math.round((route.distance / 1000 * load.distanceRate + Number.EPSILON) * 100) / 100;
      }
      load.callOutFee = callOutFee;
      const cents = Math.round((callOutFee + distanceFee + approachFee + Number.EPSILON) * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0) throw new InputError("This route requires a manual quote. Contact dispatch.", 422);
      const id = crypto.randomUUID();
      const { data: quote, error } = await admin.from("delivery_quotes").insert({
        id, owner_hash: owner, pickup: body.pickup.trim(), dropoff: body.dropoff.trim(),
        vehicle: load.vehicle, distance_meters: route.distance, price_band: band, price: cents / 100,
        route, load, distance_fee: distanceFee,
        pickup_approach_driver_user_id: approachDriverId,
        pickup_approach_distance_meters: approachDistanceMeters,
        pickup_approach_fee: approachFee,
        pickup_approach_quoted_at: approachDriverId ? new Date().toISOString() : null,
        expires_at: new Date(Date.now() + (approachDriverId ? 5 : 30) * 60 * 1000).toISOString(),
      }) .select("id,expires_at").single();
      if (error || !quote) return reply(503, { error: "quote_save_failed" });
      return reply(200, { quote: { id: quote.id, expires_at: quote.expires_at, price: cents / 100, band, vehicle: load.vehicle, vehicleClass: load.vehicleClass, route, load, callOutFee, distanceFee, distanceRate: load.distanceRate, freeMinutes: load.freeMinutes, pickupApproach: { distanceMeters: approachDistanceMeters, fee: approachFee, includedKm: 8, driverMatched: Boolean(approachDriverId), requiresApproval: approachFee > 0 } } });
    } catch (e) {
      return reply(e instanceof InputError ? e.status : 502, { error: e instanceof Error ? e.message : "route_quote_failed" });
    }
  }

  if (body.action !== "book" || typeof body.quote_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.quote_id) ||
      body.terms_accepted !== true || body.terms_version !== "2026-11-14-gauteng-vehicle-tariffs" ||
      typeof body.recipient !== "string" || !body.recipient.trim() || body.recipient.length > 500)
    return reply(400, { error: "calculate_a_quote_and_enter_recipient" });
  const { data: existing } = await admin.from("customer_bookings")
    .select("waybill,pin,pickup,dropoff,recipient,vehicle,price,distance_meters,price_band,load,distance_fee,scheduled_at,return_address,return_at,payment_method,counter_offer,counter_offer_status,original_price,paid_at,completed_at,payment_source,assigned_driver,pickup_latitude,pickup_longitude,pickup_plus_code,pickup_geohash,dropoff_latitude,dropoff_longitude,dropoff_plus_code,dropoff_geohash,refunded_at,created_at,assistance_requested,assistance_minutes,assistance_fee_cents,assistance_status")
    .eq("quote_id", body.quote_id).eq("owner_hash", owner).maybeSingle();
  if (existing) return reply(200, { order: existing });
  const { data: quote, error: quoteError } = await admin.from("delivery_quotes")
    .select("id,pickup,dropoff,vehicle,distance_meters,price_band,price,load,distance_fee,expires_at,pickup_approach_driver_user_id,pickup_approach_distance_meters,pickup_approach_fee,pickup_approach_quoted_at")
    .eq("id", body.quote_id).eq("owner_hash", owner).maybeSingle();
  if (quoteError) return reply(503, { error: "quote_lookup_failed" });
  if (!quote) return reply(409, { error: "quote_not_found_recalculate_route" });
  if (Date.parse(quote.expires_at) <= Date.now()) return reply(409, { error: "quote_expired_recalculate_route" });
  if (!quote.load) return reply(409, { error: "quote_incomplete_recalculate_route" });
  const approachFee = Number(quote.pickup_approach_fee || 0);
  if (approachFee > 0 && body.pickup_approach_approved !== true)
    return reply(409, { error: "pickup_approach_charge_requires_customer_approval" });
  if (["motorbike","light_commercial"].includes(String(quote.load?.vehicleClass)) && quote.pickup_approach_driver_user_id &&
      (!quote.pickup_approach_quoted_at || Date.now() - Date.parse(quote.pickup_approach_quoted_at) > 300000))
    return reply(409, { error: "pickup_driver_match_expired_recalculate_quote" });

  const { error: termsAcceptanceError } = await admin.from("customer_booking_terms_acceptances").upsert({
    owner_id: owner,
    quote_id: quote.id,
    terms_version: body.terms_version,
  }, { onConflict: "owner_id,quote_id,terms_version", ignoreDuplicates: true });
  if (termsAcceptanceError) {
    console.error("Customer terms acceptance could not be recorded", termsAcceptanceError.message);
    return reply(503, { error: "terms_acceptance_record_failed" });
  }

  const distance = Number(quote.distance_meters);
  const assistanceRequested = body.assistance_requested === true;
  const assistanceMinutes = assistanceRequested ? Number(body.assistance_minutes) : 0;
  const assistanceFeeCents = assistanceRequested ? Number(body.assistance_fee_cents) : 0;
  if (assistanceRequested) {
    if (!Number.isInteger(assistanceMinutes) || assistanceMinutes < 30 || assistanceMinutes > 120 || assistanceMinutes % 30 !== 0)
      return reply(400, { error: "choose_assistance_duration_between_30_and_120_minutes" });
    if (quote.vehicle !== "van" && quote.vehicle !== "truck") return reply(400, { error: "assistance_requires_a_supported_vehicle" });
    const isTruckClass = quote.load?.vehicleClass === "closed_truck" || quote.load?.vehicleClass === "freight_truck";
    const expectedFee = (isTruckClass ? 35000 : 18000) + ((assistanceMinutes / 30) - 1) * (isTruckClass ? 18000 : 10000);
    if (assistanceFeeCents !== expectedFee) return reply(400, { error: "assistance_quote_changed_recalculate_and_review" });
  } else if ((body.assistance_minutes ?? 0) !== 0 || (body.assistance_fee_cents ?? 0) !== 0) return reply(400, { error: "unexpected_assistance_amount" });
  const method = body.payment_method ?? "dispatch";
  if (method !== "cash" && method !== "dispatch" && method !== "wallet" && method !== "card") return reply(400, { error: "choose_a_valid_payment_method" });
  if (method === "cash" && distance >= 12000) return reply(400, { error: "cash_available_only_below_12km" });
  let offer: number | null = null;
  let offerStatus = "none";
  if (body.counter_offer !== undefined && body.counter_offer !== null && body.counter_offer !== "") {
    if (typeof body.counter_offer !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(body.counter_offer) ||
        Number(body.counter_offer) <= 0 || distance >= 24000 || method !== "dispatch")
      return reply(400, { error: "counter_offer_requires_dispatch_payment_and_valid_amount" });
    offer = Number(body.counter_offer);
    offerStatus = "pending";
  }
  if (method === "wallet" && assistanceRequested) return reply(400, { error: "wallet_payment_not_available_with_optional_assistance_yet_choose_dispatch_or_cash" });
  if (method === "wallet" && offer !== null) return reply(400, { error: "wallet_payment_not_available_with_counteroffers" });
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
    pickup_approach_driver_user_id: quote.pickup_approach_driver_user_id || null,
    pickup_approach_distance_meters: quote.pickup_approach_distance_meters || 0,
    pickup_approach_fee: approachFee,
    pickup_approach_approved: approachFee === 0 || body.pickup_approach_approved === true,
    return_address: returnAddress || null, return_at: returnAt, payment_method: method,
    assistance_requested: assistanceRequested, assistance_minutes: assistanceMinutes,
    assistance_fee_cents: assistanceFeeCents, assistance_status: assistanceRequested ? "requested_pending_dispatch_confirmation" : "not_requested",
    counter_offer: offer, counter_offer_status: offerStatus,
    pickup_latitude: pickup.latitude, pickup_longitude: pickup.longitude, pickup_plus_code: pickup.plus_code, pickup_geohash: pickup.geohash,
    dropoff_latitude: dropoff.latitude, dropoff_longitude: dropoff.longitude, dropoff_plus_code: dropoff.plus_code, dropoff_geohash: dropoff.geohash,
  };
  if (method === "wallet") {
    const walletBooking = {
      recipient: insert.recipient,
      scheduled_at: scheduled,
      return_address: returnAddress || null,
      return_at: returnAt,
      counter_offer: offer,
      counter_offer_status: offerStatus,
      pickup_latitude: pickup.latitude,
      pickup_longitude: pickup.longitude,
      pickup_plus_code: pickup.plus_code,
      pickup_geohash: pickup.geohash,
      dropoff_latitude: dropoff.latitude,
      dropoff_longitude: dropoff.longitude,
      dropoff_plus_code: dropoff.plus_code,
      dropoff_geohash: dropoff.geohash,
    };
    const { data: result, error: walletBookingError } = await admin.rpc("create_wallet_funded_booking", {
      p_owner_hash: owner,
      p_quote_id: quote.id,
      p_waybill: waybill,
      p_pin: pinCode,
      p_booking: walletBooking,
    });
    if (walletBookingError || !result?.order) {
      const message = walletBookingError?.message || "wallet_booking_failed";
      if (/Insufficient wallet balance/i.test(message)) return reply(409, { error: "insufficient_wallet_balance" });
      if (/Quote expired or not found/i.test(message)) return reply(409, { error: "quote_expired_recalculate_route" });
      console.error("Wallet booking failed", message);
      return reply(503, { error: "wallet_booking_failed" });
    }
    return reply(result.already_created ? 200 : 201, { order: result.order });
  }

  const { data: order, error: insertError } = await admin.from("customer_bookings").insert(insert).select("*").single();
  if (insertError) {
    const { data: retry } = await admin.from("customer_bookings")
      .select("waybill,pin,pickup,dropoff,recipient,vehicle,price,distance_meters,price_band,load,distance_fee,scheduled_at,return_address,return_at,payment_method,counter_offer,counter_offer_status,original_price,paid_at,completed_at,payment_source,assigned_driver,pickup_latitude,pickup_longitude,pickup_plus_code,pickup_geohash,dropoff_latitude,dropoff_longitude,dropoff_plus_code,dropoff_geohash,refunded_at,created_at,assistance_requested,assistance_minutes,assistance_fee_cents,assistance_status")
      .eq("quote_id", body.quote_id).eq("owner_hash", owner).maybeSingle();
    if (retry) return reply(200, { order: retry });
    console.error("Customer booking insert failed", insertError.message);
    return reply(503, { error: "booking_save_failed" });
  }
  return reply(201, { order });
});
