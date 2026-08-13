// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "./LanguageContext";
import POSView from "./POSView";

const mocks = vi.hoisted(() => ({
  afterNextPaint: vi.fn(async () => performance.now()),
  normalizeCaptureImage: vi.fn(async () => new Blob(["normalized"], { type: "image/jpeg" })),
  prewarmRecognition: vi.fn(),
  recognizeCapture: vi.fn(),
  rpc: vi.fn(),
  sha256Hex: vi.fn(async () => "a".repeat(64)),
  storageDownload: vi.fn(),
  storageRemove: vi.fn(),
  storageUpload: vi.fn(),
}));

vi.mock("@/lib/pos-camera", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pos-camera")>();
  return {
    ...actual,
    afterNextPaint: mocks.afterNextPaint,
    normalizeCaptureImage: mocks.normalizeCaptureImage,
    prewarmRecognition: mocks.prewarmRecognition,
    recognizeCapture: mocks.recognizeCapture,
    sha256Hex: mocks.sha256Hex,
  };
});

function queryResult(data: unknown) {
  const result = Promise.resolve({ data, error: null });
  const chain = {
    abortSignal: () => result,
    eq: () => chain,
    limit: () => result,
    or: () => chain,
    order: () => chain,
    select: () => chain,
    then: result.then.bind(result),
  };
  return chain;
}

const session = {
  session_id: "10000000-0000-4000-8000-000000000001",
  status: "draft",
  inventory_leg: "import",
  sell_percentage: 80,
  rounding_mode: "nearest_cent",
  sold_at: "2026-08-11",
  platform_label: "",
  notes: "",
  lines: [],
};

const candidate = {
  card_uid: "20000000-0000-4000-8000-000000000002",
  regional_name: "ピカチュウ",
  english_name: "Pikachu",
  set_code: "SV2A",
  card_number: "025",
  misc_info: "Holo",
  language: "Japanese",
  image_url: null,
  clip_score: 0.97,
  sift_good_matches: 41,
  sift_inliers: 36,
  sift_inlier_ratio: 0.88,
  rank: 1,
  verification_state: "verified",
};

const sku = {
  leg: "import",
  card_uid: candidate.card_uid,
  condition_standard: "TCGPlayer",
  condition_code: "NM",
  condition_name: "Near Mint",
  psa_grade: 0,
  available_qty: 2,
  avg_cost_unit_usd: 10,
  preview_cogs_usd: 10,
  regional_name: candidate.regional_name,
  english_name: candidate.english_name,
  set_code: candidate.set_code,
  card_number: candidate.card_number,
  misc_info: candidate.misc_info,
  language: candidate.language,
  image_url: null,
  market_unit_usd: 100,
  market_source: "fixture",
  market_as_of: "2026-08-11T00:00:00Z",
  market_confidence: "fixture",
  market_evidence: {},
};

function acquisitionState(args: Record<string, unknown>, registeredMedia: unknown[] = []) {
  return {
    operation_id: args.p_operation_id,
    lot_id: args.p_lot_id,
    lot_line_id: 99,
    recognition_request_id: args.p_recognition_request_id,
    card_uid: args.p_card_uid,
    condition_standard: args.p_condition_standard,
    condition_code: args.p_condition_code,
    psa_grade: args.p_psa_grade,
    quantity: args.p_quantity,
    price_override_usd: args.p_price_override_usd,
    market_value_usd: args.p_market_value_usd,
    browser_snapshot: {
      recognition_request_id: args.p_recognition_request_id,
      operation_owner_id: "50000000-0000-4000-8000-000000000005",
      selection_method: "candidate_tap",
      card_uid: args.p_card_uid,
      recognition: [],
      browser: args.p_browser_snapshot,
    },
    expected_attachments: (args.p_browser_snapshot as { attachments?: unknown[] })
      .attachments ?? [],
    registered_media: registeredMedia,
  };
}

const client = {
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: { id: "50000000-0000-4000-8000-000000000005" } },
      error: null,
    })),
    getSession: vi.fn(async () => ({
      data: { session: {
        access_token: "test-access-token",
        user: { id: "50000000-0000-4000-8000-000000000005" },
      } },
      error: null,
    })),
    refreshSession: vi.fn(async () => ({
      data: { session: {
        access_token: "refreshed-access-token",
        user: { id: "50000000-0000-4000-8000-000000000005" },
      } },
      error: null,
    })),
  },
  from: vi.fn((table: string) => queryResult(table === "conditions"
    ? [{ standard: "TCGPlayer", code: "NM", display_name: "Near Mint" }]
    : [])),
  rpc: mocks.rpc,
  storage: {
    from: vi.fn(() => ({
      download: mocks.storageDownload,
      remove: mocks.storageRemove,
      upload: mocks.storageUpload,
    })),
  },
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => client,
}));

beforeEach(() => {
  localStorage.clear();
  mocks.afterNextPaint.mockClear();
  mocks.normalizeCaptureImage.mockClear();
  mocks.prewarmRecognition.mockReset().mockResolvedValue({
    status: "ready",
    modelCatalogReady: true,
    saleReady: true,
    saleScopeError: null,
    inventoryLeg: "import",
    modelFingerprint: "model-fixture",
    catalogFingerprint: "catalog-fixture",
    recognizerConfigFingerprint: "config-fixture",
    catalogGeneration: "30000000-0000-4000-8000-000000000003",
    catalogReloadError: null,
    featureCache: { required: 1, available: 1, missing: 0 },
    serviceBuildSHA: "a".repeat(40),
    runtimeLockSHA256: "b".repeat(64),
    recognizerDevice: "cuda:0",
    cudaDeviceName: "fixture GPU",
    cudaRequired: true,
  });
  mocks.recognizeCapture.mockReset().mockResolvedValue({
    result: {
      request_id: "40000000-0000-4000-8000-000000000004",
      use_case: "sale",
      capture_sha256: "a".repeat(64),
      capture_bytes: 10,
      capture_width: 733,
      capture_height: 1024,
      crop: {},
      scope: "available_inventory",
      inventory_leg: "import",
      candidate_count: 1,
      candidates: [candidate],
      ambiguous: true,
      confirmation_required: true,
      model_fingerprint: "model-fixture",
      catalog_fingerprint: "catalog-fixture",
      recognizer_config_fingerprint: "config-fixture",
      timing_ms: { total: 80 },
      inventory_age_ms: 20,
    },
    serverTiming: { total: 80 },
  });
  mocks.sha256Hex.mockClear();
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "get_pos_sale_session_state") return { data: session, error: null };
    if (name === "record_card_recognition_audit") {
      return { data: "40000000-0000-4000-8000-000000000004", error: null };
    }
    if (name === "complete_card_recognition_browser_timing") {
      return { data: true, error: null };
    }
    return { data: null, error: null };
  });
  mocks.storageDownload.mockReset();
  mocks.storageRemove.mockReset().mockResolvedValue({ error: null });
  mocks.storageUpload.mockReset().mockResolvedValue({ data: { path: "fixture" }, error: null });
  client.from.mockReset().mockImplementation((table: string) => queryResult(table === "conditions"
    ? [{ standard: "TCGPlayer", code: "NM", display_name: "Near Mint" }]
    : []));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: true }) as MediaQueryList),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe("camera POS mobile recognition", () => {
  it("reveals a phone capture candidate before session controls without changing inventory", async () => {
    const { container } = render(
      <LanguageProvider><POSView /></LanguageProvider>,
    );

    await screen.findByText("The saved sale is empty.");
    const fileInput = container.querySelector<HTMLInputElement>("input[type=file]");
    expect(fileInput?.accept).toBe("image/*");
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [new File(["heic-phone-capture"], "capture.heic", { type: "image/heic" })] },
    });

    expect(await screen.findByText(candidate.regional_name)).toBeTruthy();
    const matchPanel = screen.getByTestId("pos-match-panel");
    const sessionCard = screen.getByText("Sale session").closest("[data-slot=card]");
    const preview = container.querySelector("video")?.parentElement;

    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start" }));
    expect(matchPanel.className).toContain("order-2");
    expect(matchPanel.parentElement?.className).toContain("contents");
    expect(sessionCard?.className).toContain("order-3");
    expect(preview?.className).toContain("max-h-40");
    expect(mocks.normalizeCaptureImage).toHaveBeenCalledWith(expect.objectContaining({ type: "image/heic" }));

    const rpcNames = mocks.rpc.mock.calls.map(([name]) => name);
    expect(rpcNames).toContain("record_card_recognition_audit");
    expect(mocks.rpc).toHaveBeenCalledWith("record_card_recognition_audit", expect.objectContaining({
      p_recognizer_config_fingerprint: "config-fixture",
    }));
    expect(rpcNames).not.toContain("add_pos_sale_line");
    expect(rpcNames).not.toContain("add_recognized_card_to_lot");
    expect(rpcNames).not.toContain("finalize_pos_sale_session");
    expect(screen.getByText(/Ranked visual match, not a confidence score/)).toBeTruthy();
    expect(screen.getByText("Pikachu")).toBeTruthy();
    expect(screen.getByText(/Japanese · Holo/)).toBeTruthy();
  });

  it("keeps exact candidates locked and retries only the failed evidence write", async () => {
    let auditAttempts = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_pos_sale_session_state") return { data: session, error: null };
      if (name === "record_card_recognition_audit") {
        auditAttempts += 1;
        if (auditAttempts === 1) return { data: null, error: { code: "XX001", message: "audit unavailable" } };
        return { data: "40000000-0000-4000-8000-000000000004", error: null };
      }
      if (name === "complete_card_recognition_browser_timing") {
        return { data: true, error: null };
      }
      return { data: null, error: null };
    });
    const { container } = render(<LanguageProvider><POSView /></LanguageProvider>);
    await screen.findByText("The saved sale is empty.");
    fireEvent.change(container.querySelector<HTMLInputElement>("input[type=file]") as HTMLInputElement, {
      target: { files: [new File(["phone"], "capture.jpg", { type: "image/jpeg" })] },
    });

    expect(await screen.findByText("Retry evidence save")).toBeTruthy();
    expect(screen.getByText(candidate.regional_name)).toBeTruthy();
    const candidateButton = screen.getByText(candidate.regional_name).closest("button") as HTMLButtonElement;
    expect(candidateButton.disabled).toBe(true);
    expect(mocks.recognizeCapture).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry evidence save" }));
    await waitFor(() => expect(candidateButton.disabled).toBe(false));
    fireEvent.click(candidateButton);
    expect(await screen.findByRole("button", { name: "Confirm identity" })).toBeTruthy();
    expect(mocks.recognizeCapture).toHaveBeenCalledTimes(1);
    expect(auditAttempts).toBe(2);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain("add_pos_sale_line");
  });

  it("replays the exact audit payload when the record response is lost", async () => {
    const recordArgs: Record<string, unknown>[] = [];
    let attempts = 0;
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === "get_pos_sale_session_state") return { data: session, error: null };
      if (name === "record_card_recognition_audit") {
        recordArgs.push(structuredClone(args ?? {}));
        attempts += 1;
        if (attempts === 1) {
          return { data: null, error: new TypeError("response connection closed") };
        }
        return { data: "40000000-0000-4000-8000-000000000004", error: null };
      }
      if (name === "complete_card_recognition_browser_timing") {
        return { data: true, error: null };
      }
      return { data: null, error: null };
    });
    const { container } = render(<LanguageProvider><POSView /></LanguageProvider>);
    await screen.findByText("The saved sale is empty.");
    fireEvent.change(container.querySelector<HTMLInputElement>("input[type=file]") as HTMLInputElement, {
      target: { files: [new File(["phone"], "capture.jpg", { type: "image/jpeg" })] },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Retry evidence save" }));
    await waitFor(() => expect(recordArgs).toHaveLength(2));
    expect(recordArgs[1]).toEqual(recordArgs[0]);
    expect(mocks.recognizeCapture).toHaveBeenCalledTimes(1);
  });

  it("replays frozen completion timing when the completion response is lost", async () => {
    const completionArgs: Record<string, unknown>[] = [];
    let attempts = 0;
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === "get_pos_sale_session_state") return { data: session, error: null };
      if (name === "record_card_recognition_audit") {
        return { data: "40000000-0000-4000-8000-000000000004", error: null };
      }
      if (name === "complete_card_recognition_browser_timing") {
        completionArgs.push(structuredClone(args ?? {}));
        attempts += 1;
        if (attempts === 1) {
          return { data: null, error: new TypeError("response connection closed") };
        }
        return { data: true, error: null };
      }
      return { data: null, error: null };
    });
    const { container } = render(<LanguageProvider><POSView /></LanguageProvider>);
    await screen.findByText("The saved sale is empty.");
    fireEvent.change(container.querySelector<HTMLInputElement>("input[type=file]") as HTMLInputElement, {
      target: { files: [new File(["phone"], "capture.jpg", { type: "image/jpeg" })] },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Retry evidence save" }));
    await waitFor(() => expect(completionArgs).toHaveLength(2));
    expect(completionArgs[1]).toEqual(completionArgs[0]);
    expect(mocks.recognizeCapture).toHaveBeenCalledTimes(1);
  });

  it("keeps file fallback and manual search usable when camera permission is denied", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => { throw new DOMException("permission denied", "NotAllowedError"); }) },
    });
    const { container } = render(<LanguageProvider><POSView /></LanguageProvider>);
    await screen.findByText("The saved sale is empty.");
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Camera unavailable");

    const manualInput = screen.getByPlaceholderText("Mewtwo SV2A 150");
    fireEvent.change(manualInput, { target: { value: "Pikachu" } });
    fireEvent.keyDown(manualInput, { key: "Enter" });
    await waitFor(() => expect(mocks.rpc.mock.calls.some(([name]) => name === "search_pos_inventory")).toBe(true));

    const fallback = container.querySelector<HTMLInputElement>("input[type=file]");
    expect(fallback?.disabled).toBe(false);
    fireEvent.change(fallback as HTMLInputElement, {
      target: { files: [new File(["fallback"], "fallback.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByText(candidate.regional_name)).toBeTruthy();
  });

  it("aborts a stale acquisition search and renders only the latest result", async () => {
    const slow = candidate;
    const latest = { ...candidate, card_uid: "20000000-0000-4000-8000-000000000099", regional_name: "Latest Charizard" };
    let resolveSlow: (value: { data: unknown; error: null }) => void = () => undefined;
    mocks.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "get_pos_sale_session_state") return Promise.resolve({ data: session, error: null });
      if (name === "search_pos_card_identities") {
        const result = args?.p_query === "slow"
          ? new Promise<{ data: unknown; error: null }>((resolve) => { resolveSlow = resolve; })
          : Promise.resolve({ data: [latest], error: null });
        return { abortSignal: () => result };
      }
      return Promise.resolve({ data: null, error: null });
    });
    client.from.mockImplementation((table: string) => queryResult(table === "conditions"
      ? [{ standard: "TCGPlayer", code: "NM", display_name: "Near Mint" }]
      : table === "acquisition_lots"
        ? [{ lot_id: 1, acquired_at: "2026-08-11", shop_label: "Fixture", leg: "import" }]
        : []));
    render(<LanguageProvider><POSView /></LanguageProvider>);
    await screen.findByText("The saved sale is empty.");
    fireEvent.click(screen.getByRole("tab", { name: "Acquire" }));
    await screen.findByRole("option", { name: /Fixture/ });
    const input = screen.getByPlaceholderText("Mewtwo SV2A 150");
    fireEvent.change(input, { target: { value: "slow" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "latest" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/Latest Charizard/)).toBeTruthy();
    resolveSlow({ data: [slow], error: null });
    await Promise.resolve();
    expect(screen.queryByText(new RegExp(slow.regional_name))).toBeNull();
  });

  it("uses one frozen sale UUID across an ambiguous retry without rescanning", async () => {
    const operationIDs: string[] = [];
    mocks.rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "preview_pos_sale_line") return queryResult({
        available_quantity: 2,
        requested_quantity: 1,
        sufficient: true,
        preview_cogs_usd: 10,
        projected_session_cogs_usd: 10,
        affected_lines: [{
          line_id: null,
          line_position: 1,
          preview_cogs_usd: 10,
          fifo_fingerprint: "fifo-add",
        }],
        fifo_fingerprint: "fifo-add",
        preview_token: "c".repeat(64),
      });
      if (name === "get_pos_sale_session_state") return Promise.resolve({ data: session, error: null });
      if (name === "record_card_recognition_audit") return Promise.resolve({ data: "40000000-0000-4000-8000-000000000004", error: null });
      if (name === "complete_card_recognition_browser_timing") return Promise.resolve({ data: true, error: null });
      if (name === "confirm_card_recognition_audit") return Promise.resolve({ data: candidate.card_uid, error: null });
      if (name === "search_pos_inventory") return Promise.resolve({ data: [sku], error: null });
      if (name === "add_pos_sale_line") {
        operationIDs.push(String(args?.p_line_id));
        expect(args).toEqual(expect.objectContaining({
          p_expected_preview_token: "c".repeat(64),
          p_expected_preview_cogs_usd: 10,
        }));
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const { container } = render(<LanguageProvider><POSView /></LanguageProvider>);
    await screen.findByText("The saved sale is empty.");
    fireEvent.change(container.querySelector<HTMLInputElement>("input[type=file]") as HTMLInputElement, {
      target: { files: [new File(["phone"], "capture.jpg", { type: "image/jpeg" })] },
    });
    const ranked = (await screen.findByText(candidate.regional_name)).closest("button") as HTMLButtonElement;
    await waitFor(() => expect(ranked.disabled).toBe(false));
    fireEvent.click(ranked);
    expect(screen.getByText(/SV2A 025 · Japanese · Holo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm identity" }));
    const nearMint = (await screen.findByText("Near Mint")).closest("button") as HTMLButtonElement;
    expect(screen.getByText(/fixture · (updated|stale:).* · fixture/)).toBeTruthy();
    fireEvent.click(nearMint);
    expect(await screen.findByText("FIFO preview for 1 card(s): COGS $10.00")).toBeTruthy();
    expect(await screen.findByText("Projected cart COGS: $10.00")).toBeTruthy();
    expect(screen.getByText("Projected margin: $70.00")).toBeTruthy();
    const sellPercentage = screen.getByLabelText("Custom sell percentage");
    fireEvent.change(sellPercentage, { target: { value: "79" } });
    expect((screen.getByRole("button", { name: "Add to saved sale" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(sellPercentage, { target: { value: "80" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Add to saved sale" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Add to saved sale" }));
    expect(await screen.findByRole("button", { name: "Retry exact saved add" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry exact saved add" }));
    await waitFor(() => expect(operationIDs).toHaveLength(2));
    expect(new Set(operationIDs).size).toBe(1);
    expect(mocks.recognizeCapture).toHaveBeenCalledTimes(1);
  });

  it("reviews every shifted duplicate-SKU FIFO layer before applying an exact update", async () => {
    const baseLine = {
      line_position: 1,
      identity: {
        card_uid: candidate.card_uid,
        regional_name: candidate.regional_name,
        english_name: candidate.english_name,
        set_code: candidate.set_code,
        card_number: candidate.card_number,
        condition_standard: "TCGPlayer",
        condition_code: "NM",
        psa_grade: 0,
      },
      quantity: 1,
      available_qty_at_add: 3,
      avg_cost_unit_usd: 10,
      preview_cogs_usd: 10,
      preview_fifo_fingerprint: "first-old",
      market_unit_usd: 100,
      proposed_unit_price_usd: 80,
      agreed_unit_price_usd: 80,
      add_request: {
        requested_agreed_unit_price_usd: 80,
        requested_sell_percentage: null,
        requested_rounding_mode: null,
        manual_market_unit_usd: null,
        manual_market_reason: null,
        browser_snapshot: {},
        expected_preview_token: "a".repeat(64),
        expected_preview_cogs_usd: 10,
      },
    };
    const firstID = "60000000-0000-4000-8000-000000000001";
    const secondID = "60000000-0000-4000-8000-000000000002";
    let currentSession = {
      ...session,
      lines: [
        { ...baseLine, line_id: firstID },
        {
          ...baseLine,
          line_id: secondID,
          line_position: 2,
          preview_fifo_fingerprint: "second-old",
        },
      ],
    };
    const quote = {
      available_quantity: 2,
      requested_quantity: 2,
      sufficient: true,
      preview_cogs_usd: 20,
      projected_session_cogs_usd: 40,
      affected_lines: [
        { line_id: firstID, line_position: 1, preview_cogs_usd: 20, fifo_fingerprint: "first-new" },
        { line_id: secondID, line_position: 2, preview_cogs_usd: 20, fifo_fingerprint: "second-new" },
      ],
      fifo_fingerprint: "first-new",
      preview_token: "d".repeat(64),
    };
    const updates: Record<string, unknown>[] = [];
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === "get_pos_sale_session_state") return { data: currentSession, error: null };
      if (name === "preview_pos_sale_line") return { data: quote, error: null };
      if (name === "update_pos_sale_line") {
        updates.push(structuredClone(args ?? {}));
        currentSession = {
          ...currentSession,
          lines: currentSession.lines.map((line) => line.line_id === firstID
            ? { ...line, quantity: 2, preview_cogs_usd: 20, preview_fifo_fingerprint: "first-new" }
            : { ...line, preview_cogs_usd: 20, preview_fifo_fingerprint: "second-new" }),
        };
        return { data: firstID, error: null };
      }
      return { data: null, error: null };
    });

    render(<LanguageProvider><POSView /></LanguageProvider>);
    await screen.findByText("$160.00");
    fireEvent.click(screen.getAllByRole("button", { name: "Increase quantity" })[0]);

    const review = await screen.findByRole("region", { name: "Review quoted line change" });
    await waitFor(() => expect(document.activeElement).toBe(review));
    expect(screen.getByText("$40.00")).toBeTruthy();
    expect(screen.getByText("$200.00")).toBeTruthy();
    expect(screen.getAllByText(/\$10\.00 to \$20\.00/)).toHaveLength(2);
    expect(updates).toHaveLength(0);

    const apply = screen.getByRole("button", { name: "Apply quoted change" });
    apply.focus();
    expect(document.activeElement).toBe(apply);
    fireEvent.click(apply);
    await waitFor(() => expect(updates).toEqual([{
      p_line_id: firstID,
      p_quantity: 2,
      p_agreed_unit_price_usd: 80,
      p_expected_preview_token: "d".repeat(64),
      p_expected_preview_cogs_usd: 20,
      p_expected_session_cogs_usd: 40,
    }]));
  });

  it("preserves uploaded bytes when media registration committed before its response was lost", async () => {
    let registrationAttempts = 0;
    let committedArgs: Record<string, unknown> | null = null;
    let registeredMedia: unknown[] = [];
    mocks.storageDownload
      .mockResolvedValueOnce({ data: null, error: { statusCode: 404, code: "not_found" } })
      .mockResolvedValue({
        data: new Blob(["normalized"], { type: "image/jpeg" }),
        error: null,
      });
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === "get_pos_sale_session_state") return { data: session, error: null };
      if (name === "record_card_recognition_audit") {
        return { data: "40000000-0000-4000-8000-000000000004", error: null };
      }
      if (name === "complete_card_recognition_browser_timing") {
        return { data: true, error: null };
      }
      if (name === "confirm_card_recognition_audit") return { data: candidate.card_uid, error: null };
      if (name === "get_pos_acquisition_operation_state") {
        return { data: committedArgs ? acquisitionState(committedArgs, registeredMedia) : null, error: null };
      }
      if (name === "add_recognized_card_to_lot") {
        committedArgs = args ?? {};
        return { data: 99, error: null };
      }
      if (name === "register_inventory_card_media") {
        registrationAttempts += 1;
        if (registrationAttempts === 1) {
          return { data: null, error: new TypeError("response connection closed") };
        }
        registeredMedia = [{
          media_kind: args?.p_media_kind,
          object_key: args?.p_object_key,
          mime_type: args?.p_mime_type,
          byte_size: args?.p_byte_size,
          sha256: args?.p_sha256,
          is_recognition_capture: args?.p_is_recognition_capture,
        }];
        return { data: "60000000-0000-4000-8000-000000000006", error: null };
      }
      return { data: null, error: null };
    });
    client.from.mockImplementation((table: string) => queryResult(table === "conditions"
      ? [{ standard: "TCGPlayer", code: "NM", display_name: "Near Mint" }]
      : table === "acquisition_lots"
        ? [{ lot_id: 1, acquired_at: "2026-08-11", shop_label: "Fixture", leg: "import", orig_currency: "JPY", fx_rate_used: 0.0065 }]
        : []));

    const { container } = render(<LanguageProvider><POSView /></LanguageProvider>);
    await screen.findByText("The saved sale is empty.");
    fireEvent.click(screen.getByRole("tab", { name: "Acquire" }));
    await screen.findByRole("option", { name: /Fixture/ });
    fireEvent.change(container.querySelector<HTMLInputElement>("input[type=file]") as HTMLInputElement, {
      target: { files: [new File(["phone"], "capture.jpg", { type: "image/jpeg" })] },
    });
    const ranked = (await screen.findByText(candidate.regional_name)).closest("button") as HTMLButtonElement;
    await waitFor(() => expect(ranked.disabled).toBe(false));
    fireEvent.click(ranked);
    fireEvent.click(screen.getByRole("button", { name: "Confirm identity" }));
    expect(await screen.findByText(
      "Use this recognition capture as the single private front image",
    )).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to acquisition lot" }));

    expect(await screen.findByText(/was added to acquisition lot 1/)).toBeTruthy();
    expect(registrationAttempts).toBe(2);
    expect(mocks.storageUpload).toHaveBeenCalledTimes(1);
    expect(mocks.storageRemove).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name))
      .not.toContain("pos_inventory_media_object_is_orphan");
  });

  it("marks all primary phone controls as 44px targets and exposes keyboard focus", async () => {
    const { container } = render(<LanguageProvider><POSView /></LanguageProvider>);
    await screen.findByText("The saved sale is empty.");
    const controls = [
      screen.getByRole("tab", { name: "Sell" }),
      screen.getByRole("tab", { name: "Acquire" }),
      screen.getByRole("button", { name: "Start camera" }),
      screen.getByRole("button", { name: "Search" }),
      screen.getByRole("button", { name: "Pause" }),
      container.querySelector("label[aria-disabled]") as HTMLElement,
      screen.getByPlaceholderText("Mewtwo SV2A 150"),
    ];
    for (const control of controls) {
      expect(control.className).toContain("min-h-11");
    }
    screen.getByRole("button", { name: "Pause" }).focus();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause" }));
    expect((screen.getByLabelText("Platform") as HTMLInputElement).maxLength).toBe(255);
    expect((screen.getByLabelText("Notes") as HTMLInputElement).maxLength).toBe(1000);
  });

  it("keeps a finalized session visible while surfacing ledger reversal", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_pos_sale_session_state") return {
        data: {
          ...session,
          status: "finalized",
          finalization: {
            line_count: 1,
            total_cogs_usd: 10,
            total_margin_usd: 10,
            total_gross_usd: 20,
          },
          ledger: {
            status: "reversed",
            reversed_at: "2026-08-12T10:00:00Z",
          },
        },
        error: null,
      };
      return { data: null, error: null };
    });
    render(<LanguageProvider><POSView /></LanguageProvider>);

    expect(await screen.findByText("Finalized")).toBeTruthy();
    expect(screen.getByText("This finalized sale was reversed in the ledger")).toBeTruthy();
    expect(screen.getByText(/Reversed on 2026-08-12/)).toBeTruthy();
  });
});
