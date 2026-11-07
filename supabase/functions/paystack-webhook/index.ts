import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const response = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

import { verifyLegacySignature, verifyModernSignature } from "./signature.ts";

async function validSignature(req: Request, raw: string) {
  const modern = req.headers.get("Paystack-Signature");
  if (modern) {
    const signingSecret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET");
    return await verifyModernSignature(modern, raw, signingSecret ?? "");
  }
  return await verifyLegacySignature(
    req.headers.get("x-paystack-signature"),
    raw,
    Deno.env.get("PAYSTACK_SECRET_KEY") ?? "",
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response(405, "Method not allowed");
  const raw = await req.text();
  if (raw.length > 65536) return response(413, "Payload too large");
  if (!await validSignature(req, raw)) return response(401, "Invalid webhook signature");

  let event: Record<string, unknown>;
  try { event = JSON.parse(raw); } catch { return response(400, "Invalid JSON"); }
  if (event.event !== "charge.success") return response(200, "Event acknowledged");

  const data = event.data as Record<string, unknown> | undefined;
  const reference = data?.reference;
  if (typeof reference !== "string" || !/^SHPS-[A-Fa-f0-9]{32}$/.test(reference))
    return response(200, "Unrelated payment acknowledged");

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const mode = Deno.env.get("PAYSTACK_MODE");
  if (!url || !service || !secret || (mode !== "test" && mode !== "live")) {
    console.error("Paystack webhook configuration is incomplete");
    return response(503, "Payment confirmation unavailable");
  }

  const verification = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!verification?.ok) return response(503, "Payment verification unavailable");
  const verified = await verification.json().catch(() => null);
  const payment = verified?.data;
  if (!verified?.status || payment?.status !== "success" || payment?.reference !== reference)
    return response(200, "Payment is not successful");

  const expectedDomain = mode === "test" ? "test" : "live";
  if (payment.domain !== expectedDomain || payment.currency !== "ZAR" ||
      !Number.isSafeInteger(payment.amount) || payment.amount < 500 ||
      typeof payment.id !== "number" && typeof payment.id !== "string")
    return response(400, "Verified payment details do not match configured mode or currency");

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: applied, error } = await admin.rpc("apply_paystack_booking_payment", {
    p_reference: reference,
    p_paystack_transaction_id: String(payment.id),
    p_amount_cents: payment.amount,
    p_currency: payment.currency,
    p_payment_mode: mode === "test" ? "sandbox" : "live",
    p_payload: { event: "charge.success", reference, transaction_id: String(payment.id), mode: payment.domain },
  });
  if (error) {
    console.error("Paystack booking settlement failed", error.message);
    return response(503, "Payment confirmation could not be saved");
  }
  if (applied !== true) return response(409, "Payment reference is not eligible for booking settlement");
  return response(200, "OK");
});
