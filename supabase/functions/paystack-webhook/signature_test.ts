import { verifyLegacySignature, verifyModernSignature } from "./signature.ts";

async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.test("modern signature accepts a valid timestamped signature", async () => {
  const secret = "whsec_test_signing_secret";
  const body = '{"event":"charge.success"}';
  const timestamp = "1794096000";
  const signature = await sign(secret, timestamp + "." + body);
  const header = `t=${timestamp},v1=whk_testkey:${signature}`;
  if (!await verifyModernSignature(header, body, secret, Number(timestamp))) throw new Error("valid signature rejected");
});

Deno.test("modern signature accepts any valid v1 during secret rotation", async () => {
  const secret = "whsec_test_signing_secret";
  const body = '{"event":"charge.success"}';
  const timestamp = "1794096000";
  const signature = await sign(secret, timestamp + "." + body);
  const header = `t=${timestamp},v1=whk_oldkey:${"a".repeat(128)},v1=whk_newkey:${signature}`;
  if (!await verifyModernSignature(header, body, secret, Number(timestamp))) throw new Error("rotated signature rejected");
});

Deno.test("modern signature rejects stale timestamps and malformed key IDs", async () => {
  const secret = "whsec_test_signing_secret";
  const body = '{"event":"charge.success"}';
  const timestamp = "1794096000";
  const signature = await sign(secret, timestamp + "." + body);
  if (await verifyModernSignature(`t=${timestamp},v1=whk_testkey:${signature}`, body, secret, Number(timestamp) + 301)) throw new Error("stale signature accepted");
  if (await verifyModernSignature(`t=${timestamp},v1=bad-key:${signature}`, body, secret, Number(timestamp))) throw new Error("malformed key ID accepted");
});

Deno.test("legacy signature validates the raw body", async () => {
  const secret = "sk_test_example";
  const body = '{"event":"charge.success"}';
  const signature = await sign(secret, body);
  if (!await verifyLegacySignature(signature, body, secret)) throw new Error("valid legacy signature rejected");
  if (await verifyLegacySignature(signature, body + " ", secret)) throw new Error("modified body accepted");
});
