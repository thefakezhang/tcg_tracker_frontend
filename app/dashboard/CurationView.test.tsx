// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import { CurationCandidateCard } from "./CurationView";
import { SealedCurationCandidateCard } from "./SealedCurationView";

afterEach(cleanup);

const baseCandidate = {
  candidate_id: 1,
  status: "needs_review",
  cell_image_url: null,
  source_image_url: null,
  source_grid_bbox: null,
  effective_source_grid_bbox: null,
  source_image_width: null,
  source_image_height: null,
  active_geometry_correction_id: null,
  ocr_price_jpy: 1200,
  price_evidence: {
    verified: false,
    method: "recognition_fallback",
    ocr_confidence: 0.99,
    banner: null,
  },
  ocr_text: null,
  ocr_overlay_text: null,
  ocr_cell_label_text: null,
  confidence: 0.9,
  match_method: "test",
  match_score_features: null,
  match_score_embedding: null,
  match_score_text: null,
  variant_attrs: null,
  variant_source: null,
  curator_notes: null,
  source_author_handle: null,
  source_tweet_url: null,
  source_tweet_date: null,
  source_thread_root_id: null,
  source_thread_position: null,
  source_thread_root_text: null,
};

function labelFor(text: string): HTMLLabelElement {
  return screen.getByText(text).closest("label") as HTMLLabelElement;
}

function expectAssociatedControl(label: string) {
  const control = screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  expect(labelFor(label).htmlFor).toBe(control.id);
  expect(control.className).toContain("min-h-11");
}

describe("curation correction cards", () => {
  it("keeps singles correction controls labelled, touch-sized, and mobile-wrappable", () => {
    render(
      <LanguageProvider>
        <CurationCandidateCard
          c={{ ...baseCandidate, card_grading: "raw", candidate_card_id: 7, card: null }}
          idx={0} status="needs_review" language="en" saving={false} selected={false}
          onSelect={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} onSendBack={vi.fn()}
        />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Correct false match" }));

    ["Grading", "Price (¥)", "Change matched card", "Notes"].forEach(expectAssociatedControl);
    expect(screen.getByRole("button", { name: "Approve with fixes" }).className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: "Reject - no match" }).className).toContain("min-h-11");
    expect(screen.getByText("No real card to map to? Reject it.").parentElement?.className).toContain("flex-col");
    expect(screen.getByText("Identity 90% · test").className).toContain("whitespace-normal");
    expect(screen.getByText("Price needs review").className).toContain("whitespace-normal");
  });

  it("keeps sealed correction controls labelled and touch-sized", () => {
    render(
      <LanguageProvider>
        <SealedCurationCandidateCard
          c={{ ...baseCandidate, sealed_condition: "standard", candidate_product_id: 7, product: null }}
          idx={0} status="needs_review" language="en" saving={false} selected={false}
          onSelect={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} onSendBack={vi.fn()}
        />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Correct false match" }));

    ["Condition", "Price (¥)", "Change matched product", "Notes"].forEach(expectAssociatedControl);
    expect(screen.getByRole("button", { name: "Approve with fixes" }).className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: "Reject - no match" }).className).toContain("min-h-11");
    expect(screen.getByText("Identity 90% · test")).toBeTruthy();
    expect(screen.getByText("Price needs review")).toBeTruthy();
  });

  it("keeps a 99% identity match separate from a failed price-banner threshold", () => {
    render(
      <LanguageProvider>
        <CurationCandidateCard
          c={{
            ...baseCandidate,
            confidence: 0.99,
            price_evidence: {
              verified: false,
              method: "banner_plain_digits",
              ocr_confidence: 0.99,
              banner: { kind: "yellow", score: 0.54, threshold: 0.55, matched: false },
            },
            card_grading: "raw",
            candidate_card_id: 7,
            card: null,
          }}
          idx={0} status="needs_review" language="en" saving={false} selected={false}
          onSelect={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} onSendBack={vi.fn()}
        />
      </LanguageProvider>,
    );

    expect(screen.getByText("Identity 99% · test")).toBeTruthy();
    expect(screen.getByText("Price review · banner 54%/55%")).toBeTruthy();
    expect(screen.getByLabelText(
      "yellow price banner score: 54%; required: 55%. OCR readability: 99%. This is separate from card identity confidence.",
    )).toBeTruthy();
  });
});
