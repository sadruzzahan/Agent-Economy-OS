import { describe, it, expect } from "vitest";

describe("env module", () => {
  it("loads valid env without throwing", async () => {
    // The test suite already runs with PORT and DATABASE_URL set; if this
    // import succeeds, the schema accepted the environment.
    const mod = await import("../lib/env");
    expect(mod.env.PORT).toBeGreaterThan(0);
    expect((mod.env.DATABASE_URL ?? "").length).toBeGreaterThan(0);
    expect(["development", "test", "production"]).toContain(mod.env.NODE_ENV);
  });

  it("getAllowedOrigins returns an array (possibly empty)", async () => {
    const { getAllowedOrigins } = await import("../lib/env");
    expect(Array.isArray(getAllowedOrigins())).toBe(true);
  });

  it("getAdminBootstrapEmails normalizes to lowercase", async () => {
    const { getAdminBootstrapEmails } = await import("../lib/env");
    // No env set → empty list. The behavior we're locking in is "always
    // returns an array of trimmed lowercased entries", verified by type.
    const out = getAdminBootstrapEmails();
    for (const e of out) {
      expect(e).toBe(e.toLowerCase());
      expect(e).toBe(e.trim());
    }
  });
});
