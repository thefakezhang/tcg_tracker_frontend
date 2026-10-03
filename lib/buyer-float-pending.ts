export type BuyerFloatOperation = "remittance" | "refund" | "settlement";

export type RemittancePayload = {
  p_buyer_email: string;
  p_cash_account: string;
  p_amount_usd: number;
  p_fee_usd: number;
  p_amount_jpy: number;
  p_occurred_at: string;
  p_trip_id: number | null;
  p_note: string | null;
};

export type RefundPayload = {
  p_plan_line_id: number;
  p_amount_jpy: number;
  p_occurred_at: string;
  p_note: string | null;
};

export type SettlementPayload = {
  p_buyer_email: string;
  p_amount_jpy: number;
  p_occurred_at: string;
  p_trip_id: null;
  p_note: string | null;
};

type PendingBase = {
  version: 1;
  ownerId: string;
  requestId: string;
  createdAt: string;
  retryPolicy: "safe" | "verify";
};

export type PendingRemittance = PendingBase & {
  operation: "remittance";
  payload: RemittancePayload;
};

export type PendingRefund = PendingBase & {
  operation: "refund";
  payload: RefundPayload;
};

export type PendingSettlement = PendingBase & {
  operation: "settlement";
  payload: SettlementPayload;
};

export type PendingBuyerFloatRequest =
  | PendingRemittance
  | PendingRefund
  | PendingSettlement;

type PayloadByOperation = {
  remittance: RemittancePayload;
  refund: RefundPayload;
  settlement: SettlementPayload;
};

const STORAGE_PREFIX = "tcg:buyer-float-pending:v1";

function storageKey(ownerId: string, operation: BuyerFloatOperation): string {
  return `${STORAGE_PREFIX}:${ownerId}:${operation}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validPayload(operation: BuyerFloatOperation, value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (operation === "remittance") {
    return typeof value.p_buyer_email === "string"
      && typeof value.p_cash_account === "string"
      && isFiniteNumber(value.p_amount_usd)
      && isFiniteNumber(value.p_fee_usd)
      && isFiniteNumber(value.p_amount_jpy)
      && typeof value.p_occurred_at === "string"
      && (value.p_trip_id === null || isFiniteNumber(value.p_trip_id))
      && isNullableString(value.p_note);
  }
  if (operation === "refund") {
    return isFiniteNumber(value.p_plan_line_id)
      && isFiniteNumber(value.p_amount_jpy)
      && typeof value.p_occurred_at === "string"
      && isNullableString(value.p_note);
  }
  return typeof value.p_buyer_email === "string"
    && isFiniteNumber(value.p_amount_jpy)
    && typeof value.p_occurred_at === "string"
    && value.p_trip_id === null
    && isNullableString(value.p_note);
}

export function createPendingBuyerFloatRequest<O extends BuyerFloatOperation>(
  ownerId: string,
  operation: O,
  payload: PayloadByOperation[O],
  requestId = crypto.randomUUID(),
): Extract<PendingBuyerFloatRequest, { operation: O }> {
  return {
    version: 1,
    ownerId,
    operation,
    requestId,
    createdAt: new Date().toISOString(),
    retryPolicy: "safe",
    payload,
  } as Extract<PendingBuyerFloatRequest, { operation: O }>;
}

export function readPendingBuyerFloatRequest<O extends BuyerFloatOperation>(
  ownerId: string,
  operation: O,
): Extract<PendingBuyerFloatRequest, { operation: O }> | null {
  const raw = window.localStorage.getItem(storageKey(ownerId, operation));
  if (raw == null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid persisted ${operation} request`);
  }
  if (!isRecord(value)
      || value.version !== 1
      || value.ownerId !== ownerId
      || value.operation !== operation
      || typeof value.requestId !== "string"
      || value.requestId.length === 0
      || typeof value.createdAt !== "string"
      || (value.retryPolicy !== "safe" && value.retryPolicy !== "verify")
      || !validPayload(operation, value.payload)) {
    throw new Error(`Invalid persisted ${operation} request`);
  }
  return value as Extract<PendingBuyerFloatRequest, { operation: O }>;
}

export function writePendingBuyerFloatRequest(request: PendingBuyerFloatRequest): void {
  window.localStorage.setItem(
    storageKey(request.ownerId, request.operation),
    JSON.stringify(request),
  );
}

export function clearPendingBuyerFloatRequest(
  ownerId: string,
  operation: BuyerFloatOperation,
): void {
  window.localStorage.removeItem(storageKey(ownerId, operation));
}

export function requireBuyerFloatVerification<T extends PendingBuyerFloatRequest>(request: T): T {
  return { ...request, retryPolicy: "verify" };
}

export function isBuyerFloatOutcomeUnknown(error: unknown): boolean {
  if (!isRecord(error)) return true;
  const code = typeof error.code === "string" ? error.code : "";
  if (code === "57014" || code.startsWith("08") || code.startsWith("PGRST0")) return true;
  if (code !== "") return false;
  const status = typeof error.status === "number" ? error.status : null;
  return status == null || status >= 500;
}
