import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import type { Agent } from "@workspace/db";
import { createRateLimit, getClientIp } from "../lib/rate-limit";
import { Errors } from "../lib/errors";

declare global {
  namespace Express {
    interface Request {
      apiKeyAgent?: Agent;
    }
  }
}

// Per-hashed-key rate limiter: 100 requests/minute. Backed by the shared
// in-memory store with bounded eviction. Hashing the bearer token before
// using it as a key prevents the raw secret from ever sitting in process
// memory as a map key.
const apiKeyRateLimit = createRateLimit({
  bucket: "api-key",
  windowMs: 60_000,
  limit: 100,
  keyFn: (req: Request) => {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!token) return `ip:${getClientIp(req)}`;
    return `hash:${crypto.createHash("sha256").update(token).digest("hex")}`;
  },
});

export async function requireApiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Apply the rate limit first so unknown-key floods don't hit the DB.
  apiKeyRateLimit(req, res, async (limitErr) => {
    if (limitErr) return next(limitErr);

    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      return next(
        Errors.unauthorized(
          "Missing or invalid Authorization header. Use: Authorization: Bearer <api_key>",
        ),
      );
    }
    const token = authHeader.slice(7).trim();
    if (!token) return next(Errors.unauthorized("Missing API key"));

    const keyHash = crypto.createHash("sha256").update(token).digest("hex");

    try {
      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.apiKeyHash, keyHash));

      if (!agent || agent.status !== "active") {
        return next(
          Errors.unauthorized("Invalid API key or inactive agent"),
        );
      }

      req.apiKeyAgent = agent;

      // Update last-used telemetry. Fire and forget.
      const ip = getClientIp(req);
      db.update(agentsTable)
        .set({
          lastActiveAt: new Date(),
          apiKeyLastUsedAt: new Date(),
          apiKeyLastUsedIp: ip,
        })
        .where(eq(agentsTable.id, agent.id))
        .catch(() => {});

      next();
    } catch (err) {
      next(err);
    }
  });
}
