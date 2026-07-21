"use client";

import { useCallback } from "react";
import { CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery } from "./use-query";
import type { MarketEventRow } from "./market-events";

function offsetDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function UpcomingEventsStrip() {
  const { t } = useTranslation();
  const fetchUpcoming = useCallback(async (): Promise<MarketEventRow[]> => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("market_events")
      .select("event_id, starts_on, ends_on, kind, scope, scope_ref, card_ids, title, note, source_url, confidence, source_key, created_at, updated_at")
      .gte("starts_on", offsetDate(0))
      .lte("starts_on", offsetDate(90))
      .order("starts_on", { ascending: true })
      .limit(3);
    if (error) throw error;
    return (data as MarketEventRow[]) ?? [];
  }, []);
  const { data } = useSupabaseQuery("upcoming-market-events", fetchUpcoming);
  if (!data?.length) return null;

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" aria-label={t("events.upcoming")}>
      <CalendarClock className="size-3.5 shrink-0 text-sky-400" />
      {data.slice(0, 2).map((event, index) => (
        <span key={event.event_id} className={index === 1 ? "hidden min-w-0 truncate xl:inline" : "min-w-0 truncate"}>
          <span className="font-medium text-foreground">{event.starts_on.slice(5)}</span> {event.title}
        </span>
      ))}
    </div>
  );
}
