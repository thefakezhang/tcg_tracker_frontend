import { describe, expect, it } from "vitest";
import { allowLocalE2EAuth } from "./e2e-auth-guard";

const SECRET = "a".repeat(32);

function allowed(overrides: Record<string, string | null | undefined> = {}) {
  return allowLocalE2EAuth({
    enabled: "1",
    nodeEnvironment: "test",
    configuredSecret: SECRET,
    presentedSecret: SECRET,
    supabaseUrl: "http://127.0.0.1:54321/",
    ...overrides,
  });
}

describe("allowLocalE2EAuth", () => {
  it("allows a matching strong secret only against literal loopback HTTP", () => {
    expect(allowed()).toBe(true);
    expect(allowed({ supabaseUrl: "http://[::1]:54321/" })).toBe(true);
  });

  it.each([
    { enabled: "0" },
    { nodeEnvironment: "production" },
    { configuredSecret: "short" },
    { presentedSecret: `${SECRET}x` },
    { supabaseUrl: "https://127.0.0.1:54321/" },
    { supabaseUrl: "http://localhost:54321/" },
    { supabaseUrl: "http://127.0.0.1.evil.test:54321/" },
    { supabaseUrl: "http://127.0.0.1:54321/path" },
  ])("rejects unsafe configuration %#", (overrides) => {
    expect(allowed(overrides)).toBe(false);
  });
});
