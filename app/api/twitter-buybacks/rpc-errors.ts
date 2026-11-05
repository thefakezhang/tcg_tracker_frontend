// How the Buybacks routes classify a backend RPC failure (backend #2392,
// migration 000628). Shared by the overview and buylist routes.

type RpcError = { code?: string; message?: string };

/**
 * What PostgREST and Postgres answer while the RPC is not applied yet: the
 * schema-cache miss and undefined_function. The routes report that as 501, so
 * the tab says the overview waits for the backend migration instead of
 * showing it as broken.
 */
export function buybackRpcMissing(error: RpcError): boolean {
  return error.code === "PGRST202"
    || error.code === "42883"
    || /could not find the function/i.test(error.message ?? "");
}

/** The backend's administrator refusal. */
export function buybackForbidden(error: RpcError): boolean {
  return error.code === "42501" || (error.message ?? "").includes("requires an administrator");
}

export const NO_STORE = { "cache-control": "private, no-store" } as const;
