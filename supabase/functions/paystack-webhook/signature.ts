function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function equalHex(a: string, b: string) {
  if (!/^[a-f0-9]{128}$/i.test(a) || !/^[a-f0-9]{128}$/i.test(b)) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function verifyModernSignature(header: string | null, rawBody: string, secret: string, nowSeconds = Date.now() / 1000) {
  if (!header || !secret) return false;
  const fields = header.split(",").map(value => value.trim());
  const timestampField = fields.find(value => value.startsWith("t="));
  const timestamp = timestampField?.slice(2) ?? "";
  if (!/^\d{10}$/.test(timestamp)) return false;
  const timestampNumber = Number(timestamp);
  if (Math.abs(nowSeconds - timestampNumber) > 300) return false;
  const signatures = fields.filter(value => value.startsWith("v1=")).map(value => {
    const match = /^v1=(whk_[A-Za-z0-9_-]+):([a-f0-9]{128})$/i.exec(value);
    return match?.[2] ?? "";
  });
  if (!signatures.length) return false;
  const expected = await hmac(secret, timestamp + "." + rawBody);
  return signatures.some(signature => equalHex(signature, expected));
}

export async function verifyLegacySignature(signature: string | null, rawBody: string, secret: string) {
  if (!signature || !secret) return false;
  return equalHex(signature, await hmac(secret, rawBody));
}
