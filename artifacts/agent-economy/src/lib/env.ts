import { z } from "zod";

/**
 * Typed, Zod-validated frontend env. All access to `import.meta.env.*`
 * MUST go through this module so the build fails fast when a required
 * VITE_* variable is missing or malformed, rather than every component
 * silently reading `undefined` and behaving in subtly broken ways.
 */
const FrontendEnvSchema = z.object({
  VITE_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  VITE_CLERK_PROXY_URL: z.string().optional(),
  // Optional: present when running against a live Stripe key. The UI
  // shows a "Stub mode" indicator when this is missing so testers don't
  // expect a real card prompt.
  VITE_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
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

export function getStripePublishableKey(): string | undefined {
  return frontendEnv.VITE_STRIPE_PUBLISHABLE_KEY;
}

/** True when the frontend is running against a Stripe stub server. */
export function isStripeStubMode(): boolean {
  return !frontendEnv.VITE_STRIPE_PUBLISHABLE_KEY;
}
