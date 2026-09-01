import { describe, it, expect } from "vitest";
import { principalFromAccessToken } from "./principal";

function token(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `header.${body}.signature`;
}

describe("principalFromAccessToken", () => {
  it("reads the role the access-token hook stamped", () => {
    expect(principalFromAccessToken(token({ role: "buyer" }))).toBe("buyer");
    expect(principalFromAccessToken(token({ role: "administrator" }))).toBe("administrator");
    expect(principalFromAccessToken(token({ role: "unmapped" }))).toBe("unmapped");
  });

  it("treats a pre-hook `authenticated` session as the operator", () => {
    // Sessions minted before the hook was enabled carry the historical role;
    // showing those users an empty buyer screen would be a regression.
    expect(principalFromAccessToken(token({ role: "authenticated" }))).toBe("administrator");
  });

  it("never guesses a privileged role from a malformed token", () => {
    // The database is the real boundary, but the UI must not volunteer an
    // operator view to a token it could not read.
    for (const bad of [null, undefined, "", "not-a-jwt", "a.b", "a.!!!.c", token({})]) {
      expect(principalFromAccessToken(bad as string | null)).toBe("unknown");
    }
  });
});
