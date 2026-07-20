"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";

type InFlightRow = { source: string; status: string };

const POLL_MS = 15_000;
const WINDOW_MS = 2 * 60 * 60 * 1000; // requests older than this are stale, not in flight

/**
 * RefreshInFlightStrip shows targeted-refresh work that is still outstanding
 * (redesign R6): rows the worker has not finished draining yet.
 *
 * It polls rather than subscribing - the design deliberately avoids a realtime
 * dependency - and renders NOTHING when nothing is in flight, so it never
 * occupies space just to say "idle".
 */
export function RefreshInFlightStrip() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<InFlightRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const supabase = createClient();
      const since = new Date(Date.now() - WINDOW_MS).toISOString();
      const { data } = await supabase
        .from("refresh_requests")
        .select("source,status")
        .in("status", ["pending", "running"])
        .gte("requested_at", since)
        .limit(500);
      if (!cancelled) setRows((data ?? []) as InFlightRow[]);
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (rows.length === 0) return null;

  // Per-source counts read better than a flat total: it shows which shop is slow.
  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  const summary = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, n]) => `${source} ${n}`)
    .join(", ");

  return (
    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <LoaderCircle className="size-3.5 animate-spin" />
      <span>
        {t("refreshPrices.inFlight")}: {summary}
      </span>
    </div>
  );
}
