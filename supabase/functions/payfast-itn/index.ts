import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import CryptoJS from "npm:crypto-js@4.2.0";

const SANDBOX_VALIDATE_URL = "https://sandbox.payfast.co.za/eng/query/validate";
const cors = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
const response = (status: number, body: string) => new Response(body, { status, headers: cors });
function urlencode(value: string) {
  return encodeURIComponent(value.trim()).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%[0-9a-f]{2}/gi, m => m.toUpperCase()).replace(/%20/g, "+");
}
function signature(fields: Array<[string,string]>, passphrase: string) {
  const body = fields.filter(([k,v]) => k !== "signature" && v !== "")
    .map(([k,v]) => k + "=" + urlencode(v)).join("&");
  return CryptoJS.MD5(body + "&passphrase=" + urlencode(passphrase)).toString();
}
function ipv4(value: string) {
  const parts = value.trim().split(".");
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((n,p) => ((n << 8) | Number(p)) >>> 0, 0);
}
function inCidr(ip: string, cidr: string) {
  const [network, bitsRaw] = cidr.split("/");
  const a = ipv4(ip), b = ipv4(network), bits = Number(bitsRaw);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}
const PAYFAST_IPS = ["197.97.145.144/28","41.74.179.192/27","102.216.36.0/28","102.216.36.128/28","144.126.193.139/32"];
function trustedSource(req: Request) {
  const direct = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  const forwarded = req.headers.get("x-forwarded-for") || "";
  // Prefer the proxy-provided client IP. If only X-Forwarded-For is present,
  // inspect its right-most hop because trusted proxies append to this header.
  const ip = (direct || forwarded.split(",").at(-1) || "").trim();
  return PAYFAST_IPS.some(range => inCidr(ip, range));
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response(405, "Method not allowed");
  if (!trustedSource(req)) return response(403, "Untrusted payment notification source");
  const raw = await req.text();
  if (raw.length > 32768) return response(413, "Notification too large");
  const params = new URLSearchParams(raw);
  const entries = Array.from(params.entries());
  const payload: Record<string,string> = {};
  for (const [key,value] of entries) {
    if (Object.prototype.hasOwnProperty.call(payload,key)) return response(400, "Duplicate notification field");
    payload[key] = value;
  }
  const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID") || "10000100";
  const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") || "jt7NOE43FZPn";
  if (payload.merchant_id !== merchantId || !payload.signature || !payload.m_payment_id?.startsWith("SH-PF-"))
    return response(400, "Invalid merchant or payment reference");
  const expected = signature(entries, passphrase);
  if (!constantTimeEqual(expected, payload.signature.toLowerCase())) return response(400, "Invalid notification signature");

  const validation = await fetch(SANDBOX_VALIDATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: raw,
    signal: AbortSignal.timeout(12000),
  });
  const validationText = (await validation.text()).trim();
  if (!validation.ok || validationText !== "VALID") return response(400, "PayFast notification validation failed");

  const match = /^SH-PF-([0-9a-f-]{36})$/i.exec(payload.m_payment_id);
  if (!match || !payload.pf_payment_id || payload.pf_payment_id.length > 100)
    return response(400, "Invalid payment identifiers");
  const amount = Number(payload.amount_gross);
  if (payload.payment_status !== "COMPLETE" || !Number.isFinite(amount) || amount < 5)
    return response(200, "Notification received; payment is not complete");

  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return response(500, "Payment confirmation service unavailable");
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: payment } = await admin.from("payment_transactions")
    .select("id,amount,status").eq("id", match[1]).eq("m_payment_id", payload.m_payment_id).maybeSingle();
  if (!payment) return response(404, "Payment reference not found");
  if (Math.round(Number(payment.amount) * 100) !== Math.round(amount * 100))
    return response(400, "Payment amount does not match booking amount");

  const { data: applied, error } = await admin.rpc("apply_payfast_payment", {
    p_payment_id: match[1],
    p_pf_payment_id: payload.pf_payment_id,
    p_amount: amount,
    p_payload: payload,
  });
  if (error) {
    console.error("PayFast payment confirmation failed", error.message);
    return response(503, "Payment confirmation could not be saved");
  }
  if (applied !== true) return response(409, "Payment is no longer eligible for confirmation");
  return response(200, "OK");
});
