"use client";

import { type FormEvent, useEffect, useState } from "react";
import { CalendarClock, ChevronDown, LoaderCircle, MapPin, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type TranslationKey, useTranslation } from "@/lib/i18n";
import en from "@/lib/i18n/en";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import {
  type ArrivalRegion,
  FOCUS_UNTIL_MAX_DAYS,
  type ReadRun,
  type RegionAction,
  addTokyoDays,
  focusRegions,
  regionReadState,
} from "./arrival-regions";
import type { ArrivalRegionStatusController } from "./use-arrival-region-status";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** A region's display name; an unknown key shows as itself. */
export function regionName(t: Translate, region: string): string {
  const key = `arrivals.regionName.${region}`;
  return key in en ? t(key as TranslationKey) : region;
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

// Every control here is a 44 px target at every width, overriding the
// Button's compact desktop height: the operator changes the focus from a
// phone or a tablet on the way to a city as often as from a desk.
const TARGET = "min-h-11 sm:min-h-11";

const STATUS_CLASS: Record<ArrivalRegion["focus_kind"], string> = {
  default: "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  operator: "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  until: "border-violet-500/50 bg-violet-500/10 text-violet-800 dark:text-violet-200",
  off: "text-muted-foreground",
};

function RegionRow({
  region,
  readRun,
  now,
  today,
  busy,
  editing,
  error,
  onAction,
  onEdit,
  when,
  date,
}: {
  region: ArrivalRegion;
  /** The newest read-once answer for the region this session, if any. */
  readRun: ReadRun | null | undefined;
  now: number;
  today: string;
  busy: boolean;
  editing: boolean;
  error: string | null;
  onAction: (action: RegionAction) => void;
  onEdit: (open: boolean) => void;
  when: (value: string) => string;
  date: (value: string) => string;
}) {
  const { t } = useTranslation();
  const [until, setUntil] = useState(region.focus_until ?? addTokyoDays(today, 7));
  const latest = addTokyoDays(today, FOCUS_UNTIL_MAX_DAYS);
  const name = regionName(t, region.region);
  const status = region.focus_kind === "until" && region.focus_until
    ? t("arrivals.regions.status.until", { date: date(region.focus_until) })
    : t(`arrivals.regions.status.${region.focus_kind}`);
  const pending = region.pending_request;
  const canRead = region.readable_lists > 0;
  const validUntil = until >= today && until <= latest;

  useEffect(() => {
    if (editing) setUntil(region.focus_until ?? addTokyoDays(today, 7));
  }, [editing, region.focus_until, today]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (validUntil) onAction({ action: "set_focus", region: region.region, until });
  };

  return (
    <li
      className="min-w-0 rounded-lg border bg-background p-3"
      data-testid="arrival-region"
      data-region={region.region}
      aria-busy={busy}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words font-medium">{name}</span>
        <Badge variant="outline" className={STATUS_CLASS[region.focus_kind]} data-testid="arrival-region-status">
          {status}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground" data-testid="arrival-region-meta">
        {region.shops === 1 ? t("arrivals.regions.shopsOne") : t("arrivals.regions.shops", { count: region.shops })}
        {" · "}
        {t("arrivals.regions.lists", { readable: region.readable_lists, count: region.lists })}
        {" · "}
        {region.last_read_at
          ? t("arrivals.regions.lastRead", { when: when(region.last_read_at) })
          : t("arrivals.regions.neverRead")}
      </p>
      {pending ? (
        <p className="mt-1 text-xs text-sky-800 dark:text-sky-200" data-testid="arrival-region-pending">
          {regionReadState(region, now, readRun) === "queued"
            ? t("arrivals.regions.pendingQueued", { when: when(pending.requested_at) })
            : t("arrivals.regions.pendingReading", { when: when(pending.requested_at) })}
        </p>
      ) : region.last_fulfilled ? (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="arrival-region-fulfilled">
          {t("arrivals.regions.lastFulfilled", { when: when(region.last_fulfilled.fulfilled_at) })}
        </p>
      ) : null}

      {editing ? (
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={submit}>
          <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-xs text-muted-foreground">
            {t("arrivals.regions.focusUntilLabel")}
            <Input
              type="date"
              className={cn("h-11 w-full min-w-0", TARGET)}
              min={today}
              max={latest}
              value={until}
              required
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
          <Button type="submit" className={TARGET} disabled={busy || !validUntil}>
            {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {t("arrivals.regions.save")}
          </Button>
          <Button type="button" variant="outline" className={TARGET} disabled={busy} onClick={() => onEdit(false)}>
            {t("arrivals.regions.cancel")}
          </Button>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {!region.in_focus && (
            <Button
              type="button"
              variant="outline"
              className={TARGET}
              disabled={busy}
              onClick={() => onAction({ action: "set_focus", region: region.region, until: null })}
            >
              {t("arrivals.regions.addFocus")}
            </Button>
          )}
          <Button type="button" variant="outline" className={TARGET} disabled={busy} onClick={() => onEdit(true)}>
            <CalendarClock aria-hidden="true" />
            {region.focus_kind === "until" ? t("arrivals.regions.changeUntil") : t("arrivals.regions.focusUntil")}
          </Button>
          {region.focus_kind === "until" && (
            <Button
              type="button"
              variant="outline"
              className={TARGET}
              disabled={busy}
              onClick={() => onAction({ action: "set_focus", region: region.region, until: null })}
            >
              {t("arrivals.regions.keep")}
            </Button>
          )}
          {region.in_focus && (
            <Button
              type="button"
              variant="outline"
              className={TARGET}
              disabled={busy}
              onClick={() => onAction({ action: "clear_focus", region: region.region })}
            >
              {t("arrivals.regions.remove")}
            </Button>
          )}
          {/* Absent, not disabled, while the region has no list to read; a
              pending request stays visible as the disabled button. */}
          {!region.in_focus && (canRead || pending) && (
            <Button
              type="button"
              variant={pending ? "secondary" : "outline"}
              className={TARGET}
              disabled={busy || pending !== null}
              onClick={() => onAction({ action: "request_read", region: region.region })}
            >
              {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {pending ? t("arrivals.regions.readOncePending") : t("arrivals.regions.readOnce")}
            </Button>
          )}
        </div>
      )}
      {!region.in_focus && !canRead && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="arrival-region-nolist">
          {t("arrivals.regions.noList")}
        </p>
      )}
      {error && (
        <p className="mt-2 break-words text-xs text-destructive" role="alert">
          {t("arrivals.regions.actionFailed", { message: error })}
        </p>
      )}
    </li>
  );
}

// The status is the tab's (useArrivalRegionStatus), shared with the feed's
// region filter, so a read the filter asks for shows here as pending at once.
export default function ArrivalRegionPanel({
  regions,
  now = Date.now,
}: {
  regions: ArrivalRegionStatusController;
  now?: () => number;
}) {
  const { t, language } = useTranslation();
  const { state } = regions;
  const [open, setOpen] = useState(false);
  // The region whose change is in flight ("" for the whole-focus reset).
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ region: string; message: string } | null>(null);
  const locale = language === "ja" ? "ja-JP" : "en-US";

  const act = async (key: string, action: RegionAction) => {
    setBusy(key);
    setFailure(null);
    try {
      await regions.send(action);
      setEditing(null);
    } catch (reason) {
      setFailure({ region: key, message: asError(reason).message });
    } finally {
      setBusy(null);
    }
  };

  const when = (value: string) => relativeTime(value, now(), locale) ?? value;
  const date = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, day)));
  };

  let summary: string;
  if (state.status === "ready") {
    const names = focusRegions(state.data).map((region) => regionName(t, region.region)).join(", ");
    summary = state.data.focus_source === "default"
      ? t("arrivals.regions.summaryDefault", { regions: names })
      : t("arrivals.regions.summaryOperator", { regions: names });
    const pending = state.data.regions.filter((region) => region.pending_request !== null).length;
    if (pending === 1) summary += ` · ${t("arrivals.regions.pendingOne")}`;
    else if (pending > 1) summary += ` · ${t("arrivals.regions.pendingMany", { count: pending })}`;
  } else if (state.status === "loading") {
    summary = t("arrivals.regions.loading");
  } else if (state.status === "unavailable") {
    summary = t("arrivals.regions.unavailable");
  } else {
    summary = t("arrivals.regions.errorTitle");
  }

  return (
    <section className="min-w-0 rounded-xl border bg-card" aria-labelledby="arrival-regions-title" data-testid="arrival-regions">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id="arrival-regions-title" className="flex items-center gap-2 text-sm font-semibold">
            <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
            {t("arrivals.regions.title")}
          </h2>
          <p className="mt-0.5 break-words text-xs text-muted-foreground" data-testid="arrival-regions-summary" aria-live="polite">
            {state.status === "loading" && (
              <LoaderCircle className="mr-1 inline size-3.5 animate-spin" aria-hidden="true" />
            )}
            {summary}
          </p>
        </div>
        {state.status !== "unavailable" && (
          <Button
            type="button"
            variant="ghost"
            className={TARGET}
            aria-expanded={open}
            aria-controls="arrival-region-list"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? t("arrivals.regions.hide") : t("arrivals.regions.show")}
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        )}
      </div>
      <div id="arrival-region-list" className={cn("space-y-3 border-t p-3", !open && "hidden")}>
        <p className="text-xs text-muted-foreground">{t("arrivals.regions.explain")}</p>
        {state.status === "error" && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
            <p className="font-medium">{t("arrivals.regions.errorTitle")}</p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">{state.error.message}</p>
            <Button type="button" variant="outline" className={cn("mt-2", TARGET)} onClick={() => void regions.reload()}>
              <RefreshCw aria-hidden="true" />
              {t("arrivals.retry")}
            </Button>
          </div>
        )}
        {state.status === "ready" && state.data.regions.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="arrival-regions-unpublished">
            {t("arrivals.regions.notPublished")}
          </p>
        )}
        {state.status === "ready" && state.data.regions.length > 0 && (
          <>
            <ul className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-3" data-testid="arrival-region-list">
              {state.data.regions.map((region) => (
                <RegionRow
                  key={region.region}
                  region={region}
                  readRun={regions.readRuns.get(region.region)}
                  now={now()}
                  today={state.data.today}
                  busy={busy === region.region}
                  editing={editing === region.region}
                  error={failure?.region === region.region ? failure.message : null}
                  onAction={(action) => void act(region.region, action)}
                  onEdit={(value) => setEditing(value ? region.region : null)}
                  when={when}
                  date={date}
                />
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {state.data.published_at && (
                <p className="text-xs text-muted-foreground">
                  {t("arrivals.regions.published", { when: when(state.data.published_at) })}
                </p>
              )}
              {state.data.focus_source === "operator" && (
                <Button
                  type="button"
                  variant="outline"
                  className={TARGET}
                  disabled={busy !== null}
                  onClick={() => void act("", { action: "reset_focus" })}
                >
                  {busy === "" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                  {t("arrivals.regions.resetFocus")}
                </Button>
              )}
            </div>
            {failure?.region === "" && (
              <p className="break-words text-xs text-destructive" role="alert">
                {t("arrivals.regions.actionFailed", { message: failure.message })}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
