"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, ExternalLink, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QueryError, useSupabaseQuery } from "./use-query";
import { useLanguage } from "./LanguageContext";
import {
  MARKET_EVENT_KINDS,
  MARKET_EVENT_SCOPES,
  dateKey,
  eventTone,
  eventsForDay,
  monthGrid,
  type ChangepointAnnotation,
  type EventConfidence,
  type MarketEventKind,
  type MarketEventRow,
  type MarketEventScope,
} from "./market-events";

interface EventForm {
  event_id: number | null;
  starts_on: string;
  ends_on: string;
  kind: MarketEventKind;
  scope: MarketEventScope;
  scope_ref: string;
  card_ids: string;
  title: string;
  note: string;
  source_url: string;
  confidence: EventConfidence;
}

const EMPTY_FORM: EventForm = {
  event_id: null,
  starts_on: dateKey(new Date()),
  ends_on: "",
  kind: "other",
  scope: "global",
  scope_ref: "",
  card_ids: "",
  title: "",
  note: "",
  source_url: "",
  confidence: "confirmed",
};

function toForm(event: MarketEventRow): EventForm {
  return {
    event_id: event.event_id,
    starts_on: event.starts_on,
    ends_on: event.ends_on ?? "",
    kind: event.kind,
    scope: event.scope,
    scope_ref: event.scope_ref ?? "",
    card_ids: event.card_ids?.join(", ") ?? "",
    title: event.title,
    note: event.note,
    source_url: event.source_url ?? "",
    confidence: event.confidence,
  };
}

function promptFromChangepoint(row: ChangepointAnnotation, title: string): EventForm {
  const [prefix, ...rest] = row.cohort.split(":");
  const scoped = MARKET_EVENT_SCOPES.includes(prefix as MarketEventScope) && prefix !== "global" && prefix !== "card_list";
  return {
    ...EMPTY_FORM,
    starts_on: row.detected_on,
    scope: scoped ? prefix as MarketEventScope : "character",
    scope_ref: scoped ? rest.join(":") : row.cohort,
    title,
  };
}

function kindKey(kind: MarketEventKind): TranslationKey {
  return `events.kind.${kind}` as TranslationKey;
}

function scopeKey(scope: MarketEventScope): TranslationKey {
  return `events.scope.${scope}` as TranslationKey;
}

export default function EventsCalendarView() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchEvents = useCallback(async (): Promise<MarketEventRow[]> => {
    const supabase = createClient();
    return selectAll<MarketEventRow>(
      () => supabase.from("market_events").select("event_id, starts_on, ends_on, kind, scope, scope_ref, card_ids, title, note, source_url, confidence, source_key, created_at, updated_at"),
      ["event_id"],
    );
  }, []);
  const fetchChangepoints = useCallback(async (): Promise<ChangepointAnnotation[]> => {
    const supabase = createClient();
    return selectAll<ChangepointAnnotation>(
      () => supabase.from("cohort_changepoint_annotations_v").select("cohort, detected_on, direction, magnitude, model_version, event_id, event_title, event_kind, event_starts_on, event_ends_on, event_confidence, unexplained"),
      ["cohort", "detected_on", "model_version", "event_id"],
    );
  }, []);
  const eventsQuery = useSupabaseQuery("market-events", fetchEvents);
  const changesQuery = useSupabaseQuery("market-event-changepoints", fetchChangepoints);
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const calendarDays = useMemo(() => monthGrid(month), [month]);
  const locale = language === "ja" ? "ja-JP" : "en-US";
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month);
  const weekdayLabels = useMemo(() => Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2026, 6, 5 + index))), [locale]);
  const upcoming = useMemo(() => {
    const today = dateKey(new Date());
    return events.filter((event) => (event.ends_on ?? event.starts_on) >= today).slice().sort((a, b) => a.starts_on.localeCompare(b.starts_on)).slice(0, 8);
  }, [events]);
  const recentChanges = useMemo(() => (changesQuery.data ?? []).slice().sort((a, b) => b.detected_on.localeCompare(a.detected_on)).slice(0, 12), [changesQuery.data]);

  function openNew(prefill?: Partial<EventForm>) {
    setForm({ ...EMPTY_FORM, ...prefill, event_id: null });
    setSaveError(null);
    setDialogOpen(true);
  }

  function openEdit(event: MarketEventRow) {
    setForm(toForm(event));
    setSaveError(null);
    setDialogOpen(true);
  }

  async function saveEvent() {
    const cardIds = form.scope === "card_list"
      ? form.card_ids.split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0)
      : null;
    const needsRef = ["era", "set", "character"].includes(form.scope);
    if (!form.title.trim() || !form.starts_on || (needsRef && !form.scope_ref.trim()) || (form.scope === "card_list" && !cardIds?.length) || (form.ends_on && form.ends_on < form.starts_on)) {
      setSaveError(t("events.validation"));
      return;
    }
    const payload = {
      starts_on: form.starts_on,
      ends_on: form.ends_on || null,
      kind: form.kind,
      scope: form.scope,
      scope_ref: ["era", "set", "character"].includes(form.scope) ? form.scope_ref.trim() : null,
      card_ids: cardIds,
      title: form.title.trim(),
      note: form.note.trim(),
      source_url: form.source_url.trim() || null,
      confidence: form.confidence,
      updated_at: new Date().toISOString(),
    };
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const query = form.event_id == null
      ? supabase.from("market_events").insert(payload)
      : supabase.from("market_events").update(payload).eq("event_id", form.event_id);
    const { error } = await query;
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setDialogOpen(false);
    await eventsQuery.retry();
    await changesQuery.retry();
  }

  async function confirmEvent(event: MarketEventRow) {
    const supabase = createClient();
    const { error } = await supabase.from("market_events").update({ confidence: "confirmed", updated_at: new Date().toISOString() }).eq("event_id", event.event_id);
    if (!error) await eventsQuery.retry();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("events.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("events.explain")}</p>
        </div>
        <Button className="ml-auto" onClick={() => openNew()}><Plus className="size-4" />{t("events.add")}</Button>
      </div>
      {eventsQuery.error && <QueryError onRetry={eventsQuery.retry} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Button variant="ghost" size="icon-sm" aria-label={t("events.previousMonth")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button>
            <CardTitle className="flex-1 text-center">{monthLabel}</CardTitle>
            <Button variant="ghost" size="icon-sm" aria-label={t("events.nextMonth")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 border-l border-t text-center text-xs text-muted-foreground">
              {weekdayLabels.map((day) => <div key={day} className="border-b border-r py-1">{day}</div>)}
              {calendarDays.map((day) => {
                const key = dateKey(day);
                const dayEvents = eventsForDay(events, key);
                const muted = day.getMonth() !== month.getMonth();
                return (
                  <div key={key} className={`min-h-24 border-b border-r p-1 text-left sm:min-h-28 ${muted ? "bg-muted/20 text-muted-foreground" : ""}`}>
                    <button className="mb-1 size-6 rounded text-center text-xs hover:bg-muted" onClick={() => openNew({ starts_on: key })}>{day.getDate()}</button>
                    <div className="space-y-1">
                      {dayEvents.slice(0, 3).map((event) => (
                        <button key={event.event_id} onClick={() => openEdit(event)} className={`block w-full truncate rounded border px-1 py-0.5 text-left text-[10px] ${eventTone(event.kind)}`} title={event.title}>
                          {event.confidence === "rumored" ? "? " : ""}{event.title}
                        </button>
                      ))}
                      {dayEvents.length > 3 && <span className="text-[10px] text-muted-foreground">+{dayEvents.length - 3}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("events.upcoming")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {upcoming.map((event) => (
              <div key={event.event_id} className="rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <CalendarDays className="mt-0.5 size-4 shrink-0 text-sky-400" />
                  <div className="min-w-0 flex-1">
                    <button onClick={() => openEdit(event)} className="block truncate text-left text-sm font-medium hover:underline">{event.title}</button>
                    <div className="text-xs text-muted-foreground">{event.starts_on} · {t(kindKey(event.kind))}</div>
                  </div>
                  {event.confidence === "rumored" && <Button size="icon-sm" variant="outline" aria-label={t("events.confirm")} onClick={() => confirmEvent(event)}><Check /></Button>}
                </div>
              </div>
            ))}
            {!eventsQuery.isLoading && upcoming.length === 0 && <p className="text-sm text-muted-foreground">{t("events.empty")}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("events.changepoints")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("events.changepointsExplain")}</p>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {recentChanges.map((row) => (
            <div key={`${row.cohort}-${row.detected_on}-${row.model_version}-${row.event_id ?? "none"}`} className={`rounded-md border p-3 ${row.unexplained ? "border-amber-500/40" : ""}`}>
              <div className="flex items-center gap-2">
                {row.unexplained ? <AlertTriangle className="size-4 text-amber-400" /> : <Badge variant="outline">{t("events.annotated")}</Badge>}
                <span className="font-medium">{row.cohort}</span>
                <span className={row.direction === "up" ? "text-emerald-400" : "text-red-400"}>{row.direction === "up" ? "↑" : "↓"}{Number(row.magnitude).toFixed(1)}%</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{row.detected_on} · {row.model_version}</div>
              {row.event_title ? <div className="mt-2 text-sm">{row.event_title}</div> : (
                <Button className="mt-2" variant="outline" size="sm" onClick={() => { setForm(promptFromChangepoint(row, t("events.breakTitle", { cohort: row.cohort, direction: row.direction }))); setSaveError(null); setDialogOpen(true); }}>
                  <Plus className="size-3.5" />{t("events.explainBreak")}
                </Button>
              )}
            </div>
          ))}
          {!changesQuery.isLoading && recentChanges.length === 0 && <p className="text-sm text-muted-foreground">{t("events.noChangepoints")}</p>}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{form.event_id == null ? t("events.add") : t("events.edit")}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="event-title">{t("events.field.title")}</Label><Input id="event-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label htmlFor="event-start">{t("events.field.starts")}</Label><Input id="event-start" type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></div>
            <div><Label htmlFor="event-end">{t("events.field.ends")}</Label><Input id="event-end" type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></div>
            <div><Label htmlFor="event-kind">{t("events.field.kind")}</Label><select id="event-kind" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MarketEventKind })}>{MARKET_EVENT_KINDS.map((kind) => <option key={kind} value={kind}>{t(kindKey(kind))}</option>)}</select></div>
            <div><Label htmlFor="event-confidence">{t("events.field.confidence")}</Label><select id="event-confidence" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value as EventConfidence })}><option value="confirmed">{t("events.confirmed")}</option><option value="rumored">{t("events.rumored")}</option></select></div>
            <div><Label htmlFor="event-scope">{t("events.field.scope")}</Label><select id="event-scope" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as MarketEventScope })}>{MARKET_EVENT_SCOPES.map((scope) => <option key={scope} value={scope}>{t(scopeKey(scope))}</option>)}</select></div>
            {form.scope === "card_list" ? <div><Label htmlFor="event-cards">{t("events.field.cards")}</Label><Input id="event-cards" value={form.card_ids} onChange={(e) => setForm({ ...form, card_ids: e.target.value })} placeholder="123, 456" /></div> : form.scope !== "global" ? <div><Label htmlFor="event-ref">{t("events.field.scopeRef")}</Label><Input id="event-ref" value={form.scope_ref} onChange={(e) => setForm({ ...form, scope_ref: e.target.value })} /></div> : <div />}
            <div className="sm:col-span-2"><Label htmlFor="event-note">{t("events.field.note")}</Label><Textarea id="event-note" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="event-source">{t("events.field.source")}</Label><div className="flex gap-2"><Input id="event-source" type="url" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} />{form.source_url && <Button variant="outline" size="icon" aria-label={t("events.openSource")} render={<a href={form.source_url} target="_blank" rel="noreferrer" />}><ExternalLink /></Button>}</div></div>
          </div>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button><Button disabled={saving} onClick={saveEvent}>{form.event_id == null ? <Plus /> : <Pencil />}{saving ? t("common.saving") : t("common.save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
