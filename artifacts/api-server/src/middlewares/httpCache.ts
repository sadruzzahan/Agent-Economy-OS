import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

/**
 * Adds a weak ETag and `Cache-Control: private, max-age=0, must-revalidate`
 * to JSON responses on GET requests. Returns 304 when If-None-Match matches.
 */
export function jsonEtagMiddleware() {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (req.method !== "GET") return next();
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown): Response {
      try {
        const payload =
          typeof body === "string" ? body : JSON.stringify(body);
        const hash = crypto
          .createHash("sha1")
          .update(payload)
          .digest("base64")
          .slice(0, 27);
        const etag = `W/"${hash}"`;
        res.setHeader("ETag", etag);
        if (!res.getHeader("Cache-Control")) {
          res.setHeader(
            "Cache-Control",
            "private, max-age=0, must-revalidate",
          );
        }
        const inm = req.headers["if-none-match"];
        if (typeof inm === "string" && inm === etag) {
          res.status(304).end();
          return res;
        }
        return originalJson(body);
      } catch {
        return originalJson(body);
      }
    } as Response["json"];
    next();
  };
}
