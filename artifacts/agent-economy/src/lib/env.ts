import { z } from "zod";

/**
 * Typed, Zod-validated frontend env. All access to `import.meta.env.*`
 * MUST go through this module so the build fails fast when a required
 * VITE_* variable is missing or malformed, rather than every component
 * silently reading `undefined` and behaving in subtly broken ways.
 *
 * Add new variables here first, then read them via `frontendEnv` (or one
 * of the named getters below). Keep all variables prefixed with `VITE_`
 * so Vite actually exposes them to the bundle.
 */
const FrontendEnvSchema = z.object({
  VITE_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  VITE_CLERK_PROXY_URL: z.string().optional(),
  BASE_URL: z.string().default("/"),
  MODE: z.string().default("development"),
  DEV: z.boolean().default(true),
  PROD: z.boolean().default(false),
});

export type FrontendEnv = z.infer<typeof FrontendEnvSchema>;

function parseFrontendEnv(): FrontendEnv {
  const result = FrontendEnvSchema.safeParse(import.meta.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // Throwing during module evaluation surfaces immediately in the
    // browser console with the offending variable names, which is the
    // fastest way to debug a misconfigured deployment.
    throw new Error(
      `Invalid frontend environment configuration:\n${issues}\n` +
        `Set the missing or malformed VITE_* variables before building.`,
    );
  }
  return result.data;
}

export const frontendEnv: FrontendEnv = parseFrontendEnv();

/** Trailing-slash-trimmed base path. e.g. "/" → "", "/agent-economy/" → "/agent-economy". */
export function getBasePath(): string {
  return frontendEnv.BASE_URL.replace(/\/$/, "");
}

export function getClerkPublishableKey(): string | undefined {
  return frontendEnv.VITE_CLERK_PUBLISHABLE_KEY;
}

export function getClerkProxyUrl(): string | undefined {
  return frontendEnv.VITE_CLERK_PROXY_URL;
}
