// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StableFrameGate,
  ExactRetryOperation,
  afterNextPaint,
  acquisitionCostEvidence,
  boundedDecimalInput,
  captureNormalizationPlan,
  captureMetadata,
  centeredPortraitCrop,
  contentAddressedMediaKey,
  coverGuideToSourceCrop,
  meanAbsoluteDifference,
  manualSelectionEvidence,
  normalizeCaptureImage,
  patchPOSSessionSettings,
  proposedSalePrice,
  posErrorMessage,
  parseRecognitionResult,
  parseServerTiming,
  prewarmRecognition,
  reconcileInventoryMediaRegistration,
  recognizeCapture,
  samePOSSessionSettings,
  saleAddRetryDisposition,
  strictIntegerInput,
  validatedRecognitionOrigin,
} from "./pos-camera";

const requestID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function validPayload() {
  return {
    request_id: requestID,
    use_case: "sale",
    capture_sha256: "b".repeat(64),
    capture_bytes: 120_000,
    capture_width: 733,
    capture_height: 1024,
    crop: {
      x: 100,
      y: 20,
      width: 800,
      height: 1117,
      source_width: 1920,
      source_height: 1080 + 100,
    },
    scope: "available_inventory",
    inventory_leg: "import",
    candidate_count: 1,
    candidates: [{
      card_uid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      regional_name: "Old-back card",
      english_name: null,
      set_code: "",
      card_number: "",
      misc_info: "",
      language: "",
      image_url: null,
      clip_score: 0.91,
      sift_good_matches: 14,
      sift_inliers: 10,
      sift_inlier_ratio: 0.714286,
      rank: 1,
      verification_state: "verified",
    }],
    ambiguous: true,
    confirmation_required: true,
    model_fingerprint: "model:abc",
    catalog_fingerprint: "catalog:def",
    recognizer_config_fingerprint: "recognizer-config-sha256:" + "d".repeat(64),
    timing_ms: { decode: 2, clip: 16, sift: 4, total: 23 },
    inventory_age_ms: 200,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POS camera capture contract", () => {
  it("centers the 63:88 card guide for the 733x1024 output", () => {
    const landscape = centeredPortraitCrop(1920, 1080);
    expect(landscape).toEqual({ x: 573, y: 0, width: 773, height: 1080 });
    const portrait = centeredPortraitCrop(720, 1280);
    expect(portrait).toEqual({ x: 0, y: 137, width: 720, height: 1006 });
  });

  it("maps a displayed landscape cover guide through source offsets and margin", () => {
    expect(coverGuideToSourceCrop({
      sourceWidth: 1920,
      sourceHeight: 1080,
      displayWidth: 390,
      displayHeight: 600,
      guideX: 69,
      guideY: 124,
      guideWidth: 252,
      guideHeight: 352,
    })).toEqual({ x: 710, y: 191, width: 500, height: 698 });
  });

  it("maps portrait cover offsets and clamps an expanded edge guide", () => {
    expect(coverGuideToSourceCrop({
      sourceWidth: 1080,
      sourceHeight: 1920,
      displayWidth: 390,
      displayHeight: 600,
      guideX: 69,
      guideY: 124,
      guideWidth: 252,
      guideHeight: 352,
    })).toEqual({ x: 156, y: 423, width: 768, height: 1074 });
    expect(coverGuideToSourceCrop({
      sourceWidth: 800,
      sourceHeight: 1600,
      displayWidth: 400,
      displayHeight: 800,
      guideX: 0,
      guideY: 0,
      guideWidth: 200,
      guideHeight: 280,
    })).toEqual({ x: 0, y: 0, width: 420, height: 588 });
  });

  it("fails closed when either measured guide offset is non-finite", () => {
    const measured = {
      sourceWidth: 1920,
      sourceHeight: 1080,
      displayWidth: 390,
      displayHeight: 600,
      guideX: 69,
      guideY: 124,
      guideWidth: 252,
      guideHeight: 352,
    };
    expect(() => coverGuideToSourceCrop({ ...measured, guideX: Number.NaN }))
      .toThrow(/measured camera guide/);
    expect(() => coverGuideToSourceCrop({ ...measured, guideY: Number.POSITIVE_INFINITY }))
      .toThrow(/measured camera guide/);
  });

  it("normalizes EXIF-oriented photos to one bounded portrait JPEG contract", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const createBitmap = vi.fn(async () => ({
      width: 1200,
      height: 800,
      close,
    }));
    vi.stubGlobal("createImageBitmap", createBitmap);
    vi.spyOn(document, "createElement").mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(
        new Blob(["normalized"], { type: "image/jpeg" }),
      ),
    } as unknown as HTMLCanvasElement);
    const source = new Blob(["photo"], { type: "image/jpeg" });

    const normalized = await normalizeCaptureImage(source);

    expect(createBitmap).toHaveBeenCalledWith(source, { imageOrientation: "from-image" });
    expect(captureNormalizationPlan(1200, 800)).toEqual({
      source: { x: 314, y: 0, width: 573, height: 800 },
      outputWidth: 733,
      outputHeight: 1024,
    });
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      314,
      0,
      573,
      800,
      0,
      0,
      733,
      1024,
    );
    expect(normalized.type).toBe("image/jpeg");
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["image/heic", "image/heif"])(
    "accepts a %s phone source when the browser decoder supports it",
    async (mimeType) => {
      const close = vi.fn();
      const drawImage = vi.fn();
      const decode = vi.fn(async () => ({
        source: {} as CanvasImageSource,
        width: 1200,
        height: 1600,
        close,
      }));
      vi.spyOn(document, "createElement").mockReturnValue({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toBlob: (callback: BlobCallback) => callback(
          new Blob(["normalized"], { type: "image/jpeg" }),
        ),
      } as unknown as HTMLCanvasElement);
      const source = new Blob(["phone-photo"], { type: mimeType });

      const normalized = await normalizeCaptureImage(source, decode);

      expect(decode).toHaveBeenCalledWith(source);
      expect(normalized.type).toBe("image/jpeg");
      expect(drawImage).toHaveBeenCalledWith(
        expect.anything(),
        27,
        0,
        1145,
        1600,
        0,
        0,
        733,
        1024,
      );
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("re-arms through a stable removal before accepting an identical next card", () => {
    const gate = new StableFrameGate(3, 2, 8, 1_000);
    const cardA = new Uint8Array([20, 20, 20, 20]);
    expect(gate.observe(cardA, 0)).toBe(false);
    expect(gate.observe(cardA, 100)).toBe(false);
    expect(gate.observe(cardA, 200)).toBe(true);
    gate.markSubmitted(cardA, 200);
    expect(gate.observe(cardA, 1_500)).toBe(false);
    const background = new Uint8Array([80, 80, 80, 80]);
    expect(gate.observe(background, 1_800)).toBe(false);
    expect(gate.observe(background, 1_900)).toBe(false);
    expect(gate.observe(background, 2_000)).toBe(false);
    expect(gate.observe(background, 2_100)).toBe(false);
    expect(gate.observe(background, 2_200)).toBe(false);
    expect(gate.observe(background, 2_300)).toBe(false);
    expect(gate.observe(cardA, 2_400)).toBe(false);
    expect(gate.observe(cardA, 2_500)).toBe(false);
    expect(gate.observe(cardA, 2_600)).toBe(true);
    gate.markSubmitted(cardA, 2_600);
    expect(gate.observe(cardA, 4_000)).toBe(false);
  });

  it("uses a two-frame default gate without weakening removal and repeat protection", () => {
    const gate = new StableFrameGate();
    const card = new Uint8Array([20, 20, 20, 20]);
    expect(gate.observe(card, 0)).toBe(false);
    expect(gate.observe(card, 55)).toBe(true);
    gate.markSubmitted(card, 55);
    expect(gate.observe(card, 2_000)).toBe(false);
    const removed = new Uint8Array([90, 90, 90, 90]);
    expect(gate.observe(removed, 2_055)).toBe(false);
    expect(gate.observe(removed, 2_110)).toBe(false);
    expect(gate.observe(card, 2_165)).toBe(false);
    expect(gate.observe(card, 2_220)).toBe(true);
  });

  it("strictly rejects fractional integers and preserves native acquisition FX evidence", () => {
    expect(strictIntegerInput("1.9", 1, 10)).toBeNull();
    expect(strictIntegerInput("01", 0, 10)).toBeNull();
    expect(strictIntegerInput("10", 0, 10)).toBe(10);
    expect(boundedDecimalInput("12.345", 0, 1_000)).toBeNull();
    expect(acquisitionCostEvidence("1200", "JPY", 0.0065)).toEqual({
      native_amount: 1200,
      native_currency: "JPY",
      fx_rate_to_usd: 0.0065,
      price_usd: 7.8,
    });
    expect(acquisitionCostEvidence("12.50", "USD", 1)).toEqual({
      native_amount: 12.5,
      native_currency: "USD",
      fx_rate_to_usd: 1,
      price_usd: 12.5,
    });
  });

  it("renders useful PostgREST errors instead of object coercion", () => {
    expect(posErrorMessage({
      code: "P0001",
      message: "recognition replay rejected",
      details: "config fingerprint changed",
      hint: "retry the frozen request",
    })).toBe(
      "recognition replay rejected · config fingerprint changed · retry the frozen request · P0001",
    );
    expect(posErrorMessage({ message: "audit unavailable" })).toBe("audit unavailable");
    expect(posErrorMessage({})).toBe("Unknown request error");
  });

  it("keeps quick settings edits in one draft until an explicit save", () => {
    const initial = {
      sellPercentage: "80",
      roundingMode: "nearest_dollar",
      soldAt: "2026-08-11",
      platformLabel: "",
      notes: "",
    };
    const afterPercentage = patchPOSSessionSettings(initial, { sellPercentage: "83" });
    const afterRounding = patchPOSSessionSettings(afterPercentage, {
      roundingMode: "nearest_cent",
    });
    expect(afterRounding).toEqual({
      ...initial,
      sellPercentage: "83",
      roundingMode: "nearest_cent",
    });
    expect(samePOSSessionSettings(afterRounding, {
      sell_percentage: 83,
      rounding_mode: "nearest_cent",
      sold_at: "2026-08-11",
      platform_label: "",
      notes: "",
    })).toBe(true);
    expect(samePOSSessionSettings(initial, {
      sell_percentage: 83,
      rounding_mode: "nearest_cent",
      sold_at: "2026-08-11",
    })).toBe(false);
  });

  it("uses bounded double animation frames with a background-tab timeout", async () => {
    vi.useFakeTimers();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const painted = afterNextPaint(100);
    callbacks.shift()?.(1);
    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(2);
    await expect(painted).resolves.toEqual(expect.any(Number));

    const backgrounded = afterNextPaint(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(backgrounded).resolves.toEqual(expect.any(Number));
    vi.useRealTimers();
  });

  it("freezes the stable UUID for unaudited manual selection", () => {
    expect(manualSelectionEvidence("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))
      .toEqual({
        selection_method: "manual_search",
        card_uid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      });
    expect(() => manualSelectionEvidence("local-card-17")).toThrow(/stable card UUID/);
  });

  it("shows the server-equivalent proposal without overriding an explicit agreement", () => {
    for (const mode of [
      "nearest_cent",
      "nearest_dollar",
      "down_dollar",
      "up_dollar",
    ]) {
      expect(proposedSalePrice(20, 80, mode)).toBe(16);
    }
    expect(proposedSalePrice(20.51, 83, "nearest_cent")).toBe(17.02);
    expect(proposedSalePrice(20.51, 83, "nearest_dollar")).toBe(17);
    expect(proposedSalePrice(20.51, 83, "down_dollar")).toBe(17);
    expect(proposedSalePrice(20.51, 83, "up_dollar")).toBe(18);
    const operatorAgreed = 19;
    expect(operatorAgreed).not.toBe(proposedSalePrice(20, 80, "nearest_dollar"));
  });

  it("reuses one add-operation UUID after an uncertain response", () => {
    const operation = new ExactRetryOperation();
    const first = operation.begin("frozen-payload", () => requestID);
    const retry = operation.begin("frozen-payload", () => "should-not-be-used");
    expect(retry).toEqual(first);
    expect(() => operation.begin("edited-payload")).toThrow(/frozen payload/);
    operation.clear(requestID);
    expect(operation.pending()).toBeNull();
  });

  it("restores and clears one frozen operation across a browser reload", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const firstPage = new ExactRetryOperation({
      storage,
      storageKey: "owner-a:sale-add",
    });
    const frozen = firstPage.begin("{\"quantity\":1}", () => requestID);

    const reloadedPage = new ExactRetryOperation({
      storage,
      storageKey: "owner-a:sale-add",
    });
    expect(reloadedPage.pending()).toEqual(frozen);
    expect(reloadedPage.begin("{\"quantity\":1}", () => "unused"))
      .toEqual(frozen);
    expect(() => reloadedPage.begin("{\"quantity\":2}"))
      .toThrow(/frozen payload/);
    reloadedPage.clear(requestID);

    expect(new ExactRetryOperation({
      storage,
      storageKey: "owner-a:sale-add",
    }).pending()).toBeNull();
  });

  it("isolates owners, retains old unresolved operations, and rejects corrupt storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    new ExactRetryOperation({
      storage,
      storageKey: "owner-a:sale",
      clock: () => 1_000_000,
    }).begin("frozen", () => requestID);
    expect(new ExactRetryOperation({
      storage,
      storageKey: "owner-b:sale",
      clock: () => 1_000_000,
    }).pending()).toBeNull();
    expect(new ExactRetryOperation({
      storage,
      storageKey: "owner-a:sale",
      clock: () => 1_000_000 + 8 * 24 * 60 * 60 * 1_000,
    }).pending()).toEqual({ operationID: requestID, payloadKey: "frozen" });
    values.set("owner-a:acquisition", "{bad-json");
    expect(() => new ExactRetryOperation({
      storage,
      storageKey: "owner-a:acquisition",
    })).toThrow(/malformed/);
  });

  it("retains the frozen sale add until an exact row converges", () => {
    expect(saleAddRetryDisposition({
      addReturnedSuccessfully: false,
      definitiveRPCFailure: false,
      stateReadConverged: true,
      lineFound: false,
    })).toBe("retain");
    expect(saleAddRetryDisposition({
      addReturnedSuccessfully: true,
      definitiveRPCFailure: true,
      stateReadConverged: false,
      lineFound: false,
    })).toBe("retain");
    expect(saleAddRetryDisposition({
      addReturnedSuccessfully: false,
      definitiveRPCFailure: true,
      stateReadConverged: true,
      lineFound: false,
    })).toBe("clear");
    expect(saleAddRetryDisposition({
      addReturnedSuccessfully: false,
      definitiveRPCFailure: false,
      stateReadConverged: true,
      lineFound: true,
    })).toBe("complete");

    const frozen = new ExactRetryOperation();
    const first = frozen.begin("sale-payload", () => requestID);
    expect(frozen.pending()?.operationID).toBe(requestID);
    const convergedRetry = frozen.begin("sale-payload", () => "new-id");
    expect(convergedRetry.operationID).toBe(first.operationID);
  });

  it("keeps uploaded evidence when registration committed but its response was lost", async () => {
    let registered = false;
    let attempts = 0;
    const remove = vi.fn(async () => undefined);
    await reconcileInventoryMediaRegistration({
      register: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          registered = true;
          throw new TypeError("response connection closed");
        }
        if (!registered) throw { code: "P0001", message: "missing registration" };
      }),
      isOrphan: vi.fn(async () => !registered),
      remove,
      isDefinitiveFailure: (cause) => Boolean(
        cause && typeof cause === "object" && "code" in cause,
      ),
    });
    expect(attempts).toBe(2);
    expect(registered).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes only after two definitive failures and an authoritative orphan result", async () => {
    const failure = { code: "P0001", message: "registration rejected" };
    const remove = vi.fn(async () => undefined);
    await expect(reconcileInventoryMediaRegistration({
      register: vi.fn(async () => { throw failure; }),
      isOrphan: vi.fn(async () => true),
      remove,
      isDefinitiveFailure: () => true,
    })).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("treats a definitive retry as converged when the object is registered", async () => {
    const remove = vi.fn(async () => undefined);
    await reconcileInventoryMediaRegistration({
      register: vi.fn(async () => { throw { code: "P0001", message: "response rejected" }; }),
      isOrphan: vi.fn(async () => false),
      remove,
      isDefinitiveFailure: () => true,
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("preserves an orphan when the retry outcome remains ambiguous", async () => {
    const remove = vi.fn(async () => undefined);
    await expect(reconcileInventoryMediaRegistration({
      register: vi.fn(async () => { throw new TypeError("connection closed"); }),
      isOrphan: vi.fn(async () => true),
      remove,
      isDefinitiveFailure: () => false,
    })).rejects.toThrow("connection closed");
    expect(remove).not.toHaveBeenCalled();
  });

  it("preserves bytes when authoritative orphan reconciliation cannot be read", async () => {
    const remove = vi.fn(async () => undefined);
    await expect(reconcileInventoryMediaRegistration({
      register: vi.fn(async () => { throw { code: "P0001", message: "rejected" }; }),
      isOrphan: vi.fn(async () => { throw new TypeError("orphan RPC unavailable"); }),
      remove,
      isDefinitiveFailure: () => true,
    })).rejects.toThrow("orphan RPC unavailable");
    expect(remove).not.toHaveBeenCalled();
  });

  it("measures normalized frame change", () => {
    expect(meanAbsoluteDifference(
      new Uint8Array([0, 10, 20]),
      new Uint8Array([3, 16, 20]),
    )).toBe(3);
  });

  it("parses exposed stage durations and ignores descriptions", () => {
    expect(parseServerTiming("queue;dur=1.25, clip;dur=16.5, cache;desc=hit;dur=0"))
      .toEqual({ queue: 1.25, clip: 16.5, cache: 0 });
  });

  it("creates only the owner-prefixed content-addressed media key", () => {
    const sha = "a".repeat(64);
    expect(contentAddressedMediaKey("owner", sha, "image/jpeg"))
      .toBe(`owner/${sha}.jpg`);
    expect(() => contentAddressedMediaKey("owner", "bad", "image/jpeg"))
      .toThrow(/hashed JPEG/);
  });

  it("strictly accepts empty old-back identity fields without inventing a number", () => {
    const parsed = parseRecognitionResult(validPayload(), {
      requestID,
      useCase: "sale",
    });
    expect(parsed.candidates[0].card_number).toBe("");
    expect(parsed.candidates[0].rank).toBe(1);
  });

  it("fails closed on extra local IDs, inconsistent counts, or malformed ranks", () => {
    expect(() => parseRecognitionResult({
      ...validPayload(),
      candidates: [{ ...validPayload().candidates[0], card_id: 123 }],
    })).toThrow(/forbidden local identity/);
    expect(() => parseRecognitionResult({ ...validPayload(), candidate_count: 0 }))
      .toThrow(/count/);
    expect(() => parseRecognitionResult({
      ...validPayload(),
      candidates: [{ ...validPayload().candidates[0], rank: 2 }],
    })).toThrow(/ranks/);
    expect(() => parseRecognitionResult({
      ...validPayload(),
      candidates: [{ ...validPayload().candidates[0], image_url: "javascript:alert(1)" }],
    })).toThrow(/unsafe candidate.image_url/);
    expect(() => parseRecognitionResult({
      ...validPayload(),
      inventory_leg: "export",
    }, { requestID, useCase: "sale", inventoryLeg: "import" }))
      .toThrow(/inventory leg/);
  });

  it("validates the recognizer origin before attaching a bearer token", () => {
    expect(validatedRecognitionOrigin("https://recognizer.example.test/", false))
      .toBe("https://recognizer.example.test");
    expect(validatedRecognitionOrigin("http://localhost:8765", true))
      .toBe("http://localhost:8765");
    for (const unsafe of [
      "http://recognizer.example.test",
      "https://user:secret@recognizer.example.test",
      "https://recognizer.example.test/api",
      "https://recognizer.example.test?target=elsewhere",
      "https://recognizer.example.test/#fragment",
    ]) {
      expect(() => validatedRecognitionOrigin(unsafe, false)).toThrow(/exact HTTPS origin/);
    }
  });

  it("sends complete crop metadata and refreshes the token exactly once on 401", async () => {
    const calls: RequestInit[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      if (calls.length === 1) {
        return new Response(JSON.stringify({ detail: "expired" }), { status: 401 });
      }
      return new Response(JSON.stringify(validPayload()), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Server-Timing": "clip;dur=16",
          "X-Request-ID": requestID,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => "fresh-token");
    const crop = captureMetadata(
      { videoWidth: 1920, videoHeight: 1080 },
      { x: 100, y: 20, width: 800, height: 1000 },
    );
    const output = await recognizeCapture({
      baseURL: "https://recognizer.test/",
      accessToken: "expired-token",
      refreshAccessToken: refresh,
      requestID,
      useCase: "sale",
      inventoryLeg: "import",
      capture: new Blob(["jpeg"], { type: "image/jpeg" }),
      crop,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://recognizer.test/v1/recognize?use_case=sale&inventory_leg=import",
    );
    expect(new Headers(calls[0].headers).get("Authorization")).toBe("Bearer expired-token");
    expect(new Headers(calls[1].headers).get("Authorization")).toBe("Bearer fresh-token");
    expect(JSON.parse(new Headers(calls[1].headers).get("X-Recognition-Crop") ?? "{}"))
      .toEqual({
        x: 100,
        y: 20,
        width: 800,
        height: 1000,
        source_width: 1920,
        source_height: 1080,
      });
    expect(output.result.candidates[0].card_number).toBe("");
  });

  it("prewarms the exact authenticated sale scope without following redirects", async () => {
    const status = {
      status: "ready",
      model_catalog_ready: true,
      sale_ready: true,
      sale_scope_error: null,
      inventory_leg: "import",
      model_fingerprint: "model:abc",
      catalog_fingerprint: "catalog:def",
      catalog_generation: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      catalog_reload_error: null,
      recognizer_config_fingerprint: "recognizer-config-sha256:" + "d".repeat(64),
      feature_cache: { required: 100, available: 100, missing: 0 },
      service_build_sha: "a".repeat(40),
      runtime_lock_sha256: "b".repeat(64),
      recognizer_device: "cuda:0",
      cuda_device_name: "Test GPU",
      cuda_required: true,
      identity_count: 100,
      launch_policy: "confirmation_required",
      queue_depth: 0,
      queue_capacity: 4,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(status), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const output = await prewarmRecognition({
      baseURL: "https://recognizer.test",
      accessToken: "token",
      inventoryLeg: "import",
    });
    expect(output.catalogGeneration).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(output.recognizerConfigFingerprint).toBe(
      "recognizer-config-sha256:" + "d".repeat(64),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://recognizer.test/v1/status?inventory_leg=import",
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    );
  });
});
