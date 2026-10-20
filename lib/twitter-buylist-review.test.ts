import { describe, expect, it } from "vitest";
import {
  classifyTwitterBuylistReviewError,
  isStaleTwitterBuylistReviewError,
  parseTwitterBuylistReviewEnvelope,
  twitterBuylistReviewErrorDetail,
} from "./twitter-buylist-review";

const sha = "a".repeat(64);
const envelope = {
  document_sha256: sha,
  document: {
    schema_version: 1,
    candidate_kind: "singles",
    candidate_id: 7,
    candidate_uid: "11111111-1111-4111-8111-111111111111",
    candidate_projection: {
      candidate_id: 7,
      candidate_uid: "11111111-1111-4111-8111-111111111111",
      candidate_card_id: 3,
      card_grading: "psa_10",
      source_tweet_url: "https://x.example/status/1",
      source_image_url: `https://media.example/${sha}.jpg`,
      source_image_width: 1200,
      source_image_height: 800,
      original_price_jpy: 120000,
      ocr_price_jpy: 121000,
    },
    routing_outcome_id: 9,
    routing_digest: sha,
    route: {},
    media_acquisition_outcome_id: 11,
    acquisition: {},
    source: {
      tweet_url: "https://x.example/status/1",
      image_url: `https://media.example/${sha}.jpg`,
      content_sha256: sha,
      width: 1200,
      height: 800,
      geometry: {
        card: { x0: 1, y0: 2, x1: 401, y1: 602 },
        price: { x0: 410, y0: 20, x1: 700, y1: 120 },
      },
      card_crop_sha256: "b".repeat(64),
      price_crop_sha256: "c".repeat(64),
    },
    catalog: {
      target_id: 3,
      entity_uid: "22222222-2222-4222-8222-222222222222",
    },
    displayed: {
      target_id: 3,
      entity_uid: "22222222-2222-4222-8222-222222222222",
      grade_or_condition: "psa_10",
      variant_attrs: {},
      detector_price_jpy: 120000,
      effective_bid_price_jpy: 121000,
      price_evidence: {},
      uncertainty_flags: ["unverified_item_identity"],
    },
  },
};

describe("Twitter buylist review contract", () => {
  it("accepts one exact content-addressed server review envelope", () => {
    expect(parseTwitterBuylistReviewEnvelope(envelope, "singles", 7)).toEqual(envelope);
  });

  it("binds immutable detector price separately from the reviewed effective price", () => {
    expect(() => parseTwitterBuylistReviewEnvelope({
      ...envelope,
      document: {
        ...envelope.document,
        candidate_projection: {
          ...envelope.document.candidate_projection,
          original_price_jpy: 121000,
        },
      },
    })).toThrow("review_document_invalid");
    expect(() => parseTwitterBuylistReviewEnvelope({
      ...envelope,
      document: {
        ...envelope.document,
        candidate_projection: {
          ...envelope.document.candidate_projection,
          ocr_price_jpy: 120000,
        },
      },
    })).toThrow("review_document_invalid");
  });

  it("refuses a mismatched subject or source binding", () => {
    expect(() => parseTwitterBuylistReviewEnvelope(envelope, "sealed", 7)).toThrow(
      "review_document_subject_mismatch",
    );
    expect(() => parseTwitterBuylistReviewEnvelope({
      ...envelope,
      document: {
        ...envelope.document,
        source: { ...envelope.document.source, image_url: "https://media.example/unbound.jpg" },
      },
    })).toThrow("review_document_invalid");
  });

  it("recognizes the server stale-document conflict", () => {
    expect(isStaleTwitterBuylistReviewError({ code: "40001" })).toBe(true);
    expect(isStaleTwitterBuylistReviewError({ message: "stale_review_document: reload" })).toBe(true);
    expect(isStaleTwitterBuylistReviewError({ code: "23514" })).toBe(false);
  });

  it("does not accept a fabricated not-applicable result as legacy authority", () => {
    expect(() => parseTwitterBuylistReviewEnvelope({
      status: "not_applicable",
      candidate_kind: "singles",
      candidate_id: 7,
      reason: "non_twitter_source",
    }, "singles", 7)).toThrow("review_document_invalid");
  });

  it.each([
    [{ code: "23514", message: "candidate has no renderable current Twitter review document" }, "retry"],
    [{ code: "PGRST202", message: "function not found" }, "capability"],
    [{ code: "42883", message: "undefined function" }, "capability"],
    [{ status: 401, message: "JWT expired" }, "sign_in"],
    [{ code: "42501", message: "Twitter buylist review requires an authenticated curator" }, "sign_in"],
    [{ status: 403, message: "permission denied" }, "forbidden"],
  ] as const)("classifies review recovery for %o", (error, expected) => {
    expect(classifyTwitterBuylistReviewError(error)).toBe(expected);
  });

  it("shows only the review error code and message", () => {
    expect(twitterBuylistReviewErrorDetail({
      code: "23514",
      message: "candidate has no renderable current Twitter review document",
      details: "private server detail",
    })).toBe("23514 · candidate has no renderable current Twitter review document");
  });
});
