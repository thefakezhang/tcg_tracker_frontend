import { describe, expect, it } from "vitest";
import { formatMutationError } from "./mutation-error";

describe("formatMutationError", () => {
  it("renders a structured Supabase error instead of [object Object]", () => {
    expect(formatMutationError({
      code: "PGRST204",
      message: "batch candidate failed",
      details: { candidate_id: 17 },
      hint: "correct the candidate and retry",
    })).toBe(
      '[PGRST204] batch candidate failed - {"candidate_id":17} - correct the candidate and retry',
    );
  });

  it("unwraps a returned error object", () => {
    expect(formatMutationError({ error: { code: "23503", message: "card no longer exists" } }))
      .toBe("[23503] card no longer exists");
  });
});
