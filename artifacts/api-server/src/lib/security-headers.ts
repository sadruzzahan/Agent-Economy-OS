import type { Request, Response, NextFunction } from "express";
import { isProduction } from "./env";

/**
 * Lightweight Helmet-equivalent security headers. We intentionally avoid the
 * `helmet` dependency to keep the bundle small; the defaults below match
 * Helmet's recommended values for an API + same-origin React SPA.
 *
 * - HSTS: force HTTPS for one year (prod only — dev uses http on Replit).
 * - X-Content-Type-Options: prevent MIME sniffing.
 * - X-Frame-Options + CSP frame-ancestors: deny framing (clickjacking).
 *   Note: we allow framing from the Replit preview iframe in dev.
 * - Referrer-Policy: strict-origin-when-cross-origin.
 * - Permissions-Policy: deny unused browser APIs.
 * - X-DNS-Prefetch-Control: off.
 * - X-Download-Options: noopen (legacy IE).
 * - Cross-Origin-Opener-Policy: same-origin.
 *
 * The Content-Security-Policy is kept loose because the React app loads from a
 * different artifact path and Clerk requires several third-party origins; we
 * tighten frame-ancestors only.
 */
export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (isProduction) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Download-Options", "noopen");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

    // Frame-ancestors: in production only allow same-origin embedding so the
    // dashboard can't be clickjacked. In development we leave it open so the
    // Replit preview iframe works. X-Frame-Options is the legacy fallback.
    if (isProduction) {
      res.setHeader(
        "Content-Security-Policy",
        "frame-ancestors 'self'",
      );
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
    }

    next();
  };
}

/**
 * Per-request correlation ID. Honors an inbound `x-request-id` (proxy may
 * set one) so the same id flows through pino-http logs and our error
 * responses.
 */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.headers["x-request-id"];
    const id =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() ||
      // pino-http already assigns req.id; reuse it if present
      ((req as { id?: string | number }).id !== undefined
        ? String((req as { id: string | number }).id)
        : crypto.randomUUID());
    (req as { id: string }).id = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}
