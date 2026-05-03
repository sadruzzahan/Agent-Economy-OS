import { describe, it, expect, vi, afterEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import {
  createRateLimit,
  getClientIp,
  userOrIpKey,
} from "../lib/rate-limit";
import { errorHandler } from "../lib/errors";

interface HitResult {
  status: number;
  headers: Record<string, string>;
}

async function listen(app: Express): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = http.createServer(app);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((res, rej) =>
        server.close((err) => (err ? rej(err) : res())),
      ),
  };
}

async function hit(
  port: number,
  ip = "1.2.3.4",
  path = "/x",
): Promise<HitResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { "x-forwarded-for": ip },
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v);
        }
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function makeApp(limit: number, windowMs = 60_000): Express {
  const app = express();
  app.set("trust proxy", true);
  const limiter = createRateLimit({
    bucket: `test-${Math.random().toString(36).slice(2)}`,
    windowMs,
    limit,
  });
  app.get("/x", limiter, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe("createRateLimit", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()!();
  });

  it("allows up to the limit and then 429s with Retry-After", async () => {
    const { port, close } = await listen(makeApp(3));
    closers.push(close);
    const r1 = await hit(port);
    const r2 = await hit(port);
    const r3 = await hit(port);
    const r4 = await hit(port);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    expect(r4.status).toBe(429);
    expect(r4.headers["retry-after"]).toBeDefined();
    expect(r4.headers["x-ratelimit-limit"]).toBe("3");
    expect(r4.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("buckets are per-IP", async () => {
    const { port, close } = await listen(makeApp(1));
    closers.push(close);
    const a = await hit(port, "1.1.1.1");
    const b = await hit(port, "2.2.2.2");
    const aBlocked = await hit(port, "1.1.1.1");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(aBlocked.status).toBe(429);
  });

  it("respects RATE_LIMIT_DISABLED", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "1");
    vi.resetModules();
    const { createRateLimit: cr } = await import("../lib/rate-limit");
    const app = express();
    app.set("trust proxy", true);
    app.get(
      "/x",
      cr({ bucket: "stub", windowMs: 1000, limit: 1 }),
      (_req, res) => res.json({ ok: true }),
    );
    const { port, close } = await listen(app);
    closers.push(close);
    const r1 = await hit(port);
    const r2 = await hit(port);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    vi.unstubAllEnvs();
  });
});

describe("getClientIp", () => {
  it("uses Express's req.ip (which respects trust proxy)", () => {
    expect(
      getClientIp({
        ip: "9.9.9.9",
        headers: { "x-forwarded-for": "1.1.1.1" },
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as express.Request),
    ).toBe("9.9.9.9");
  });

  it("does NOT trust raw X-Forwarded-For when req.ip is unset (anti-spoof)", () => {
    // If req.ip is not populated (Express not configured / not Express),
    // we MUST fall back to socket — never to the spoofable header.
    expect(
      getClientIp({
        headers: { "x-forwarded-for": "9.9.9.9, 1.1.1.1" },
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as express.Request),
    ).toBe("127.0.0.1");
  });

  it("falls back to socket address when nothing else is available", () => {
    expect(
      getClientIp({
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as express.Request),
    ).toBe("127.0.0.1");
  });
});

describe("userOrIpKey", () => {
  it("returns user key when authenticated", () => {
    expect(
      userOrIpKey({
        ip: "1.1.1.1",
        headers: {},
        socket: { remoteAddress: "1.1.1.1" },
        dbUser: { id: 42 },
      } as unknown as express.Request),
    ).toBe("user:42");
  });

  it("falls back to ip key when anonymous (uses req.ip)", () => {
    expect(
      userOrIpKey({
        ip: "8.8.8.8",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as express.Request),
    ).toBe("ip:8.8.8.8");
  });
});
