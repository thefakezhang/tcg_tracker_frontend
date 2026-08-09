"use client";

import { useMemo, useState } from "react";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  parseCsv, detectColumns, parseCollectionRows,
  type ColumnMap, type TcgField,
} from "./tcgplayer-collection-csv";
import { matchCollectionRow, type MatchableHolding } from "./tcgplayer-collection-match";

export interface TcgImportEntry {
  holdingKey: string;
  qty: number;
  priceUsd: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holdings: MatchableHolding[];
  onImport: (entries: TcgImportEntry[]) => void;
}

const FIELDS: TcgField[] = ["quantity", "name", "set", "number", "condition", "printing", "price"];
const FIELD_LABEL: Record<TcgField, TranslationKey> = {
  quantity: "trips.tcgCsvField.quantity",
  name: "trips.tcgCsvField.name",
  set: "trips.tcgCsvField.set",
  number: "trips.tcgCsvField.number",
  condition: "trips.tcgCsvField.condition",
  printing: "trips.tcgCsvField.printing",
  price: "trips.tcgCsvField.price",
};
const MAX_RENDER = 600;

export default function TcgplayerImportDialog({ open, onOpenChange, holdings, onImport }: Props) {
  const { t } = useTranslation();
  const [header, setHeader] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<string[][]>([]);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setHeader([]); setMatrix([]); setMap(null); setExcluded(new Set()); setError(null); };

  const handleFile = async (file: File) => {
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) { setError(t("trips.tcgCsvEmpty")); return; }
      setMatrix(parsed);
      setHeader(parsed[0]);
      setMap(detectColumns(parsed[0]));
      setExcluded(new Set());
      setError(null);
    } catch {
      setError(t("trips.tcgCsvUnreadable"));
    }
  };

  const rows = useMemo(() => (map ? parseCollectionRows(matrix, map) : []), [matrix, map]);
  const previews = useMemo(
    () => rows.map((row) => ({ row, match: matchCollectionRow(row, holdings) })),
    [rows, holdings],
  );
  const counts = useMemo(() => ({
    matched: previews.filter((p) => p.match.status === "matched").length,
    ambiguous: previews.filter((p) => p.match.status === "ambiguous").length,
    none: previews.filter((p) => p.match.status === "none").length,
  }), [previews]);

  const includable = previews.filter((p) => p.match.status === "matched" && !excluded.has(p.row.rowIndex));

  const confirm = () => {
    const entries: TcgImportEntry[] = includable.map((p) => ({
      holdingKey: p.match.holding!.key,
      qty: Math.max(1, Math.min(p.row.quantity, p.match.holding!.qty_on_hand)),
      priceUsd: p.row.priceUsd,
    }));
    onImport(entries);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("trips.tcgCsvTitle")}</DialogTitle>
          <DialogDescription>{t("trips.tcgCsvHelp")}</DialogDescription>
        </DialogHeader>

        <input
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:bg-muted file:px-3"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
        />

        {error && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        {map && (
          <>
            {/* Column mapping - editable so an unusual export still lines up. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FIELDS.map((field) => (
                <label key={field} className="text-xs">
                  <span className="text-muted-foreground">{t(FIELD_LABEL[field])}</span>
                  <select
                    className="mt-1 min-h-11 w-full rounded-md border bg-background px-2 text-sm sm:min-h-8"
                    value={map[field]}
                    onChange={(e) => setMap({ ...map, [field]: Number(e.target.value) })}
                  >
                    <option value={-1}>{t("trips.tcgCsvUnmapped")}</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
              <span className="text-emerald-600 dark:text-emerald-400">{t("trips.tcgCsvMatched", { n: counts.matched })}</span>
              <span className="text-amber-600 dark:text-amber-400">{t("trips.tcgCsvAmbiguous", { n: counts.ambiguous })}</span>
              <span>{t("trips.tcgCsvUnmatched", { n: counts.none })}</span>
            </div>

            <div className="max-h-80 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>{t("trips.tcgCsvColCard")}</TableHead>
                    <TableHead className="w-16">{t("trips.saleQty")}</TableHead>
                    <TableHead className="w-20">{t("trips.tcgCsvColPrice")}</TableHead>
                    <TableHead>{t("trips.tcgCsvColMatch")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previews.slice(0, MAX_RENDER).map(({ row, match }) => {
                    const on = match.status === "matched" && !excluded.has(row.rowIndex);
                    return (
                      <TableRow key={row.rowIndex} className={match.status !== "matched" ? "opacity-60" : undefined}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="size-4"
                            disabled={match.status !== "matched"}
                            checked={on}
                            onChange={(e) => setExcluded((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(row.rowIndex); else next.add(row.rowIndex);
                              return next;
                            })}
                          />
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{row.name}</div>
                          <div className="text-muted-foreground">{[row.set, row.number, row.condition].filter(Boolean).join(" · ")}</div>
                        </TableCell>
                        <TableCell className="tabular-nums">{row.quantity}</TableCell>
                        <TableCell className="tabular-nums">{row.priceUsd == null ? "-" : `$${row.priceUsd.toFixed(2)}`}</TableCell>
                        <TableCell className="text-xs">
                          {match.status === "matched" && (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {match.holding!.englishName || match.holding!.name}
                              <span className="block text-muted-foreground">{match.holding!.set_code} {match.holding!.card_number} · {t(match.holding!.leg === "export" ? "trips.legExport" : "trips.legImport")} · {t("inventory.ownedQty")} {match.holding!.qty_on_hand}</span>
                            </span>
                          )}
                          {match.status === "ambiguous" && <span className="text-amber-600 dark:text-amber-400">{t("trips.tcgCsvAmbiguousRow", { n: match.candidates.length })}</span>}
                          {match.status === "none" && <span className="text-muted-foreground">{t("trips.tcgCsvNoMatch")}</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {previews.length > MAX_RENDER && <p className="p-2 text-xs text-muted-foreground">{t("trips.tcgCsvTruncated", { shown: MAX_RENDER, total: previews.length })}</p>}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>{t("trips.cancel")}</Button>
          <Button disabled={includable.length === 0} onClick={confirm}>{t("trips.tcgCsvStage", { n: includable.length })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
