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
