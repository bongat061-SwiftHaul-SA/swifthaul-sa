import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const response = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function verifySignature(req: Request, rawBody: string, secret: string): Promise<boolean> {
  const id = req.headers.get("webhook-id");
  const timestamp = req.headers.get("webhook-timestamp");
  const signatures = req.headers.get("webhook-signature");
  if (!id || !timestamp || !signatures || !secret.startsWith("whsec_")) return false;

  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 180) return false;

  let keyBytes: Uint8Array;
  try { keyBytes = decodeBase64(secret.slice("whsec_".length)); } catch { return false; }
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return signatures.split(" ").some((entry) => {
    const [version, signature] = entry.split(",", 2);
    return version === "v1" && !!signature && constantTimeEqual(signature, expected);
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response(405, "Method not allowed");
  const raw = await req.text();
  if (raw.length > 65536) return response(413, "Payload too large");

  const webhookSecret = Deno.env.get("YOCO_WEBHOOK_SECRET") ?? "";
  if (!await verifySignature(req, raw, webhookSecret)) return response(401, "Invalid webhook signature");

  let event: Record<string, unknown>;
  try { event = JSON.parse(raw); } catch { return response(400, "Invalid JSON"); }
  if (event.type !== "payment.succeeded") return response(200, "Event acknowledged");

  const payment = event.payload as Record<string, unknown> | undefined;
  const checkoutId = (payment?.metadata as Record<string, unknown> | undefined)?.checkoutId;
  const eventId = event.id;
  const mode = Deno.env.get("YOCO_MODE");
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service || (mode !== "test" && mode !== "live"))
    return response(503, "Payment confirmation unavailable");

  if (typeof checkoutId !== "string" || !checkoutId || typeof eventId !== "string" ||
      payment?.status !== "succeeded" || payment?.type !== "payment" ||
      payment?.currency !== "ZAR" || !Number.isSafeInteger(payment?.amount) ||
      payment?.mode !== (mode === "test" ? "test" : "live"))
    return response(400, "Payment details do not match configured mode or currency");

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: applied, error } = await admin.rpc("apply_yoco_booking_payment", {
    p_checkout_id: checkoutId,
    p_event_id: eventId,
    p_amount_cents: payment.amount,
    p_currency: payment.currency,
    p_payment_mode: mode === "test" ? "sandbox" : "live",
    p_payload: event,
  });
  if (error) {
    console.error("Yoco booking settlement failed", error.message);
    return response(503, "Payment confirmation could not be saved");
  }
  if (applied !== true) return response(409, "Checkout is not eligible for booking settlement");
  return response(200, "OK");
});
