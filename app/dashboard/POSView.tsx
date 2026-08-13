"use client";

import {
  Camera,
  Check,
  CircleAlert,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  ShoppingBag,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import {
  AUTO_CAPTURE_SAMPLE_INTERVAL_MS,
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  ExactRetryOperation,
  StableFrameGate,
  afterNextPaint,
  captureMetadata,
  captureVideoFrame,
  contentAddressedMediaKey,
  coverGuideToSourceCrop,
  acquisitionCostEvidence,
  boundedDecimalInput,
  exactPOSValue,
  manualSelectionEvidence,
  normalizeCaptureImage,
  patchPOSSessionSettings,
  posErrorMessage,
  posExactRetryStorageKey,
  parseFrozenPOSOperation,
  proposedSalePrice,
  prewarmRecognition,
  recognizeCapture,
  samePOSSessionSettings,
  sampleVideoFrame,
  sha256Hex,
  strictIntegerInput,
  type CaptureMetadata,
  type FrozenAcquisitionAdd,
  type FrozenAcquisitionMedia,
  type FrozenSaleAdd,
  type POSUseCase,
  type POSSessionSettingsDraft,
  type RecognitionCandidate,
  type RecognitionResult,
  type RecognitionStatus,
} from "@/lib/pos-camera";

interface InventorySKU {
  leg: "import" | "export";
  card_uid: string;
  condition_standard: string;
  condition_code: string;
  condition_name: string;
  psa_grade: number;
  available_qty: number;
  avg_cost_unit_usd: number;
  preview_cogs_usd: number;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string;
  misc_info: string;
  language: string;
  image_url: string | null;
  market_unit_usd: number | null;
  market_source: string | null;
  market_as_of: string | null;
  market_confidence: string | null;
  market_evidence: Record<string, unknown>;
}

interface SaleLine {
  line_id: string;
  line_position: number;
  identity: {
    card_uid: string;
    regional_name: string;
    english_name: string | null;
    set_code: string;
    card_number: string;
    condition_standard: string;
    condition_code: string;
    psa_grade: number;
  };
  quantity: number;
  available_qty_at_add: number;
  avg_cost_unit_usd: number;
  preview_cogs_usd: number;
  preview_fifo_fingerprint: string;
  market_unit_usd: number;
  proposed_unit_price_usd: number;
  agreed_unit_price_usd: number;
  add_request: {
    requested_agreed_unit_price_usd: number | null;
    requested_sell_percentage: number | null;
    requested_rounding_mode: string | null;
    manual_market_unit_usd: number | null;
    manual_market_reason: string | null;
    browser_snapshot: Record<string, unknown>;
    expected_preview_token: string;
    expected_preview_cogs_usd: number;
  };
  recognition?: { request_id: string; status: string };
}

interface SaleSessionState {
  session_id: string;
  status: "draft" | "paused" | "finalized" | "cancelled";
  inventory_leg: "import" | "export";
  sell_percentage: number;
  rounding_mode: string;
  sold_at: string;
  platform_label?: string;
  notes?: string;
  finalization?: {
    line_count: number;
    total_cogs_usd: number;
    total_margin_usd: number;
    total_gross_usd: number;
  };
  ledger?: {
    status: "finalized" | "reversed";
    reversed_at?: string;
    reversal_sold_at?: string;
    reversal_gross_usd?: number;
  };
  lines: SaleLine[];
}

interface AcquisitionLot {
  lot_id: number;
  acquired_at: string;
  shop_label: string | null;
  leg: string;
  orig_currency: string;
  fx_rate_used: number;
}

interface ConditionRef {
  standard: string;
  code: string;
  display_name: string;
}

interface StableCardIdentity {
  card_uid: string;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string;
  misc_info: string;
  language: string;
  image_url: string | null;
}

interface LatencyEvidence {
  permissionMs: number;
  captureMs: number;
  captureToResponseMs: number;
  tapToResponseMs: number | null;
  responseToPaintMs: number;
  auditReadyMs: number | null;
  totalTapToReadyMs: number | null;
  serverTiming: Record<string, number>;
}

interface PendingRecognitionAudit {
  requestID: string;
  args: Record<string, unknown>;
  captureStarted: number;
  tappedAt: number | null;
  responseAt: number;
  auditStartedAt: number | null;
  completionTiming: {
    auditReadyMs: number;
    totalTapToReadyMs: number;
  } | null;
}

interface FinalizeResponse {
  session_id: string;
  status: "finalized" | "review_required";
  reason?: "inventory_shortfall" | "fifo_composition_changed";
  line_id?: string;
  available_quantity?: number;
  requested_quantity?: number;
  preview_cogs_usd?: number;
  changed_lines?: Array<{
    line_id: string;
    identity: SaleLine["identity"];
    quantity: number;
    previous_preview_cogs_usd: number;
    preview_cogs_usd: number;
    previous_fifo_fingerprint?: string;
    fifo_fingerprint: string;
  }>;
  line_count?: number;
  total_cogs_usd?: number;
  total_margin_usd?: number;
  total_gross_usd?: number;
}

interface SaleLinePreview {
  available_quantity: number;
  requested_quantity: number;
  sufficient: boolean;
  preview_cogs_usd: number | null;
  projected_session_cogs_usd: number | null;
  affected_lines: Array<{
    line_id: string | null;
    line_position: number;
    preview_cogs_usd: number;
    fifo_fingerprint: string;
  }>;
  fifo_fingerprint: string | null;
  preview_token: string | null;
}

interface PendingSaleLineChange {
  lineID: string;
  quantity: number;
  agreedUnitPriceUSD: number;
  preview: SaleLinePreview;
}

type InventoryLeg = "import" | "export";
type MediaKind = FrozenAcquisitionMedia["media_kind"];
const POS_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class MissingFrozenMediaError extends Error {
  constructor(readonly mediaKind: MediaKind, message: string) {
    super(message);
    this.name = "MissingFrozenMediaError";
  }
}

interface AcquisitionOperationState {
  operation_id: string;
  lot_id: number;
  lot_line_id: number;
  recognition_request_id: string | null;
  card_uid: string;
  condition_standard: string;
  condition_code: string;
  psa_grade: number;
  quantity: number;
  price_override_usd: number | null;
  market_value_usd: number | null;
  browser_snapshot: {
    recognition_request_id: string | null;
    operation_owner_id: string;
    selection_method: string;
    card_uid: string;
    recognition: unknown[];
    browser: Record<string, unknown>;
  };
  expected_attachments: FrozenAcquisitionMedia[];
  registered_media: FrozenAcquisitionMedia[];
}

function saleLineMatchesFrozen(line: SaleLine, frozen: FrozenSaleAdd): boolean {
  const args = frozen.rpc_args;
  return (
    line.line_id === args.p_line_id
    && line.identity.card_uid === args.p_card_uid
    && line.identity.condition_standard === args.p_condition_standard
    && line.identity.condition_code === args.p_condition_code
    && Number(line.identity.psa_grade) === args.p_psa_grade
    && Number(line.quantity) === args.p_quantity
    && (line.recognition?.request_id ?? null) === args.p_recognition_request_id
    && exactPOSValue(line.add_request) === exactPOSValue({
      requested_agreed_unit_price_usd: args.p_agreed_unit_price_usd,
      requested_sell_percentage: args.p_sell_percentage,
      requested_rounding_mode: args.p_rounding_mode,
      manual_market_unit_usd: args.p_manual_market_unit_usd,
      manual_market_reason: args.p_manual_market_reason,
      browser_snapshot: args.p_browser_snapshot,
      expected_preview_token: args.p_expected_preview_token,
      expected_preview_cogs_usd: args.p_expected_preview_cogs_usd,
    })
  );
}

function comparableMedia(media: FrozenAcquisitionMedia[]): FrozenAcquisitionMedia[] {
  return [...media].sort((left, right) => (
    left.object_key.localeCompare(right.object_key)
    || left.media_kind.localeCompare(right.media_kind)
  ));
}

function acquisitionStateMatchesFrozen(
  state: AcquisitionOperationState,
  frozen: FrozenAcquisitionAdd,
): boolean {
  const args = frozen.rpc_args;
  return (
    state.operation_id === args.p_operation_id
    && Number(state.lot_id) === args.p_lot_id
    && (state.recognition_request_id ?? null) === args.p_recognition_request_id
    && state.card_uid === args.p_card_uid
    && state.condition_standard === args.p_condition_standard
    && state.condition_code === args.p_condition_code
    && Number(state.psa_grade) === args.p_psa_grade
    && Number(state.quantity) === args.p_quantity
    && (state.price_override_usd == null ? null : Number(state.price_override_usd))
      === args.p_price_override_usd
    && (state.market_value_usd == null ? null : Number(state.market_value_usd))
      === args.p_market_value_usd
    && exactPOSValue(state.browser_snapshot?.browser) === exactPOSValue(args.p_browser_snapshot)
    && exactPOSValue(comparableMedia(state.expected_attachments ?? []))
      === exactPOSValue(comparableMedia(frozen.media))
  );
}

function mediaRegisteredExactly(
  state: AcquisitionOperationState,
  expected: FrozenAcquisitionMedia[],
): boolean {
  return exactPOSValue(
    comparableMedia(state.registered_media ?? []),
  ) === exactPOSValue(comparableMedia(expected));
}

const SESSION_STATUS_KEYS: Record<SaleSessionState["status"], TranslationKey> = {
  draft: "pos.statusDraft",
  paused: "pos.statusPaused",
  finalized: "pos.statusFinalized",
  cancelled: "pos.statusCancelled",
};

const ROUNDING_KEYS: Record<string, TranslationKey> = {
  nearest_cent: "pos.roundingNearestCent",
  nearest_dollar: "pos.roundingNearestDollar",
  down_dollar: "pos.roundingDownDollar",
  up_dollar: "pos.roundingUpDollar",
};

function messageOf(error: unknown): string {
  return posErrorMessage(error);
}

function posRequestError(
  translate: ReturnType<typeof useTranslation>["t"],
  error: unknown,
): string {
  return translate("pos.requestFailed", { message: messageOf(error) });
}

function marketEvidenceSummary(
  sku: InventorySKU,
  translate: ReturnType<typeof useTranslation>["t"],
): string {
  const asOf = sku.market_as_of ? new Date(sku.market_as_of) : null;
  const ageDays = asOf && Number.isFinite(asOf.getTime())
    ? Math.max(0, Math.floor((Date.now() - asOf.getTime()) / 86_400_000))
    : null;
  const rawFlags = sku.market_evidence?.flags;
  const flags = Array.isArray(rawFlags)
    ? rawFlags.filter((flag): flag is string => typeof flag === "string")
    : rawFlags && typeof rawFlags === "object"
      ? Object.entries(rawFlags).flatMap(([flag, enabled]) => enabled === true ? [flag] : [])
      : [];
  const kind = typeof sku.market_evidence?.kind === "string"
    ? sku.market_evidence.kind
    : sku.market_source;
  const evidenceStale = sku.market_evidence?.stale === true;
  const freshness = ageDays == null
    ? translate("pos.marketAgeUnknown")
    : evidenceStale || ageDays > 30
      ? translate("pos.marketStale", { days: ageDays })
      : translate("pos.marketFresh", { days: ageDays });
  return [
    kind || translate("pos.marketUnknown"),
    freshness,
    sku.market_confidence || translate("pos.marketUnknown"),
    flags.length > 0 ? translate("pos.marketFlags", { flags: flags.join(", ") }) : null,
  ].filter(Boolean).join(" · ");
}

function isDefinitiveRPCFailure(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && typeof (error as { code?: unknown }).code === "string",
  );
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await createClient().rpc(name, args);
  if (error) throw error;
  return data as T;
}

async function rpcAbortable<T>(
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<T> {
  const { data, error } = await createClient().rpc(name, args).abortSignal(signal);
  if (error) throw error;
  return data as T;
}

export default function POSView() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<POSUseCase>("sale");
  const [session, setSession] = useState<SaleSessionState | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [newSaleLeg, setNewSaleLeg] = useState<InventoryLeg>("import");
  const [settingsDraft, setSettingsDraft] = useState<POSSessionSettingsDraft | null>(null);
  const [lots, setLots] = useState<AcquisitionLot[]>([]);
  const [conditions, setConditions] = useState<ConditionRef[]>([]);
  const [selectedLot, setSelectedLot] = useState<number | null>(null);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<RecognitionCandidate | null>(null);
  const [candidateConfirmed, setCandidateConfirmed] = useState(false);
  const [selectionMethod, setSelectionMethod] = useState<"candidate" | "manual">("candidate");
  const [manualQuery, setManualQuery] = useState("");
  const [manualCandidates, setManualCandidates] = useState<RecognitionCandidate[]>([]);
  const [saleSKUs, setSaleSKUs] = useState<InventorySKU[]>([]);
  const [selectedSKU, setSelectedSKU] = useState<InventorySKU | null>(null);
  const [captureBlob, setCaptureBlob] = useState<Blob | null>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<Partial<Record<MediaKind, File>>>({});
  const [latency, setLatency] = useState<LatencyEvidence | null>(null);
  const [auditState, setAuditState] = useState<"idle" | "saving" | "ready" | "failed">("idle");
  const [recognitionStatus, setRecognitionStatus] = useState<RecognitionStatus | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMessageKey, setCameraMessageKey] = useState<TranslationKey>("pos.cameraOff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saleQuantity, setSaleQuantity] = useState("1");
  const [saleAgreedPrice, setSaleAgreedPrice] = useState("");
  const [salePreview, setSalePreview] = useState<SaleLinePreview | null>(null);
  const [salePreviewLoading, setSalePreviewLoading] = useState(false);
  const [salePreviewError, setSalePreviewError] = useState<string | null>(null);
  const [manualMarket, setManualMarket] = useState("");
  const [manualMarketReason, setManualMarketReason] = useState("");
  const [conditionRef, setConditionRef] = useState("");
  const [acquisitionGrade, setAcquisitionGrade] = useState("0");
  const [acquisitionQuantity, setAcquisitionQuantity] = useState("1");
  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [acquisitionMarket, setAcquisitionMarket] = useState("");
  const [attachCapture, setAttachCapture] = useState(false);
  const [pendingSaleOperationID, setPendingSaleOperationID] = useState<string | null>(null);
  const [pendingSaleFrozen, setPendingSaleFrozen] = useState<FrozenSaleAdd | null>(null);
  const [pendingAcquisitionOperationID, setPendingAcquisitionOperationID] = useState<string | null>(null);
  const [pendingAcquisitionFrozen, setPendingAcquisitionFrozen] = useState<FrozenAcquisitionAdd | null>(null);
  const [pendingMissingMedia, setPendingMissingMedia] = useState<MediaKind[]>([]);
  const [durableRetryReady, setDurableRetryReady] = useState(false);
  const [linePriceDrafts, setLinePriceDrafts] = useState<Record<string, string>>({});
  const [pendingLineChange, setPendingLineChange] = useState<PendingSaleLineChange | null>(null);
  const [finalizeReview, setFinalizeReview] = useState<FinalizeResponse | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const cameraActionRef = useRef<HTMLButtonElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const matchPanelRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inFlightRef = useRef(false);
  const pendingResultRef = useRef<RecognitionResult | null>(null);
  const sessionRef = useRef<SaleSessionState | null>(null);
  const modeRef = useRef<POSUseCase>(mode);
  const gateRef = useRef(new StableFrameGate());
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const salePreviewGenerationRef = useRef(0);
  const salePreviewAbortRef = useRef<AbortController | null>(null);
  const recognitionStatusRef = useRef<RecognitionStatus | null>(null);
  const pendingAuditRef = useRef<PendingRecognitionAudit | null>(null);
  const cameraPermissionMsRef = useRef(0);
  const manualSearchGenerationRef = useRef(0);
  const manualSearchAbortRef = useRef<AbortController | null>(null);
  const saleAddOperationRef = useRef<ExactRetryOperation | null>(null);
  const acquisitionAddOperationRef = useRef<ExactRetryOperation | null>(null);
  const ownerIDRef = useRef<string | null>(null);
  const lineRefs = useRef(new Map<string, HTMLDivElement>());
  const lineChangeReviewRef = useRef<HTMLDivElement>(null);
  const initialSaleLegRef = useRef<InventoryLeg>(newSaleLeg);
  const submitRef = useRef<(capture: () => Promise<Blob>, crop?: CaptureMetadata, tappedAt?: number) => Promise<void>>(async () => {});

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pendingResultRef.current = result; }, [result]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useLayoutEffect(() => {
    if (
      !result
      || !matchPanelRef.current
      || typeof window.matchMedia !== "function"
      || !window.matchMedia("(max-width: 1023px)").matches
    ) return;
    matchPanelRef.current.scrollIntoView({ block: "start" });
  }, [result]);

  const authenticatedSession = useCallback(async () => {
    const supabase = createClient();
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session?.access_token || !data.session.user?.id) {
      throw sessionError ?? new Error(t("pos.signInAgain"));
    }
    if (!POS_UUID_PATTERN.test(data.session.user.id)) {
      throw new Error(t("pos.ownerUnavailable"));
    }
    return {
      accessToken: data.session.access_token,
      ownerID: data.session.user.id,
      supabase,
    };
  }, [t]);

  const authenticatedRecognition = useCallback(async (
    inventoryLeg?: InventoryLeg,
    signal?: AbortSignal,
  ) => {
    const authenticated = await authenticatedSession();
    const status = await prewarmRecognition({
      baseURL: process.env.NEXT_PUBLIC_POS_RECOGNITION_URL ?? "",
      accessToken: authenticated.accessToken,
      refreshAccessToken: async () => {
        const refreshed = await authenticated.supabase.auth.refreshSession();
        if (refreshed.error || !refreshed.data.session?.access_token) {
          throw refreshed.error ?? new Error(t("pos.sessionRefreshFailed"));
        }
        return refreshed.data.session.access_token;
      },
      inventoryLeg,
      signal,
    });
    if (inventoryLeg && !status.saleReady) {
      throw new Error(status.saleScopeError ?? t("pos.saleRecognitionUnavailable"));
    }
    recognitionStatusRef.current = status;
    setRecognitionStatus(status);
    return { status, ...authenticated };
  }, [authenticatedSession, t]);

  const loadSaleSession = useCallback(async (sessionID?: string) => {
    let state = await rpc<SaleSessionState | null>("get_pos_sale_session_state", {
      p_session_id: sessionID ?? null,
    });
    setSession(state);
    sessionRef.current = state;
    setSettingsDraft(state ? {
      sellPercentage: String(state.sell_percentage),
      roundingMode: state.rounding_mode,
      soldAt: state.sold_at,
      platformLabel: state.platform_label ?? "",
      notes: state.notes ?? "",
    } : null);
    setLinePriceDrafts(Object.fromEntries(
      (state?.lines ?? []).map((line) => [
        line.line_id,
        Number(line.agreed_unit_price_usd).toFixed(2),
      ]),
    ));
    setPendingLineChange(null);
    setSessionLoaded(true);
    return state;
  }, []);

  const loadAcquisitionInputs = useCallback(async (preferredLotID?: number | null) => {
    const supabase = createClient();
    const [lotResult, conditionResult] = await Promise.all([
      supabase
        .from("acquisition_lots")
        .select("lot_id,acquired_at,shop_label,leg,orig_currency,fx_rate_used")
        .eq("lines_imported", false)
        .order("acquired_at", { ascending: false })
        .limit(100),
      supabase
        .from("conditions")
        .select("standard,code,display_name")
        .order("standard")
        .order("tier"),
    ]);
    if (lotResult.error) throw lotResult.error;
    if (conditionResult.error) throw conditionResult.error;
    const openLots = (lotResult.data ?? []) as AcquisitionLot[];
    if (preferredLotID && !openLots.some((lot) => lot.lot_id === preferredLotID)) {
      const preferredResult = await supabase
        .from("acquisition_lots")
        .select("lot_id,acquired_at,shop_label,leg,orig_currency,fx_rate_used")
        .eq("lot_id", preferredLotID)
        .eq("lines_imported", false)
        .limit(1);
      if (preferredResult.error) throw preferredResult.error;
      const preferred = ((preferredResult.data ?? []) as AcquisitionLot[])[0];
      if (preferred) openLots.unshift(preferred);
    }
    const stableConditions = (conditionResult.data ?? []) as ConditionRef[];
    setLots(openLots);
    setConditions(stableConditions);
    setConditionRef((current) => current || (stableConditions[0]
      ? `${stableConditions[0].standard}\u0000${stableConditions[0].code}`
      : ""));
    setSelectedLot((current) => preferredLotID ?? current ?? openLots[0]?.lot_id ?? null);
  }, []);

  const registerFrozenMedia = useCallback(async (
    frozen: FrozenAcquisitionAdd,
    lotLineID: number,
    media: FrozenAcquisitionMedia,
  ) => {
    await rpc<string>("register_inventory_card_media", {
      p_lot_id: frozen.lot_id,
      p_lot_line_id: lotLineID,
      p_recognition_request_id: frozen.rpc_args.p_recognition_request_id,
      p_media_kind: media.media_kind,
      p_object_key: media.object_key,
      p_mime_type: media.mime_type,
      p_byte_size: media.byte_size,
      p_sha256: media.sha256,
      p_is_recognition_capture: media.is_recognition_capture,
    });
  }, []);

  const authenticatedMediaBucket = useCallback(async (expectedOwnerID: string) => {
    const authenticated = await authenticatedSession();
    if (authenticated.ownerID !== expectedOwnerID) {
      throw new Error(t("pos.ownerUnavailable"));
    }
    return authenticated.supabase.storage.from("inventory-card-media");
  }, [authenticatedSession, t]);

  const describeAcquisitionEvidence = useCallback(async (
    blob: Blob,
    expectedOwnerID: string,
    mediaKind: MediaKind,
    isRecognitionCapture: boolean,
  ): Promise<FrozenAcquisitionMedia> => {
    const sha = await sha256Hex(blob);
    return {
      media_kind: mediaKind,
      object_key: contentAddressedMediaKey(expectedOwnerID, sha, blob.type),
      mime_type: blob.type,
      byte_size: blob.size,
      sha256: sha,
      is_recognition_capture: isRecognitionCapture,
    };
  }, []);

  const verifyEvidenceBlob = useCallback(async (
    blob: Blob,
    descriptor: FrozenAcquisitionMedia,
  ) => {
    if (
      blob.size !== descriptor.byte_size
      || blob.type !== descriptor.mime_type
      || await sha256Hex(blob) !== descriptor.sha256
    ) throw new Error(t("pos.evidenceMismatch"));
  }, [t]);

  const storageObjectMissing = useCallback((storageError: unknown): boolean => {
    if (!storageError || typeof storageError !== "object") return false;
    const record = storageError as Record<string, unknown>;
    return Number(record.statusCode ?? record.status) === 404 || record.code === "not_found";
  }, []);

  const proveOrUploadFrozenMedia = useCallback(async (
    descriptor: FrozenAcquisitionMedia,
    expectedOwnerID: string,
    blob?: Blob,
  ) => {
    if (blob) await verifyEvidenceBlob(blob, descriptor);
    const bucket = await authenticatedMediaBucket(expectedOwnerID);
    const existing = await bucket.download(descriptor.object_key);
    if (!existing.error && existing.data) {
      await verifyEvidenceBlob(existing.data, descriptor);
      return;
    }
    if (existing.error && !storageObjectMissing(existing.error)) throw existing.error;
    if (!blob) {
      throw new MissingFrozenMediaError(
        descriptor.media_kind,
        t("pos.reselectExactEvidence", { kind: descriptor.media_kind }),
      );
    }
    const uploaded = await bucket.upload(descriptor.object_key, blob, {
      contentType: descriptor.mime_type,
      upsert: false,
      metadata: { sha256: descriptor.sha256 },
    });
    if (uploaded.error) {
      const afterAmbiguousUpload = await bucket.download(descriptor.object_key);
      if (afterAmbiguousUpload.error || !afterAmbiguousUpload.data) throw uploaded.error;
      await verifyEvidenceBlob(afterAmbiguousUpload.data, descriptor);
      return;
    }
    const readback = await bucket.download(descriptor.object_key);
    if (readback.error || !readback.data) {
      throw readback.error ?? new Error(t("pos.mediaReadbackMissing"));
    }
    await verifyEvidenceBlob(readback.data, descriptor);
  }, [authenticatedMediaBucket, storageObjectMissing, t, verifyEvidenceBlob]);

  const removeProvenOrphanMedia = useCallback(async (
    frozen: FrozenAcquisitionAdd,
  ) => {
    if (!ownerIDRef.current) throw new Error(t("pos.ownerUnavailable"));
    const bucket = await authenticatedMediaBucket(ownerIDRef.current);
    for (const media of frozen.media) {
      const orphan = await rpc<boolean>("pos_inventory_media_object_is_orphan", {
        p_object_key: media.object_key,
      });
      if (!orphan) continue;
      const removed = await bucket.remove([media.object_key]);
      if (removed.error) throw removed.error;
    }
  }, [authenticatedMediaBucket, t]);

  const reconcilePendingSale = useCallback(async (
    retry: ExactRetryOperation,
    frozen: FrozenSaleAdd,
  ): Promise<SaleSessionState | null> => {
    const operationID = frozen.rpc_args.p_line_id;
    setPendingSaleOperationID(operationID);
    setPendingSaleFrozen(frozen);
    let state = await loadSaleSession(frozen.session_id);
    let line = state?.lines.find((candidateLine) => candidateLine.line_id === operationID);
    if (line) {
      if (!saleLineMatchesFrozen(line, frozen)) {
        throw new Error(t("pos.retryStateMismatch"));
      }
      retry.clear(operationID);
      setPendingSaleOperationID(null);
      setPendingSaleFrozen(null);
      setNotice(t("pos.saleAdded", { name: frozen.display_name }));
      return state;
    }
    let addFailure: unknown = null;
    try {
      await rpc<string>("add_pos_sale_line", frozen.rpc_args);
    } catch (cause) {
      addFailure = cause;
    }
    state = await loadSaleSession(frozen.session_id);
    line = state?.lines.find((candidateLine) => candidateLine.line_id === operationID);
    if (!line) {
      if (addFailure && isDefinitiveRPCFailure(addFailure)) {
        retry.clear(operationID);
        setPendingSaleOperationID(null);
        setPendingSaleFrozen(null);
      }
      throw addFailure ?? new Error(t("pos.saleLineMissing"));
    }
    if (!saleLineMatchesFrozen(line, frozen)) {
      throw new Error(t("pos.retryStateMismatch"));
    }
    retry.clear(operationID);
    setPendingSaleOperationID(null);
    setPendingSaleFrozen(null);
    setNotice(t("pos.saleAdded", { name: frozen.display_name }));
    return state;
  }, [loadSaleSession, t]);

  const reconcilePendingAcquisition = useCallback(async (
    retry: ExactRetryOperation,
    frozen: FrozenAcquisitionAdd,
    availableBlobs: ReadonlyMap<string, Blob> = new Map(),
  ) => {
    const operationID = frozen.rpc_args.p_operation_id;
    setPendingAcquisitionOperationID(operationID);
    setPendingAcquisitionFrozen(frozen);
    let state = await rpc<AcquisitionOperationState | null>(
      "get_pos_acquisition_operation_state",
      { p_operation_id: operationID },
    );
    if (!state) {
      const missing: MediaKind[] = [];
      let missingFailure: MissingFrozenMediaError | null = null;
      for (const media of frozen.media) {
        try {
          await proveOrUploadFrozenMedia(
            media,
            ownerIDRef.current ?? "",
            availableBlobs.get(media.object_key),
          );
        } catch (cause) {
          if (!(cause instanceof MissingFrozenMediaError)) throw cause;
          missing.push(cause.mediaKind);
          missingFailure ??= cause;
        }
      }
      if (missingFailure) {
        setPendingMissingMedia(missing);
        throw missingFailure;
      }
      setPendingMissingMedia([]);
      let addFailure: unknown = null;
      try {
        await rpc<number>("add_recognized_card_to_lot", frozen.rpc_args);
      } catch (cause) {
        addFailure = cause;
      }
      state = await rpc<AcquisitionOperationState | null>(
        "get_pos_acquisition_operation_state",
        { p_operation_id: operationID },
      );
      if (!state) {
        if (addFailure && isDefinitiveRPCFailure(addFailure)) {
          await removeProvenOrphanMedia(frozen);
          retry.clear(operationID);
          setPendingAcquisitionOperationID(null);
          setPendingAcquisitionFrozen(null);
        }
        throw addFailure ?? new Error(t("pos.acquisitionLineMissing"));
      }
    }
    if (!acquisitionStateMatchesFrozen(state, frozen)) {
      throw new Error(t("pos.retryStateMismatch"));
    }
    for (const media of frozen.media) {
      await proveOrUploadFrozenMedia(
        media,
        ownerIDRef.current ?? "",
        availableBlobs.get(media.object_key),
      );
    }
    setPendingMissingMedia([]);
    for (const media of frozen.media) {
      if (!state) throw new Error(t("pos.acquisitionLineMissing"));
      const matchingKey = state.registered_media.find(
        (registered) => registered.object_key === media.object_key,
      );
      if (matchingKey && exactPOSValue(matchingKey) !== exactPOSValue(media)) {
        throw new Error(t("pos.evidenceMismatch"));
      }
      if (matchingKey) continue;
      let registrationFailure: unknown = null;
      try {
        await registerFrozenMedia(frozen, state.lot_line_id, media);
      } catch (cause) {
        registrationFailure = cause;
      }
      state = await rpc<AcquisitionOperationState | null>(
        "get_pos_acquisition_operation_state",
        { p_operation_id: operationID },
      );
      let registered = state?.registered_media.find(
        (candidateMedia) => candidateMedia.object_key === media.object_key,
      );
      if (!registered) {
        try {
          if (!state) throw new Error(t("pos.acquisitionLineMissing"));
          await registerFrozenMedia(frozen, state.lot_line_id, media);
        } catch (cause) {
          registrationFailure = cause;
        }
        state = await rpc<AcquisitionOperationState | null>(
          "get_pos_acquisition_operation_state",
          { p_operation_id: operationID },
        );
        registered = state?.registered_media.find(
          (candidateMedia) => candidateMedia.object_key === media.object_key,
        );
      }
      if (!registered || exactPOSValue(registered) !== exactPOSValue(media)) {
        throw registrationFailure ?? new Error(t("pos.evidenceMismatch"));
      }
    }
    state = await rpc<AcquisitionOperationState | null>(
      "get_pos_acquisition_operation_state",
      { p_operation_id: operationID },
    );
    if (
      !state
      || !acquisitionStateMatchesFrozen(state, frozen)
      || !mediaRegisteredExactly(state, frozen.media)
    ) {
      throw new Error(t("pos.retryStateMismatch"));
    }
    retry.clear(operationID);
    setPendingAcquisitionOperationID(null);
    setPendingAcquisitionFrozen(null);
    setPendingMissingMedia([]);
    setNotice(t("pos.acquisitionAdded", {
      name: frozen.display_name,
      lot: frozen.lot_id,
    }));
  }, [proveOrUploadFrozenMedia, registerFrozenMedia, removeProvenOrphanMedia, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const authenticated = await authenticatedSession();
        if (cancelled) return;
        ownerIDRef.current = authenticated.ownerID;
        const saleRetry = new ExactRetryOperation({
          storage: window.localStorage,
          storageKey: posExactRetryStorageKey(authenticated.ownerID, "sale-add"),
        });
        const acquisitionRetry = new ExactRetryOperation({
          storage: window.localStorage,
          storageKey: posExactRetryStorageKey(authenticated.ownerID, "acquisition-add"),
        });
        saleAddOperationRef.current = saleRetry;
        acquisitionAddOperationRef.current = acquisitionRetry;
        const pendingSale = saleRetry.pending();
        const pendingAcquisition = acquisitionRetry.pending();
        const frozenSale = pendingSale
          ? parseFrozenPOSOperation(
            pendingSale.payloadKey,
            "sale-add",
            authenticated.ownerID,
          )
          : null;
        const frozenAcquisition = pendingAcquisition
          ? parseFrozenPOSOperation(
            pendingAcquisition.payloadKey,
            "acquisition-add",
            authenticated.ownerID,
          )
          : null;
        if (
          pendingSale
          && frozenSale
          && pendingSale.operationID !== frozenSale.rpc_args.p_line_id
        ) throw new Error(t("pos.retryStateMismatch"));
        if (
          pendingAcquisition
          && frozenAcquisition
          && pendingAcquisition.operationID !== frozenAcquisition.rpc_args.p_operation_id
        ) throw new Error(t("pos.retryStateMismatch"));
        setDurableRetryReady(true);
        if (frozenAcquisition) {
          modeRef.current = "acquisition";
          setMode("acquisition");
          setPendingAcquisitionOperationID(frozenAcquisition.rpc_args.p_operation_id);
          setPendingAcquisitionFrozen(frozenAcquisition);
        }
        if (frozenSale) {
          setPendingSaleOperationID(frozenSale.rpc_args.p_line_id);
          setPendingSaleFrozen(frozenSale);
        }
        await loadAcquisitionInputs(frozenAcquisition?.lot_id ?? null);
        let loadedSession = frozenSale
          ? await reconcilePendingSale(saleRetry, frozenSale)
          : await loadSaleSession();
        if (frozenAcquisition) {
          await reconcilePendingAcquisition(acquisitionRetry, frozenAcquisition);
        }
        if (cancelled) return;
        loadedSession = sessionRef.current ?? loadedSession;
        await authenticatedRecognition(
          loadedSession?.inventory_leg ?? initialSaleLegRef.current,
        );
      } catch (cause) {
        if (!cancelled) {
          setError(posRequestError(t, cause));
          if (!saleAddOperationRef.current || !acquisitionAddOperationRef.current) {
            setDurableRetryReady(false);
          }
        }
      } finally {
        if (!cancelled) setSessionLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticatedRecognition, authenticatedSession, loadAcquisitionInputs, loadSaleSession, reconcilePendingAcquisition, reconcilePendingSale, t]);

  const measuredCrop = useCallback((): {
    crop: ReturnType<typeof coverGuideToSourceCrop>;
    metadata: CaptureMetadata;
  } => {
    const video = videoRef.current;
    const preview = previewRef.current;
    const guide = guideRef.current;
    if (!video || !preview || !guide || !video.videoWidth || !video.videoHeight) {
      throw new Error(t("pos.frameUnavailable"));
    }
    const previewBox = preview.getBoundingClientRect();
    const guideBox = guide.getBoundingClientRect();
    const crop = coverGuideToSourceCrop({
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      displayWidth: previewBox.width,
      displayHeight: previewBox.height,
      guideX: guideBox.left - previewBox.left,
      guideY: guideBox.top - previewBox.top,
      guideWidth: guideBox.width,
      guideHeight: guideBox.height,
    });
    return { crop, metadata: captureMetadata(video, crop) };
  }, [t]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    setCameraMessageKey("pos.cameraOff");
  }, []);

  const startCamera = useCallback(async () => {
    let requestedStream: Promise<MediaStream> | null = null;
    const permissionStarted = performance.now();
    try {
      setError(null);
      const inventoryLeg = modeRef.current === "sale"
        ? sessionRef.current?.inventory_leg ?? newSaleLeg
        : undefined;
      const warmed = recognitionStatusRef.current;
      const readiness = warmed
        && warmed.inventoryLeg === (inventoryLeg ?? null)
        && (!inventoryLeg || warmed.saleReady)
        ? Promise.resolve(warmed)
        : authenticatedRecognition(inventoryLeg).then((value) => value.status);
      requestedStream = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      const permissionResult = requestedStream.then((stream) => ({
        stream,
        permissionMs: performance.now() - permissionStarted,
      }));
      const [{ stream, permissionMs }] = await Promise.all([permissionResult, readiness]);
      cameraPermissionMsRef.current = permissionMs;
      stopCamera();
      streamRef.current = stream;
      if (!videoRef.current) throw new Error(t("pos.previewUnavailable"));
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      gateRef.current.reset(true);
      setCameraReady(true);
      setCameraMessageKey("pos.cameraWatching");
    } catch (cause) {
      void requestedStream?.then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      }).catch(() => {});
      stopCamera();
      setError(t("pos.cameraUnavailable", { message: messageOf(cause) }));
    }
  }, [authenticatedRecognition, newSaleLeg, stopCamera, t]);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    requestAbortRef.current?.abort();
    stopCamera();
  }, [stopCamera]);

  const persistRecognitionAudit = useCallback(async (pending: PendingRecognitionAudit) => {
    setAuditState("saving");
    const auditStartedAt = pending.auditStartedAt ?? performance.now();
    pending.auditStartedAt = auditStartedAt;
    const recorded = await rpc<string>("record_card_recognition_audit", pending.args);
    if (recorded !== pending.requestID) {
      throw new Error(t("pos.auditUUIDMismatch"));
    }
    if (!pending.completionTiming) {
      const auditReadyAt = performance.now();
      pending.completionTiming = {
        auditReadyMs: Math.round(
          (auditReadyAt - auditStartedAt) * 1000,
        ) / 1000,
        totalTapToReadyMs: Math.round(
          (auditReadyAt - (pending.tappedAt ?? pending.captureStarted)) * 1000,
        ) / 1000,
      };
    }
    const { auditReadyMs, totalTapToReadyMs } = pending.completionTiming;
    const timingCompleted = await rpc<boolean>(
      "complete_card_recognition_browser_timing",
      {
        p_request_id: pending.requestID,
        p_audit_ready_ms: auditReadyMs,
        p_total_tap_to_ready_ms: totalTapToReadyMs,
      },
    );
    if (timingCompleted !== true) {
      throw new Error(t("pos.auditTimingIncomplete"));
    }
    pendingAuditRef.current = null;
    setAuditState("ready");
    setLatency((current) => current ? {
      ...current,
      auditReadyMs,
      totalTapToReadyMs,
    } : current);
    setCameraMessageKey("pos.cameraConfirm");
  }, [t]);

  const retryRecognitionAudit = useCallback(async () => {
    const pending = pendingAuditRef.current;
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await persistRecognitionAudit(pending);
    } catch (cause) {
      setAuditState("failed");
      setError(t("pos.evidenceSaveError", { message: messageOf(cause) }));
    } finally {
      setBusy(false);
    }
  }, [persistRecognitionAudit, t]);

  const submitCapture = useCallback(async (
    capture: () => Promise<Blob>,
    crop?: CaptureMetadata,
    tappedAt?: number,
  ) => {
    if (inFlightRef.current || pendingResultRef.current) return;
    const useCase = modeRef.current;
    const inventoryLeg = useCase === "sale"
      ? sessionRef.current?.inventory_leg
      : undefined;
    if (useCase === "sale" && !inventoryLeg) {
      setError(t("pos.startSaleBeforeScan"));
      return;
    }
    if (useCase === "sale" && sessionRef.current?.status !== "draft") {
      setError(t("pos.resumeBeforeScan"));
      return;
    }
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    setCameraMessageKey("pos.cameraRecognizing");
    const captureStarted = performance.now();
    const requestID = crypto.randomUUID();
    let captureBytes: Blob | null = null;
    let authenticatedStatus: RecognitionStatus | null = null;
    const isCurrent = () => (
      requestGenerationRef.current === generation && !controller.signal.aborted
    );
    try {
      captureBytes = await capture();
      const capturedAt = performance.now();
      if (!isCurrent()) return;
      const warmed = recognitionStatusRef.current;
      const warmScopeMatches = warmed
        && warmed.inventoryLeg === (inventoryLeg ?? null)
        && (!inventoryLeg || warmed.saleReady);
      const authenticated = warmScopeMatches
        ? await authenticatedSession()
        : await authenticatedRecognition(inventoryLeg);
      authenticatedStatus = recognitionStatusRef.current;
      const response = await recognizeCapture({
        baseURL: process.env.NEXT_PUBLIC_POS_RECOGNITION_URL ?? "",
        accessToken: authenticated.accessToken,
        refreshAccessToken: async () => {
          const refreshed = await authenticated.supabase.auth.refreshSession();
          if (refreshed.error || !refreshed.data.session?.access_token) {
            throw refreshed.error ?? new Error(t("pos.sessionRefreshFailed"));
          }
          return refreshed.data.session.access_token;
        },
        requestID,
        useCase,
        inventoryLeg,
        capture: captureBytes,
        crop,
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (
        !authenticatedStatus
        || response.result.model_fingerprint !== authenticatedStatus.modelFingerprint
        || response.result.catalog_fingerprint !== authenticatedStatus.catalogFingerprint
        || response.result.recognizer_config_fingerprint
          !== authenticatedStatus.recognizerConfigFingerprint
        || response.result.inventory_leg !== authenticatedStatus.inventoryLeg
      ) {
        throw new Error(t("pos.recognizerGenerationChanged"));
      }
      const responseAt = performance.now();
      pendingResultRef.current = response.result;
      setResult(response.result);
      setCaptureBlob(captureBytes);
      setAuditState("saving");
      setLatency({
        permissionMs: cameraPermissionMsRef.current,
        captureMs: capturedAt - captureStarted,
        captureToResponseMs: responseAt - captureStarted,
        tapToResponseMs: tappedAt == null ? null : responseAt - tappedAt,
        responseToPaintMs: 0,
        auditReadyMs: null,
        totalTapToReadyMs: null,
        serverTiming: response.serverTiming,
      });
      setCameraMessageKey("pos.cameraSaving");
      const paintedAt = await afterNextPaint();
      if (!isCurrent()) return;
      const browserTiming = {
        browser_permission_ms: Math.round(cameraPermissionMsRef.current * 1000) / 1000,
        browser_capture_ms: Math.round((capturedAt - captureStarted) * 1000) / 1000,
        browser_capture_to_response_ms: Math.round((responseAt - captureStarted) * 1000) / 1000,
        browser_response_to_paint_ms: Math.round((paintedAt - responseAt) * 1000) / 1000,
        ...(tappedAt == null
          ? {}
          : { browser_tap_to_response_ms: Math.round((responseAt - tappedAt) * 1000) / 1000 }),
        ...Object.fromEntries(
          Object.entries(response.serverTiming).map(([key, value]) => [`server_${key}`, value]),
        ),
      };
      setLatency((current) => current ? {
        ...current,
        responseToPaintMs: paintedAt - responseAt,
      } : current);
      const pending = {
        requestID: response.result.request_id,
        captureStarted,
        tappedAt: tappedAt ?? null,
        responseAt,
        auditStartedAt: null,
        completionTiming: null,
        args: {
          p_request_id: response.result.request_id,
          p_use_case: response.result.use_case,
          p_inventory_leg: response.result.inventory_leg,
          p_capture_sha256: response.result.capture_sha256,
          p_capture_bytes: response.result.capture_bytes,
          p_capture_width: response.result.capture_width,
          p_capture_height: response.result.capture_height,
          p_crop: response.result.crop,
          p_candidates: response.result.candidates,
          p_ambiguous: response.result.ambiguous,
          p_model_fingerprint: response.result.model_fingerprint,
          p_catalog_fingerprint: response.result.catalog_fingerprint,
          p_recognizer_config_fingerprint: response.result.recognizer_config_fingerprint,
          p_timing_ms: { ...response.result.timing_ms, ...browserTiming },
        },
      } satisfies PendingRecognitionAudit;
      pendingAuditRef.current = pending;
      try {
        await persistRecognitionAudit(pending);
      } catch (cause) {
        setAuditState("failed");
        setError(t("pos.evidenceSaveError", { message: messageOf(cause) }));
        setCameraMessageKey("pos.cameraLocked");
      }
    } catch (cause) {
      if (!isCurrent() || (cause instanceof DOMException && cause.name === "AbortError")) return;
      if (captureBytes && authenticatedStatus) {
        try {
          await rpc<string>("record_card_recognition_failure", {
            p_request_id: requestID,
            p_use_case: useCase,
            p_inventory_leg: inventoryLeg ?? null,
            p_capture_sha256: await sha256Hex(captureBytes),
            p_capture_bytes: captureBytes.size,
            p_capture_width: CAPTURE_WIDTH,
            p_capture_height: CAPTURE_HEIGHT,
            p_crop: crop ?? {},
            p_model_fingerprint: authenticatedStatus.modelFingerprint,
            p_catalog_fingerprint: authenticatedStatus.catalogFingerprint,
            p_recognizer_config_fingerprint: authenticatedStatus.recognizerConfigFingerprint,
            p_failure_note: messageOf(cause).slice(0, 1000),
            p_timing_ms: {
              browser_failure_after: Math.round(
                (performance.now() - captureStarted) * 1000,
              ) / 1000,
            },
          });
        } catch {
          // Preserve the recognition error. A failed audit remains visible to
          // operators through the original request error and service logs.
        }
      }
      setError(posRequestError(t, cause));
      setCameraMessageKey(cameraReady ? "pos.cameraRetry" : "pos.cameraOff");
    } finally {
      if (requestGenerationRef.current === generation) {
        requestAbortRef.current = null;
        inFlightRef.current = false;
        setBusy(false);
      }
    }
  }, [authenticatedRecognition, authenticatedSession, cameraReady, persistRecognitionAudit, t]);

  useEffect(() => { submitRef.current = submitCapture; }, [submitCapture]);

  useEffect(() => {
    if (!cameraReady || session?.status === "paused") return;
    const timer = window.setInterval(() => {
      if (inFlightRef.current || pendingResultRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      try {
        const { crop, metadata } = measuredCrop();
        const sample = sampleVideoFrame(video, crop);
        const now = performance.now();
        if (!gateRef.current.observe(sample, now)) {
          if (!gateRef.current.needsRemoval()) setCameraMessageKey("pos.cameraWatching");
          return;
        }
        gateRef.current.markSubmitted(sample, now);
        void submitRef.current(() => captureVideoFrame(video, crop), metadata);
      } catch (cause) {
        setError(posRequestError(t, cause));
      }
    }, AUTO_CAPTURE_SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [cameraReady, measuredCrop, session?.status, t]);

  const scanNow = useCallback(async () => {
    if (!cameraReady) {
      await startCamera();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const tappedAt = performance.now();
    const { crop, metadata } = measuredCrop();
    try {
      gateRef.current.markSubmitted(sampleVideoFrame(video, crop), tappedAt);
    } catch {
      // Manual capture remains available even when the lightweight gate sample fails.
    }
    await submitCapture(() => captureVideoFrame(video, crop), metadata, tappedAt);
  }, [cameraReady, measuredCrop, startCamera, submitCapture]);

  const choosePhoto = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await submitCapture(
      () => normalizeCaptureImage(file),
      undefined,
      performance.now(),
    );
  }, [submitCapture]);

  const chooseEvidencePhoto = useCallback(async (
    kind: MediaKind,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const normalized = await normalizeCaptureImage(file);
      const basename = file.name.replace(/\.[^.]+$/, "") || "card-evidence";
      setEvidenceFiles((current) => ({
        ...current,
        [kind]: new File([normalized], `${basename}.jpg`, { type: "image/jpeg" }),
      }));
      if (kind === "front") setAttachCapture(false);
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const choosePendingEvidencePhoto = useCallback(async (
    descriptor: FrozenAcquisitionMedia,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const normalized = await normalizeCaptureImage(file);
      await verifyEvidenceBlob(normalized, descriptor);
      const basename = file.name.replace(/\.[^.]+$/, "") || "card-evidence";
      setEvidenceFiles((current) => ({
        ...current,
        [descriptor.media_kind]: new File(
          [normalized],
          `${basename}.jpg`,
          { type: descriptor.mime_type },
        ),
      }));
      setPendingMissingMedia((current) => current.filter(
        (kind) => kind !== descriptor.media_kind,
      ));
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [t, verifyEvidenceBlob]);

  const resumePendingAcquisition = useCallback(async () => {
    const retry = acquisitionAddOperationRef.current;
    const frozen = pendingAcquisitionFrozen;
    if (!retry || !frozen) {
      setError(t("pos.retryUnavailable"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const available = new Map<string, Blob>();
      for (const media of frozen.media) {
        const blob = evidenceFiles[media.media_kind];
        if (blob) available.set(media.object_key, blob);
      }
      await reconcilePendingAcquisition(retry, frozen, available);
      setEvidenceFiles({});
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [evidenceFiles, pendingAcquisitionFrozen, reconcilePendingAcquisition, t]);

  const resumePendingSale = useCallback(async () => {
    const retry = saleAddOperationRef.current;
    const frozen = pendingSaleFrozen;
    if (!retry || !frozen) {
      setError(t("pos.retryUnavailable"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reconcilePendingSale(retry, frozen);
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [pendingSaleFrozen, reconcilePendingSale, t]);

  const abortInFlightRecognition = useCallback(() => {
    requestGenerationRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    inFlightRef.current = false;
    setBusy(false);
  }, []);

  const clearRecognition = useCallback(() => {
    if (auditState === "saving") return;
    pendingResultRef.current = null;
    pendingAuditRef.current = null;
    setResult(null);
    setSelectedCandidate(null);
    setCandidateConfirmed(false);
    setSelectionMethod("candidate");
    setManualQuery("");
    manualSearchGenerationRef.current += 1;
    manualSearchAbortRef.current?.abort();
    manualSearchAbortRef.current = null;
    setManualCandidates([]);
    setSaleSKUs([]);
    setSelectedSKU(null);
    salePreviewGenerationRef.current += 1;
    salePreviewAbortRef.current?.abort();
    salePreviewAbortRef.current = null;
    setSalePreview(null);
    setSalePreviewLoading(false);
    setCaptureBlob(null);
    setEvidenceFiles({});
    setAttachCapture(false);
    setLatency(null);
    setAuditState("idle");
    gateRef.current.reset();
    setCameraMessageKey(cameraReady
      ? gateRef.current.needsRemoval()
        ? "pos.cameraRemoveCard"
        : "pos.cameraWatching"
      : "pos.cameraOff");
  }, [auditState, cameraReady]);

  const focusCameraForNextCard = useCallback(() => {
    requestAnimationFrame(() => {
      previewRef.current?.scrollIntoView({ block: "start" });
      cameraActionRef.current?.focus();
    });
  }, []);

  const changeMode = useCallback(async (nextMode: POSUseCase) => {
    if (nextMode === mode) return;
    if (candidateConfirmed || pendingSaleOperationID || pendingAcquisitionOperationID) {
      setError(t("pos.finishConfirmedBeforeMode"));
      return;
    }
    if (result && auditState !== "ready") {
      setError(t("pos.saveEvidenceBeforeMode"));
      return;
    }
    abortInFlightRecognition();
    if (result) {
      setBusy(true);
      try {
        await rpc<string>("resolve_card_recognition_audit", {
          p_request_id: result.request_id,
          p_status: "rejected",
          p_note: "operator changed POS mode before selecting a card",
        });
        clearRecognition();
      } catch (cause) {
        setError(posRequestError(t, cause));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    try {
      await authenticatedRecognition(nextMode === "sale"
        ? sessionRef.current?.inventory_leg ?? newSaleLeg
        : undefined);
    } catch (cause) {
      setError(posRequestError(t, cause));
      return;
    }
    modeRef.current = nextMode;
    setMode(nextMode);
  }, [abortInFlightRecognition, auditState, authenticatedRecognition, candidateConfirmed, clearRecognition, mode, newSaleLeg, pendingAcquisitionOperationID, pendingSaleOperationID, result, t]);

  const selectCandidate = useCallback((
    candidate: RecognitionCandidate,
    method: "candidate" | "manual" = "candidate",
  ) => {
    if (result && auditState !== "ready") return;
    setSelectedCandidate(candidate);
    setSelectionMethod(method);
    setCandidateConfirmed(false);
    setSaleSKUs([]);
    setSelectedSKU(null);
    salePreviewGenerationRef.current += 1;
    salePreviewAbortRef.current?.abort();
    setSalePreview(null);
    setSalePreviewLoading(false);
  }, [auditState, result]);

  const confirmSelectedCandidate = useCallback(async () => {
    if (!selectedCandidate || (result && auditState !== "ready")) return;
    setBusy(true);
    setError(null);
    try {
      if (result) {
        await rpc<string>(selectionMethod === "candidate"
          ? "confirm_card_recognition_audit"
          : "correct_card_recognition_audit", {
          p_request_id: result.request_id,
          p_card_uid: selectedCandidate.card_uid,
          p_note: selectionMethod === "candidate"
            ? "operator explicitly confirmed selected ranked camera candidate"
            : "operator selected stable card identity through manual search",
        });
      } else if (selectionMethod !== "manual") {
        throw new Error(t("pos.cameraCandidateEvidence"));
      }
      if (mode === "sale") {
        if (!session || session.status !== "draft") throw new Error(t("pos.resumeBeforeManual"));
        const rows = await rpc<InventorySKU[]>("search_pos_inventory", {
          p_query: selectedCandidate.card_uid,
          p_inventory_leg: session.inventory_leg,
          p_limit: 50,
        });
        const exact = (rows ?? []).filter((row) => row.card_uid === selectedCandidate.card_uid);
        if (exact.length === 0) throw new Error(t("pos.inventoryNoLongerAvailable"));
        setSaleSKUs(exact);
        setSelectedSKU(null);
      } else if (result) {
        if (!captureBlob) throw new Error(t("pos.captureUnavailable"));
        setAttachCapture(true);
        setEvidenceFiles((current) => {
          const next = { ...current };
          delete next.front;
          return next;
        });
      }
      setCandidateConfirmed(true);
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [auditState, captureBlob, mode, result, selectedCandidate, selectionMethod, session, t]);

  const searchManually = useCallback(async () => {
    const query = manualQuery.trim();
    if (!query || (result && auditState !== "ready")) return;
    if (query.length > 120) {
      setError(t("pos.searchTooLong"));
      return;
    }
    const generation = manualSearchGenerationRef.current + 1;
    manualSearchGenerationRef.current = generation;
    manualSearchAbortRef.current?.abort();
    const searchController = new AbortController();
    manualSearchAbortRef.current = searchController;
    setBusy(true);
    setError(null);
    try {
      let candidates: RecognitionCandidate[];
      if (mode === "sale") {
        if (!session) throw new Error(t("pos.saleUnavailable"));
        const rows = await rpc<InventorySKU[]>("search_pos_inventory", {
          p_query: query,
          p_inventory_leg: session.inventory_leg,
          p_limit: 20,
        });
        if (generation !== manualSearchGenerationRef.current) return;
        const unique = new Map<string, InventorySKU>();
        for (const row of rows ?? []) unique.set(row.card_uid, row);
        candidates = [...unique.values()].map((row, index) => ({
          card_uid: row.card_uid,
          regional_name: row.regional_name,
          english_name: row.english_name,
          set_code: row.set_code,
          card_number: row.card_number,
          misc_info: row.misc_info,
          language: row.language,
          image_url: row.image_url,
          clip_score: 0,
          sift_good_matches: 0,
          sift_inliers: 0,
          sift_inlier_ratio: 0,
          rank: index + 1,
          verification_state: "manual_search",
        }));
      } else {
        const rows = await rpcAbortable<StableCardIdentity[]>("search_pos_card_identities", {
          p_query: query,
          p_limit: 20,
        }, searchController.signal);
        if (generation !== manualSearchGenerationRef.current) return;
        candidates = (rows ?? []).map((row, index) => ({
          ...row,
          clip_score: 0,
          sift_good_matches: 0,
          sift_inliers: 0,
          sift_inlier_ratio: 0,
          rank: index + 1,
          verification_state: "manual_search",
        }));
      }
      if (generation !== manualSearchGenerationRef.current) return;
      setManualCandidates(candidates);
    } catch (cause) {
      if (generation !== manualSearchGenerationRef.current || searchController.signal.aborted) return;
      setError(posRequestError(t, cause));
    } finally {
      if (generation === manualSearchGenerationRef.current) {
        manualSearchAbortRef.current = null;
        setBusy(false);
      }
    }
  }, [auditState, manualQuery, mode, result, session, t]);

  const rejectRecognition = useCallback(async () => {
    if (!result || auditState !== "ready") return;
    setBusy(true);
    try {
      await rpc<string>("resolve_card_recognition_audit", {
        p_request_id: result.request_id,
        p_status: "rejected",
        p_note: "operator rejected every camera candidate",
      });
      clearRecognition();
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [auditState, clearRecognition, result, t]);

  const addSaleLine = useCallback(async () => {
    if (!session || !selectedCandidate || !selectedSKU || !candidateConfirmed) return;
    const retry = saleAddOperationRef.current;
    if (!retry) {
      setError(t("pos.retryUnavailable"));
      return;
    }
    const pending = retry.pending();
    if (pending) {
      setBusy(true);
      setError(null);
      try {
        if (!ownerIDRef.current) throw new Error(t("pos.retryUnavailable"));
        const frozen = parseFrozenPOSOperation(
          pending.payloadKey,
          "sale-add",
          ownerIDRef.current,
        );
        if (frozen.rpc_args.p_line_id !== pending.operationID) {
          throw new Error(t("pos.retryStateMismatch"));
        }
        await reconcilePendingSale(retry, frozen);
        setSaleQuantity("1");
        setSaleAgreedPrice("");
        setManualMarket("");
        setManualMarketReason("");
        clearRecognition();
        setNotice(t("pos.saleAddedNext", { name: frozen.display_name }));
        focusCameraForNextCard();
      } catch (cause) {
        setError(posRequestError(t, cause));
      } finally {
        setBusy(false);
      }
      return;
    }
    const quantity = strictIntegerInput(saleQuantity.trim(), 1, selectedSKU.available_qty);
    const agreed = saleAgreedPrice.trim()
      ? boundedDecimalInput(saleAgreedPrice.trim(), 0, 1_000_000_000)
      : null;
    const manualMarketValue = manualMarket.trim()
      ? boundedDecimalInput(manualMarket.trim(), 0, 1_000_000_000)
      : null;
    if (quantity == null) {
      setError(t("pos.quantityUnavailable"));
      return;
    }
    if (saleAgreedPrice.trim() && agreed == null) {
      setError(t("pos.positiveAgreedPrice"));
      return;
    }
    if (
      selectedSKU.market_unit_usd == null
      && (
        manualMarketValue == null
        || !manualMarketReason.trim()
      )
    ) {
      setError(t("pos.unpricedMarketRequired"));
      return;
    }
    if (selectedSKU.market_unit_usd != null && manualMarket.trim() && manualMarketValue == null) {
      setError(t("pos.unpricedMarketRequired"));
      return;
    }
    if (!salePreview?.sufficient
        || salePreview.preview_token == null
        || salePreview.preview_cogs_usd == null) {
      setError(salePreviewError || t("pos.quantityUnavailable"));
      return;
    }
    const browserSnapshot = selectionMethod === "manual"
      ? manualSelectionEvidence(selectedCandidate.card_uid)
      : {};
    const operationID = crypto.randomUUID();
    const frozen: FrozenSaleAdd = {
      schema_version: 1,
      kind: "sale-add",
      display_name: selectedCandidate.regional_name,
      session_id: session.session_id,
      rpc_args: {
        p_line_id: operationID,
        p_session_id: session.session_id,
        p_card_uid: selectedCandidate.card_uid,
        p_condition_standard: selectedSKU.condition_standard,
        p_condition_code: selectedSKU.condition_code,
        p_psa_grade: selectedSKU.psa_grade,
        p_quantity: quantity,
        p_agreed_unit_price_usd: agreed,
        p_recognition_request_id: result?.request_id ?? null,
        p_sell_percentage: null,
        p_rounding_mode: null,
        p_manual_market_unit_usd: manualMarketValue,
        p_manual_market_reason: manualMarketReason.trim() || null,
        p_browser_snapshot: browserSnapshot,
        p_expected_preview_token: salePreview.preview_token,
        p_expected_preview_cogs_usd: salePreview.preview_cogs_usd,
      },
    };
    try {
      retry.begin(JSON.stringify(frozen), () => operationID);
    } catch (cause) {
      setError(posRequestError(t, cause));
      return;
    }
    setPendingSaleOperationID(operationID);
    setBusy(true);
    setError(null);
    try {
      await reconcilePendingSale(retry, frozen);
      setSaleQuantity("1");
      setSaleAgreedPrice("");
      setManualMarket("");
      setManualMarketReason("");
      clearRecognition();
      setNotice(t("pos.saleAddedNext", { name: selectedCandidate.regional_name }));
      focusCameraForNextCard();
    } catch (cause) {
      setError(t("pos.unknownSaleAdd", { message: messageOf(cause) }));
    } finally {
      setBusy(false);
    }
  }, [candidateConfirmed, clearRecognition, focusCameraForNextCard, manualMarket, manualMarketReason, reconcilePendingSale, result, saleAgreedPrice, salePreview, salePreviewError, saleQuantity, selectedCandidate, selectedSKU, selectionMethod, session, t]);

  const reviewSaleLineChange = useCallback(async (
    line: SaleLine,
    quantity: number,
    agreed: number,
  ) => {
    if (!session || session.status !== "draft") return null;
    setBusy(true);
    setError(null);
    try {
      const preview = await rpc<SaleLinePreview>("preview_pos_sale_line", {
        p_session_id: session.session_id,
        p_inventory_leg: session.inventory_leg,
        p_card_uid: line.identity.card_uid,
        p_condition_standard: line.identity.condition_standard,
        p_condition_code: line.identity.condition_code,
        p_psa_grade: line.identity.psa_grade,
        p_quantity: quantity,
        p_replace_line_id: line.line_id,
      });
      if (!preview.sufficient || preview.preview_token == null
          || preview.preview_cogs_usd == null
          || preview.projected_session_cogs_usd == null) {
        throw new Error(t("pos.quantityUnavailable"));
      }
      setPendingLineChange({
        lineID: line.line_id,
        quantity,
        agreedUnitPriceUSD: agreed,
        preview,
      });
      requestAnimationFrame(() => {
        lineChangeReviewRef.current?.focus();
        lineChangeReviewRef.current?.scrollIntoView({ block: "nearest" });
      });
      return preview;
    } catch (cause) {
      setError(posRequestError(t, cause));
      return null;
    } finally {
      setBusy(false);
    }
  }, [session, t]);

  const applySaleLineChange = useCallback(async () => {
    if (!session || session.status !== "draft" || !pendingLineChange) return;
    const frozen = pendingLineChange;
    const preview = frozen.preview;
    if (!preview.preview_token || preview.preview_cogs_usd == null
        || preview.projected_session_cogs_usd == null) return;
    setBusy(true);
    setError(null);
    try {
      await rpc<string>("update_pos_sale_line", {
        p_line_id: frozen.lineID,
        p_quantity: frozen.quantity,
        p_agreed_unit_price_usd: frozen.agreedUnitPriceUSD,
        p_expected_preview_token: preview.preview_token,
        p_expected_preview_cogs_usd: preview.preview_cogs_usd,
        p_expected_session_cogs_usd: preview.projected_session_cogs_usd,
      });
      await loadSaleSession(session.session_id);
      setFinalizeReview(null);
    } catch (cause) {
      setPendingLineChange(null);
      const line = session.lines.find((candidateLine) => candidateLine.line_id === frozen.lineID);
      if (line) {
        const refreshed = await reviewSaleLineChange(
          line,
          frozen.quantity,
          frozen.agreedUnitPriceUSD,
        );
        if (refreshed) {
          setError(refreshed.preview_token === preview.preview_token
            ? posRequestError(t, cause)
            : t("pos.lineQuoteChanged"));
        }
        return;
      }
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [loadSaleSession, pendingLineChange, reviewSaleLineChange, session, t]);

  const removeSaleLine = useCallback(async (lineID: string) => {
    if (!session || session.status !== "draft") return;
    setBusy(true);
    try {
      await rpc<null>("remove_pos_sale_line", { p_line_id: lineID });
      await loadSaleSession(session.session_id);
      setFinalizeReview(null);
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [loadSaleSession, session, t]);

  const saveSaleLinePrice = useCallback(async (line: SaleLine) => {
    const agreed = boundedDecimalInput(
      linePriceDrafts[line.line_id]?.trim() ?? "",
      0,
      1_000_000_000,
    );
    if (agreed == null) {
      setError(t("pos.positiveAgreedPrice"));
      return;
    }
    await reviewSaleLineChange(line, line.quantity, agreed);
  }, [linePriceDrafts, reviewSaleLineChange, t]);

  const togglePause = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      await rpc<string>("pause_pos_sale_session", {
        p_session_id: session.session_id,
        p_paused: session.status !== "paused",
      });
      await loadSaleSession(session.session_id);
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [loadSaleSession, session, t]);

  const settingsDirty = !samePOSSessionSettings(settingsDraft, session);
  const linePricesDirty = Boolean(session?.lines.some(
    (line) => Number(linePriceDrafts[line.line_id]) !== Number(line.agreed_unit_price_usd),
  ));
  const hasUnsavedSaleEdits = settingsDirty || linePricesDirty || pendingLineChange != null;

  useEffect(() => {
    salePreviewGenerationRef.current += 1;
    const generation = salePreviewGenerationRef.current;
    salePreviewAbortRef.current?.abort();
    salePreviewAbortRef.current = null;
    setSalePreview(null);
    setSalePreviewError(null);
    const quantity = selectedSKU
      ? strictIntegerInput(saleQuantity.trim(), 1, selectedSKU.available_qty)
      : null;
    if (!session || session.status !== "draft" || !selectedSKU
        || !candidateConfirmed || quantity == null || settingsDirty) {
      setSalePreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    salePreviewAbortRef.current = controller;
    setSalePreviewLoading(true);
    void rpcAbortable<SaleLinePreview>("preview_pos_sale_line", {
      p_session_id: session.session_id,
      p_inventory_leg: session.inventory_leg,
      p_card_uid: selectedSKU.card_uid,
      p_condition_standard: selectedSKU.condition_standard,
      p_condition_code: selectedSKU.condition_code,
      p_psa_grade: selectedSKU.psa_grade,
      p_quantity: quantity,
      p_replace_line_id: null,
    }, controller.signal).then((preview) => {
      if (generation !== salePreviewGenerationRef.current || controller.signal.aborted) return;
      setSalePreview(preview);
    }).catch((cause) => {
      if (generation !== salePreviewGenerationRef.current || controller.signal.aborted) return;
      setSalePreviewError(posRequestError(t, cause));
    }).finally(() => {
      if (generation === salePreviewGenerationRef.current) setSalePreviewLoading(false);
    });
    return () => controller.abort();
  }, [candidateConfirmed, saleQuantity, selectedSKU, session, settingsDirty, t]);

  const saveSessionSettings = useCallback(async () => {
    if (!session || !settingsDraft || session.status !== "draft") return;
    const percentage = Number(settingsDraft.sellPercentage);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      setError(t("pos.percentageRange"));
      return;
    }
    setBusy(true);
    try {
      await rpc<string>("update_pos_sale_session_settings", {
        p_session_id: session.session_id,
        p_sell_percentage: percentage,
        p_rounding_mode: settingsDraft.roundingMode,
        p_sold_at: settingsDraft.soldAt,
        p_platform_label: settingsDraft.platformLabel.trim() || null,
        p_notes: settingsDraft.notes.trim() || null,
      });
      await loadSaleSession(session.session_id);
      setFinalizeReview(null);
      setNotice(t("pos.settingsSavedNotice"));
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [loadSaleSession, session, settingsDraft, t]);

  const cancelSale = useCallback(async () => {
    if (!session || !window.confirm(t("pos.cancelConfirm"))) return;
    setBusy(true);
    try {
      await rpc<string>("cancel_pos_sale_session", { p_session_id: session.session_id });
      await loadSaleSession(session.session_id);
      setNotice(t("pos.cancelledNotice"));
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [loadSaleSession, session, t]);

  const finalizeSale = useCallback(async () => {
    if (!session || session.status !== "draft" || session.lines.length === 0) return;
    if (hasUnsavedSaleEdits) {
      setError(t("pos.saveEditsBeforeFinalize"));
      return;
    }
    const confirmation = finalizeReview
      ? t("pos.finalizeReviewConfirm")
      : t("pos.finalizeConfirm");
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    try {
      const summary = await rpc<FinalizeResponse>("finalize_pos_sale_session", {
        p_session_id: session.session_id,
      });
      await loadSaleSession(session.session_id);
      if (summary.status === "review_required") {
        setFinalizeReview(summary);
        setNotice(summary.reason === "inventory_shortfall"
          ? t("pos.inventoryChangedNotice", {
            available: summary.available_quantity ?? 0,
            requested: summary.requested_quantity ?? 0,
          })
          : t("pos.fifoChangedNotice"));
        const affected = summary.reason === "inventory_shortfall"
          ? [summary.line_id].filter((value): value is string => Boolean(value))
          : (summary.changed_lines ?? []).map((line) => line.line_id);
        window.requestAnimationFrame(() => {
          const first = affected.flatMap((lineID) => {
            const element = lineRefs.current.get(lineID);
            return element ? [element] : [];
          })[0];
          first?.scrollIntoView({ block: "center" });
          first?.focus();
        });
        return;
      }
      if (summary.status !== "finalized" || summary.total_gross_usd == null) {
        throw new Error(t("pos.invalidFinalize"));
      }
      setFinalizeReview(null);
      setNotice(t("pos.saleFinalizedNotice", { gross: Number(summary.total_gross_usd).toFixed(2) }));
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [finalizeReview, hasUnsavedSaleEdits, loadSaleSession, session, t]);

  const reverseSale = useCallback(async () => {
    if (!session || session.status !== "finalized" || session.ledger?.status === "reversed") return;
    if (!window.confirm(t("pos.reverseSaleConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      await rpc<Record<string, unknown>>("reverse_pos_sale_session", {
        p_session_id: session.session_id,
        p_reversed_at: new Date().toISOString().slice(0, 10),
      });
      await loadSaleSession(session.session_id);
      setNotice(t("pos.saleReversed"));
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [loadSaleSession, session, t]);

  const changeNewSaleLeg = useCallback(async (nextLeg: InventoryLeg) => {
    if (nextLeg === newSaleLeg) return;
    if (result || selectedCandidate || inFlightRef.current) {
      setError(t("pos.clearScanBeforeLeg"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authenticatedRecognition(nextLeg);
      abortInFlightRecognition();
      clearRecognition();
      setNewSaleLeg(nextLeg);
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [abortInFlightRecognition, authenticatedRecognition, clearRecognition, newSaleLeg, result, selectedCandidate, t]);

  const startNewSale = useCallback(async () => {
    setBusy(true);
    try {
      await authenticatedRecognition(newSaleLeg);
      const created = await rpc<string>("create_pos_sale_session", {
        p_inventory_leg: newSaleLeg,
      });
      await loadSaleSession(created);
      setFinalizeReview(null);
      setNotice(t("pos.newSaleNotice"));
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [authenticatedRecognition, loadSaleSession, newSaleLeg, t]);

  const addAcquisitionLine = useCallback(async () => {
    if (!selectedCandidate || !selectedLot || !candidateConfirmed) return;
    const retry = acquisitionAddOperationRef.current;
    if (!retry) {
      setError(t("pos.retryUnavailable"));
      return;
    }
    const pending = retry.pending();
    if (pending) {
      setBusy(true);
      setError(null);
      try {
        if (!ownerIDRef.current) throw new Error(t("pos.retryUnavailable"));
        const frozen = parseFrozenPOSOperation(
          pending.payloadKey,
          "acquisition-add",
          ownerIDRef.current,
        );
        if (frozen.rpc_args.p_operation_id !== pending.operationID) {
          throw new Error(t("pos.retryStateMismatch"));
        }
        const available = new Map<string, Blob>();
        for (const media of frozen.media) {
          const replacement = media.is_recognition_capture && attachCapture
            ? captureBlob
            : evidenceFiles[media.media_kind] ?? null;
          if (replacement) available.set(media.object_key, replacement);
        }
        await reconcilePendingAcquisition(retry, frozen, available);
        setAcquisitionQuantity("1");
        setAcquisitionCost("");
        setAcquisitionMarket("");
        setAttachCapture(false);
        setEvidenceFiles({});
        clearRecognition();
      } catch (cause) {
        setError(posRequestError(t, cause));
      } finally {
        setBusy(false);
      }
      return;
    }
    const selectedCondition = conditions.find(
      (condition) => `${condition.standard}\u0000${condition.code}` === conditionRef,
    );
    if (!selectedCondition) {
      setError(t("pos.chooseCondition"));
      return;
    }
    const lot = lots.find((candidateLot) => candidateLot.lot_id === selectedLot);
    if (!lot) {
      setError(t("pos.chooseLot"));
      return;
    }
    const quantity = strictIntegerInput(acquisitionQuantity.trim(), 1, 1_000_000);
    const grade = strictIntegerInput(acquisitionGrade.trim(), 0, 10);
    let costEvidence: ReturnType<typeof acquisitionCostEvidence>;
    try {
      costEvidence = acquisitionCostEvidence(
        acquisitionCost,
        lot.orig_currency.trim().toUpperCase(),
        Number(lot.fx_rate_used),
      );
    } catch (cause) {
      setError(posRequestError(t, cause));
      return;
    }
    const market = acquisitionMarket.trim()
      ? boundedDecimalInput(acquisitionMarket.trim(), 0, 1_000_000_000)
      : null;
    if (quantity == null || grade == null) {
      setError(t("pos.invalidQuantityGrade"));
      return;
    }
    if (acquisitionMarket.trim() && market == null) {
      setError(t("pos.invalidAcquisitionMarket"));
      return;
    }
    if (attachCapture && !captureBlob) {
      setError(t("pos.captureUnavailable"));
      return;
    }
    if (result && (!attachCapture || !captureBlob)) {
      setError(t("pos.recognizedFrontRequired"));
      return;
    }
    if (!result && (attachCapture || !evidenceFiles.front)) {
      setError(t("pos.manualFrontRequired"));
      return;
    }
    const evidenceEntries = (["front", "back", "defect"] as const)
      .flatMap((kind) => evidenceFiles[kind] && !(kind === "front" && attachCapture)
        ? [{ kind, file: evidenceFiles[kind] as File }]
        : []);
    setBusy(true);
    setError(null);
    try {
      const authenticated = await authenticatedSession();
      const mediaSources = [
        ...(attachCapture && captureBlob
          ? [{ blob: captureBlob, kind: "front" as const, recognition: true }]
          : []),
        ...evidenceEntries.map(({ file, kind }) => ({
          blob: file as Blob,
          kind,
          recognition: false,
        })),
      ];
      const media: FrozenAcquisitionMedia[] = [];
      for (const source of mediaSources) {
        const descriptor = await describeAcquisitionEvidence(
          source.blob,
          authenticated.ownerID,
          source.kind,
          source.recognition,
        );
        if (media.some((existing) => existing.object_key === descriptor.object_key)) {
          throw new Error(t("pos.evidenceMismatch"));
        }
        if (
          source.recognition
          && result
          && descriptor.sha256 !== result.capture_sha256
        ) throw new Error(t("pos.evidenceMismatch"));
        media.push(descriptor);
      }
      const browserSnapshot: Record<string, unknown> = {
        ...(selectionMethod === "manual"
          ? manualSelectionEvidence(selectedCandidate.card_uid)
          : {
            selection_method: "candidate_tap",
            card_uid: selectedCandidate.card_uid,
          }),
        acquisition_cost: costEvidence,
        market_value_usd: market,
        attachments: media,
        latency: {
          permission_ms: latency?.permissionMs ?? null,
          capture_ms: latency?.captureMs ?? null,
          capture_to_response_ms: latency?.captureToResponseMs ?? null,
          tap_to_response_ms: latency?.tapToResponseMs ?? null,
          response_to_paint_ms: latency?.responseToPaintMs ?? null,
          audit_ready_ms: latency?.auditReadyMs ?? null,
          total_tap_to_ready_ms: latency?.totalTapToReadyMs ?? null,
        },
      };
      const operationID = crypto.randomUUID();
      const frozen: FrozenAcquisitionAdd = {
        schema_version: 1,
        kind: "acquisition-add",
        display_name: selectedCandidate.regional_name,
        lot_id: selectedLot,
        rpc_args: {
          p_operation_id: operationID,
          p_recognition_request_id: result?.request_id ?? null,
          p_lot_id: selectedLot,
          p_condition_standard: selectedCondition.standard,
          p_condition_code: selectedCondition.code,
          p_psa_grade: grade,
          p_quantity: quantity,
          p_price_override_usd: costEvidence?.price_usd ?? null,
          p_market_value_usd: market,
          p_browser_snapshot: browserSnapshot,
          p_card_uid: selectedCandidate.card_uid,
        },
        media,
      };
      retry.begin(JSON.stringify(frozen), () => operationID);
      setPendingAcquisitionOperationID(operationID);
      setPendingAcquisitionFrozen(frozen);
      const available = new Map<string, Blob>();
      mediaSources.forEach((source, index) => {
        available.set(media[index].object_key, source.blob);
      });
      await reconcilePendingAcquisition(retry, frozen, available);
      setAcquisitionQuantity("1");
      setAcquisitionCost("");
      setAcquisitionMarket("");
      setAttachCapture(false);
      setEvidenceFiles({});
      clearRecognition();
      setNotice(t("pos.acquisitionAddedNext", {
        name: selectedCandidate.regional_name,
        lot: selectedLot,
      }));
      focusCameraForNextCard();
    } catch (cause) {
      setError(posRequestError(t, cause));
    } finally {
      setBusy(false);
    }
  }, [acquisitionCost, acquisitionGrade, acquisitionMarket, acquisitionQuantity, attachCapture, authenticatedSession, candidateConfirmed, captureBlob, clearRecognition, conditionRef, conditions, describeAcquisitionEvidence, evidenceFiles, focusCameraForNextCard, latency, lots, reconcilePendingAcquisition, result, selectedCandidate, selectedLot, selectionMethod, t]);

  const saleGross = session?.lines.reduce(
    (total, line) => total + Number(line.agreed_unit_price_usd) * line.quantity,
    0,
  ) ?? 0;
  const identityDetails = (identity: StableCardIdentity | RecognitionCandidate) => [
    `${identity.set_code || t("pos.noSet")} ${identity.card_number || t("pos.noNumber")}`,
    identity.language || t("pos.languageUnknown"),
    identity.misc_info || t("pos.variantNone"),
  ].join(" · ");
  const englishIdentityName = (identity: StableCardIdentity | RecognitionCandidate) => (
    identity.english_name && identity.english_name !== identity.regional_name
      ? identity.english_name
      : null
  );
  const sessionStatus = session ? t(SESSION_STATUS_KEYS[session.status]) : "";
  const roundingLabel = session
    ? t(ROUNDING_KEYS[session.rounding_mode] ?? "pos.roundingNearestDollar")
    : "";
  const saleCOGS = session?.lines.reduce(
    (total, line) => total + Number(line.preview_cogs_usd),
    0,
  ) ?? 0;
  const pendingChangedLines = pendingLineChange?.preview.affected_lines.filter((projected) => {
    if (projected.line_id == null) return false;
    const current = session?.lines.find((line) => line.line_id === projected.line_id);
    return current != null && (
      Number(current.preview_cogs_usd) !== Number(projected.preview_cogs_usd)
      || current.preview_fifo_fingerprint !== projected.fifo_fingerprint
    );
  }) ?? [];
  const pendingProjectedGross = pendingLineChange && session
    ? session.lines.reduce((total, line) => total + (
      line.line_id === pendingLineChange.lineID
        ? pendingLineChange.agreedUnitPriceUSD * pendingLineChange.quantity
        : Number(line.agreed_unit_price_usd) * line.quantity
    ), 0)
    : null;
  const selectedProposedPrice = (
    selectedSKU?.market_unit_usd != null && session
      ? proposedSalePrice(
        Number(selectedSKU.market_unit_usd),
        Number(session.sell_percentage),
        session.rounding_mode,
      )
      : null
  );
  const selectedPreviewGross = salePreview?.sufficient && selectedSKU
    ? (boundedDecimalInput(saleAgreedPrice.trim(), 0, 1_000_000_000)
      ?? selectedProposedPrice ?? 0) * salePreview.requested_quantity
    : null;
  const selectedProjectedGross = selectedPreviewGross == null
    ? null
    : saleGross + selectedPreviewGross;
  const canRecognize = mode === "sale"
    ? session?.status === "draft" && !settingsDirty
    : selectedLot !== null;
  const canManualSearch = canRecognize;
  const selectedAcquisitionLot = lots.find((lot) => lot.lot_id === selectedLot) ?? null;
  let acquisitionCostPreview: ReturnType<typeof acquisitionCostEvidence> = null;
  try {
    if (selectedAcquisitionLot) {
      acquisitionCostPreview = acquisitionCostEvidence(
        acquisitionCost,
        selectedAcquisitionLot.orig_currency.trim().toUpperCase(),
        Number(selectedAcquisitionLot.fx_rate_used),
      );
    }
  } catch {
    acquisitionCostPreview = null;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4" data-testid="pos-view">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t("pos.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("pos.subtitle")}</p>
        </div>
        <Tabs value={mode} onValueChange={(value) => void changeMode(value as POSUseCase)}>
          <TabsList className="grid w-full grid-cols-2 sm:w-72">
            <TabsTrigger value="sale" disabled={session?.status === "paused" || candidateConfirmed || Boolean(pendingSaleOperationID || pendingAcquisitionOperationID)}><ShoppingBag />{t("pos.sell")}</TabsTrigger>
            <TabsTrigger value="acquisition" disabled={session?.status === "paused" || candidateConfirmed || Boolean(pendingSaleOperationID || pendingAcquisitionOperationID)}><ScanLine />{t("pos.acquire")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {error && <div role="alert" className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><CircleAlert className="size-4 shrink-0" />{error}</div>}
      {notice && <div aria-live="polite" className="rounded-lg border bg-muted/50 p-3 text-sm">{notice}</div>}
      {!durableRetryReady && <div role="status" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t("pos.durableRetryRequired")}</div>}
      {pendingSaleFrozen && (
        <Card className="border-amber-500/50" data-testid="pos-pending-sale-recovery">
          <CardHeader>
            <CardTitle>{t("pos.pendingSaleRecovery")}</CardTitle>
            <CardDescription>{t("pos.pendingSaleRecoveryHelp", {
              name: pendingSaleFrozen.display_name,
            })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" className="min-h-11 w-full" disabled={busy} onClick={() => void resumePendingSale()}>
              <ShoppingBag />{t("pos.retrySaleAdd")}
            </Button>
          </CardContent>
        </Card>
      )}
      {pendingAcquisitionFrozen && (
        <Card className="border-amber-500/50" data-testid="pos-pending-acquisition-recovery">
          <CardHeader>
            <CardTitle>{t("pos.pendingAcquisitionRecovery")}</CardTitle>
            <CardDescription>{t("pos.pendingAcquisitionRecoveryHelp", {
              lot: pendingAcquisitionFrozen.lot_id,
            })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingAcquisitionFrozen.media.map((media) => {
              const missing = pendingMissingMedia.includes(media.media_kind);
              return (
                <div key={media.object_key} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium capitalize">{media.media_kind}</p>
                  <p className="break-all text-xs text-muted-foreground">{t("pos.exactEvidenceDescriptor", {
                    size: media.byte_size,
                    mime: media.mime_type,
                    sha: media.sha256,
                  })}</p>
                  {missing && (
                    <Label className="mt-2 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 focus-within:outline-none focus-within:ring-2 focus-within:ring-ring">
                      <Upload className="size-4" />{t("pos.reselectEvidence", { kind: media.media_kind })}
                      <input className="sr-only" type="file" accept="image/*" capture="environment" disabled={busy} onChange={(event) => void choosePendingEvidencePhoto(media, event)} />
                    </Label>
                  )}
                </div>
              );
            })}
            <Button type="button" className="min-h-11 w-full" disabled={busy || pendingMissingMedia.some((kind) => !evidenceFiles[kind])} onClick={() => void resumePendingAcquisition()}>
              <ScanLine />{t("pos.resumePendingAcquisition")}
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(21rem,.95fr)]">
        <Card className="order-1">
          <CardHeader>
            <CardTitle className="flex items-center justify-between"><span>{t("pos.cardCamera")}</span><Badge variant="outline">{t(cameraMessageKey)}</Badge></CardTitle>
            <CardDescription>{t("pos.cameraHelp")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div ref={previewRef} className={`relative mx-auto aspect-[3/4] w-full overflow-hidden rounded-xl bg-black ${result || selectedCandidate ? "max-h-40 sm:max-h-[68vh]" : "max-h-[68vh]"}`}>
              <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
              <div ref={guideRef} className="pointer-events-none absolute left-1/2 top-1/2 h-[78%] aspect-[63/88] -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.34)]" />
              {busy && <div className="absolute inset-0 grid place-items-center bg-black/45 text-white"><Loader2 className="size-8 animate-spin" /></div>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button ref={cameraActionRef} type="button" className="min-h-11" variant={cameraReady ? "outline" : "default"} disabled={busy || !canRecognize || Boolean(result)} onClick={() => void scanNow()}><Camera />{cameraReady ? t("pos.scanNow") : t("pos.startCamera")}</Button>
              <Label aria-disabled={busy || !canRecognize || Boolean(result)} className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium focus-within:outline-none focus-within:ring-2 focus-within:ring-ring ${busy || !canRecognize || result ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}><Upload className="size-4" />{t("pos.choosePhoto")}<input className="sr-only" type="file" accept="image/*" capture="environment" disabled={busy || !canRecognize || Boolean(result)} onChange={(event) => void choosePhoto(event)} /></Label>
            </div>
            {recognitionStatus && <p className="truncate text-xs text-muted-foreground" title={`${recognitionStatus.modelFingerprint} / ${recognitionStatus.catalogFingerprint}`}>{t("pos.recognizerReady", { generation: recognitionStatus.catalogGeneration?.slice(0, 8) ?? "legacy" })}</p>}
          </CardContent>
        </Card>
        <div className="contents lg:order-none lg:block lg:space-y-4">
          <Card className="order-3 lg:order-none">
            <CardHeader>
              <CardTitle>{mode === "sale" ? t("pos.saleSession") : t("pos.acquisitionLot")}</CardTitle>
              <CardDescription>{mode === "sale" ? t("pos.saleSessionHelp") : t("pos.acquisitionLotHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {mode === "sale" ? (
                !sessionLoaded ? <p aria-live="polite" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("pos.loadingSale")}</p> : !session ? <div className="space-y-2 rounded-lg border border-dashed p-4"><p className="text-sm text-muted-foreground">{t("pos.noSale")}</p><div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-[1fr_auto]"><select aria-label={t("pos.newSaleLeg")} className="min-h-11 min-w-0 rounded-md border bg-background px-3" value={newSaleLeg} onChange={(event) => void changeNewSaleLeg(event.target.value as InventoryLeg)} disabled={busy}><option value="import">{t("pos.importInventory")}</option><option value="export">{t("pos.exportInventory")}</option></select><Button type="button" className="min-h-11" onClick={() => void startNewSale()} disabled={busy}><ShoppingBag />{t("pos.startSale")}</Button></div></div> : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{sessionStatus}</Badge>
                      <Badge variant="secondary">{t(session.inventory_leg === "import" ? "pos.importInventory" : "pos.exportInventory")}</Badge>
                      <span className="text-sm text-muted-foreground">{t("pos.sessionPricing", { percentage: session.sell_percentage, rounding: roundingLabel })}</span>
                      {session.status === "draft" ? (
                        <Button type="button" className="min-h-11" size="sm" variant="outline" onClick={() => void togglePause()} disabled={busy}>
                          <Pause />{t("pos.pause")}
                        </Button>
                      ) : session.status === "paused" ? (
                        <div className="grid w-full grid-cols-2 gap-2 min-[390px]:flex min-[390px]:w-auto">
                          <Button type="button" className="min-h-11" size="sm" onClick={() => void togglePause()} disabled={busy}><Play />{t("pos.resume")}</Button>
                          <Button type="button" className="min-h-11" size="sm" variant="outline" onClick={() => void cancelSale()} disabled={busy}>{t("pos.cancel")}</Button>
                        </div>
                      ) : (
                        <div className="flex gap-2"><select aria-label={t("pos.newSaleLeg")} className="min-h-11 rounded-md border bg-background px-2 text-sm" value={newSaleLeg} onChange={(event) => void changeNewSaleLeg(event.target.value as InventoryLeg)} disabled={busy}><option value="import">{t("pos.import")}</option><option value="export">{t("pos.export")}</option></select><Button type="button" className="min-h-11" size="sm" onClick={() => void startNewSale()} disabled={busy}><RotateCcw />{t("pos.newSale")}</Button></div>
                      )}
                    </div>
                    {session.status === "draft" && settingsDraft && (
                      <div className="space-y-2 rounded-lg border p-3">
                        <div className="flex flex-wrap gap-2">
                          {[80, 83].map((percentage) => <Button key={percentage} type="button" className="min-h-11 min-w-11" size="sm" variant={Number(settingsDraft.sellPercentage) === percentage ? "default" : "outline"} onClick={() => setSettingsDraft((current) => current ? patchPOSSessionSettings(current, { sellPercentage: String(percentage) }) : current)}>{percentage}%</Button>)}
                          <Input aria-label={t("pos.customPercentage")} className="min-h-11 w-24" type="number" min="1" max="100" value={settingsDraft.sellPercentage} onChange={(event) => setSettingsDraft((current) => current ? patchPOSSessionSettings(current, { sellPercentage: event.target.value }) : current)} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><Label htmlFor="pos-rounding">{t("pos.rounding")}</Label><select id="pos-rounding" className="min-h-11 w-full rounded-md border bg-background px-2" value={settingsDraft.roundingMode} onChange={(event) => setSettingsDraft((current) => current ? patchPOSSessionSettings(current, { roundingMode: event.target.value }) : current)}><option value="nearest_cent">{t("pos.roundingNearestCent")}</option><option value="nearest_dollar">{t("pos.roundingNearestDollar")}</option><option value="down_dollar">{t("pos.roundingDownDollar")}</option><option value="up_dollar">{t("pos.roundingUpDollar")}</option></select></div>
                          <div><Label htmlFor="pos-sold-at">{t("pos.soldDate")}</Label><Input id="pos-sold-at" className="min-h-11" type="date" value={settingsDraft.soldAt} onChange={(event) => setSettingsDraft((current) => current ? patchPOSSessionSettings(current, { soldAt: event.target.value }) : current)} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="pos-platform">{t("pos.platform")}</Label><Input id="pos-platform" className="min-h-11" maxLength={255} value={settingsDraft.platformLabel} onChange={(event) => setSettingsDraft((current) => current ? patchPOSSessionSettings(current, { platformLabel: event.target.value }) : current)} /></div><div><Label htmlFor="pos-notes">{t("pos.notes")}</Label><Input id="pos-notes" className="min-h-11" maxLength={1000} value={settingsDraft.notes} onChange={(event) => setSettingsDraft((current) => current ? patchPOSSessionSettings(current, { notes: event.target.value }) : current)} /></div></div>
                        <Button type="button" size="sm" className="min-h-11 w-full" disabled={busy || !settingsDirty} onClick={() => void saveSessionSettings()}>{settingsDirty ? t("pos.saveSettings") : t("pos.settingsSaved")}</Button>
                      </div>
                    )}
                    <div className="space-y-2" data-testid="pos-sale-lines">
                      {session.lines.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{t("pos.emptySale")}</p>}
                      {session.lines.map((line) => {
                        const changed = finalizeReview?.line_id === line.line_id
                          || finalizeReview?.changed_lines?.some(
                            (changedLine) => changedLine.line_id === line.line_id,
                          );
                        const changedDetail = finalizeReview?.changed_lines?.find(
                          (changedLine) => changedLine.line_id === line.line_id,
                        );
                        return (
                        <div key={line.line_id} ref={(element) => { if (element) lineRefs.current.set(line.line_id, element); else lineRefs.current.delete(line.line_id); }} tabIndex={changed ? -1 : undefined} className={`rounded-lg border p-3 ${changed ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/50" : ""}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{line.identity.regional_name}</p>
                              <p className="text-xs text-muted-foreground">{line.identity.set_code} {line.identity.card_number} · {line.identity.condition_code}{line.identity.psa_grade ? ` · PSA ${line.identity.psa_grade}` : ""}</p>
                            </div>
                            <Button type="button" className="min-h-11 min-w-11" size="icon-sm" variant="ghost" aria-label={t("pos.removeLine")} disabled={busy || session.status !== "draft" || pendingLineChange != null} onClick={() => void removeSaleLine(line.line_id)}><Trash2 /></Button>
                          </div>
                          <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2 text-sm">
                            <div className="flex items-center rounded-md border">
                              <Button type="button" className="min-h-11 min-w-11" size="icon-sm" variant="ghost" aria-label={t("pos.decreaseQuantity")} disabled={busy || line.quantity <= 1 || session.status !== "draft" || linePricesDirty || pendingLineChange != null} onClick={() => void reviewSaleLineChange(line, line.quantity - 1, line.agreed_unit_price_usd)}>-</Button>
                              <span className="w-8 text-center">{line.quantity}</span>
                              <Button type="button" className="min-h-11 min-w-11" size="icon-sm" variant="ghost" aria-label={t("pos.increaseQuantity")} disabled={busy || line.quantity >= line.available_qty_at_add || session.status !== "draft" || linePricesDirty || pendingLineChange != null} onClick={() => void reviewSaleLineChange(line, line.quantity + 1, line.agreed_unit_price_usd)}>+</Button>
                            </div>
                            <div className="flex min-w-0 items-center justify-end gap-1"><span className="text-muted-foreground">$</span><Input aria-label={t("pos.agreedPriceFor", { name: line.identity.regional_name })} className="min-h-11 min-w-0 w-24 text-right" type="number" step="0.01" min="0.01" value={linePriceDrafts[line.line_id] ?? ""} disabled={busy || session.status !== "draft" || pendingLineChange != null} onChange={(event) => setLinePriceDrafts((current) => ({ ...current, [line.line_id]: event.target.value }))} /><Button type="button" className="min-h-11 shrink-0" size="sm" variant="outline" disabled={busy || session.status !== "draft" || pendingLineChange != null || Number(linePriceDrafts[line.line_id]) === Number(line.agreed_unit_price_usd)} onClick={() => void saveSaleLinePrice(line)}>{t("pos.reviewChange")}</Button></div>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">{t("pos.fifoPreview", { quantity: line.quantity, amount: Number(line.preview_cogs_usd).toFixed(2) })}</p>
                          {changedDetail && <p className="mt-1 text-xs font-medium text-amber-600">{t("pos.fifoLineChanged", { previous: Number(changedDetail.previous_preview_cogs_usd).toFixed(2), current: Number(changedDetail.preview_cogs_usd).toFixed(2) })}</p>}
                        </div>
                      );})}
                    </div>
                    {pendingLineChange && pendingProjectedGross != null && pendingLineChange.preview.projected_session_cogs_usd != null && (
                      <div ref={lineChangeReviewRef} tabIndex={-1} role="region" aria-label={t("pos.lineChangeReview")} className="space-y-3 rounded-lg border-2 border-primary/50 bg-primary/5 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <div>
                          <p className="font-medium">{t("pos.lineChangeReview")}</p>
                          <p className="text-sm text-muted-foreground">{t("pos.lineChangeReviewHelp")}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-sm">
                          <div><p className="text-xs text-muted-foreground">{t("pos.targetCOGS")}</p><p className="font-semibold">${Number(pendingLineChange.preview.preview_cogs_usd).toFixed(2)}</p></div>
                          <div><p className="text-xs text-muted-foreground">{t("pos.projectedCartCOGS")}</p><p className="font-semibold">${Number(pendingLineChange.preview.projected_session_cogs_usd).toFixed(2)}</p></div>
                          <div><p className="text-xs text-muted-foreground">{t("pos.projectedMargin")}</p><p className="font-semibold">${(pendingProjectedGross - Number(pendingLineChange.preview.projected_session_cogs_usd)).toFixed(2)}</p></div>
                        </div>
                        {pendingChangedLines.length > 0 && <div className="space-y-1"><p className="text-sm font-medium">{t("pos.shiftedFIFO")}</p>{pendingChangedLines.map((projected) => {
                          const current = session.lines.find((line) => line.line_id === projected.line_id);
                          return <p key={projected.line_id} className="text-xs text-muted-foreground">{t("pos.shiftedFIFOLine", { name: current?.identity.regional_name ?? t("pos.unknownLine"), previous: Number(current?.preview_cogs_usd ?? 0).toFixed(2), current: Number(projected.preview_cogs_usd).toFixed(2) })}</p>;
                        })}</div>}
                        <div className="grid grid-cols-2 gap-2"><Button type="button" className="min-h-11" variant="outline" disabled={busy} onClick={() => setPendingLineChange(null)}>{t("pos.keepEditing")}</Button><Button type="button" className="min-h-11" disabled={busy} onClick={() => void applySaleLineChange()}>{t("pos.applyQuotedChange")}</Button></div>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted p-3 text-center text-sm"><div><p className="text-xs text-muted-foreground">{t("pos.gross")}</p><p className="font-semibold">${saleGross.toFixed(2)}</p></div><div><p className="text-xs text-muted-foreground">{t("pos.cogs")}</p><p className="font-semibold">${saleCOGS.toFixed(2)}</p></div><div><p className="text-xs text-muted-foreground">{t("pos.margin")}</p><p className="font-semibold">${(saleGross - saleCOGS).toFixed(2)}</p></div></div>
                    {finalizeReview && <div role="status" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{finalizeReview.reason === "inventory_shortfall" ? t("pos.shortfallReview") : t("pos.fifoReview")}</div>}
                    {session.status === "draft" && (
                      <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-[1fr_auto]"><Button type="button" className="min-h-11" disabled={busy || session.lines.length === 0 || hasUnsavedSaleEdits} onClick={() => void finalizeSale()}><Check />{finalizeReview ? t("pos.confirmFIFO") : t("pos.finalizeSale")}</Button><Button type="button" className="min-h-11" variant="outline" disabled={busy} onClick={() => void cancelSale()}>{t("pos.cancel")}</Button></div>
                    )}
                    {session.finalization && <div className="rounded-lg bg-muted p-3 text-sm"><p className="font-medium">{t("pos.finalizedGross", { gross: Number(session.finalization.total_gross_usd).toFixed(2) })}</p><p className="text-muted-foreground">{t("pos.finalizedDetail", { count: session.finalization.line_count, cogs: Number(session.finalization.total_cogs_usd).toFixed(2) })}</p>{session.ledger?.status === "finalized" && <Button type="button" className="mt-3 min-h-11 w-full" variant="destructive" disabled={busy} onClick={() => void reverseSale()}><RotateCcw />{t("pos.reverseSale")}</Button>}</div>}
                    {session.ledger?.status === "reversed" && <div role="status" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm"><p className="font-medium">{t("pos.saleReversed")}</p><p className="text-muted-foreground">{t("pos.saleReversedDetail", { date: session.ledger.reversed_at?.slice(0, 10) ?? t("pos.timingUnavailable") })}</p></div>}
                  </>
                )
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="pos-acquisition-lot">{t("pos.openLot")}</Label>
                  <select id="pos-acquisition-lot" className="min-h-11 w-full rounded-md border bg-background px-3" value={selectedLot ?? ""} disabled={Boolean(pendingAcquisitionOperationID)} onChange={(event) => setSelectedLot(Number(event.target.value) || null)}>
                    <option value="">{t("pos.chooseLot")}</option>
                    {lots.map((lot) => <option key={lot.lot_id} value={lot.lot_id}>{lot.acquired_at} · {lot.shop_label || t("pos.lotLabel", { id: lot.lot_id })} · {t(lot.leg === "export" ? "pos.export" : "pos.import")} · {lot.orig_currency}</option>)}
                  </select>
                  {lots.length === 0 && <p className="text-sm text-muted-foreground">{t("pos.noLots")}</p>}
                </div>
              )}
            </CardContent>
          </Card>
          <Card ref={matchPanelRef} className="order-2 scroll-mt-4 lg:order-none" data-testid="pos-match-panel">
            <CardHeader><CardTitle>{t("pos.confirmMatch")}</CardTitle><CardDescription>{t("pos.confirmMatchHelp")}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {!result && !selectedCandidate && <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">{t("pos.scanOrManual")}</p>}
              {result && !selectedCandidate && (
                <>
                  {auditState === "saving" && <div aria-live="polite" className="rounded-lg border bg-muted p-3 text-sm">{t("pos.candidatesSaving")}</div>}
                  {auditState === "failed" && <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm"><p>{t("pos.evidenceFailed")}</p><Button type="button" className="min-h-11 w-full" variant="outline" onClick={() => void retryRecognitionAudit()} disabled={busy}>{t("pos.retryEvidence")}</Button></div>}
                  <div className="space-y-2" data-testid="pos-candidates">
                    {result.candidates.map((candidate) => (
                      <button key={candidate.card_uid} type="button" className="flex min-h-20 w-full items-center gap-3 rounded-lg border p-2 text-left transition hover:border-primary hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => selectCandidate(candidate)} disabled={busy || auditState !== "ready"}>
                        {candidate.image_url ? <img src={candidate.image_url} alt="" className="h-16 w-12 rounded object-cover" /> : <div className="grid h-16 w-12 place-items-center rounded bg-muted text-xs">#{candidate.rank}</div>}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{candidate.regional_name}</span>
                          {englishIdentityName(candidate) && <span className="block truncate text-xs">{englishIdentityName(candidate)}</span>}
                          <span className="block truncate text-xs text-muted-foreground">{identityDetails(candidate)}</span>
                          <span className="block text-xs">{t("pos.visualMatchEvidence")}</span>
                        </span>
                        <span className="text-xs font-semibold">{t("pos.tapSelect")}</span>
                      </button>
                    ))}
                    {result.candidates.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm">{t("pos.noCandidate")}</p>}
                  </div>
                  <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => void rejectRecognition()} disabled={busy || auditState !== "ready"}>{t("pos.noneThese")}</Button>
                </>
              )}
              {!selectedCandidate && <div className="rounded-lg border p-3">
                <Label htmlFor="pos-manual-search">{t("pos.manualSearch")}</Label>
                <p className="text-xs text-muted-foreground">{t("pos.manualSearchHelp")}</p>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2"><Input id="pos-manual-search" className="min-h-11" maxLength={120} value={manualQuery} disabled={!canManualSearch} onChange={(event) => { manualSearchGenerationRef.current += 1; manualSearchAbortRef.current?.abort(); setManualQuery(event.target.value); setManualCandidates([]); }} placeholder={t("pos.searchPlaceholder")} onKeyDown={(event) => { if (event.key === "Enter") void searchManually(); }} /><Button type="button" className="min-h-11" variant="outline" onClick={() => void searchManually()} disabled={busy || !canManualSearch || !manualQuery.trim() || Boolean(result && auditState !== "ready")}>{t("pos.search")}</Button></div>
                {manualCandidates.length > 0 && <div className="mt-2 space-y-1">{manualCandidates.map((candidate) => <button key={candidate.card_uid} type="button" className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-2 text-left" onClick={() => selectCandidate(candidate, "manual")} disabled={busy || Boolean(result && auditState !== "ready")}><span className="min-w-0"><span className="block truncate">{candidate.regional_name}</span>{englishIdentityName(candidate) && <span className="block truncate text-xs">{englishIdentityName(candidate)}</span>}<span className="block truncate text-xs text-muted-foreground">{identityDetails(candidate)}</span></span><span className="shrink-0 text-xs font-medium">{t("pos.select")}</span></button>)}</div>}
              </div>}
              {selectedCandidate && !candidateConfirmed && (
                <div className="space-y-3 rounded-lg border-2 border-primary/40 p-3">
                  <div className="flex items-start gap-3">
                    {selectedCandidate.image_url ? <img src={selectedCandidate.image_url} alt="" className="h-24 w-[4.3rem] shrink-0 rounded object-cover" /> : <div className="grid h-24 w-[4.3rem] shrink-0 place-items-center rounded bg-muted text-xs">#{selectedCandidate.rank}</div>}
                    <div className="min-w-0"><p className="font-medium">{t("pos.selected", { name: selectedCandidate.regional_name })}</p>{englishIdentityName(selectedCandidate) && <p className="text-sm">{englishIdentityName(selectedCandidate)}</p>}<p className="text-xs text-muted-foreground">{identityDetails(selectedCandidate)}</p><p className="mt-1 text-xs">{selectionMethod === "manual" ? t("pos.manualCorrection") : t("pos.rank", { rank: selectedCandidate.rank })}</p></div>
                  </div>
                  <p className="text-sm">{t("pos.identityCheck")}</p>
                  <div className="grid grid-cols-2 gap-2"><Button type="button" className="min-h-11" variant="outline" onClick={() => setSelectedCandidate(null)} disabled={busy}>{t("pos.back")}</Button><Button type="button" className="min-h-11" onClick={() => void confirmSelectedCandidate()} disabled={busy || Boolean(result && auditState !== "ready")}><Check />{t("pos.confirmIdentity")}</Button></div>
                </div>
              )}
              {selectedCandidate && candidateConfirmed && mode === "sale" && (
                <>
                  <div className="rounded-lg bg-muted p-3 text-sm"><p className="font-medium">{t("pos.confirmed", { name: selectedCandidate.regional_name })}</p>{englishIdentityName(selectedCandidate) && <p>{englishIdentityName(selectedCandidate)}</p>}<p className="text-xs text-muted-foreground">{identityDetails(selectedCandidate)}</p><p className="text-muted-foreground">{t("pos.saleSKUHelp")}</p></div>
                  <div className="space-y-2" data-testid="pos-sale-skus">
                    {saleSKUs.map((sku) => (
                      <button key={`${sku.condition_standard}:${sku.condition_code}:${sku.psa_grade}`} type="button" className={`flex min-h-14 w-full items-center justify-between rounded-lg border p-3 text-left ${selectedSKU === sku ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`} disabled={Boolean(pendingSaleOperationID) || settingsDirty} onClick={() => { setSelectedSKU(sku); setSaleAgreedPrice(""); setManualMarket(""); setManualMarketReason(""); }}>
                        <span><span className="block font-medium">{sku.condition_name}{sku.psa_grade ? ` · PSA ${sku.psa_grade}` : ""}</span><span className="text-xs text-muted-foreground">{t("pos.availableCost", { count: sku.available_qty, cost: Number(sku.avg_cost_unit_usd).toFixed(2) })}</span></span>
                        <span className="max-w-[48%] text-right"><span className="block font-semibold">{sku.market_unit_usd == null ? t("pos.noMarket") : `$${Number(sku.market_unit_usd).toFixed(2)}`}</span>{sku.market_unit_usd != null && <span className="block text-xs font-normal text-muted-foreground">{marketEvidenceSummary(sku, t)}</span>}</span>
                      </button>
                    ))}
                  </div>
                  {selectedSKU && <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="pos-sale-qty">{t("pos.quantity")}</Label><Input id="pos-sale-qty" className="min-h-11" type="number" inputMode="numeric" min="1" max={selectedSKU.available_qty} step="1" value={saleQuantity} disabled={Boolean(pendingSaleOperationID)} onChange={(event) => setSaleQuantity(event.target.value)} /></div><div><Label htmlFor="pos-sale-price">{t("pos.agreedEach")}</Label><Input id="pos-sale-price" className="min-h-11" type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" value={saleAgreedPrice} disabled={Boolean(pendingSaleOperationID)} placeholder={selectedProposedPrice == null ? t("pos.needsMarket") : t("pos.proposed", { amount: selectedProposedPrice.toFixed(2) })} onChange={(event) => setSaleAgreedPrice(event.target.value)} />{selectedProposedPrice != null && <p className="mt-1 text-xs text-muted-foreground">{t("pos.defaultProposal", { amount: selectedProposedPrice.toFixed(2), percentage: session?.sell_percentage ?? 0 })}</p>}</div></div>}
                  {selectedSKU && <div aria-live="polite" className="rounded-lg border bg-muted/40 p-3 text-sm">{settingsDirty ? t("pos.saveEditsBeforeFinalize") : salePreviewLoading ? t("pos.loadingSale") : salePreview?.sufficient && salePreview.preview_cogs_usd != null && salePreview.projected_session_cogs_usd != null ? <><p className="font-medium">{t("pos.fifoPreview", { quantity: salePreview.requested_quantity, amount: Number(salePreview.preview_cogs_usd).toFixed(2) })}</p><p className="text-muted-foreground">{t("pos.projectedCartCOGS")}: ${Number(salePreview.projected_session_cogs_usd).toFixed(2)}</p><p className="text-muted-foreground">{t("pos.projectedMargin")}: ${Number((selectedProjectedGross ?? 0) - salePreview.projected_session_cogs_usd).toFixed(2)}</p></> : <p className="text-amber-700">{salePreviewError || t("pos.quantityUnavailable")}</p>}</div>}
                  {selectedSKU?.market_unit_usd == null && <div className="grid grid-cols-2 gap-2 rounded-lg border border-amber-500/40 p-3"><div><Label htmlFor="pos-manual-market">{t("pos.observedMarket")}</Label><Input id="pos-manual-market" className="min-h-11" type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" value={manualMarket} disabled={Boolean(pendingSaleOperationID)} onChange={(event) => setManualMarket(event.target.value)} /></div><div><Label htmlFor="pos-manual-reason">{t("pos.sourceReason")}</Label><Input id="pos-manual-reason" className="min-h-11" maxLength={1000} value={manualMarketReason} disabled={Boolean(pendingSaleOperationID)} onChange={(event) => setManualMarketReason(event.target.value)} /></div></div>}
                  {!pendingSaleOperationID && <Button type="button" className="min-h-11 w-full" disabled={busy || salePreviewLoading || !salePreview?.sufficient || !salePreview.preview_token || settingsDirty || !durableRetryReady || !selectedSKU || !session || session.status !== "draft"} onClick={() => void addSaleLine()}><ShoppingBag />{t("pos.addSale")}</Button>}
                  <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={clearRecognition}>{t("pos.clearScan")}</Button>
                </>
              )}
              {selectedCandidate && candidateConfirmed && mode === "acquisition" && (
                <>
                  <div className="rounded-lg bg-muted p-3 text-sm"><p className="font-medium">{t("pos.confirmed", { name: selectedCandidate.regional_name })}</p>{englishIdentityName(selectedCandidate) && <p>{englishIdentityName(selectedCandidate)}</p>}<p className="text-xs text-muted-foreground">{identityDetails(selectedCandidate)}</p><p className="text-muted-foreground">{t("pos.acquisitionHelp")}</p></div>
                  <div><Label htmlFor="pos-condition">{t("pos.condition")}</Label><select id="pos-condition" className="min-h-11 w-full rounded-md border bg-background px-3" value={conditionRef} disabled={Boolean(pendingAcquisitionOperationID)} onChange={(event) => setConditionRef(event.target.value)}>{conditions.map((condition) => <option key={`${condition.standard}:${condition.code}`} value={`${condition.standard}\u0000${condition.code}`}>{condition.display_name} · {condition.standard}/{condition.code}</option>)}</select></div>
                  {selectedAcquisitionLot && <div className="rounded-lg border bg-muted/40 p-3 text-sm"><p className="font-medium">{selectedAcquisitionLot.shop_label || t("pos.lotLabel", { id: selectedAcquisitionLot.lot_id })}</p><p className="text-muted-foreground">{t("pos.selectedLotEvidence", { date: selectedAcquisitionLot.acquired_at, leg: t(selectedAcquisitionLot.leg === "export" ? "pos.export" : "pos.import"), currency: selectedAcquisitionLot.orig_currency })}</p></div>}
                  <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="pos-acq-grade">{t("pos.psaGrade")}</Label><Input id="pos-acq-grade" className="min-h-11" type="number" inputMode="numeric" min="0" max="10" step="1" value={acquisitionGrade} disabled={Boolean(pendingAcquisitionOperationID)} onChange={(event) => setAcquisitionGrade(event.target.value)} /></div><div><Label htmlFor="pos-acq-qty">{t("pos.quantity")}</Label><Input id="pos-acq-qty" className="min-h-11" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={acquisitionQuantity} disabled={Boolean(pendingAcquisitionOperationID)} onChange={(event) => setAcquisitionQuantity(event.target.value)} /></div><div><Label htmlFor="pos-acq-cost">{t("pos.costEach", { currency: selectedAcquisitionLot?.orig_currency ?? "USD" })}</Label><Input id="pos-acq-cost" className="min-h-11" type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" value={acquisitionCost} disabled={Boolean(pendingAcquisitionOperationID)} onChange={(event) => setAcquisitionCost(event.target.value)} />{acquisitionCostPreview && <p className="mt-1 text-xs text-muted-foreground">{t("pos.frozenCostConversion", { native: acquisitionCostPreview.native_amount, currency: acquisitionCostPreview.native_currency, usd: acquisitionCostPreview.price_usd.toFixed(6), rate: acquisitionCostPreview.fx_rate_to_usd })}</p>}</div><div><Label htmlFor="pos-acq-market">{t("pos.marketEach")}</Label><Input id="pos-acq-market" className="min-h-11" type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" value={acquisitionMarket} disabled={Boolean(pendingAcquisitionOperationID)} onChange={(event) => setAcquisitionMarket(event.target.value)} /></div></div>
                  {result && captureBlob && <div className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm"><Check className="size-4" />{t("pos.useCaptureFront")}</div>}
                  <div className={`grid grid-cols-1 gap-2 ${result ? "min-[390px]:grid-cols-2" : "min-[390px]:grid-cols-3"}`}>{(["front", "back", "defect"] as const).filter((kind) => !result || kind !== "front").map((kind) => <Label key={kind} className="flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-md border px-2 text-sm capitalize focus-within:outline-none focus-within:ring-2 focus-within:ring-ring"><Upload className="size-4" />{kind === "front" ? t("pos.chooseFront") : t(kind === "back" ? "pos.backImage" : "pos.defectImage")}<input className="sr-only" type="file" accept="image/*" capture="environment" disabled={Boolean(pendingAcquisitionOperationID)} onChange={(event) => void chooseEvidencePhoto(kind, event)} /></Label>)}</div>
                  {(["front", "back", "defect"] as const).map((kind) => evidenceFiles[kind] && <p key={kind} className="text-xs text-muted-foreground">{t("pos.evidenceFile", {
                    kind: t(kind === "front" ? "pos.chooseFront" : kind === "back" ? "pos.backImage" : "pos.defectImage"),
                    name: evidenceFiles[kind]?.name ?? "",
                    size: Math.ceil((evidenceFiles[kind]?.size ?? 0) / 1024),
                  })}</p>)}
                  <Button type="button" className="min-h-11 w-full" disabled={busy || !durableRetryReady || !selectedLot || !conditionRef} onClick={() => void addAcquisitionLine()}><ScanLine />{pendingAcquisitionOperationID ? t("pos.retryAcquisitionAdd") : t("pos.addAcquisition")}</Button>
                  <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={clearRecognition}>{t("pos.clearScan")}</Button>
                </>
              )}
              {latency && <div className="border-t pt-3 text-xs text-muted-foreground"><p>{t("pos.permissionTiming", { milliseconds: latency.permissionMs.toFixed(0) })} · {t("pos.captureTiming", { milliseconds: latency.captureMs.toFixed(0) })}</p><p>{t("pos.captureResponse", { milliseconds: latency.captureToResponseMs.toFixed(0) })}{latency.tapToResponseMs == null ? ` (${t("pos.automatic")})` : ` · ${t("pos.tapResponse", { milliseconds: latency.tapToResponseMs.toFixed(0) })}`}</p><p>{t("pos.responsePaint", { milliseconds: latency.responseToPaintMs.toFixed(0) })} · {latency.auditReadyMs == null ? `${t("pos.auditReady", { milliseconds: t("pos.pending") })}` : t("pos.auditReady", { milliseconds: `${latency.auditReadyMs.toFixed(0)} ms` })}{latency.totalTapToReadyMs == null ? "" : ` · ${t("pos.totalTapReady", { milliseconds: latency.totalTapToReadyMs.toFixed(0) })}`}</p><p>{t("pos.serverTiming", { timing: latency.serverTiming.total == null ? t("pos.timingUnavailable") : `${latency.serverTiming.total.toFixed(1)} ms` })}</p></div>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
