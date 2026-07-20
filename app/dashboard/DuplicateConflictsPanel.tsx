"use client";

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";

type ConflictRow = {
  game: string;
  price_type: string;
  location_id: number;
  conflict_key: string;
  card_id: number | null;
  members: string[] | null;
  member_count: number;
  first_seen_on: string;
};

/**
 * DuplicateConflictsPanel surfaces malignant duplicate conflicts as curation work.
 *
 * These used to abort an entire source's populate and report only to a text file
 * in the data repo - which is how two sources sat ~18 days stale unnoticed. Now
 * the populate skips just the ambiguous keys and publishes them here, so the
 * ambiguity is visible and fixable instead of silently freezing a source.
 *
 * A conflict means two rows the catalog cannot tell apart collapsed onto one
 * card at the same location/condition/grade - usually different printings the
 * catalog does not split yet. The fix is a catalog split, not a price edit.
 */
export function DuplicateConflictsPanel() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ConflictRow[]>([]);
  const [names, setNames] = useState<Map<number, string>>(new Map());

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("listing_duplicate_conflicts")
      .select("*")
      .order("member_count", { ascending: false })
      .limit(100);
    const list = (data ?? []) as ConflictRow[];
    setRows(list);

    if (list.length > 0) {
      const ids = [...new Set(list.map((r) => r.location_id))];
      const { data: locs } = await supabase
        .from("locations")
        .select("location_id,name")
        .in("location_id", ids);
      setNames(new Map((locs ?? []).map((l: { location_id: number; name: string }) => [l.location_id, l.name])));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Absence is the default: no conflicts, no panel.
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        {t("conflicts.title")} <span className="text-muted-foreground">({rows.length})</span>
      </h3>
      <p className="text-muted-foreground text-xs">{t("conflicts.explain")}</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.location_id}:${r.price_type}:${r.conflict_key}`} className="border-b align-top last:border-0">
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  {names.get(r.location_id) ?? r.location_id}
                  <span className="text-muted-foreground ml-1 font-normal">{r.price_type}</span>
                </td>
                <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                  {r.card_id ? `card ${r.card_id}` : r.conflict_key}
                </td>
                <td className="px-3 py-2">
                  {(r.members ?? []).map((m, i) => (
                    <div key={i} className="text-muted-foreground">
                      {m}
                    </div>
                  ))}
                </td>
                <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                  {t("conflicts.since", { date: r.first_seen_on })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
