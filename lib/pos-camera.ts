export type POSUseCase = "sale" | "acquisition";

export interface CardCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureMetadata extends CardCrop {
  source_width: number;
  source_height: number;
}

export interface RecognitionCandidate {
  card_uid: string;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string;
  misc_info: string;
  language: string;
  image_url: string | null;
  clip_score: number;
  sift_good_matches: number;
  sift_inliers: number;
  sift_inlier_ratio: number;
  rank: number;
  verification_state: string;
}

export interface RecognitionResult {
  request_id: string;
  use_case: POSUseCase;
  capture_sha256: string;
  capture_bytes: number;
  capture_width: number;
  capture_height: number;
  crop: Record<string, number>;
  scope: "available_inventory" | "full_catalog";
  inventory_leg: "import" | "export" | null;
  candidate_count: number;
  candidates: RecognitionCandidate[];
  ambiguous: boolean;
  confirmation_required: true;
  model_fingerprint: string;
  catalog_fingerprint: string;
  recognizer_config_fingerprint: string;
  timing_ms: Record<string, number>;
  inventory_age_ms: number | null;
}

export interface RecognitionResponse {
  result: RecognitionResult;
  serverTiming: Record<string, number>;
}

export interface RecognitionStatus {
  status: "ready";
  modelCatalogReady: true;
  saleReady: boolean;
  saleScopeError: string | null;
  inventoryLeg: "import" | "export" | null;
  modelFingerprint: string;
  catalogFingerprint: string;
  recognizerConfigFingerprint: string;
  catalogGeneration: string | null;
  catalogReloadError: string | null;
  featureCache: { required: number; available: number; missing: number };
  serviceBuildSHA: string;
  runtimeLockSHA256: string;
  recognizerDevice: string;
  cudaDeviceName: string | null;
  cudaRequired: boolean;
}

export const RECOGNIZER_REQUEST_TIMEOUT_MS = 15_000;

interface RequestDeadline {
  signal: AbortSignal;
  clear: () => void;
  race: <T>(promise: Promise<T>) => Promise<T>;
}

function requestDeadline(
  callerSignal: AbortSignal | undefined,
  timeoutMs = RECOGNIZER_REQUEST_TIMEOUT_MS,
): RequestDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Recognizer request timeout must be positive");
  }
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = window.setTimeout(() => {
    controller.abort(new DOMException("Recognizer request timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    race: <T>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
      const rejectOnAbort = () => reject(controller.signal.reason
        ?? new DOMException("Recognizer request aborted", "AbortError"));
      if (controller.signal.aborted) {
        rejectOnAbort();
        return;
      }
      controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
      promise.then(
        (value) => {
          controller.signal.removeEventListener("abort", rejectOnAbort);
          resolve(value);
        },
        (error) => {
          controller.signal.removeEventListener("abort", rejectOnAbort);
          reject(error);
        },
      );
    }),
    clear: () => {
      window.clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

export function posErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = ["message", "details", "hint", "code"]
      .flatMap((key) => typeof record[key] === "string" && record[key].trim()
        ? [record[key].trim()]
        : []);
    if (parts.length) return [...new Set(parts)].join(" · ");
    try {
      const rendered = JSON.stringify(record);
      if (rendered && rendered !== "{}") return rendered;
    } catch {
      // Fall through to the stable generic message.
    }
  }
  return "Unknown request error";
}

export function strictIntegerInput(
  value: string,
  minimum: number,
  maximum: number,
): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export function boundedDecimalInput(
  value: string,
  minimumExclusive: number,
  maximum: number,
): number | null {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > minimumExclusive && parsed <= maximum
    ? parsed
    : null;
}

export interface AcquisitionCostEvidence {
  native_amount: number;
  native_currency: string;
  fx_rate_to_usd: number;
  price_usd: number;
}

export function acquisitionCostEvidence(
  rawAmount: string,
  currency: string,
  fxRateToUSD: number,
): AcquisitionCostEvidence | null {
  if (!rawAmount.trim()) return null;
  const nativeAmount = boundedDecimalInput(rawAmount.trim(), 0, 1_000_000_000);
  if (
    nativeAmount == null
    || !/^[A-Z]{3}$/.test(currency)
    || !Number.isFinite(fxRateToUSD)
    || fxRateToUSD <= 0
    || fxRateToUSD > 1_000_000
  ) throw new Error("Acquisition cost or frozen FX rate is invalid");
  const priceUSD = Math.round(
    (nativeAmount * fxRateToUSD + Number.EPSILON) * 1_000_000,
  ) / 1_000_000;
  if (!Number.isFinite(priceUSD) || priceUSD <= 0 || priceUSD > 1_000_000_000) {
    throw new Error("Converted acquisition cost is outside its supported range");
  }
  return {
    native_amount: nativeAmount,
    native_currency: currency,
    fx_rate_to_usd: fxRateToUSD,
    price_usd: priceUSD,
  };
}

export interface POSSessionSettingsDraft {
  sellPercentage: string;
  roundingMode: string;
  soldAt: string;
  platformLabel: string;
  notes: string;
}

export function patchPOSSessionSettings(
  current: POSSessionSettingsDraft,
  patch: Partial<POSSessionSettingsDraft>,
): POSSessionSettingsDraft {
  return { ...current, ...patch };
}

export function samePOSSessionSettings(
  draft: POSSessionSettingsDraft | null,
  persisted: {
    sell_percentage: number;
    rounding_mode: string;
    sold_at: string;
    platform_label?: string;
    notes?: string;
  } | null,
): boolean {
  if (!draft || !persisted) return draft === null && persisted === null;
  return (
    Number(draft.sellPercentage) === Number(persisted.sell_percentage)
    && draft.roundingMode === persisted.rounding_mode
    && draft.soldAt === persisted.sold_at
    && draft.platformLabel.trim() === (persisted.platform_label ?? "")
    && draft.notes.trim() === (persisted.notes ?? "")
  );
}

export function manualSelectionEvidence(cardUID: string): {
  selection_method: "manual_search";
  card_uid: string;
} {
  if (!UUID_PATTERN.test(cardUID)) throw new Error("Manual selection needs a stable card UUID");
  return { selection_method: "manual_search", card_uid: cardUID };
}

export function afterNextPaint(timeoutMs = 250): Promise<number> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_000) {
    throw new Error("Paint timeout is invalid");
  }
  return new Promise((resolve) => {
    let settled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (firstFrame) window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      resolve(performance.now());
    };
    const timer = window.setTimeout(finish, timeoutMs);
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(finish);
    });
  });
}

export function proposedSalePrice(
  market: number,
  sellPercentage: number,
  roundingMode: string,
): number {
  if (
    !Number.isFinite(market)
    || market <= 0
    || !Number.isFinite(sellPercentage)
    || sellPercentage <= 0
    || sellPercentage > 100
  ) throw new Error("Sale proposal inputs are invalid");
  const proposed = market * sellPercentage / 100;
  switch (roundingMode) {
    case "nearest_cent":
      return Math.round((proposed + Number.EPSILON) * 100) / 100;
    case "nearest_dollar":
      return Math.round(proposed);
    case "down_dollar":
      return Math.floor(proposed);
    case "up_dollar":
      return Math.ceil(proposed);
    default:
      throw new Error("Sale rounding mode is invalid");
  }
}

interface OperationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ExactRetryOperationOptions {
  storage: OperationStorage;
  storageKey: string;
  clock?: () => number;
}

export class ExactRetryOperation {
  private current: { operationID: string; payloadKey: string } | null = null;

  private readonly durable: ExactRetryOperationOptions | null;

  private readonly clock: () => number;

  constructor(options?: ExactRetryOperationOptions) {
    this.durable = options ?? null;
    this.clock = options?.clock ?? Date.now;
    if (!this.durable) return;
    if (!this.durable.storageKey.trim()) {
      throw new Error("Exact retry storage key is required");
    }
    const raw = this.durable.storage.getItem(this.durable.storageKey);
    if (raw == null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Stored exact retry operation is malformed");
    }
    if (
      !parsed
      || typeof parsed !== "object"
      || Object.keys(parsed).sort().join(",") !== "createdAt,operationID,payloadKey,schemaVersion"
      || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1
      || typeof (parsed as { createdAt?: unknown }).createdAt !== "number"
      || !Number.isFinite((parsed as { createdAt: number }).createdAt)
      || typeof (parsed as { operationID?: unknown }).operationID !== "string"
      || !UUID_PATTERN.test((parsed as { operationID: string }).operationID)
      || typeof (parsed as { payloadKey?: unknown }).payloadKey !== "string"
      || !(parsed as { payloadKey: string }).payloadKey
      || (parsed as { payloadKey: string }).payloadKey.length > 65_536
    ) {
      throw new Error("Stored exact retry operation is invalid");
    }
    const age = this.clock() - (parsed as { createdAt: number }).createdAt;
    if (age < 0) throw new Error("Stored exact retry operation timestamp is invalid");
    this.current = {
      operationID: (parsed as { operationID: string }).operationID,
      payloadKey: (parsed as { payloadKey: string }).payloadKey,
    };
  }

  begin(
    payloadKey: string,
    createID: () => string = () => crypto.randomUUID(),
  ): { operationID: string; payloadKey: string } {
    if (!payloadKey) throw new Error("Exact retry payload is required");
    if (this.current) {
      if (this.current.payloadKey !== payloadKey) {
        throw new Error("An uncertain operation must be retried with its frozen payload");
      }
      return this.current;
    }
    const operationID = createID();
    if (!UUID_PATTERN.test(operationID)) {
      throw new Error("Exact retry operation ID must be a UUID");
    }
    const next = { operationID, payloadKey };
    if (this.durable) {
      this.durable.storage.setItem(this.durable.storageKey, JSON.stringify({
        schemaVersion: 1,
        createdAt: this.clock(),
        ...next,
      }));
    }
    this.current = next;
    return this.current;
  }

  pending(): { operationID: string; payloadKey: string } | null {
    return this.current ? { ...this.current } : null;
  }

  clear(operationID: string): void {
    if (this.current?.operationID !== operationID) return;
    this.durable?.storage.removeItem(this.durable.storageKey);
    this.current = null;
  }
}

export function posExactRetryStorageKey(
  ownerID: string,
  operation: "sale-add" | "acquisition-add",
): string {
  if (!UUID_PATTERN.test(ownerID)) throw new Error("Exact retry owner must be a UUID");
  return `tcg-pos-camera:v1:${ownerID}:${operation}`;
}

export interface FrozenSaleAdd {
  schema_version: 1;
  kind: "sale-add";
  display_name: string;
  session_id: string;
  rpc_args: {
    p_line_id: string;
    p_session_id: string;
    p_card_uid: string;
    p_condition_standard: string;
    p_condition_code: string;
    p_psa_grade: number;
    p_quantity: number;
    p_agreed_unit_price_usd: number | null;
    p_recognition_request_id: string | null;
    p_sell_percentage: null;
    p_rounding_mode: null;
    p_manual_market_unit_usd: number | null;
    p_manual_market_reason: string | null;
    p_browser_snapshot: Record<string, unknown>;
    p_expected_preview_token: string;
    p_expected_preview_cogs_usd: number;
  };
}

export interface FrozenAcquisitionMedia {
  media_kind: "front" | "back" | "defect";
  object_key: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  is_recognition_capture: boolean;
}

export interface FrozenAcquisitionAdd {
  schema_version: 1;
  kind: "acquisition-add";
  display_name: string;
  lot_id: number;
  rpc_args: {
    p_operation_id: string;
    p_recognition_request_id: string | null;
    p_lot_id: number;
    p_condition_standard: string;
    p_condition_code: string;
    p_psa_grade: number;
    p_quantity: number;
    p_price_override_usd: number | null;
    p_market_value_usd: number | null;
    p_browser_snapshot: Record<string, unknown>;
    p_card_uid: string;
  };
  media: FrozenAcquisitionMedia[];
}

function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Stored POS retry ${label} fields are invalid`);
  }
}

function jsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Stored POS retry ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finiteNullableAmount(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    throw new Error(`Stored POS retry ${label} is invalid`);
  }
  return value;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`Stored POS retry ${label} is invalid`);
  }
  return value;
}

export function exactPOSValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(exactPOSValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${exactPOSValue(child)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Stored POS retry contains a non-JSON value");
  return serialized;
}

function validateBrowserSnapshot(
  value: unknown,
  maximumBytes: number,
): Record<string, unknown> {
  const snapshot = jsonRecord(value, "browser snapshot");
  const rendered = exactPOSValue(snapshot);
  if (new TextEncoder().encode(rendered).byteLength > maximumBytes) {
    throw new Error("Stored POS retry browser snapshot is too large");
  }
  return snapshot;
}

function validateMedia(
  value: unknown,
  ownerID: string,
): FrozenAcquisitionMedia[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error("Stored POS retry media list is invalid");
  }
  const media = value.map((entry, index) => {
    const record = jsonRecord(entry, `media ${index + 1}`);
    exactObjectKeys(record, [
      "media_kind", "object_key", "mime_type", "byte_size", "sha256",
      "is_recognition_capture",
    ], `media ${index + 1}`);
    if (!['front', 'back', 'defect'].includes(String(record.media_kind))) {
      throw new Error("Stored POS retry media kind is invalid");
    }
    if (
      typeof record.mime_type !== "string"
      || !["image/jpeg", "image/png", "image/webp"].includes(record.mime_type)
      || typeof record.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(record.sha256)
      || !Number.isInteger(record.byte_size)
      || Number(record.byte_size) < 1
      || Number(record.byte_size) > MAX_CAPTURE_BYTES
      || typeof record.is_recognition_capture !== "boolean"
      || typeof record.object_key !== "string"
      || record.object_key !== contentAddressedMediaKey(ownerID, record.sha256, record.mime_type)
    ) throw new Error("Stored POS retry media evidence is invalid");
    return record as unknown as FrozenAcquisitionMedia;
  });
  if (
    new Set(media.map((entry) => entry.object_key)).size !== media.length
    || new Set(media.map((entry) => entry.media_kind)).size !== media.length
    || media.filter((entry) => entry.media_kind === "front").length !== 1
    || media.filter((entry) => entry.is_recognition_capture).length > 1
    || media.some((entry) => entry.is_recognition_capture && entry.media_kind !== "front")
  ) throw new Error("Stored POS retry media evidence is inconsistent");
  return media;
}

export function parseFrozenPOSOperation(
  raw: string,
  kind: "sale-add",
  ownerID: string,
): FrozenSaleAdd;
export function parseFrozenPOSOperation(
  raw: string,
  kind: "acquisition-add",
  ownerID: string,
): FrozenAcquisitionAdd;
export function parseFrozenPOSOperation(
  raw: string,
  kind: "sale-add" | "acquisition-add",
  ownerID: string,
): FrozenSaleAdd | FrozenAcquisitionAdd {
  if (!UUID_PATTERN.test(ownerID)) throw new Error("Stored POS retry owner is invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Stored POS retry payload is malformed");
  }
  const root = jsonRecord(parsed, "payload");
  if (root.schema_version !== 1 || root.kind !== kind) {
    throw new Error("Stored POS retry payload version or kind is invalid");
  }
  boundedText(root.display_name, "display name", 500);
  const rpc = jsonRecord(root.rpc_args, "RPC arguments");
  if (kind === "sale-add") {
    exactObjectKeys(root, ["schema_version", "kind", "display_name", "session_id", "rpc_args"], "payload");
    exactObjectKeys(rpc, [
      "p_line_id", "p_session_id", "p_card_uid", "p_condition_standard",
      "p_condition_code", "p_psa_grade", "p_quantity",
      "p_agreed_unit_price_usd", "p_recognition_request_id", "p_sell_percentage",
      "p_rounding_mode", "p_manual_market_unit_usd", "p_manual_market_reason",
      "p_browser_snapshot", "p_expected_preview_token", "p_expected_preview_cogs_usd",
    ], "sale RPC");
    if (
      typeof root.session_id !== "string"
      || !UUID_PATTERN.test(root.session_id)
      || rpc.p_session_id !== root.session_id
      || typeof rpc.p_line_id !== "string"
      || !UUID_PATTERN.test(rpc.p_line_id)
      || typeof rpc.p_card_uid !== "string"
      || !UUID_PATTERN.test(rpc.p_card_uid)
      || !Number.isInteger(rpc.p_psa_grade)
      || Number(rpc.p_psa_grade) < 0
      || Number(rpc.p_psa_grade) > 10
      || !Number.isInteger(rpc.p_quantity)
      || Number(rpc.p_quantity) < 1
      || Number(rpc.p_quantity) > 1_000_000
      || rpc.p_sell_percentage !== null
      || rpc.p_rounding_mode !== null
      || typeof rpc.p_expected_preview_token !== "string"
      || !/^[0-9a-f]{64}$/.test(rpc.p_expected_preview_token)
      || typeof rpc.p_expected_preview_cogs_usd !== "number"
      || !Number.isFinite(rpc.p_expected_preview_cogs_usd)
      || rpc.p_expected_preview_cogs_usd < 0
      || rpc.p_expected_preview_cogs_usd > 1_000_000_000_000_000
      || (rpc.p_recognition_request_id !== null
        && (typeof rpc.p_recognition_request_id !== "string"
          || !UUID_PATTERN.test(rpc.p_recognition_request_id)))
    ) throw new Error("Stored POS retry sale identity or quantity is invalid");
    boundedText(rpc.p_condition_standard, "condition standard", 100);
    boundedText(rpc.p_condition_code, "condition code", 100);
    finiteNullableAmount(rpc.p_agreed_unit_price_usd, "agreed price");
    finiteNullableAmount(rpc.p_manual_market_unit_usd, "manual market");
    if (
      rpc.p_manual_market_reason !== null
      && (typeof rpc.p_manual_market_reason !== "string"
        || !rpc.p_manual_market_reason.trim()
        || rpc.p_manual_market_reason.length > 1_000)
    ) throw new Error("Stored POS retry manual market reason is invalid");
    if ((rpc.p_manual_market_unit_usd === null) !== (rpc.p_manual_market_reason === null)) {
      throw new Error("Stored POS retry manual market evidence is incomplete");
    }
    const browser = validateBrowserSnapshot(rpc.p_browser_snapshot, 8_192);
    if (rpc.p_recognition_request_id === null) {
      exactObjectKeys(browser, ["selection_method", "card_uid"], "manual sale browser evidence");
      if (browser.selection_method !== "manual_search" || browser.card_uid !== rpc.p_card_uid) {
        throw new Error("Stored POS retry manual sale evidence is invalid");
      }
    } else if (Object.keys(browser).length !== 0) {
      throw new Error("Stored POS retry recognized sale browser evidence is invalid");
    }
    return root as unknown as FrozenSaleAdd;
  }

  exactObjectKeys(root, ["schema_version", "kind", "display_name", "lot_id", "rpc_args", "media"], "payload");
  exactObjectKeys(rpc, [
    "p_operation_id", "p_recognition_request_id", "p_lot_id",
    "p_condition_standard", "p_condition_code", "p_psa_grade", "p_quantity",
    "p_price_override_usd", "p_market_value_usd", "p_browser_snapshot", "p_card_uid",
  ], "acquisition RPC");
  if (
    !Number.isInteger(root.lot_id)
    || Number(root.lot_id) < 1
    || rpc.p_lot_id !== root.lot_id
    || typeof rpc.p_operation_id !== "string"
    || !UUID_PATTERN.test(rpc.p_operation_id)
    || typeof rpc.p_card_uid !== "string"
    || !UUID_PATTERN.test(rpc.p_card_uid)
    || (rpc.p_recognition_request_id !== null
      && (typeof rpc.p_recognition_request_id !== "string"
        || !UUID_PATTERN.test(rpc.p_recognition_request_id)))
    || !Number.isInteger(rpc.p_psa_grade)
    || Number(rpc.p_psa_grade) < 0
    || Number(rpc.p_psa_grade) > 10
    || !Number.isInteger(rpc.p_quantity)
    || Number(rpc.p_quantity) < 1
    || Number(rpc.p_quantity) > 1_000_000
  ) throw new Error("Stored POS retry acquisition identity or quantity is invalid");
  boundedText(rpc.p_condition_standard, "condition standard", 100);
  boundedText(rpc.p_condition_code, "condition code", 100);
  const priceUSD = finiteNullableAmount(rpc.p_price_override_usd, "USD cost");
  const marketUSD = finiteNullableAmount(rpc.p_market_value_usd, "market value");
  const media = validateMedia(root.media, ownerID);
  const browser = validateBrowserSnapshot(rpc.p_browser_snapshot, 32_768);
  exactObjectKeys(browser, [
    "selection_method", "card_uid", "acquisition_cost", "market_value_usd",
    "attachments", "latency",
  ], "acquisition browser evidence");
  if (
    browser.card_uid !== rpc.p_card_uid
    || browser.market_value_usd !== marketUSD
    || !Array.isArray(browser.attachments)
    || exactPOSValue(browser.attachments) !== exactPOSValue(media)
    || (rpc.p_recognition_request_id === null && browser.selection_method !== "manual_search")
    || (rpc.p_recognition_request_id !== null
      && browser.selection_method !== "candidate_tap"
      && browser.selection_method !== "manual_search")
    || (rpc.p_recognition_request_id === null
      && media.some((entry) => entry.is_recognition_capture))
    || (rpc.p_recognition_request_id !== null
      && (
        media.filter((entry) => entry.is_recognition_capture).length !== 1
        || !media.some((entry) => (
          entry.media_kind === "front" && entry.is_recognition_capture
        ))
      ))
  ) throw new Error("Stored POS retry acquisition browser evidence is inconsistent");
  const latency = jsonRecord(browser.latency, "latency evidence");
  exactObjectKeys(latency, [
    "permission_ms", "capture_ms", "capture_to_response_ms", "tap_to_response_ms",
    "response_to_paint_ms", "audit_ready_ms", "total_tap_to_ready_ms",
  ], "latency evidence");
  for (const value of Object.values(latency)) {
    if (
      value !== null
      && (
        typeof value !== "number"
        || !Number.isFinite(value)
        || value < 0
        || value > 120_000
      )
    ) {
      throw new Error("Stored POS retry latency evidence is invalid");
    }
  }
  if (priceUSD === null) {
    if (browser.acquisition_cost !== null) {
      throw new Error("Stored POS retry native cost evidence is inconsistent");
    }
  } else {
    const cost = jsonRecord(browser.acquisition_cost, "native cost evidence");
    exactObjectKeys(cost, [
      "native_amount", "native_currency", "fx_rate_to_usd", "price_usd",
    ], "native cost evidence");
    if (
      typeof cost.native_amount !== "number"
      || !Number.isFinite(cost.native_amount)
      || cost.native_amount <= 0
      || cost.native_amount > 1_000_000_000
      || typeof cost.native_currency !== "string"
      || !/^[A-Z]{3}$/.test(cost.native_currency)
      || typeof cost.fx_rate_to_usd !== "number"
      || !Number.isFinite(cost.fx_rate_to_usd)
      || cost.fx_rate_to_usd <= 0
      || cost.fx_rate_to_usd > 1_000_000
      || cost.price_usd !== priceUSD
      || Math.round(cost.native_amount * cost.fx_rate_to_usd * 1_000_000) / 1_000_000
        !== priceUSD
    ) throw new Error("Stored POS retry native cost evidence is invalid");
  }
  return root as unknown as FrozenAcquisitionAdd;
}

export type SaleAddRetryDisposition = "complete" | "retain" | "clear";

export function saleAddRetryDisposition(input: {
  addReturnedSuccessfully: boolean;
  definitiveRPCFailure: boolean;
  stateReadConverged: boolean;
  lineFound: boolean;
}): SaleAddRetryDisposition {
  if (input.lineFound) return "complete";
  if (
    !input.addReturnedSuccessfully
    && input.definitiveRPCFailure
    && input.stateReadConverged
  ) return "clear";
  return "retain";
}

export async function reconcileInventoryMediaRegistration(input: {
  register: () => Promise<void>;
  isOrphan: () => Promise<boolean>;
  remove: () => Promise<void>;
  isDefinitiveFailure: (error: unknown) => boolean;
}): Promise<void> {
  let firstFailure: unknown;
  try {
    await input.register();
    return;
  } catch (cause) {
    firstFailure = cause;
  }

  let retryFailure: unknown;
  try {
    await input.register();
    return;
  } catch (cause) {
    retryFailure = cause;
  }

  const orphan = await input.isOrphan();
  if (!orphan) return;
  if (!input.isDefinitiveFailure(retryFailure)) throw firstFailure;

  await input.remove();
  throw retryFailure;
}

export const CAPTURE_WIDTH = 733;
export const CAPTURE_HEIGHT = 1024;
export const AUTO_CAPTURE_SAMPLE_INTERVAL_MS = 55;
export const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_CAPTURE_BYTES = 15 * 1024 * 1024;
export const MAX_SOURCE_CAPTURE_PIXELS = 40_000_000;
export const CARD_GUIDE_ASPECT = 63 / 88;
export const CARD_GUIDE_SAFETY_MARGIN = 0.05;

export function centeredPortraitCrop(
  sourceWidth: number,
  sourceHeight: number,
): CardCrop {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("A live camera frame is required");
  }
  const targetAspect = CARD_GUIDE_ASPECT;
  const sourceAspect = sourceWidth / sourceHeight;
  let width: number;
  let height: number;
  if (sourceAspect > targetAspect) {
    height = sourceHeight;
    width = height * targetAspect;
  } else {
    width = sourceWidth;
    height = width / targetAspect;
  }
  return {
    x: Math.round((sourceWidth - width) / 2),
    y: Math.round((sourceHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function coverGuideToSourceCrop(args: {
  sourceWidth: number;
  sourceHeight: number;
  displayWidth: number;
  displayHeight: number;
  guideX: number;
  guideY: number;
  guideWidth: number;
  guideHeight: number;
  marginFraction?: number;
}): CardCrop {
  const values = [
    args.sourceWidth, args.sourceHeight, args.displayWidth, args.displayHeight,
    args.guideX, args.guideY, args.guideWidth, args.guideHeight,
  ];
  if (
    values.some((value) => !Number.isFinite(value))
    || [args.sourceWidth, args.sourceHeight, args.displayWidth, args.displayHeight,
      args.guideWidth, args.guideHeight].some((value) => value <= 0)
  ) {
    throw new Error("A measured camera guide is required");
  }
  const margin = args.marginFraction ?? CARD_GUIDE_SAFETY_MARGIN;
  if (!Number.isFinite(margin) || margin < 0 || margin > 0.2) {
    throw new Error("Camera guide safety margin is invalid");
  }
  const scale = Math.max(
    args.displayWidth / args.sourceWidth,
    args.displayHeight / args.sourceHeight,
  );
  const coveredX = (args.sourceWidth * scale - args.displayWidth) / 2;
  const coveredY = (args.sourceHeight * scale - args.displayHeight) / 2;
  const guideSourceX = (args.guideX + coveredX) / scale;
  const guideSourceY = (args.guideY + coveredY) / scale;
  const guideSourceWidth = args.guideWidth / scale;
  const guideSourceHeight = args.guideHeight / scale;
  const expandedX = guideSourceX - guideSourceWidth * margin;
  const expandedY = guideSourceY - guideSourceHeight * margin;
  const expandedRight = guideSourceX + guideSourceWidth * (1 + margin);
  const expandedBottom = guideSourceY + guideSourceHeight * (1 + margin);
  const left = Math.max(0, Math.floor(expandedX));
  const top = Math.max(0, Math.floor(expandedY));
  const right = Math.min(args.sourceWidth, Math.ceil(expandedRight));
  const bottom = Math.min(args.sourceHeight, Math.ceil(expandedBottom));
  if (right <= left || bottom <= top) throw new Error("Camera guide is outside the video");
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function captureMetadata(
  video: Pick<HTMLVideoElement, "videoWidth" | "videoHeight">,
  crop: CardCrop,
): CaptureMetadata {
  return {
    ...crop,
    source_width: video.videoWidth,
    source_height: video.videoHeight,
  };
}

function canvas2d(width: number, height: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Camera capture is unavailable in this browser");
  return { canvas, context };
}

export function sampleVideoFrame(
  video: HTMLVideoElement,
  crop: CardCrop,
): Uint8Array {
  const { canvas, context } = canvas2d(24, 33);
  context.drawImage(
    video,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const grayscale = new Uint8Array(canvas.width * canvas.height);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 1) {
    grayscale[target] = Math.round(
      rgba[source] * 0.299 + rgba[source + 1] * 0.587 + rgba[source + 2] * 0.114,
    );
  }
  return grayscale;
}

export async function captureVideoFrame(
  video: HTMLVideoElement,
  crop = centeredPortraitCrop(video.videoWidth, video.videoHeight),
): Promise<Blob> {
  const { canvas, context } = canvas2d(CAPTURE_WIDTH, CAPTURE_HEIGHT);
  context.drawImage(
    video,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Camera JPEG encoding failed")),
      "image/jpeg",
      0.82,
    );
  });
}

interface NormalizableImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}

export interface CaptureNormalizationPlan {
  source: CardCrop;
  outputWidth: typeof CAPTURE_WIDTH;
  outputHeight: typeof CAPTURE_HEIGHT;
}

export function captureNormalizationPlan(
  sourceWidth: number,
  sourceHeight: number,
): CaptureNormalizationPlan {
  if (
    !Number.isInteger(sourceWidth)
    || !Number.isInteger(sourceHeight)
    || sourceWidth < 1
    || sourceHeight < 1
    || sourceWidth * sourceHeight > MAX_SOURCE_CAPTURE_PIXELS
  ) {
    throw new Error("Photo dimensions are invalid or too large");
  }
  return {
    source: centeredPortraitCrop(sourceWidth, sourceHeight),
    outputWidth: CAPTURE_WIDTH,
    outputHeight: CAPTURE_HEIGHT,
  };
}

async function decodeCaptureImage(blob: Blob): Promise<NormalizableImage> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("Photo decoding is unavailable in this browser");
  }
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
  };
}

export async function normalizeCaptureImage(
  blob: Blob,
  decode: (input: Blob) => Promise<NormalizableImage> = decodeCaptureImage,
): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(blob.type)) {
    throw new Error("Choose a JPEG, PNG, WebP, HEIC, or HEIF photo");
  }
  if (blob.size < 1 || blob.size > MAX_SOURCE_CAPTURE_BYTES) {
    throw new Error("Photo must be between 1 byte and 15 MiB");
  }
  const decoded = await decode(blob);
  try {
    const plan = captureNormalizationPlan(decoded.width, decoded.height);
    const { canvas, context } = canvas2d(plan.outputWidth, plan.outputHeight);
    context.drawImage(
      decoded.source,
      plan.source.x,
      plan.source.y,
      plan.source.width,
      plan.source.height,
      0,
      0,
      plan.outputWidth,
      plan.outputHeight,
    );
    const normalized = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (output) => output
          ? resolve(output)
          : reject(new Error("Photo JPEG encoding failed")),
        "image/jpeg",
        0.82,
      );
    });
    if (normalized.size < 1 || normalized.size > MAX_CAPTURE_BYTES) {
      throw new Error("Normalized photo exceeds the 2 MiB recognition limit");
    }
    return normalized;
  } finally {
    decoded.close?.();
  }
}

export function meanAbsoluteDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    total += Math.abs(a[index] - b[index]);
  }
  return total / a.length;
}

export class StableFrameGate {
  private prior: Uint8Array | null = null;
  private submitted: Uint8Array | null = null;
  private stableSamples = 0;
  private submittedAt = Number.NEGATIVE_INFINITY;
  private awaitingRemoval = false;
  private transition: Uint8Array | null = null;

  constructor(
    readonly requiredStableSamples = 2,
    readonly stableDifference = 3.5,
    readonly changedDifference = 9,
    readonly cooldownMs = 1_500,
  ) {}

  observe(sample: Uint8Array, nowMs: number): boolean {
    const priorDifference = this.prior
      ? meanAbsoluteDifference(sample, this.prior)
      : Number.POSITIVE_INFINITY;
    this.stableSamples = priorDifference <= this.stableDifference
      ? this.stableSamples + 1
      : 1;
    this.prior = sample.slice();
    if (this.stableSamples < this.requiredStableSamples) return false;
    if (nowMs - this.submittedAt < this.cooldownMs) return false;
    if (this.submitted) {
      if (this.awaitingRemoval) {
        if (meanAbsoluteDifference(sample, this.submitted) < this.changedDifference) {
          return false;
        }
        this.transition = sample.slice();
        this.awaitingRemoval = false;
        this.stableSamples = 0;
        return false;
      }
      if (
        !this.transition
        || meanAbsoluteDifference(sample, this.transition) < this.changedDifference
      ) return false;
    }
    return true;
  }

  markSubmitted(sample: Uint8Array, nowMs: number): void {
    this.submitted = sample.slice();
    this.submittedAt = nowMs;
    this.stableSamples = 0;
    this.awaitingRemoval = true;
    this.transition = null;
  }

  needsRemoval(): boolean {
    return this.awaitingRemoval;
  }

  reset(forgetSubmission = false): void {
    this.prior = null;
    this.stableSamples = 0;
    if (forgetSubmission) {
      this.submitted = null;
      this.submittedAt = Number.NEGATIVE_INFINITY;
      this.awaitingRemoval = false;
      this.transition = null;
    }
  }
}

export function parseServerTiming(value: string | null): Record<string, number> {
  const parsed: Record<string, number> = {};
  if (!value) return parsed;
  for (const entry of value.split(",")) {
    const [rawName, ...parameters] = entry.trim().split(";");
    const duration = parameters.find((parameter) => parameter.trim().startsWith("dur="));
    if (!rawName || !duration) continue;
    const numeric = Number(duration.trim().slice(4));
    if (Number.isFinite(numeric)) parsed[rawName] = numeric;
  }
  return parsed;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_SURROGATE_KEYS = new Set([
  "card_id",
  "condition_id",
  "lot_id",
  "lot_line_id",
  "sale_group",
  "customer_id",
  "recognition_audit_id",
  "decision_id",
  "location_id",
]);

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Recognizer returned invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Recognizer returned an unexpected ${label} contract`);
  }
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const selected = value[key];
  if (typeof selected !== "string" || selected.length === 0) {
    throw new Error(`Recognizer returned invalid ${label}.${key}`);
  }
  return selected;
}

function boundedString(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maximum = 1024,
): string {
  const selected = value[key];
  if (typeof selected !== "string" || selected.length > maximum) {
    throw new Error(`Recognizer returned invalid ${label}.${key}`);
  }
  return selected;
}

function requiredBoundedString(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maximum: number,
): string {
  const selected = requiredString(value, key, label);
  if (selected.length > maximum) {
    throw new Error(`Recognizer returned invalid ${label}.${key}`);
  }
  return selected;
}

function nullableString(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maximum = 2048,
): string | null {
  const selected = value[key];
  if (selected === null) return null;
  if (typeof selected !== "string" || selected.length > maximum) {
    throw new Error(`Recognizer returned invalid ${label}.${key}`);
  }
  return selected;
}

function nullableHTTPSURL(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const selected = nullableString(value, key, label);
  if (selected === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(selected);
  } catch {
    throw new Error(`Recognizer returned invalid ${label}.${key}`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
  ) {
    throw new Error(`Recognizer returned unsafe ${label}.${key}`);
  }
  return parsed.href;
}

function boundedNumber(
  value: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  label: string,
  integer = false,
): number {
  const selected = value[key];
  if (
    typeof selected !== "number"
    || !Number.isFinite(selected)
    || selected < minimum
    || selected > maximum
    || (integer && !Number.isInteger(selected))
  ) {
    throw new Error(`Recognizer returned invalid ${label}.${key}`);
  }
  return selected;
}

function rejectSurrogateKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectSurrogateKeys);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SURROGATE_KEYS.has(key)) {
      throw new Error(`Recognizer exposed forbidden local identity ${key}`);
    }
    rejectSurrogateKeys(child);
  }
}

export function parseRecognitionResult(
  payload: unknown,
  expected?: {
    requestID: string;
    useCase: POSUseCase;
    inventoryLeg?: "import" | "export";
  },
): RecognitionResult {
  rejectSurrogateKeys(payload);
  const result = objectValue(payload, "response");
  exactKeys(result, [
    "request_id", "use_case", "capture_sha256", "capture_bytes",
    "capture_width", "capture_height", "crop", "scope", "inventory_leg", "candidate_count",
    "candidates", "ambiguous", "confirmation_required", "model_fingerprint",
    "catalog_fingerprint", "recognizer_config_fingerprint", "timing_ms", "inventory_age_ms",
  ], "response");

  const requestID = requiredString(result, "request_id", "response");
  if (!UUID_PATTERN.test(requestID) || (expected && requestID !== expected.requestID)) {
    throw new Error("Recognizer returned a mismatched request UUID");
  }
  const useCase = requiredString(result, "use_case", "response");
  if (
    (useCase !== "sale" && useCase !== "acquisition")
    || (expected && useCase !== expected.useCase)
  ) throw new Error("Recognizer returned a mismatched use case");
  const captureSHA = requiredString(result, "capture_sha256", "response");
  if (!/^[0-9a-f]{64}$/.test(captureSHA)) {
    throw new Error("Recognizer returned an invalid capture digest");
  }
  const captureBytes = boundedNumber(result, "capture_bytes", 1, 2 * 1024 * 1024, "response", true);
  const captureWidth = boundedNumber(result, "capture_width", 240, 4096, "response", true);
  const captureHeight = boundedNumber(result, "capture_height", 320, 4096, "response", true);
  if (captureWidth * captureHeight > 4_000_000) {
    throw new Error("Recognizer returned oversized capture dimensions");
  }
  const aspect = captureWidth / captureHeight;
  if (aspect < 0.55 || aspect > 0.9) {
    throw new Error("Recognizer returned a non-card capture aspect");
  }

  const cropValue = objectValue(result.crop, "crop");
  let crop: Record<string, number> = {};
  if (Object.keys(cropValue).length > 0) {
    exactKeys(cropValue, [
      "x", "y", "width", "height", "source_width", "source_height",
    ], "crop");
    crop = {
      x: boundedNumber(cropValue, "x", 0, 16384, "crop"),
      y: boundedNumber(cropValue, "y", 0, 16384, "crop"),
      width: boundedNumber(cropValue, "width", 1, 16384, "crop"),
      height: boundedNumber(cropValue, "height", 1, 16384, "crop"),
      source_width: boundedNumber(cropValue, "source_width", 1, 16384, "crop"),
      source_height: boundedNumber(cropValue, "source_height", 1, 16384, "crop"),
    };
    if (
      crop.x + crop.width > crop.source_width
      || crop.y + crop.height > crop.source_height
    ) throw new Error("Recognizer returned an out-of-bounds crop");
  }

  const rawCandidates = result.candidates;
  if (!Array.isArray(rawCandidates) || rawCandidates.length > 10) {
    throw new Error("Recognizer returned an invalid candidate list");
  }
  const candidateCount = boundedNumber(result, "candidate_count", 0, 10, "response", true);
  if (candidateCount !== rawCandidates.length) {
    throw new Error("Recognizer candidate count does not match its list");
  }
  const candidates = rawCandidates.map((rawCandidate, index): RecognitionCandidate => {
    const candidate = objectValue(rawCandidate, `candidate ${index + 1}`);
    exactKeys(candidate, [
      "card_uid", "regional_name", "english_name", "set_code", "card_number",
      "misc_info", "language", "image_url", "clip_score", "sift_good_matches",
      "sift_inliers", "sift_inlier_ratio", "rank", "verification_state",
    ], `candidate ${index + 1}`);
    const cardUID = requiredString(candidate, "card_uid", "candidate");
    if (!UUID_PATTERN.test(cardUID)) throw new Error("Recognizer returned an invalid card UUID");
    const good = boundedNumber(candidate, "sift_good_matches", 0, 100_000, "candidate", true);
    const inliers = boundedNumber(candidate, "sift_inliers", 0, good, "candidate", true);
    const ratio = boundedNumber(candidate, "sift_inlier_ratio", 0, 1, "candidate");
    const expectedRatio = good === 0 ? 0 : inliers / good;
    if (Math.abs(ratio - expectedRatio) > 0.000002) {
      throw new Error("Recognizer returned inconsistent SIFT evidence");
    }
    const rank = boundedNumber(candidate, "rank", 1, 10, "candidate", true);
    if (rank !== index + 1) throw new Error("Recognizer returned non-deterministic ranks");
    const verification = requiredString(candidate, "verification_state", "candidate");
    if (!["verified", "weak_geometry", "clip_only"].includes(verification)) {
      throw new Error("Recognizer returned an invalid verification state");
    }
    return {
      card_uid: cardUID,
      regional_name: requiredString(candidate, "regional_name", "candidate"),
      english_name: nullableString(candidate, "english_name", "candidate"),
      set_code: boundedString(candidate, "set_code", "candidate", 128),
      card_number: boundedString(candidate, "card_number", "candidate", 128),
      misc_info: boundedString(candidate, "misc_info", "candidate", 512),
      language: boundedString(candidate, "language", "candidate", 64),
      image_url: nullableHTTPSURL(candidate, "image_url", "candidate"),
      clip_score: boundedNumber(candidate, "clip_score", -1, 1, "candidate"),
      sift_good_matches: good,
      sift_inliers: inliers,
      sift_inlier_ratio: ratio,
      rank,
      verification_state: verification,
    };
  });

  const scope = requiredString(result, "scope", "response");
  const expectedScope = useCase === "sale" ? "available_inventory" : "full_catalog";
  if (scope !== expectedScope) throw new Error("Recognizer returned an unsafe catalog scope");
  const inventoryLeg = result.inventory_leg;
  if (useCase === "sale") {
    if (
      (inventoryLeg !== "import" && inventoryLeg !== "export")
      || (expected?.inventoryLeg && inventoryLeg !== expected.inventoryLeg)
    ) throw new Error("Recognizer returned a mismatched inventory leg");
  } else if (inventoryLeg !== null || expected?.inventoryLeg !== undefined) {
    throw new Error("Recognizer returned an inventory leg for acquisition");
  }
  if (result.ambiguous !== true || result.confirmation_required !== true) {
    throw new Error("Recognizer bypassed mandatory operator confirmation");
  }
  const timingValue = objectValue(result.timing_ms, "timing");
  const allowedTiming = new Set(["queue", "decode", "clip", "sift", "total"]);
  const timing: Record<string, number> = {};
  for (const [key, raw] of Object.entries(timingValue)) {
    if (!allowedTiming.has(key) || typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 120_000) {
      throw new Error("Recognizer returned invalid timing evidence");
    }
    timing[key] = raw;
  }
  for (const required of ["decode", "clip", "sift", "total"]) {
    if (!(required in timing)) throw new Error("Recognizer omitted required timing evidence");
  }
  const inventoryAge = result.inventory_age_ms;
  if (
    inventoryAge !== null
    && (typeof inventoryAge !== "number" || !Number.isFinite(inventoryAge) || inventoryAge < 0)
  ) throw new Error("Recognizer returned invalid inventory age");

  return {
    request_id: requestID,
    use_case: useCase,
    capture_sha256: captureSHA,
    capture_bytes: captureBytes,
    capture_width: captureWidth,
    capture_height: captureHeight,
    crop,
    scope,
    inventory_leg: inventoryLeg,
    candidate_count: candidateCount,
    candidates,
    ambiguous: true,
    confirmation_required: true,
    model_fingerprint: requiredBoundedString(result, "model_fingerprint", "response", 256),
    catalog_fingerprint: requiredBoundedString(result, "catalog_fingerprint", "response", 256),
    recognizer_config_fingerprint: requiredBoundedString(
      result,
      "recognizer_config_fingerprint",
      "response",
      256,
    ),
    timing_ms: timing,
    inventory_age_ms: inventoryAge,
  };
}

export async function recognizeCapture(args: {
  baseURL: string;
  accessToken: string;
  refreshAccessToken?: () => Promise<string>;
  requestID: string;
  useCase: POSUseCase;
  inventoryLeg?: "import" | "export";
  capture: Blob;
  crop?: CaptureMetadata;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RecognitionResponse> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(args.capture.type)) {
    throw new Error("Recognition requires JPEG, PNG, or WebP capture bytes");
  }
  if (
    (args.useCase === "sale" && !args.inventoryLeg)
    || (args.useCase === "acquisition" && args.inventoryLeg !== undefined)
  ) {
    throw new Error("Recognition inventory leg does not match the use case");
  }
  const origin = validatedRecognitionOrigin(args.baseURL);
  const query = new URLSearchParams({ use_case: args.useCase });
  if (args.inventoryLeg) query.set("inventory_leg", args.inventoryLeg);
  const deadline = requestDeadline(args.signal, args.timeoutMs);
  const request = (accessToken: string) => fetch(
      `${origin}/v1/recognize?${query.toString()}`,
      {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": args.capture.type,
        "X-Recognition-Request-ID": args.requestID,
        ...(args.crop ? { "X-Recognition-Crop": JSON.stringify(args.crop) } : {}),
      },
      body: args.capture,
      signal: deadline.signal,
    },
  );
  try {
    let response = await request(args.accessToken);
    if (response.status === 401 && args.refreshAccessToken) {
      const refreshedToken = await deadline.race(args.refreshAccessToken());
      response = await request(refreshedToken);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload?.detail === "string"
        ? payload.detail
        : `Recognition failed (${response.status})`;
      throw new Error(detail);
    }
    if (response.headers.get("X-Request-ID") !== args.requestID) {
      throw new Error("Recognizer returned a mismatched response request UUID");
    }
    return {
      result: parseRecognitionResult(payload, {
        requestID: args.requestID,
        useCase: args.useCase,
        inventoryLeg: args.inventoryLeg,
      }),
      serverTiming: parseServerTiming(response.headers.get("Server-Timing")),
    };
  } finally {
    deadline.clear();
  }
}

export async function prewarmRecognition(args: {
  baseURL: string;
  accessToken: string;
  refreshAccessToken?: () => Promise<string>;
  inventoryLeg?: "import" | "export";
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RecognitionStatus> {
  const origin = validatedRecognitionOrigin(args.baseURL);
  const query = new URLSearchParams();
  if (args.inventoryLeg) query.set("inventory_leg", args.inventoryLeg);
  const suffix = query.size ? `?${query.toString()}` : "";
  const deadline = requestDeadline(args.signal, args.timeoutMs);
  const request = (accessToken: string) => fetch(`${origin}/v1/status${suffix}`, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: deadline.signal,
  });
  try {
    let response = await request(args.accessToken);
    if (response.status === 401 && args.refreshAccessToken) {
      const refreshedToken = await deadline.race(args.refreshAccessToken());
      response = await request(refreshedToken);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload?.detail === "string"
        ? payload.detail
        : `Recognition prewarm failed (${response.status})`;
      throw new Error(detail);
    }
  const status = objectValue(payload, "status");
  exactKeys(status, [
    "status", "model_catalog_ready", "sale_ready", "sale_scope_error",
    "inventory_leg", "model_fingerprint", "catalog_fingerprint",
    "catalog_generation", "catalog_reload_error", "identity_count",
    "recognizer_config_fingerprint", "feature_cache", "service_build_sha",
    "runtime_lock_sha256", "recognizer_device", "cuda_device_name", "cuda_required",
    "launch_policy", "queue_depth", "queue_capacity",
  ], "status");
  if (status.status !== "ready" || status.model_catalog_ready !== true) {
    throw new Error("Recognition model and catalog are not ready");
  }
  if (typeof status.sale_ready !== "boolean") {
    throw new Error("Recognizer returned invalid status.sale_ready");
  }
  const inventoryLeg = status.inventory_leg;
  if (
    inventoryLeg !== null
    && inventoryLeg !== "import"
    && inventoryLeg !== "export"
  ) throw new Error("Recognizer returned invalid status.inventory_leg");
  if (inventoryLeg !== (args.inventoryLeg ?? null)) {
    throw new Error("Recognizer prewarmed the wrong inventory leg");
  }
  const launchPolicy = requiredString(status, "launch_policy", "status");
  if (launchPolicy !== "confirmation_required") {
    throw new Error("Recognizer status bypassed mandatory confirmation");
  }
  boundedNumber(status, "identity_count", 1, 100_000_000, "status", true);
  boundedNumber(status, "queue_depth", 0, 10_000, "status", true);
  boundedNumber(status, "queue_capacity", 1, 10_000, "status", true);
  const featureCache = objectValue(status.feature_cache, "feature cache");
  exactKeys(featureCache, ["required", "available", "missing"], "feature cache");
  const requiredFeatures = boundedNumber(
    featureCache,
    "required",
    1,
    100_000_000,
    "feature cache",
    true,
  );
  const availableFeatures = boundedNumber(
    featureCache,
    "available",
    1,
    100_000_000,
    "feature cache",
    true,
  );
  const missingFeatures = boundedNumber(
    featureCache,
    "missing",
    0,
    100_000_000,
    "feature cache",
    true,
  );
  if (missingFeatures !== 0 || availableFeatures !== requiredFeatures) {
    throw new Error("Recognizer returned an incomplete feature cache");
  }
  const buildSHA = requiredString(status, "service_build_sha", "status");
  const runtimeLockSHA = requiredString(status, "runtime_lock_sha256", "status");
  if (!/^[0-9a-f]{40}$/.test(buildSHA) || !/^[0-9a-f]{64}$/.test(runtimeLockSHA)) {
    throw new Error("Recognizer returned invalid release provenance");
  }
  if (typeof status.cuda_required !== "boolean") {
    throw new Error("Recognizer returned invalid CUDA policy");
  }
  const device = requiredBoundedString(status, "recognizer_device", "status", 128);
  const cudaDeviceName = nullableString(status, "cuda_device_name", "status", 256);
  if (status.cuda_required && (!device.startsWith("cuda") || !cudaDeviceName)) {
    throw new Error("Recognizer did not satisfy its required CUDA device policy");
  }
  const saleScopeError = nullableString(status, "sale_scope_error", "status", 1_000);
  if (args.inventoryLeg && status.sale_ready !== true && !saleScopeError) {
    throw new Error("Recognizer reported an unavailable sale scope without a reason");
  }
  return {
    status: "ready",
    modelCatalogReady: true,
    saleReady: status.sale_ready,
    saleScopeError,
    inventoryLeg,
    modelFingerprint: requiredBoundedString(status, "model_fingerprint", "status", 256),
    catalogFingerprint: requiredBoundedString(status, "catalog_fingerprint", "status", 256),
    recognizerConfigFingerprint: requiredBoundedString(
      status,
      "recognizer_config_fingerprint",
      "status",
      256,
    ),
    catalogGeneration: nullableString(status, "catalog_generation", "status", 128),
    catalogReloadError: nullableString(status, "catalog_reload_error", "status", 128),
    featureCache: {
      required: requiredFeatures,
      available: availableFeatures,
      missing: missingFeatures,
    },
    serviceBuildSHA: buildSHA,
    runtimeLockSHA256: runtimeLockSHA,
    recognizerDevice: device,
    cudaDeviceName,
    cudaRequired: status.cuda_required,
  };
  } finally {
    deadline.clear();
  }
}

export function validatedRecognitionOrigin(
  value: string,
  allowLocalHTTP = process.env.NODE_ENV !== "production",
): string {
  if (!value || value !== value.trim()) {
    throw new Error("Recognition service URL must be an exact origin");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Recognition service URL must be an exact origin");
  }
  const localDevelopment = (
    allowLocalHTTP
    && parsed.protocol === "http:"
    && parsed.hostname === "localhost"
  );
  if (
    (parsed.protocol !== "https:" && !localDevelopment)
    || parsed.username !== ""
    || parsed.password !== ""
    || (parsed.pathname !== "" && parsed.pathname !== "/")
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new Error("Recognition service URL must be an exact HTTPS origin");
  }
  return parsed.origin;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function contentAddressedMediaKey(
  ownerID: string,
  sha256: string,
  mimeType: string,
): string {
  const extension = mimeType === "image/jpeg"
    ? "jpg"
    : mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : null;
  if (!extension || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Only hashed JPEG, PNG, or WebP evidence can be stored");
  }
  return `${ownerID}/${sha256}.${extension}`;
}
