import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { env, isProduction, getAllowedOrigins } from "./lib/env";
import { securityHeaders, requestId } from "./lib/security-headers";
import { errorHandler, Errors } from "./lib/errors";
import {
  globalLimit,
  userBaselineLimit,
  authLimit,
} from "./middlewares/rateLimits";

const app: Express = express();

// Trust the platform proxy so req.ip / x-forwarded-for resolve correctly.
app.set("trust proxy", 1);

// Disable the framework banner — small attack-surface reduction.
app.disable("x-powered-by");

app.use(securityHeaders());
app.use(requestId());

app.use(
  pinoHttp({
    logger,
    genReqId: (req) =>
      (req as { id?: string }).id ?? Math.random().toString(36).slice(2),
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS lockdown: in production we restrict to ALLOWED_ORIGINS (and the
// Replit dev domain when set). In development we allow all origins so the
// preview iframe and local tooling work.
const allowedOrigins = getAllowedOrigins();
app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      // Same-origin requests (curl, server-to-server) have no Origin header.
      if (!origin) return cb(null, true);
      if (!isProduction) return cb(null, true);
      if (allowedOrigins.length === 0) {
        // Production with no configured origins → only same-origin allowed.
        return cb(null, false);
      }
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  }),
);

// Body size limits. 100kb is plenty for normal API payloads; routes that
// need more (e.g. task result blobs) can override locally.
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// The Clerk auth proxy is mounted UNDER /api so the same rate-limit
// stack applies. We add a stricter per-IP `authLimit` on top because
// this surface handles sign-in / token-issuance flows that are prime
// targets for credential-stuffing and brute-force probing. Order
// matters: globalLimit → userBaselineLimit → authLimit → proxy.
app.use("/api", globalLimit);
app.use("/api", userBaselineLimit);
app.use(CLERK_PROXY_PATH, authLimit, clerkProxyMiddleware());

app.use("/api", router);

// 404 for any /api path that didn't match a route.
app.use("/api", (_req, _res, next) => {
  next(Errors.notFound("Route not found"));
});

// Central error handler — MUST be last.
app.use(errorHandler);

export default app;
