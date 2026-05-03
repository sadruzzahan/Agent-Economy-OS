/**
 * Money is stored and computed in integer minor units (USD cents). This
 * module is the single source of truth for converting between
 *
 *   - cents (number, integer, what the DB and Stripe both speak)
 *   - dollars (number, what the legacy API surface and UI show today)
 *   - human strings (formatted for display)
 *
 * Never do `dollars * 100` or `cents / 100` outside this file. Float math
 * on currency is the kind of bug you find in production at 3am.
 *
 * `Cents` is a branded type so the compiler stops you from mixing the
 * two units up. `dollarsToCents(1.005)` rounds bank-style (half-even is
 * overkill for whole-cent inputs we control); we bail on non-finite or
 * out-of-range inputs.
 *
 * Maximum safe value is ~2^53 cents, which is more than $90 trillion;
 * fits in a JS number without precision loss.
 */

declare const __cents: unique symbol;
export type Cents = number & { readonly [__cents]: void };

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export function asCents(n: number): Cents {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Invalid cents value (must be a finite integer): ${n}`);
  }
  if (Math.abs(n) > MAX_SAFE_CENTS) {
    throw new Error(`Cents value out of safe range: ${n}`);
  }
  return n as Cents;
}

/** Parse a value that came back from the DB as `bigint("mode: number")`. */
export function centsFromDb(v: number | string | bigint | null | undefined): Cents {
  if (v == null) return asCents(0);
  if (typeof v === "number") return asCents(Math.trunc(v));
  if (typeof v === "bigint") {
    if (v > BigInt(MAX_SAFE_CENTS) || v < BigInt(-MAX_SAFE_CENTS)) {
      throw new Error(`Cents bigint exceeds safe range: ${v.toString()}`);
    }
    return asCents(Number(v));
  }
  // string (numeric column or transport)
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid cents string: ${v}`);
  }
  return asCents(Math.round(n));
}

export function dollarsToCents(d: number): Cents {
  if (!Number.isFinite(d)) {
    throw new Error(`Invalid dollar amount: ${d}`);
  }
  // Round to the nearest cent. Inputs are user-provided dollars (e.g.
  // 19.99 from a form field); standard math rounding is what people expect.
  return asCents(Math.round(d * 100));
}

export function centsToDollars(c: Cents | number): number {
  // Plain division — both operands are integers and the result is the
  // dollar value as a JS number for the legacy JSON API. UI formats it.
  return Math.round(c) / 100;
}

export function addCents(a: Cents, b: Cents): Cents {
  return asCents(a + b);
}

export function subCents(a: Cents, b: Cents): Cents {
  return asCents(a - b);
}

export function maxCents(a: Cents, b: Cents): Cents {
  return asCents(Math.max(a, b));
}

export function clampNonNegative(c: number): Cents {
  return asCents(Math.max(0, Math.trunc(c)));
}

/** "1234" cents → "$12.34" — used for audit messages and logs only. */
export function formatCents(c: Cents | number): string {
  const dollars = centsToDollars(c);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(dollars);
}
