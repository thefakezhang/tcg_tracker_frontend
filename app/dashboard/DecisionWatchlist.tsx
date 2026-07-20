"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { useTranslation } from "@/lib/i18n";
import { useLanguage } from "./LanguageContext";

interface WatchedDeal {
  rule_id: number;
  card_id: number;
  psa_grade: number;
  decided_at: string;
  flagged_price: number | null;
  flagged_currency: string | null;
  current_price: number | null;
  current_currency: string | null;
  current_observed_on: string | null;
  reason: string | null;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string | null;
  image_url: string | null;
}

function price(value: number | null, currency: string | null) {
  if (value == null) return "-";
  return `${currency === "JPY" ? "¥" : currency === "USD" ? "$" : ""}${Number(value).toLocaleString()}${currency && currency !== "JPY" && currency !== "USD" ? ` ${currency}` : ""}`;
}

export default function DecisionWatchlist() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [rows, setRows] = useState<WatchedDeal[]>([]);

  useEffect(() => {
    const supabase = createClient();
    selectAll<WatchedDeal>(
      () => supabase.from("active_deal_watchlist_v").select("*") ,
      ["rule_id"],
    ).then(setRows).catch((error) => console.error("Failed to load watchlist:", error));
  }, []);

  if (rows.length === 0) {
    return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t("decision.emptyWatchlist")}</div>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => {
        const comparable = row.flagged_price != null && row.current_price != null && row.flagged_currency === row.current_currency;
        const movement = comparable ? row.current_price! - row.flagged_price! : null;
        return (
          <article key={row.rule_id} className="flex gap-3 rounded-lg border bg-card p-3">
            {row.image_url ? <img src={row.image_url} alt="" className="h-24 w-16 rounded object-cover" /> : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="truncate font-medium">{language === "en" && row.english_name ? row.english_name : row.regional_name}</h3>
                  <p className="text-xs text-muted-foreground">{row.set_code} {row.card_number} · {row.psa_grade === 0 ? t("evidence.raw") : `PSA ${row.psa_grade}`}</p>
                </div>
                <Badge variant="outline"><Eye className="size-3" />{t("decision.watching")}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-[10px] uppercase text-muted-foreground">{t("decision.flagged")}</div><div className="font-medium">{price(row.flagged_price, row.flagged_currency)}</div><div className="text-[10px] text-muted-foreground">{new Date(row.decided_at).toLocaleDateString(language)}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">{t("decision.now")}</div><div className="flex items-center gap-1 font-medium">{price(row.current_price, row.current_currency)}{movement != null && movement > 0 ? <ArrowUpRight className="size-3 text-emerald-500" /> : movement != null && movement < 0 ? <ArrowDownRight className="size-3 text-rose-500" /> : null}</div><div className="text-[10px] text-muted-foreground">{row.current_observed_on ? new Date(`${row.current_observed_on}T00:00:00`).toLocaleDateString(language) : "-"}</div></div>
              </div>
              {row.reason ? <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{row.reason}</p> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
