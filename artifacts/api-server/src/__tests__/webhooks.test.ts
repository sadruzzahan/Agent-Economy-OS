import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  verifyHmacSignature,
  parseStripeSignature,
  verifyHmacWithTimestamp,
} from "../lib/webhooks";

const SECRET = "whsec_test_super_secret";

function sign(payload: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyHmacSignature", () => {
  it("accepts a correctly signed payload", () => {
    const body = '{"hello":"world"}';
    expect(verifyHmacSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const body = '{"hello":"world"}';
    expect(verifyHmacSignature(body + "x", sign(body), SECRET)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifyHmacSignature("body", "", SECRET)).toBe(false);
  });

  it("rejects when length mismatched (no exception)", () => {
    expect(verifyHmacSignature("body", "short", SECRET)).toBe(false);
  });

  it("rejects with wrong secret", () => {
    const body = "body";
    expect(verifyHmacSignature(body, sign(body), "other_secret")).toBe(false);
  });
});

describe("parseStripeSignature", () => {
  it("parses single v1", () => {
    const r = parseStripeSignature("t=1700000000,v1=abc");
    expect(r).toEqual({ timestamp: 1700000000, signatures: ["abc"] });
  });

  it("parses multiple v1 (rotation window)", () => {
    const r = parseStripeSignature("t=1700000000,v1=a,v1=b,v0=ignored");
    expect(r?.signatures).toEqual(["a", "b"]);
  });

  it("returns null on missing timestamp", () => {
    expect(parseStripeSignature("v1=abc")).toBeNull();
  });

  it("returns null on missing signature", () => {
    expect(parseStripeSignature("t=1700000000")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseStripeSignature("")).toBeNull();
  });
});

describe("verifyHmacWithTimestamp", () => {
  const NOW = 1_700_000_000;
  const body = '{"event":"test"}';

  function makeHeader(ts: number, secret = SECRET): string {
    const sig = crypto
      .createHmac("sha256", secret)
      .update(`${ts}.${body}`)
      .digest("hex");
    return `t=${ts},v1=${sig}`;
  }

  it("accepts a freshly signed payload", () => {
    expect(
      verifyHmacWithTimestamp(body, makeHeader(NOW), SECRET, {
        now: () => NOW,
      }),
    ).toBe(true);
  });

  it("rejects an expired timestamp (replay)", () => {
    expect(
      verifyHmacWithTimestamp(body, makeHeader(NOW - 600), SECRET, {
        now: () => NOW,
        toleranceSeconds: 300,
      }),
    ).toBe(false);
  });

  it("rejects a future timestamp beyond tolerance", () => {
    expect(
      verifyHmacWithTimestamp(body, makeHeader(NOW + 600), SECRET, {
        now: () => NOW,
        toleranceSeconds: 300,
      }),
    ).toBe(false);
  });

  it("rejects when body is tampered", () => {
    const header = makeHeader(NOW);
    expect(
      verifyHmacWithTimestamp(body + "x", header, SECRET, {
        now: () => NOW,
      }),
    ).toBe(false);
  });

  it("accepts when one of multiple v1 candidates matches (rotation)", () => {
    const goodSig = crypto
      .createHmac("sha256", SECRET)
      .update(`${NOW}.${body}`)
      .digest("hex");
    const header = `t=${NOW},v1=deadbeef${"0".repeat(goodSig.length - 8)},v1=${goodSig}`;
    expect(
      verifyHmacWithTimestamp(body, header, SECRET, { now: () => NOW }),
    ).toBe(true);
  });

  it("rejects malformed signature header", () => {
    expect(
      verifyHmacWithTimestamp(body, "not-a-real-header", SECRET, {
        now: () => NOW,
      }),
    ).toBe(false);
  });
});
