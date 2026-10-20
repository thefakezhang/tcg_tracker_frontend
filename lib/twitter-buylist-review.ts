"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type TwitterBuylistCandidateKind = "singles" | "sealed";

export interface TwitterBuylistReviewDocument {
  schema_version: 1;
  candidate_kind: TwitterBuylistCandidateKind;
  candidate_id: number;
  candidate_uid: string;
  candidate_projection: Record<string, unknown>;
  routing_outcome_id: number;
  routing_digest: string;
  route: Record<string, unknown>;
  media_acquisition_outcome_id: number;
  acquisition: Record<string, unknown>;
  source: {
    tweet_url: string;
    image_url: string;
    content_sha256: string;
    width: number;
    height: number;
    geometry: Record<string, unknown>;
    card_crop_sha256: string;
    price_crop_sha256: string;
  };
  catalog: Record<string, unknown>;
  displayed: {
    target_id: number;
    entity_uid: string;
    grade_or_condition: string;
    variant_attrs: Record<string, unknown>;
    detector_price_jpy: number;
    effective_bid_price_jpy: number;
    price_evidence: Record<string, unknown>;
    uncertainty_flags: string[];
  };
}

export interface TwitterBuylistReviewEnvelope {
  document: TwitterBuylistReviewDocument;
  document_sha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBoundedGeometry(value: unknown, width: number, height: number): boolean {
  if (!isRecord(value) || !isRecord(value.card) || !isRecord(value.price)) return false;
  return [value.card, value.price].every((box) => {
    const { x0, y0, x1, y1 } = box;
    return Number.isInteger(x0) && Number.isInteger(y0) &&
      Number.isInteger(x1) && Number.isInteger(y1) &&
      Number(x0) >= 0 && Number(y0) >= 0 &&
      Number(x1) > Number(x0) && Number(y1) > Number(y0) &&
      Number(x1) <= width && Number(y1) <= height;
  });
}

export function parseTwitterBuylistReviewEnvelope(
  value: unknown,
  expectedKind?: TwitterBuylistCandidateKind,
  expectedCandidateId?: number,
): TwitterBuylistReviewEnvelope {
  if (!isRecord(value) || !isRecord(value.document)) {
    throw new Error("review_document_invalid");
  }
  const sha = value.document_sha256;
  const document = value.document;
  const source = document.source;
  const displayed = document.displayed;
  const projection = document.candidate_projection;
  const catalog = document.catalog;
  if (
    typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha) ||
    document.schema_version !== 1 ||
    (document.candidate_kind !== "singles" && document.candidate_kind !== "sealed") ||
    !isPositiveInteger(document.candidate_id) ||
    typeof document.candidate_uid !== "string" ||
    !isRecord(projection) ||
    !isPositiveInteger(document.routing_outcome_id) ||
    typeof document.routing_digest !== "string" || !/^[0-9a-f]{64}$/.test(document.routing_digest) ||
    !isRecord(document.route) ||
    !isPositiveInteger(document.media_acquisition_outcome_id) ||
    !isRecord(document.acquisition) ||
    !isRecord(source) ||
    typeof source.tweet_url !== "string" || !/^https?:\/\//i.test(source.tweet_url) ||
    typeof source.image_url !== "string" || !/^https?:\/\//i.test(source.image_url) ||
    typeof source.content_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.content_sha256) ||
    !source.image_url.toLowerCase().includes(source.content_sha256) ||
    !isPositiveInteger(source.width) ||
    !isPositiveInteger(source.height) ||
    !isBoundedGeometry(source.geometry, source.width, source.height) ||
    typeof source.card_crop_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.card_crop_sha256) ||
    typeof source.price_crop_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.price_crop_sha256) ||
    !isRecord(catalog) ||
    !isRecord(displayed) ||
    !isPositiveInteger(displayed.target_id) ||
    typeof displayed.entity_uid !== "string" ||
    typeof displayed.grade_or_condition !== "string" ||
    !isRecord(displayed.variant_attrs) ||
    !isPositiveInteger(displayed.detector_price_jpy) ||
    !isPositiveInteger(displayed.effective_bid_price_jpy) ||
    !isRecord(displayed.price_evidence) ||
    !Array.isArray(displayed.uncertainty_flags) ||
    displayed.uncertainty_flags.length === 0 ||
    displayed.uncertainty_flags.some((flag) => typeof flag !== "string") ||
    projection.candidate_id !== document.candidate_id ||
    projection.candidate_uid !== document.candidate_uid ||
    projection.source_image_url !== source.image_url ||
    projection.source_tweet_url !== source.tweet_url ||
    projection.source_image_width !== source.width ||
    projection.source_image_height !== source.height ||
    projection.original_price_jpy !== displayed.detector_price_jpy ||
    projection.ocr_price_jpy !== displayed.effective_bid_price_jpy ||
    catalog.target_id !== displayed.target_id ||
    catalog.entity_uid !== displayed.entity_uid ||
    (document.candidate_kind === "singles" && (
      projection.candidate_card_id !== displayed.target_id ||
      projection.card_grading !== displayed.grade_or_condition
    )) ||
    (document.candidate_kind === "sealed" && (
      projection.candidate_product_id !== displayed.target_id ||
      projection.sealed_condition !== displayed.grade_or_condition
    ))
  ) {
    throw new Error("review_document_invalid");
  }
  if (expectedKind && document.candidate_kind !== expectedKind) {
    throw new Error("review_document_subject_mismatch");
  }
  if (expectedCandidateId != null && document.candidate_id !== expectedCandidateId) {
    throw new Error("review_document_subject_mismatch");
  }
  return value as unknown as TwitterBuylistReviewEnvelope;
}

export function isStaleTwitterBuylistReviewError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === "40001" ||
    (candidate?.message ?? "").includes("stale_review_document");
}

export type TwitterBuylistReviewRecovery =
  | "retry"
  | "sign_in"
  | "capability"
  | "forbidden";

export function classifyTwitterBuylistReviewError(
  error: unknown,
): TwitterBuylistReviewRecovery {
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    name?: unknown;
  } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const status = String(candidate?.status ?? candidate?.code ?? "");
  const detail = [candidate?.code, candidate?.message, candidate?.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (
    status === "401" ||
    code === "PGRST301" ||
    (code === "42501" && /authenticated curator|curator subject/i.test(detail)) ||
    /\b(jwt|session|refresh[_ -]?token|access[_ -]?token)\b.*\b(expired|invalid|missing|not found)\b/i.test(detail) ||
    /\b(expired|invalid|missing|not found)\b.*\b(jwt|session|refresh[_ -]?token|access[_ -]?token)\b/i.test(detail)
  ) {
    return "sign_in";
  }
  if (["42883", "42P01", "PGRST202", "PGRST204"].includes(code)) {
    return "capability";
  }
  if (
    status === "403" ||
    code === "42501" ||
    /\b(forbidden|permission denied|not authorized|unauthori[sz]ed|insufficient privilege)\b/i.test(detail)
  ) {
    return "forbidden";
  }
  return "retry";
}

export function twitterBuylistReviewErrorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object") return "review_document_failed";
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return [code, message].filter(Boolean).join(" · ") || "review_document_failed";
}

export type TwitterReviewLoadState =
  | { status: "idle" | "loading"; envelope: null; error: null }
  | { status: "ready" | "stale"; envelope: TwitterBuylistReviewEnvelope; error: null }
  | { status: "error"; envelope: null; error: unknown };

export function useTwitterBuylistReview(
  kind: TwitterBuylistCandidateKind,
  candidateId: number,
  enabled: boolean,
) {
  const [state, setState] = useState<TwitterReviewLoadState>({
    status: "idle", envelope: null, error: null,
  });

  const load = useCallback(async () => {
    if (!enabled) return;
    setState({ status: "loading", envelope: null, error: null });
    const { data, error } = await createClient().rpc(
      "get_twitter_buylist_review_document",
      { p_candidate_kind: kind, p_candidate_id: candidateId },
    );
    if (error) {
      setState({ status: "error", envelope: null, error });
      return;
    }
    try {
      setState({
        status: "ready",
        envelope: parseTwitterBuylistReviewEnvelope(data, kind, candidateId),
        error: null,
      });
    } catch (parseError) {
      setState({
        status: "error",
        envelope: null,
        error: parseError,
      });
    }
  }, [candidateId, enabled, kind]);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle", envelope: null, error: null });
      return;
    }
    void load();
  }, [enabled, load]);

  const markStaleAndReload = useCallback(() => {
    setState((current) => current.envelope
      ? { status: "stale", envelope: current.envelope, error: null }
      : current);
    void load();
  }, [load]);

  return { ...state, reload: load, markStaleAndReload };
}
