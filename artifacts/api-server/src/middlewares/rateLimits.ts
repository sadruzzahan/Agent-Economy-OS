import { createRateLimit, userOrIpKey } from "../lib/rate-limit";

/**
 * Tiered rate limits. Numbers are conservative defaults aimed at honest
 * single-user traffic plus integration scripts. Tighten per-bucket as
 * abuse patterns emerge.
 *
 * - global: every API hit, IP-keyed. Catches naive scrapers.
 * - auth: /me sync and any sign-in callbacks — IP-keyed, low ceiling.
 * - wallet: top-up + balance reads — user-keyed, prevents balance-flood.
 * - taskAction: assign/verify/dispute/resolve — user-keyed.
 * - agentKey: key rotation — user-keyed, very low (rotation is rare).
 */
export const globalLimit = createRateLimit({
  bucket: "global",
  windowMs: 60_000,
  limit: 600,
});

export const authLimit = createRateLimit({
  bucket: "auth",
  windowMs: 60_000,
  limit: 30,
});

export const walletLimit = createRateLimit({
  bucket: "wallet",
  windowMs: 60_000,
  limit: 30,
  keyFn: userOrIpKey,
});

export const taskActionLimit = createRateLimit({
  bucket: "task-action",
  windowMs: 60_000,
  limit: 60,
  keyFn: userOrIpKey,
});

export const agentKeyLimit = createRateLimit({
  bucket: "agent-key",
  windowMs: 60 * 60_000, // 1 hour
  limit: 10,
  keyFn: userOrIpKey,
});
