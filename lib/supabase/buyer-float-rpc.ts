type RpcError = {
  code?: string;
  message?: string;
};

export type BuyerFloatRpcResult = {
  data: unknown;
  error: RpcError | null;
};

const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

export function isMissingBuyerFloatRpcSignature(error: RpcError | null): boolean {
  return error?.code != null && MISSING_FUNCTION_CODES.has(error.code);
}

/**
 * Supports either rollout order for the 000535 buyer-float RPC overloads.
 *
 * A missing modern signature is the only safe reason to call the legacy
 * overload. Network, timeout, and server errors might arrive after commit, so
 * retrying those through the non-idempotent legacy signature could post twice.
 */
export async function callBuyerFloatRpc(
  modern: () => PromiseLike<BuyerFloatRpcResult>,
  legacy: () => PromiseLike<BuyerFloatRpcResult>,
): Promise<BuyerFloatRpcResult> {
  const result = await modern();
  if (!isMissingBuyerFloatRpcSignature(result.error)) return result;
  return legacy();
}
