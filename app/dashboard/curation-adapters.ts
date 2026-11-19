import { createClient } from "@/lib/supabase/client";
import { externalIdMatches, smartSearchFilters } from "@/lib/card-search";
import type { PokemonVariantProjection } from "@/lib/pokemon-variant";
import { cardMeta, POKEMON_VARIANT_COLS } from "./use-card-data";
import type { CandidateEvidence, CommonApproval, CurationCandidate, CurationConfig, CurationMatch } from "./curation-model";

interface MatchedCard extends PokemonVariantProjection {
  regional_name: string; english_name: string | null; set_code: string;
  card_number: string | null; misc_info: string | null; image_url: string | null;
}

interface MatchedProduct {
  name: string; english_name: string | null; set_code: string;
  product_type: string | null; language: string | null;
  variant_edition: string | null; misc_info: string | null; image_url: string | null;
}

export interface SinglesCandidate extends CandidateEvidence {
  card_grading: string | null;
  candidate_card_id: number | null;
  card: MatchedCard | null;
}

export interface SealedCandidate extends CandidateEvidence {
  sealed_condition: string | null;
  candidate_product_id: number | null;
  product: MatchedProduct | null;
}

export interface SinglesApproval extends CommonApproval { cardId?: number; grading?: string | null; }
export interface SealedApproval extends CommonApproval { productId?: number; condition?: string | null; }

const EVIDENCE_COLUMNS = "candidate_id, status, cell_image_url, source_image_url, source_grid_bbox, effective_source_grid_bbox, source_image_width, source_image_height, active_geometry_correction_id, ocr_price_jpy, price_evidence, ocr_text, ocr_overlay_text, ocr_cell_label_text, confidence, match_method, match_score_features, match_score_embedding, match_score_text, variant_attrs, variant_source, curator_notes, source_author_handle, source_tweet_url, source_tweet_date, source_thread_root_id, source_thread_position, source_thread_root_text";
const SINGLE_COLUMNS = `card_id, regional_name, english_name, set_code, card_number, ${POKEMON_VARIANT_COLS}, image_url`;
const SEALED_COLUMNS = "product_id, name, english_name, set_code, product_type, language, variant_edition, misc_info, image_url";

function singleMatch(card: MatchedCard, id: number): CurationMatch {
  return { id, name: card.regional_name, english_name: card.english_name,
    meta: cardMeta(card.set_code, card.card_number, card), image_url: card.image_url };
}

function sealedMatch(product: MatchedProduct, id: number): CurationMatch {
  const misc = (product.misc_info ?? "").trim();
  const edition = product.variant_edition !== "standard" ? product.variant_edition : null;
  const meta = [[product.set_code, product.product_type].filter(Boolean).join(" "),
    edition, misc.toUpperCase() !== "UNKNOWN" ? misc : null].filter(Boolean).join(" · ");
  return { id, name: product.name, english_name: product.english_name, meta, image_url: product.image_url };
}

export function normalizeSinglesCandidate(candidate: SinglesCandidate): CurationCandidate {
  const { candidate_card_id, card_grading, card, ...evidence } = candidate;
  return { ...evidence, matched_id: candidate_card_id, condition: card_grading,
    match: card ? singleMatch(card, candidate_card_id!) : null,
    // The printed language/packaging marker is evidence on singles only.
    cellLabel: typeof candidate.variant_attrs?.cell_label === "string" ? candidate.variant_attrs.cell_label : null };
}

export function normalizeSealedCandidate(candidate: SealedCandidate): CurationCandidate {
  const { candidate_product_id, sealed_condition, product, ...evidence } = candidate;
  return { ...evidence, matched_id: candidate_product_id, condition: sealed_condition,
    match: product ? sealedMatch(product, candidate_product_id!) : null, cellLabel: null };
}

export const singlesCuration: CurationConfig = {
  kind: "singles", initialStatus: "needs_review", queryKey: "curation", title: "curation.title",
  candidateTable: "pokemon_image_buylist_candidates",
  candidateColumns: `${EVIDENCE_COLUMNS}, card_grading, candidate_card_id`,
  catalogTable: "pokemon_card_definitions", catalogColumns: SINGLE_COLUMNS, catalogId: "card_id",
  readCandidate: (row) => normalizeSinglesCandidate(row as SinglesCandidate),
  readMatch: (row) => { const card = row as MatchedCard & { card_id: number }; return singleMatch(card, card.card_id); },
  async search(query) {
    const supabase = createClient();
    const ids = await externalIdMatches(supabase, "pokemon_external_identifiers", "card_id", query);
    let request = supabase.from("pokemon_card_definitions").select(SINGLE_COLUMNS);
    for (const filter of smartSearchFilters(query, ["regional_name", "english_name", "card_number"], "card_uid", "card_id", ids)) {
      request = request.or(filter);
    }
    const { data } = await request.limit(20);
    return (data ?? []).map(singlesCuration.readMatch);
  },
  defaultCondition: "raw", conditionField: "grading", conditionLabel: "curation.grading",
  conditionOptions: [{ value: "raw", label: "curation.raw" }, { value: "psa_10", label: "PSA 10" }],
  changeMatchLabel: "curation.changeCard", searchPlaceholder: "curation.searchPlaceholder",
  matchParameter: "p_card_id", conditionParameter: "p_card_grading",
  rpc: {
    promote: "promote_image_buylist_candidate", correct: "correct_and_promote_image_buylist_candidate",
    reject: "reject_image_buylist_candidate", defer: "mark_image_buylist_candidate_needs_review",
    undo: "compensate_image_curation_decision", batch: "batch_accept_image_buylist_candidates",
  },
};

export const sealedCuration: CurationConfig = {
  // Recognition writes sealed intake to pending; singles retain needs_review.
  kind: "sealed", initialStatus: "pending", queryKey: "sealed_curation", title: "curation.titleSealed",
  candidateTable: "pokemon_sealed_image_buylist_candidates",
  candidateColumns: `${EVIDENCE_COLUMNS}, sealed_condition, candidate_product_id`,
  catalogTable: "pokemon_sealed_products", catalogColumns: SEALED_COLUMNS, catalogId: "product_id",
  readCandidate: (row) => normalizeSealedCandidate(row as SealedCandidate),
  readMatch: (row) => { const product = row as MatchedProduct & { product_id: number }; return sealedMatch(product, product.product_id); },
  async search(query) {
    const safe = query.replace(/[,()*]/g, " ");
    const { data } = await createClient().from("pokemon_sealed_products").select(SEALED_COLUMNS)
      .or(`name.ilike.%${safe}%,english_name.ilike.%${safe}%`).limit(20);
    return (data ?? []).map(sealedCuration.readMatch);
  },
  defaultCondition: "standard", conditionField: "condition", conditionLabel: "curation.sealedCondition",
  conditionOptions: [
    { value: "standard", label: "curation.sealedCondition.standard" },
    { value: "shrink", label: "curation.sealedCondition.shrink" },
    { value: "no_shrink", label: "curation.sealedCondition.no_shrink" },
  ],
  changeMatchLabel: "curation.changeProduct", searchPlaceholder: "curation.searchProductPlaceholder",
  matchParameter: "p_product_id", conditionParameter: "p_sealed_condition",
  rpc: {
    promote: "promote_sealed_image_buylist_candidate", correct: "correct_and_promote_sealed_image_buylist_candidate",
    reject: "reject_sealed_image_buylist_candidate", defer: "mark_sealed_image_buylist_candidate_needs_review",
    undo: "compensate_sealed_image_curation_decision", batch: "batch_accept_sealed_image_buylist_candidates",
  },
};
