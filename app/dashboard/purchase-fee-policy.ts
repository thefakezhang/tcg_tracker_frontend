import { createClient } from "@/lib/supabase/client";

export type PurchaseFeePolicy = {
  policyKey: string;
  currency: "JPY";
  effectiveFrom: string;
  handlingRate: number;
  lineFeeJpy: number;
};

export type PurchaseFeePolicyState =
  | { status: "idle" | "loading" | "unavailable"; policy: null }
  | { status: "ready"; policy: PurchaseFeePolicy };

type PolicyRow = {
  policy_key?: unknown;
  currency?: unknown;
  effective_from?: unknown;
  handling_rate?: unknown;
  line_fee_jpy?: unknown;
};

function strictDecimal(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function normalizePurchaseFeePolicy(row: unknown): PurchaseFeePolicy | null {
  if (row == null || typeof row !== "object") return null;
  const candidate = row as PolicyRow;
  const handlingRate = strictDecimal(candidate.handling_rate);
  const lineFeeJpy = strictDecimal(candidate.line_fee_jpy);
  if (
    typeof candidate.policy_key !== "string"
    || candidate.policy_key.trim() === ""
    || candidate.currency !== "JPY"
    || typeof candidate.effective_from !== "string"
    || !isCalendarDate(candidate.effective_from)
    || handlingRate == null
    || handlingRate < 0
    || handlingRate > 1
    || lineFeeJpy == null
    || !Number.isSafeInteger(lineFeeJpy)
    || lineFeeJpy < 0
  ) return null;
  return {
    policyKey: candidate.policy_key,
    currency: "JPY",
    effectiveFrom: candidate.effective_from,
    handlingRate,
    lineFeeJpy,
  };
}

// A frontend deploy can precede migration 460. Missing views, missing rows,
// malformed values, and query failures all make this one estimate unavailable;
// they do not block listing discovery or selection.
export async function loadCurrentPurchaseFeePolicy(): Promise<PurchaseFeePolicy | null> {
  try {
    const { data, error } = await createClient()
      .from("purchase_fee_policy_current_v")
      .select("policy_key,currency,effective_from,handling_rate,line_fee_jpy")
      .eq("currency", "JPY")
      .maybeSingle();
    if (error) return null;
    return normalizePurchaseFeePolicy(data);
  } catch {
    return null;
  }
}

function roundNonnegativeHalfUp(value: number): number {
  return Math.floor(value + 0.5 + Number.EPSILON * Math.max(1, value));
}

export function landedPerCardJpy(
  price: number,
  quantity: number,
  policy: PurchaseFeePolicy,
): number {
  if (quantity <= 0) return 0;
  const cardValue = price * quantity;
  const handling = roundNonnegativeHalfUp(cardValue * policy.handlingRate);
  return (cardValue + handling + policy.lineFeeJpy) / quantity;
}

export function purchaseFeePercent(policy: PurchaseFeePolicy): string {
  return handlingRatePercent(policy.handlingRate);
}

export function handlingRatePercent(rate: number): string {
  return String(Number((rate * 100).toFixed(6)));
}
