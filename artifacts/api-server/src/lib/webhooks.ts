import crypto from "node:crypto";

/**
 * Generic HMAC-SHA256 signature verification with timing-safe comparison.
 *
 * The signature must be the hex-encoded HMAC-SHA256 of `payload` using
 * `secret`. Use `verifyHmacWithTimestamp` instead when you have a
 * Stripe-style timestamped signature header.
 */
export function verifyHmacSignature(
  payload: string | Buffer,
  signatureHex: string,
  secret: string,
): boolean {
  if (!signatureHex || !secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  // Equal-length is required for timingSafeEqual; mismatched length is itself
  // a failed verification.
  if (expected.length !== signatureHex.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

/**
 * Parse a Stripe-style signature header of the form
 *   `t=1700000000,v1=abc123,v1=def456`
 * Returns the timestamp (seconds since epoch) and all `v1` signatures.
 * Multiple `v1` values are valid during a key rotation window.
 */
export function parseStripeSignature(header: string): {
  timestamp: number;
  signatures: string[];
} | null {
  if (!header) return null;
  const parts = header.split(",");
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const key = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n)) timestamp = n;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }
  if (timestamp == null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export interface VerifyHmacWithTimestampOptions {
  /** Max seconds the signature timestamp may differ from now. Default 300 (5 min). */
  toleranceSeconds?: number;
  /** Inject a clock for testing. */
  now?: () => number;
}

/**
 * Verify a Stripe-style signature header (`t=...,v1=...`). The signed
 * payload is `${timestamp}.${rawBody}` per Stripe's convention. Rejects if
 * the timestamp is outside the tolerance window (replay protection).
 *
 * Reusable for any service that adopts the same scheme (Clerk webhooks,
 * agent webhooks, etc.) as long as the secret and signed-string format
 * match.
 */
export function verifyHmacWithTimestamp(
  rawBody: string | Buffer,
  signatureHeader: string,
  secret: string,
  options: VerifyHmacWithTimestampOptions = {},
): boolean {
  const { toleranceSeconds = 300, now = () => Math.floor(Date.now() / 1000) } =
    options;
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed) return false;
  const drift = Math.abs(now() - parsed.timestamp);
  if (drift > toleranceSeconds) return false;

  const bodyStr =
    typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const signedPayload = `${parsed.timestamp}.${bodyStr}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");

  // Accept any of the candidate signatures (Stripe sends multiple during
  // key rotation).
  for (const sig of parsed.signatures) {
    if (sig.length !== expected.length) continue;
    try {
      const sigBuf = Buffer.from(sig, "hex");
      if (
        sigBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(sigBuf, expectedBuf)
      ) {
        return true;
      }
    } catch {
      // malformed candidate — ignore and try the next one
    }
  }
  return false;
}
