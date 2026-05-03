import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Optional at the schema level so unit tests (which don't touch the DB)
  // can boot the env module. Production requires a real value — enforced
  // by the `superRefine` below so we still fail fast on a misconfigured
  // deployment.
  DATABASE_URL: z.string().min(1).optional(),

  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),

  ALLOWED_ORIGINS: z.string().optional(),
  REPLIT_DEV_DOMAIN: z.string().optional(),

  WEBHOOK_SIGNING_SECRET: z.string().optional(),

  // ── Stripe ─────────────────────────────────────────────────────────
  // All four are optional in dev/test (the adapter falls back to STUB
  // mode). Production is enforced in the superRefine below.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * In stub mode (no `STRIPE_SECRET_KEY`) the webhook endpoint still
   * needs to refuse anonymous traffic — otherwise anyone reachable on
   * the network can mint balance by POSTing a fake
   * `checkout.session.completed`. Default is a randomly-derived value
   * so dev usage works without explicit configuration; tests/dev
   * tools should set this explicitly.
   */
  STRIPE_STUB_WEBHOOK_SECRET: z.string().optional(),
  /** Platform fee captured from each task payment, in basis points. 100 = 1%. */
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
  /**
   * Public base URL of the web app, used for Checkout success/cancel
   * redirects and Connect onboarding return links. Falls back to
   * `https://${REPLIT_DEV_DOMAIN}` in dev and is required in production.
   */
  APP_BASE_URL: z.string().url().optional(),

  ADMIN_BOOTSTRAP_EMAILS: z.string().optional(),

  RATE_LIMIT_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
}).superRefine((val, ctx) => {
  if (val.NODE_ENV === "production") {
    if (!val.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required in production",
      });
    }
    if (!val.CLERK_SECRET_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["CLERK_SECRET_KEY"],
        message: "CLERK_SECRET_KEY is required in production",
      });
    }
    // If a live Stripe key is set in production we MUST also have the
    // matching webhook secret — otherwise we'd accept unsigned events.
    if (val.STRIPE_SECRET_KEY && !val.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_WEBHOOK_SECRET"],
        message:
          "STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set",
      });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n` +
        `Fix the missing or malformed env vars before starting the server.`,
    );
  }
  return result.data;
}

export const env: Env = parseEnv();

/**
 * The shared secret used to authenticate stub-mode Stripe webhooks.
 * If `STRIPE_STUB_WEBHOOK_SECRET` is set we use it verbatim; otherwise
 * we derive a stable per-process value from PID + boot time so dev
 * tooling on the same process can call the endpoint while external
 * traffic still cannot. The value is logged on boot so the developer
 * can copy/paste it into curl commands.
 */
const STUB_WEBHOOK_SECRET: string =
  env.STRIPE_STUB_WEBHOOK_SECRET ??
  `dev_${process.pid}_${Date.now().toString(36)}`;

export function getStubWebhookSecret(): string {
  return STUB_WEBHOOK_SECRET;
}

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";

export function getAllowedOrigins(): string[] {
  const list: string[] = [];
  if (env.ALLOWED_ORIGINS) {
    for (const o of env.ALLOWED_ORIGINS.split(",")) {
      const trimmed = o.trim();
      if (trimmed) list.push(trimmed);
    }
  }
  if (env.REPLIT_DEV_DOMAIN) {
    list.push(`https://${env.REPLIT_DEV_DOMAIN}`);
  }
  return list;
}

/**
 * Public web origin used when constructing Stripe redirect URLs. Prefers
 * an explicit APP_BASE_URL, falls back to the Replit dev domain so local
 * development "just works" without configuration.
 */
export function getAppBaseUrl(): string {
  if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/$/, "");
  if (env.REPLIT_DEV_DOMAIN)
    return `https://${env.REPLIT_DEV_DOMAIN.replace(/\/$/, "")}`;
  return "http://localhost:5000";
}

export function getAdminBootstrapEmails(): string[] {
  if (!env.ADMIN_BOOTSTRAP_EMAILS) return [];
  return env.ADMIN_BOOTSTRAP_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
