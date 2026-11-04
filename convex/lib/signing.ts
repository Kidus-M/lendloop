/**
 * HMAC-SHA256 request signing used in both directions between Convex and n8n.
 *
 * The signed string is `<unix seconds>.<METHOD>.<path>.<raw body>`. Binding the
 * method and path stops a captured signature being replayed against a different
 * endpoint; binding the timestamp limits how long a capture stays useful.
 */

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const SIGNATURE_VERSION = "v1";
export const MAX_CLOCK_SKEW_SECONDS = 300;

export type SignedRequest = {
  timestamp: string;
  method: string;
  path: string;
  body: string;
};

function signingString(request: SignedRequest): string {
  const { timestamp, method, path, body } = request;
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

async function importKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signRequest(
  secret: string,
  request: SignedRequest,
): Promise<string> {
  const key = await importKey(secret, "sign");
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingString(request)),
  );
  const hex = [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${SIGNATURE_VERSION}=${hex}`;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length !== 64 || !/^[0-9a-f]+$/.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export type VerifyFailure = "malformed" | "stale" | "bad_signature";

export async function verifyRequest(
  secret: string,
  signature: string | null,
  request: SignedRequest,
  nowMs: number = Date.now(),
): Promise<{ ok: true } | { ok: false; reason: VerifyFailure }> {
  const seconds = Number(request.timestamp);
  if (!signature || !Number.isInteger(seconds)) {
    return { ok: false, reason: "malformed" };
  }
  if (Math.abs(nowMs / 1000 - seconds) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const prefix = `${SIGNATURE_VERSION}=`;
  const provided = signature.startsWith(prefix)
    ? hexToBytes(signature.slice(prefix.length))
    : null;
  if (!provided) return { ok: false, reason: "malformed" };

  // subtle.verify compares in constant time, unlike `===` on two hex strings.
  const key = await importKey(secret, "verify");
  const matches = await crypto.subtle.verify(
    "HMAC",
    key,
    provided,
    new TextEncoder().encode(signingString(request)),
  );
  return matches ? { ok: true } : { ok: false, reason: "bad_signature" };
}
