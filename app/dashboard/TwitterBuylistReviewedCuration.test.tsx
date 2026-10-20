// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import CurationView, { ReviewedCurationCandidateCard } from "./CurationView";
import { ReviewedSealedCurationCandidateCard } from "./SealedCurationView";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  retry: vi.fn(),
  queueData: null as unknown,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("./use-query", () => ({
  QueryError: () => null,
  useSupabaseQuery: () => ({
    data: mocks.queueData,
    error: undefined,
    isLoading: false,
    retry: mocks.retry,
  }),
}));

const sourceSHA = "a".repeat(64);
const reviewSHA = "b".repeat(64);
const nextReviewSHA = "c".repeat(64);
const cardCropSHA = "d".repeat(64);
const priceCropSHA = "e".repeat(64);
const sourceURL = `https://fixture.invalid/twitter/${sourceSHA}.jpg`;
const geometry = {
  card: { x0: 10, y0: 20, x1: 410, y1: 620 },
  price: { x0: 420, y0: 40, x1: 720, y1: 140 },
};
const priceEvidence = {
  verified: false,
  method: "recognition_fallback",
  ocr_confidence: 0.99,
  banner: null,
};

const baseCandidate = {
  candidate_id: 7,
  candidate_uid: "11111111-1111-4111-8111-111111111111",
  status: "needs_review",
  cell_image_url: null,
  source_image_url: "https://queue.invalid/stale.jpg",
  source_grid_bbox: geometry,
  effective_source_grid_bbox: geometry,
  source_image_width: 10,
  source_image_height: 10,
  active_geometry_correction_id: null,
  ocr_price_jpy: 999,
  price_evidence: priceEvidence,
  ocr_text: null,
  ocr_overlay_text: null,
  ocr_cell_label_text: null,
  confidence: 0.91,
  match_method: "fixture",
  match_score_features: null,
  match_score_embedding: null,
  match_score_text: null,
  variant_attrs: {},
  variant_source: null,
  curator_notes: null,
  source_author_handle: "fixture-shop",
  source_tweet_url: "https://queue.invalid/status/old",
  source_tweet_date: "2026-10-20",
  source_thread_root_id: null,
  source_thread_position: null,
  source_thread_root_text: null,
};

function reviewEnvelope(
  kind: "singles" | "sealed",
  sha = reviewSHA,
  effectivePrice = 130000,
  detectorPrice = 130000,
) {
  const targetId = kind === "singles" ? 23 : 29;
  const candidateProjection = {
    ...baseCandidate,
    source_image_url: sourceURL,
    source_tweet_url: "https://x.com/fixture/status/100",
    source_image_width: 1200,
    source_image_height: 800,
    ocr_price_jpy: effectivePrice,
    original_price_jpy: detectorPrice,
    effective_source_grid_bbox: geometry,
    ...(kind === "singles"
      ? { candidate_card_id: targetId, card_grading: "raw" }
      : { candidate_product_id: targetId, sealed_condition: "standard" }),
  };
  return {
    document_sha256: sha,
    document: {
      schema_version: 1,
      candidate_kind: kind,
      candidate_id: 7,
      candidate_uid: baseCandidate.candidate_uid,
      candidate_projection: candidateProjection,
      routing_outcome_id: 31,
      routing_digest: "f".repeat(64),
      route: { actionability: "review_required" },
      media_acquisition_outcome_id: 37,
      acquisition: { outcome_status: "acquired" },
      source: {
        tweet_url: "https://x.com/fixture/status/100",
        image_url: sourceURL,
        content_sha256: sourceSHA,
        width: 1200,
        height: 800,
        geometry,
        card_crop_sha256: cardCropSHA,
        price_crop_sha256: priceCropSHA,
      },
      catalog: kind === "singles"
        ? {
          target_id: targetId,
          entity_uid: "22222222-2222-4222-8222-222222222222",
          name: "サーバー・ゼクロム",
          regional_name: "サーバー・ゼクロム",
          english_name: "Server Zekrom",
          set_code: "SV11B",
          card_number: "174/086",
          misc_info: null,
          image_url: "https://fixture.invalid/catalog/zekrom.jpg",
        }
        : {
          target_id: targetId,
          entity_uid: "33333333-3333-4333-8333-333333333333",
          name: "サーバー・ボックス",
          english_name: "Server Booster Box",
          set_code: "SV11B",
          product_type: "booster_box",
          language: "ja",
          variant_edition: "standard",
          misc_info: null,
          image_url: "https://fixture.invalid/catalog/box.jpg",
        },
      displayed: {
        target_id: targetId,
        entity_uid: kind === "singles"
          ? "22222222-2222-4222-8222-222222222222"
          : "33333333-3333-4333-8333-333333333333",
        grade_or_condition: kind === "singles" ? "raw" : "standard",
        variant_attrs: {},
        detector_price_jpy: detectorPrice,
        effective_bid_price_jpy: effectivePrice,
        price_evidence: priceEvidence,
        uncertainty_flags: ["unverified_item_identity"],
      },
    },
  };
}

function loadBoundSourceImages(container: HTMLElement) {
  const images = Array.from(
    container.querySelectorAll<HTMLImageElement>(`img[src="${sourceURL}"]`),
  );
  expect(images).toHaveLength(2);
  for (const image of images) {
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1200 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 800 });
    fireEvent.load(image);
  }
}

function renderSingles(onApprove: ReturnType<typeof vi.fn>) {
  return render(
    <LanguageProvider>
      <ReviewedCurationCandidateCard
        c={{
          ...baseCandidate,
          card_grading: "raw",
          candidate_card_id: 5,
          card: {
            regional_name: "Queue Candidate",
            english_name: "Queue Candidate",
            set_code: "OLD",
            card_number: "1",
            misc_info: null,
            image_url: null,
          },
        }}
        idx={0}
        status="needs_review"
        language="en"
        saving={false}
        selected
        onSelect={vi.fn()}
        onApprove={onApprove}
        onReject={vi.fn()}
        onSendBack={vi.fn()}
      />
    </LanguageProvider>,
  );
}

function renderSealed(onApprove: ReturnType<typeof vi.fn>) {
  return render(
    <LanguageProvider>
      <ReviewedSealedCurationCandidateCard
        c={{
          ...baseCandidate,
          sealed_condition: "standard",
          candidate_product_id: 6,
          product: {
            name: "Queue Product",
            english_name: "Queue Product",
            set_code: "OLD",
            product_type: "booster_box",
            language: "ja",
            variant_edition: "standard",
            misc_info: null,
            image_url: null,
          },
        }}
        idx={0}
        status="needs_review"
        language="en"
        saving={false}
        selected
        onSelect={vi.fn()}
        onApprove={onApprove}
        onReject={vi.fn()}
        onSendBack={vi.fn()}
      />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.retry.mockReset();
  mocks.queueData = null;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "44444444-4444-4444-8444-444444444444") });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reviewed Twitter buylist item approval", () => {
  it("renders the singles server document and submits null as explicit affirmation only after both crops load", async () => {
    mocks.rpc.mockResolvedValue({ data: reviewEnvelope("singles"), error: null });
    const approve = vi.fn().mockResolvedValue("approved");
    const view = renderSingles(approve);

    expect(await screen.findByText("Server Zekrom")).toBeTruthy();
    expect(screen.queryByText("Queue Candidate")).toBeNull();
    expect(screen.getByText("¥130,000")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Mark correct" });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    loadBoundSourceImages(view.container);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(approve.mock.calls[0][0].ocr_price_jpy).toBe(130000);
    expect(approve.mock.calls[0][1]).toMatchObject({
      cardId: null,
      grading: null,
      priceJpy: null,
      notes: null,
      reviewSHA256: reviewSHA,
      reviewRequestId: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("submits explicit corrected singles values with the same reviewed SHA", async () => {
    mocks.rpc.mockResolvedValue({ data: reviewEnvelope("singles"), error: null });
    const approve = vi.fn().mockResolvedValue("approved");
    const view = renderSingles(approve);
    await screen.findByText("Server Zekrom");
    loadBoundSourceImages(view.container);
    fireEvent.click(screen.getByRole("button", { name: "Correct false match" }));
    fireEvent.change(screen.getByLabelText("Grading"), { target: { value: "psa_10" } });
    fireEvent.change(screen.getByLabelText("Price (¥)"), { target: { value: "131000" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve with fixes" }));

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(approve.mock.calls[0][1]).toMatchObject({
      grading: "psa_10",
      priceJpy: 131000,
      reviewSHA256: reviewSHA,
    });
  });

  it("refetches and rerenders a stale document and requires a second click", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: reviewEnvelope("singles"), error: null })
      .mockResolvedValueOnce({ data: reviewEnvelope("singles", nextReviewSHA, 131000), error: null });
    const approve = vi.fn()
      .mockResolvedValueOnce("stale")
      .mockResolvedValueOnce("approved");
    const view = renderSingles(approve);
    await screen.findByText("¥130,000");
    loadBoundSourceImages(view.container);
    const complete = vi.spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);
    const naturalWidth = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
      .mockReturnValue(1200);
    const naturalHeight = vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get")
      .mockReturnValue(800);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Mark correct" }));

      expect(await screen.findByText("¥131,000")).toBeTruthy();
      expect(approve).toHaveBeenCalledTimes(1);
      const refreshedButton = screen.getByRole("button", { name: "Mark correct" });
      await waitFor(() => expect((refreshedButton as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(refreshedButton);

      await waitFor(() => expect(approve).toHaveBeenCalledTimes(2));
      expect(approve.mock.calls[1][1]).toMatchObject({ reviewSHA256: nextReviewSHA });
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
      naturalHeight.mockRestore();
    }
  });

  it("applies the same exact-document gate to sealed BID quote review", async () => {
    mocks.rpc.mockResolvedValue({ data: reviewEnvelope("sealed"), error: null });
    const approve = vi.fn().mockResolvedValue("approved");
    const view = renderSealed(approve);

    expect(await screen.findByText("Server Booster Box")).toBeTruthy();
    expect(screen.queryByText("Queue Product")).toBeNull();
    const button = screen.getByRole("button", { name: "Mark correct" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    loadBoundSourceImages(view.container);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(approve.mock.calls[0][1]).toMatchObject({
      productId: null,
      condition: null,
      priceJpy: null,
      reviewSHA256: reviewSHA,
    });
  });

  it("sends the reviewed SHA through the real item RPC while the batch RPC stays tokenless", async () => {
    const queueCandidate = {
      ...baseCandidate,
      confidence: 0.99,
      price_evidence: {
        verified: true,
        method: "currency_marker",
        ocr_confidence: 0.99,
        banner: null,
      },
      card_grading: "raw",
      candidate_card_id: 5,
      card: {
        regional_name: "Queue Candidate",
        english_name: "Queue Candidate",
        set_code: "OLD",
        card_number: "1",
        misc_info: null,
        image_url: null,
      },
    };
    mocks.queueData = {
      rows: [queueCandidate],
      stats: {
        high_water: 7,
        total: 1,
        matched: 1,
        band_counts: { high: { total: 1, matched: 1 } },
      },
      loadedAll: true,
    };
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_twitter_buylist_review_document") {
        return { data: reviewEnvelope("singles"), error: null };
      }
      if (name === "approve_twitter_buylist_review") {
        return { data: { replayed: false }, error: null };
      }
      if (name === "batch_accept_image_buylist_candidates") {
        return {
          data: {
            mode: "snapshot_savepoint",
            request_id: "batch-fixture",
            summary: {
              eligible: 1, processed: 1, succeeded: 1, failed: 0, truncated: false,
            },
            results: [{ candidate_id: 7, success: true, listing_id: 11 }],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const view = render(
      <LanguageProvider>
        <CurationView />
      </LanguageProvider>,
    );
    await screen.findByText("Server Zekrom");
    loadBoundSourceImages(view.container);
    const approveButton = screen.getByRole("button", { name: "Mark correct" });
    await waitFor(() => expect((approveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(mocks.rpc.mock.calls.some(([name]) => (
        name === "approve_twitter_buylist_review"
      ))).toBe(true);
    });
    const itemCall = mocks.rpc.mock.calls.find(([name]) => (
      name === "approve_twitter_buylist_review"
    ));
    expect(itemCall?.[1]).toMatchObject({
      p_candidate_kind: "singles",
      p_candidate_id: 7,
      p_expected_review_sha256: reviewSHA,
      p_target_id: null,
      p_grade_or_condition: null,
      p_price_jpy: null,
      p_curator_notes: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve price-verified (1 shown)" }));
    await waitFor(() => {
      expect(mocks.rpc.mock.calls.some(([name]) => (
        name === "batch_accept_image_buylist_candidates"
      ))).toBe(true);
    });
    const batchCall = mocks.rpc.mock.calls.find(([name]) => (
      name === "batch_accept_image_buylist_candidates"
    ));
    expect(batchCall?.[1]).toEqual({
      p_snapshot_high_water: 7,
      p_request_id: "44444444-4444-4444-8444-444444444444",
      p_status: "needs_review",
      p_buyer: null,
      p_bands: ["high"],
      p_max: 5000,
    });
    expect(batchCall?.[1]).not.toHaveProperty("p_expected_review_sha256");
  });
});
