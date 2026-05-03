import type { Request, Response, NextFunction } from "express";
import { env } from "./env";
import { Errors } from "./errors";

/**
 * Generic in-memory token-bucket rate limiter. Single-process by design —
 * we run on a single Replit instance. The interface (`RateLimitStore`) makes
 * a Redis-backed implementation a drop-in swap.
 *
 * Buckets are evicted on access (when their window expires) and via a
 * 5-minute background sweep so the Map can't grow unbounded under
 * high-cardinality keys (e.g. one IP per attacker).
 */

export interface RateLimitStore {
  hit(
    key: string,
    windowMs: number,
    limit: number,
  ): { allowed: boolean; remaining: number; resetAt: number };
}

interface Bucket {
  count: number;
  resetAt: number;
}

class InMemoryStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();

  constructor(sweepIntervalMs = 5 * 60_000) {
    setInterval(() => this.sweep(), sweepIntervalMs).unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (now >= b.resetAt) this.buckets.delete(k);
    }
  }

  hit(
    key: string,
    windowMs: number,
    limit: number,
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      const fresh: Bucket = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return { allowed: true, remaining: limit - 1, resetAt: fresh.resetAt };
    }
    if (bucket.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }
    bucket.count++;
    return {
      allowed: true,
      remaining: limit - bucket.count,
      resetAt: bucket.resetAt,
    };
  }
}

export const defaultStore: RateLimitStore = new InMemoryStore();

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
  /** Bucket name — keeps different limiters in different keyspaces. */
  bucket: string;
  /** Custom key extractor; defaults to client IP. */
  keyFn?: (req: Request) => string;
  store?: RateLimitStore;
}

/**
 * Resolve the client IP using Express's own `req.ip`, which honors the
 * configured `trust proxy` setting. We MUST NOT parse `X-Forwarded-For`
 * ourselves — doing so would let any client spoof the header and rotate
 * fake IPs through the rate limiter. `app.set("trust proxy", 1)` in
 * `app.ts` tells Express to trust exactly one hop (the platform proxy)
 * and reject the header otherwise. Falls back to the raw socket address
 * for tests/non-Express callers.
 */
export function getClientIp(req: Request): string {
  if (req.ip) return req.ip;
  return req.socket?.remoteAddress || "unknown";
}

export function createRateLimit(options: RateLimitOptions) {
  const store = options.store ?? defaultStore;
  const keyFn = options.keyFn ?? ((req: Request) => `ip:${getClientIp(req)}`);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (env.RATE_LIMIT_DISABLED) {
      next();
      return;
    }
    const key = `${options.bucket}:${keyFn(req)}`;
    const result = store.hit(key, options.windowMs, options.limit);
    res.setHeader("X-RateLimit-Limit", String(options.limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, result.remaining)));
    res.setHeader(
      "X-RateLimit-Reset",
      String(Math.ceil(result.resetAt / 1000)),
    );
    if (!result.allowed) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((result.resetAt - Date.now()) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfterSec));
      next(Errors.rateLimited());
      return;
    }
    next();
  };
}

/**
 * Per-user (when authenticated) or per-IP fallback. Use this on routes
 * mounted after `requireAuth`.
 */
export function userOrIpKey(req: Request): string {
  const user = (req as { dbUser?: { id: number } }).dbUser;
  if (user?.id != null) return `user:${user.id}`;
  return `ip:${getClientIp(req)}`;
}
