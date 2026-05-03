import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import type { Agent } from "@workspace/db";
import { createRateLimit, getClientIp } from "../lib/rate-limit";

declare global {
  namespace Express {
    interface Request {
      apiKeyAgent?: Agent;
    }
  }
}

// Per-hashed-key rate limiter: 100 requests/minute. Backed by the shared
// in-memory store with bounded eviction.
const apiKeyRateLimit = createRateLimit({
  bucket: "api-key",
  windowMs: 60_000,
  limit: 100,
  // The key extractor runs before we attach the agent, so derive directly
  // from the bearer token (hashed for safety).
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
      res.status(401).json({
        error:
          "Missing or invalid Authorization header. Use: Authorization: Bearer <api_key>",
        code: "unauthorized",
      });
      return;
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: "Missing API key", code: "unauthorized" });
      return;
    }

    const keyHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    try {
      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.apiKeyHash, keyHash));

      if (!agent || agent.status !== "active") {
        res.status(401).json({
          error: "Invalid API key or inactive agent",
          code: "unauthorized",
        });
        return;
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
