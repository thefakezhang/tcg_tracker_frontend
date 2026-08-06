export interface CurationBatchRow {
  candidate_id: number | null;
  success: boolean;
  listing_id?: number;
  error_code?: string;
  error_message?: string;
  error_detail?: string;
}

export interface CurationBatchResult {
  mode: "per_row_savepoint";
  summary: { requested: number; succeeded: number; failed: number };
  results: CurationBatchRow[];
}

export function parseCurationBatchResult(value: unknown): CurationBatchResult {
  if (!value || typeof value !== "object") throw new Error("The batch returned no result.");
  const result = value as Partial<CurationBatchResult>;
  if (result.mode !== "per_row_savepoint" || !result.summary || !Array.isArray(result.results)) {
    throw new Error("The batch returned an invalid result.");
  }
  if (result.results.length !== result.summary.requested) {
    throw new Error("The batch result omitted one or more candidate outcomes.");
  }
  return result as CurationBatchResult;
}

// G6: the snapshot-wide idempotent Accept All (batch_accept_image_buylist_
// candidates / _sealed_). Same per-row shape as the explicit-list batch, but
// the RPC enumerates the eligible set server-side from a G5 snapshot, so the
// summary reports the eligible total and whether p_max truncated the run rather
// than a caller-supplied "requested" count.
export interface CurationAcceptResult {
  mode: "snapshot_savepoint";
  request_id: string;
  summary: { eligible: number; processed: number; succeeded: number; failed: number; truncated: boolean };
  results: CurationBatchRow[];
}

export function parseCurationAcceptResult(value: unknown): CurationAcceptResult {
  if (!value || typeof value !== "object") throw new Error("The batch returned no result.");
  const result = value as Partial<CurationAcceptResult>;
  if (result.mode !== "snapshot_savepoint" || !result.summary || !Array.isArray(result.results)) {
    throw new Error("The batch returned an invalid result.");
  }
  if (result.results.length !== result.summary.processed) {
    throw new Error("The batch result omitted one or more candidate outcomes.");
  }
  return result as CurationAcceptResult;
}
