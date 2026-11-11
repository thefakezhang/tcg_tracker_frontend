/**
 * The Arrivals focus regions and read-once requests (backend #2342).
 *
 * The hourly Arrivals run reads only the region X Lists of the focus, Tokyo
 * and Kanto by default; any other region is read once when the operator asks.
 * The backend's `twitter_arrivals_focus_status` RPC (migration 000622) says,
 * per region the hourly run has published, whether it is in focus and why,
 * its lists and shops, when its lists were last read, and any pending
 * read-once request. The tab changes the focus through
 * `/api/twitter-arrivals/regions`, which calls the administrator-only RPCs
 * with the caller's session, and every change answers with the new status.
 */
import { REGION_RE } from "@/lib/arrival-region-key";

/** A refused region request; ``status`` is the HTTP status the route answered. */
export class ArrivalRegionRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ArrivalRegionRequestError";
    this.status = status;
  }
}

/** Why a region is or is not in the focus. */
export type FocusKind = "default" | "operator" | "until" | "off";

export type ReadOnceRequest = {
  request_id: number;
  requested_at: string;
  requested_by: string | null;
};

export type ReadOnceFulfilment = {
  request_id: number;
  fulfilled_at: string;
  fulfilled_run_id: string;
};

export type ArrivalRegion = {
  region: string;
  position: number;
  default_focus: boolean;
  in_focus: boolean;
  focus_kind: FocusKind;
  /** The last Tokyo date a "focus until" region is read (YYYY-MM-DD). */
  focus_until: string | null;
  focus_set_by: string | null;
  focus_set_at: string | null;
  in_focus_last_run: boolean;
  lists: number;
  readable_lists: number;
  shops: number;
  list_only_shops: number;
  last_read_at: string | null;
  pending_request: ReadOnceRequest | null;
  last_fulfilled: ReadOnceFulfilment | null;
};

export type ArrivalRegionStatus = {
  /** Today in Asia/Tokyo, as the backend sees it. */
  today: string;
  focus_source: "operator" | "default";
  published_at: string | null;
  regions: ArrivalRegion[];
};

export type RegionAction =
  | { action: "set_focus"; region: string; until: string | null }
  | { action: "clear_focus"; region: string }
  | { action: "reset_focus" }
  | { action: "request_read"; region: string };

/** Resolves null when the backend migration is not applied yet. */
export type RegionStatusLoader = () => Promise<ArrivalRegionStatus | null>;
export type RegionActionSender = (action: RegionAction) => Promise<ArrivalRegionStatus>;

export const TOKYO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FOCUS_KINDS: readonly FocusKind[] = ["default", "operator", "until", "off"];

function fail(field: string): never {
  throw new Error(`Invalid region status field: ${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}

function count(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) fail(field);
  return Number(value);
}

function flag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(field);
  return value;
}

function timestamp(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail(field);
  return value;
}

function text(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") fail(field);
  return value;
}

function tokyoDateField(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !TOKYO_DATE_RE.test(value)) fail(field);
  return value;
}

function parseRegion(value: unknown, index: number): ArrivalRegion {
  const row = record(value, `regions[${index}]`);
  const region = row.region;
  if (typeof region !== "string" || !REGION_RE.test(region)) fail(`regions[${index}].region`);
  const at = (name: string) => `${region}.${name}`;
  const kind = row.focus_kind;
  if (!FOCUS_KINDS.includes(kind as FocusKind)) fail(at("focus_kind"));
  const lists = count(row.lists, at("lists"));
  const readable = count(row.readable_lists, at("readable_lists"));
  if (readable > lists) fail(at("readable_lists"));
  const pending = row.pending_request == null ? null : record(row.pending_request, at("pending_request"));
  const fulfilled = row.last_fulfilled == null ? null : record(row.last_fulfilled, at("last_fulfilled"));
  return {
    region,
    position: count(row.position, at("position")),
    default_focus: flag(row.default_focus, at("default_focus")),
    in_focus: flag(row.in_focus, at("in_focus")),
    focus_kind: kind as FocusKind,
    focus_until: tokyoDateField(row.focus_until, at("focus_until")),
    focus_set_by: text(row.focus_set_by, at("focus_set_by")),
    focus_set_at: timestamp(row.focus_set_at, at("focus_set_at")),
    in_focus_last_run: flag(row.in_focus_last_run, at("in_focus_last_run")),
    lists,
    readable_lists: readable,
    shops: count(row.shops, at("shops")),
    list_only_shops: count(row.list_only_shops, at("list_only_shops")),
    last_read_at: timestamp(row.last_read_at, at("last_read_at")),
    pending_request: pending === null ? null : {
      request_id: count(pending.request_id, at("pending_request.request_id")),
      requested_at: timestamp(pending.requested_at, at("pending_request.requested_at"))
        ?? fail(at("pending_request.requested_at")),
      requested_by: text(pending.requested_by, at("pending_request.requested_by")),
    },
    last_fulfilled: fulfilled === null ? null : {
      request_id: count(fulfilled.request_id, at("last_fulfilled.request_id")),
      fulfilled_at: timestamp(fulfilled.fulfilled_at, at("last_fulfilled.fulfilled_at"))
        ?? fail(at("last_fulfilled.fulfilled_at")),
      fulfilled_run_id: text(fulfilled.fulfilled_run_id, at("last_fulfilled.fulfilled_run_id"))
        ?? fail(at("last_fulfilled.fulfilled_run_id")),
    },
  };
}

/** The RPC's status, validated; regions in the roster's order. */
export function parseRegionStatus(value: unknown): ArrivalRegionStatus {
  const body = record(value, "status");
  const today = body.today;
  if (typeof today !== "string" || !TOKYO_DATE_RE.test(today)) fail("today");
  if (body.focus_source !== "operator" && body.focus_source !== "default") fail("focus_source");
  if (!Array.isArray(body.regions)) fail("regions");
  const regions = body.regions.map(parseRegion);
  regions.sort((a, b) => a.position - b.position || a.region.localeCompare(b.region));
  return {
    today,
    focus_source: body.focus_source,
    published_at: timestamp(body.published_at, "published_at"),
    regions,
  };
}

/** A Tokyo calendar date (YYYY-MM-DD) ``days`` after ``date``. */
export function addTokyoDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** The latest "focus until" date the backend accepts: a year ahead. */
export const FOCUS_UNTIL_MAX_DAYS = 366;

/** The regions in focus, in order. */
export function focusRegions(status: ArrivalRegionStatus): ArrivalRegion[] {
  return status.regions.filter((region) => region.in_focus);
}

async function regionResponse(response: Response): Promise<ArrivalRegionStatus | null> {
  const body = await response.json().catch(() => null) as unknown;
  // 501 is the route's "the backend migration is not applied yet".
  if (response.status === 501) return null;
  if (!response.ok) {
    const message = body != null && typeof body === "object" && "error" in body
      && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new ArrivalRegionRequestError(response.status, message);
  }
  if (body == null || typeof body !== "object" || !("status" in body)) {
    throw new Error("Invalid region status response");
  }
  return parseRegionStatus(body.status);
}

export const loadRegionStatus: RegionStatusLoader = async () => {
  const response = await fetch("/api/twitter-arrivals/regions", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  return regionResponse(response);
};

export const sendRegionAction: RegionActionSender = async (action) => {
  const response = await fetch("/api/twitter-arrivals/regions", {
    method: "POST",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  const status = await regionResponse(response);
  if (status === null) {
    throw new ArrivalRegionRequestError(501, "Region controls are not available yet");
  }
  return status;
};
