import type { TranslationKey } from "@/lib/i18n";
import type { GridBBoxJSON, ImageGeometry } from "@/lib/image-curation-geometry";
import type { PriceEvidence } from "@/lib/image-curation-price-evidence";

export type CurationStatus = "needs_review" | "pending" | "auto_approved";

export interface CandidateEvidence {
  candidate_id: number;
  status: string;
  cell_image_url: string | null;
  source_image_url: string | null;
  source_grid_bbox: GridBBoxJSON;
  effective_source_grid_bbox: GridBBoxJSON;
  source_image_width: number | null;
  source_image_height: number | null;
  active_geometry_correction_id: number | null;
  ocr_price_jpy: number | null;
  ocr_text: string | null;
  ocr_overlay_text: string | null;
  ocr_cell_label_text: string | null;
  price_evidence: PriceEvidence | null;
  confidence: number | null;
  match_method: string | null;
  match_score_features: number | null;
  match_score_embedding: number | null;
  match_score_text: number | null;
  variant_attrs: Record<string, unknown> | null;
  variant_source: string | null;
  curator_notes: string | null;
  source_author_handle: string | null;
  source_tweet_url: string | null;
  source_tweet_date: string | null;
  source_thread_root_id: string | null;
  source_thread_position: number | null;
  source_thread_root_text: string | null;
}

export interface CurationMatch {
  id: number;
  name: string;
  english_name: string | null;
  meta: string;
  image_url: string | null;
}

// The UI works with one shape; only the adapters know the two database schemas.
export interface CurationCandidate extends CandidateEvidence {
  matched_id: number | null;
  match: CurationMatch | null;
  condition: string | null;
  cellLabel: string | null;
}

export interface CommonApproval {
  priceJpy?: number | null;
  notes?: string | null;
  geometry?: ImageGeometry;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface CurationApproval extends CommonApproval {
  matchId?: number;
  condition?: string | null;
}

export interface CurationCardProps<C, O extends CommonApproval> {
  c: C;
  idx: number;
  status: CurationStatus;
  language: "en" | "ja";
  saving: boolean;
  selected: boolean;
  onSelect: () => void;
  onApprove: (candidate: C, options?: O) => void;
  onReject: (candidate: C, notes?: string | null) => void;
  onSendBack: (candidate: C, notes?: string | null) => void;
  onUndo?: (candidate: C) => void;
}

export interface CurationConfig {
  kind: "singles" | "sealed";
  initialStatus: CurationStatus;
  queryKey: string;
  title: TranslationKey;
  candidateTable: string;
  candidateColumns: string;
  catalogTable: string;
  catalogColumns: string;
  catalogId: "card_id" | "product_id";
  readCandidate: (row: unknown) => CurationCandidate;
  readMatch: (row: unknown) => CurationMatch;
  search: (query: string) => Promise<CurationMatch[]>;
  defaultCondition: string;
  conditionField: "grading" | "condition";
  conditionLabel: TranslationKey;
  conditionOptions: readonly { value: string; label: TranslationKey | "PSA 10" }[];
  changeMatchLabel: TranslationKey;
  searchPlaceholder: TranslationKey;
  matchParameter: "p_card_id" | "p_product_id";
  conditionParameter: "p_card_grading" | "p_sealed_condition";
  rpc: { promote: string; correct: string; reject: string; defer: string; undo: string; batch: string };
}

export function matchDisplayName(match: CurationMatch, language: "en" | "ja"): string {
  return language === "en" && match.english_name ? match.english_name : match.name;
}
