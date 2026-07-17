"use client";

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { selectAll, chunkIds } from "@/lib/supabase/select-all";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Minimal RFC-4180-ish CSV parser (handles quoted fields, embedded commas,
// doubled quotes, CRLF). Good enough for Collectr portfolio exports.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\(jp\)/g, "").replace(/[^a-z0-9]/g, "");

interface PreviewRow {
  idx: number;
  collectrName: string;
  number: string;
  grade: number;
  qty: number;
  marketUsd: number;
  cardId: number | null;
  matchName: string | null;
  include: boolean;
}

const MAX_RENDER = 600;

export function CollectrImportDialog({
  open, onClose, lotId, onImported,
}: {
  open: boolean;
  onClose: () => void;
  lotId: number;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true); setError(null); setDone(null); setRows([]);
    try {
      const text = await file.text();
      const grid = parseCSV(text);
      if (grid.length < 2) { setError(t("trips.csvParseError")); setBusy(false); return; }
      const header = grid[0];
      const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase().startsWith(name.toLowerCase()));
      const iCat = col("Category"), iName = col("Product Name"), iNum = col("Card Number"),
        iGrade = col("Grade"), iQty = col("Quantity"), iMarket = col("Market Price");

      const parsed: Omit<PreviewRow, "cardId" | "matchName" | "include">[] = [];
      let skip = 0;
      for (let r = 1; r < grid.length; r++) {
        const cells = grid[r];
        if (cells.length < header.length) continue;
        if (iCat >= 0 && cells[iCat]?.trim() && cells[iCat].trim().toLowerCase() !== "pokemon") { skip++; continue; }
        const gradeMatch = (cells[iGrade] ?? "").match(/PSA\s*([0-9]+)/i);
        parsed.push({
          idx: r,
          collectrName: cells[iName] ?? "",
          number: (cells[iNum] ?? "").trim(),
          grade: gradeMatch ? Number(gradeMatch[1]) : 0,
          qty: Math.max(1, Math.floor(Number(cells[iQty]) || 1)),
          marketUsd: Math.round((Number(cells[iMarket]) || 0) * 100) / 100,
        });
      }
      setSkipped(skip);

      // Batch-resolve candidates by card_number, then disambiguate by name.
      const supabase = createClient();
      const numbers = [...new Set(parsed.map((p) => p.number).filter(Boolean))];
      const candidates = new Map<string, { card_id: number; regional_name: string; english_name: string | null }[]>();
      // Chunking bounds the NUMBERS per request, not the rows they return:
      // card_number is far from unique (avg ~2.47 defs per number, and the era
      // marker 旧裏 alone owns 1,295), so a 200-number chunk can ask for
      // thousands of rows and PostgREST silently caps the answer at 1000.
      // A truncated chunk is worse than a missing one here: it hands the
      // matcher below a PARTIAL candidate list, so the exact-name match that
      // should win is absent and the `cands[0]` fallback attaches a WRONG
      // card_id to the lot line. selectAll pages until the chunk is complete
      // (and throws on error, which the bare `data` destructure used to eat).
      for (const chunk of chunkIds(numbers, 200)) {
        const data = await selectAll<{ card_id: number; regional_name: string; english_name: string | null; card_number: string }>(
          () => supabase
            .from("pokemon_card_definitions")
            .select("card_id, regional_name, english_name, card_number")
            .in("card_number", chunk),
          ["card_id"], // the PK: a total order, so paging can't drop or repeat a def
        );
        for (const d of data) {
          const list = candidates.get(d.card_number) ?? [];
          list.push(d);
          candidates.set(d.card_number, list);
        }
      }

      const out: PreviewRow[] = parsed.map((p) => {
        const cands = candidates.get(p.number) ?? [];
        const n = norm(p.collectrName);
        const hit =
          cands.find((c) => norm(c.regional_name) === n || (c.english_name && norm(c.english_name) === n)) ??
          cands.find((c) => norm(c.regional_name).includes(n) || n.includes(norm(c.regional_name))) ??
          cands[0] ?? null;
        return {
          ...p,
          cardId: hit?.card_id ?? null,
          matchName: hit ? `${hit.regional_name}` : null,
          include: !!hit,
        };
      });
      setRows(out);
    } catch {
      setError(t("trips.csvParseError"));
    }
    setBusy(false);
  }, [t]);

  async function confirmImport() {
    setBusy(true); setError(null);
    const supabase = createClient();
    const { data: cond } = await supabase
      .from("conditions").select("condition_id").eq("standard", "tcgplayer").eq("code", "NM").single();
    const conditionId = (cond as { condition_id: number } | null)?.condition_id ?? 1;
    const chosen = rows.filter((r) => r.include && r.cardId);
    const payload = chosen.map((r) => ({
      lot_id: lotId, card_id: r.cardId, condition_id: conditionId, psa_grade: r.grade,
      quantity: r.qty, price_override_usd: null, market_value_usd: r.marketUsd || null,
    }));
    // Bulk insert (chunked) — one request per ~500 rows instead of one per card,
    // so it's fast and effectively all-or-nothing rather than a slow, partial loop.
    for (let i = 0; i < payload.length; i += 500) {
      const { error: insErr } = await supabase.from("pokemon_lot_lines").insert(payload.slice(i, i + 500));
      if (insErr) { setBusy(false); setError(insErr.message); return; }
    }
    setBusy(false);
    setDone(chosen.length);
    onImported();
  }

  const matchedCount = rows.filter((r) => r.cardId).length;
  const includeCount = rows.filter((r) => r.include && r.cardId).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("trips.csvImportTitle")}</DialogTitle>
          <DialogDescription>{t("trips.csvPick")}</DialogDescription>
        </DialogHeader>

        {done !== null ? (
          <p className="py-4 text-sm">{t("trips.csvDone", { n: done })}</p>
        ) : (
          <div className="space-y-3">
            <input
              type="file" accept=".csv,text/csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("trips.csvParsing")}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}

            {rows.length > 0 && (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <span>{t("trips.csvRowsSummary", { matched: matchedCount, total: rows.length })}</span>
                  {skipped > 0 && <span className="text-muted-foreground">{t("trips.csvNonPokemon", { n: skipped })}</span>}
                </div>
                <div className="max-h-80 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">{t("trips.csvInclude")}</TableHead>
                        <TableHead>{t("trips.csvColRow")}</TableHead>
                        <TableHead>{t("trips.csvColMatch")}</TableHead>
                        <TableHead className="w-14">{t("trips.qty")}</TableHead>
                        <TableHead className="w-20">{t("trips.csvColMarket")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, MAX_RENDER).map((r) => (
                        <TableRow key={r.idx} className={r.cardId ? "" : "opacity-60"}>
                          <TableCell>
                            <input
                              type="checkbox" checked={r.include} disabled={!r.cardId}
                              onChange={(e) => setRows((prev) => prev.map((x) => x.idx === r.idx ? { ...x, include: e.target.checked } : x))}
                            />
                          </TableCell>
                          <TableCell className="truncate max-w-[220px]">
                            {r.collectrName} <span className="text-muted-foreground">{r.number}{r.grade ? ` · PSA ${r.grade}` : ""}</span>
                          </TableCell>
                          <TableCell className="truncate max-w-[200px]">
                            {r.matchName ?? <span className="text-destructive">{t("trips.csvNoMatch")}</span>}
                          </TableCell>
                          <TableCell>{r.qty}</TableCell>
                          <TableCell>${r.marketUsd}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {rows.length > MAX_RENDER && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">+{rows.length - MAX_RENDER} more (all matched rows import)</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t("trips.cancel")}</Button>
          {done === null && (
            <Button disabled={busy || includeCount === 0} onClick={confirmImport}>
              {t("trips.csvAddLines", { n: includeCount })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
