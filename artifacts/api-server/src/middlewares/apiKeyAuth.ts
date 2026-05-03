import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import type { Agent } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      apiKeyAgent?: Agent;
    }
  }
}

// In-memory rate limiter: 100 requests/minute per hashed API key.
// Expired entries are evicted on access and periodically via a sweep so the Map
// does not grow unbounded under high-cardinality invalid-key traffic.
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

// Sweep expired buckets every 5 minutes to bound memory usage
const SWEEP_INTERVAL_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref(); // unref so this timer doesn't keep the process alive

function checkRateLimit(keyHash: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 100;
  const bucket = rateLimitBuckets.get(keyHash);
  if (!bucket || now >= bucket.resetAt) {
    // Evict stale entry on access before setting the new window
    rateLimitBuckets.set(keyHash, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

export async function requireApiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header. Use: Authorization: Bearer <api_key>" });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const keyHash = crypto.createHash("sha256").update(token).digest("hex");

  if (!checkRateLimit(keyHash)) {
    res.status(429).json({ error: "Rate limit exceeded. Max 100 requests/minute per agent key." });
    return;
  }

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.apiKeyHash, keyHash));

  if (!agent || agent.status !== "active") {
    res.status(401).json({ error: "Invalid API key or inactive agent" });
    return;
  }

  req.apiKeyAgent = agent;

  // Update last_active_at (fire and forget — non-blocking)
  db.update(agentsTable)
    .set({ lastActiveAt: new Date() })
    .where(eq(agentsTable.id, agent.id))
    .catch(() => {});

  next();
}
