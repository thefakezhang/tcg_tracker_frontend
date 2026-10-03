import { describe, expect, it, vi } from "vitest";
import { callBuyerFloatRpc, isMissingBuyerFloatRpcSignature } from "./buyer-float-rpc";

describe("buyer-float RPC rollout compatibility", () => {
  it.each(["PGRST202", "42883"])(
    "falls back to the legacy overload when the modern signature is missing (%s)",
    async (code) => {
      const modern = vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: "function not found" },
      });
      const legacy = vi.fn().mockResolvedValue({ data: 17, error: null });

      await expect(callBuyerFloatRpc(modern, legacy)).resolves.toEqual({ data: 17, error: null });
      expect(modern).toHaveBeenCalledOnce();
      expect(legacy).toHaveBeenCalledOnce();
    },
  );

  it("never falls back after an ambiguous failure that could follow a commit", async () => {
    const result = { data: null, error: { code: "57014", message: "request timed out" } };
    const legacy = vi.fn();

    await expect(callBuyerFloatRpc(
      () => Promise.resolve(result),
      legacy,
    )).resolves.toBe(result);
    expect(legacy).not.toHaveBeenCalled();
  });

  it("does not catch a lost response and replay through the legacy overload", async () => {
    const legacy = vi.fn();

    await expect(callBuyerFloatRpc(
      () => Promise.reject(new Error("connection closed after commit")),
      legacy,
    )).rejects.toThrow("connection closed after commit");
    expect(legacy).not.toHaveBeenCalled();
  });

  it("recognizes only missing-function errors", () => {
    expect(isMissingBuyerFloatRpcSignature({ code: "PGRST202" })).toBe(true);
    expect(isMissingBuyerFloatRpcSignature({ code: "42883" })).toBe(true);
    expect(isMissingBuyerFloatRpcSignature({ code: "42501" })).toBe(false);
    expect(isMissingBuyerFloatRpcSignature(null)).toBe(false);
  });
});
