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
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

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

export function getAdminBootstrapEmails(): string[] {
  if (!env.ADMIN_BOOTSTRAP_EMAILS) return [];
  return env.ADMIN_BOOTSTRAP_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
