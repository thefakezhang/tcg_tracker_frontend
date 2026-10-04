export const RECONCILIATION_COMPONENTS = [
  "card_jpy",
  "buyer_handling_jpy",
  "shipping_jpy",
  "payment_fee_jpy",
  "customs_jpy",
  "other_jpy",
] as const;

export type ReconciliationComponent = typeof RECONCILIATION_COMPONENTS[number];
export type SourceFunding = Record<ReconciliationComponent, number>;

export type PurchaseReconciliationPayload = {
  p_plan_id: number;
  p_trip_id: number;
  p_fx_rate: number;
  p_shipping_jpy: Record<string, number>;
  p_float_funding_jpy: Record<string, SourceFunding>;
};

export type PendingPurchaseReconciliation = {
  version: 1;
  ownerId: string;
  requestId: string;
  createdAt: string;
  payload: PurchaseReconciliationPayload;
};

const STORAGE_PREFIX = "tcg:purchase-reconciliation-pending:v1";

function storageKey(ownerId: string): string {
  return `${STORAGE_PREFIX}:${ownerId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validSource(source: string): boolean {
  return source !== "" && source === source.trim().toLowerCase();
}

function validShipping(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([source, amount]) =>
    validSource(source) && isFiniteNumber(amount) && amount >= 0);
}

function validFunding(value: unknown): value is Record<string, SourceFunding> {
  if (!isRecord(value) || Object.keys(value).length === 0) return false;
  return Object.entries(value).every(([source, raw]) => {
    if (!validSource(source) || !isRecord(raw)) return false;
    const keys = Object.keys(raw).sort();
    const expected = [...RECONCILIATION_COMPONENTS].sort();
    if (keys.join("\x00") !== expected.join("\x00")) return false;
    return RECONCILIATION_COMPONENTS.every((component) =>
      isFiniteNumber(raw[component]) && (raw[component] as number) >= 0);
  });
}

function validPayload(value: unknown): value is PurchaseReconciliationPayload {
  if (!isRecord(value)
      || !isFiniteNumber(value.p_plan_id)
      || !Number.isInteger(value.p_plan_id)
      || value.p_plan_id <= 0
      || !isFiniteNumber(value.p_trip_id)
      || !Number.isInteger(value.p_trip_id)
      || value.p_trip_id <= 0
      || !isFiniteNumber(value.p_fx_rate)
      || value.p_fx_rate <= 0
      || !validShipping(value.p_shipping_jpy)
      || !validFunding(value.p_float_funding_jpy)) {
    return false;
  }
  return Object.keys(value.p_shipping_jpy).sort().join("\x00")
    === Object.keys(value.p_float_funding_jpy).sort().join("\x00");
}

export function createPendingPurchaseReconciliation(
  ownerId: string,
  payload: PurchaseReconciliationPayload,
  requestId = crypto.randomUUID(),
): PendingPurchaseReconciliation {
  return {
    version: 1,
    ownerId,
    requestId,
    createdAt: new Date().toISOString(),
    payload,
  };
}

export function readPendingPurchaseReconciliation(
  ownerId: string,
): PendingPurchaseReconciliation | null {
  const raw = window.localStorage.getItem(storageKey(ownerId));
  if (raw == null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid persisted purchase reconciliation request");
  }
  if (!isRecord(value)
      || value.version !== 1
      || value.ownerId !== ownerId
      || typeof value.requestId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
      || typeof value.createdAt !== "string"
      || !validPayload(value.payload)) {
    throw new Error("Invalid persisted purchase reconciliation request");
  }
  return value as PendingPurchaseReconciliation;
}

export function writePendingPurchaseReconciliation(
  request: PendingPurchaseReconciliation,
): void {
  window.localStorage.setItem(storageKey(request.ownerId), JSON.stringify(request));
}

export function clearPendingPurchaseReconciliation(ownerId: string): void {
  window.localStorage.removeItem(storageKey(ownerId));
}
