"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Save, Plus, Trash2, Loader2 } from "lucide-react";

// AutoApproveModal — per-(buyer, kind) threshold config + preview + run
// trigger for slice 5a of Phase C. Reads image_curation_auto_approve_config
// via a plain SELECT and preview_auto_approve() via RPC so the "would
// auto-approve N" column stays live as the reviewer edits thresholds.
// Save UPSERTs each row; Run calls run_auto_approve() and shows a summary
// toast.
//
// v1 has no calibration UI — precision_estimate / sample_size / computed_at
// are just displayed read-only once slice 5b populates them.
type Kind = "singles" | "sealed";

interface ConfigRow {
  buyer_handle: string;
  product_kind: Kind;
  threshold: number;         // 0..1
  enabled: boolean;
  precision_estimate: number | null;
  sample_size: number | null;
  computed_at: string | null;
  // Local UI-only fields — not persisted.
  _dirty?: boolean;
  _new?: boolean;
  _removed?: boolean;
}

interface PreviewRow {
  buyer_handle: string;
  product_kind: Kind;
  threshold: number;
  would_promote: number;
  currently_pending: number;
}

function key(r: { buyer_handle: string; product_kind: string }) {
  return `${r.buyer_handle}::${r.product_kind}`;
}

export function AutoApproveModal({ open, onOpenChange, onRunComplete }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRunComplete?: () => void;
}) {
  const { t } = useTranslation();
  const supabase = createClient();
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<{ s: number; se: number; used: number } | null>(null);

  // New-row form state.
  const [newBuyer, setNewBuyer] = useState("");
  const [newKind, setNewKind] = useState<Kind>("singles");
  const [newThreshold, setNewThreshold] = useState("0.95");

  const load = useCallback(async () => {
    setError(null);
    setRunSummary(null);
    const { data: cfg, error: e1 } = await supabase
      .from("image_curation_auto_approve_config")
      .select("buyer_handle, product_kind, threshold, enabled, precision_estimate, sample_size, computed_at")
      .order("buyer_handle");
    if (e1) { setError(e1.message); return; }
    setRows(((cfg as ConfigRow[]) ?? []).map((r) => ({ ...r })));

    const { data: prev, error: e2 } = await supabase.rpc("preview_auto_approve");
    if (e2) { setError(e2.message); return; }
    setPreview((prev as PreviewRow[]) ?? []);
  }, [supabase]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const previewMap = new Map<string, PreviewRow>(preview.map((p) => [key(p), p]));

  function updateRow(k: string, patch: Partial<ConfigRow>) {
    setRows((rs) => rs.map((r) => key(r) === k ? { ...r, ...patch, _dirty: true } : r));
  }
  function removeRow(k: string) {
    setRows((rs) => rs.map((r) => key(r) === k ? { ...r, _removed: true } : r));
  }
  function addRow() {
    if (!newBuyer.trim()) { setError("Buyer handle required."); return; }
    const th = parseFloat(newThreshold);
    if (Number.isNaN(th) || th < 0 || th > 1) { setError("Threshold must be between 0 and 1."); return; }
    const kk = key({ buyer_handle: newBuyer.trim(), product_kind: newKind });
    if (rows.some((r) => key(r) === kk && !r._removed)) {
      setError("That (buyer, kind) already exists — edit the existing row.");
      return;
    }
    setError(null);
    setRows((rs) => [
      ...rs,
      { buyer_handle: newBuyer.trim(), product_kind: newKind, threshold: th, enabled: false,
        precision_estimate: null, sample_size: null, computed_at: null,
        _new: true, _dirty: true },
    ]);
    setNewBuyer("");
    setNewThreshold("0.95");
  }

  async function saveAll() {
    setSaving(true); setError(null); setRunSummary(null);
    try {
      const upserts = rows.filter((r) => (r._dirty || r._new) && !r._removed).map((r) => ({
        buyer_handle: r.buyer_handle, product_kind: r.product_kind,
        threshold: r.threshold, enabled: r.enabled,
      }));
      const deletes = rows.filter((r) => r._removed && !r._new);

      if (upserts.length) {
        const { error: e } = await supabase.from("image_curation_auto_approve_config").upsert(upserts);
        if (e) throw e;
      }
      for (const d of deletes) {
        const { error: e } = await supabase.from("image_curation_auto_approve_config")
          .delete().eq("buyer_handle", d.buyer_handle).eq("product_kind", d.product_kind);
        if (e) throw e;
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true); setError(null); setRunSummary(null);
    try {
      const { data, error: e } = await supabase.rpc("run_auto_approve");
      if (e) throw e;
      // Postgres returns [{ singles_promoted, sealed_promoted, config_rows_used }].
      const first = Array.isArray(data) ? data[0] : data;
      setRunSummary({
        s: (first?.singles_promoted as number) ?? 0,
        se: (first?.sealed_promoted as number) ?? 0,
        used: (first?.config_rows_used as number) ?? 0,
      });
      await load();
      onRunComplete?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const dirty = rows.some((r) => r._dirty || r._removed || r._new);
  const totalWouldPromote = rows.reduce((sum, r) => {
    if (r._removed || !r.enabled) return sum;
    const p = previewMap.get(key(r));
    return sum + (p?.would_promote ?? 0);
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("curation.autoApprove.title")}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{t("curation.autoApprove.hint")}</p>

        <div className="max-h-96 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">{t("curation.autoApprove.colBuyer")}</th>
                <th className="px-2 py-1 text-left">{t("curation.autoApprove.colKind")}</th>
                <th className="px-2 py-1 text-left">{t("curation.autoApprove.colThreshold")}</th>
                <th className="px-2 py-1 text-left">{t("curation.autoApprove.colEnabled")}</th>
                <th className="px-2 py-1 text-right">{t("curation.autoApprove.colWouldPromote")}</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => !r._removed).length === 0 && (
                <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">{t("curation.autoApprove.emptyRows")}</td></tr>
              )}
              {rows.filter((r) => !r._removed).map((r) => {
                const k = key(r);
                const p = previewMap.get(k);
                return (
                  <tr key={k} className="border-t">
                    <td className="px-2 py-1 font-mono">{r.buyer_handle}</td>
                    <td className="px-2 py-1">{r.product_kind}</td>
                    <td className="px-2 py-1">
                      <Input type="number" min={0} max={1} step={0.01}
                        value={r.threshold}
                        onChange={(e) => updateRow(k, { threshold: parseFloat(e.target.value) })}
                        className="h-7 w-20" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={r.enabled}
                        onChange={(e) => updateRow(k, { enabled: e.target.checked })} />
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {r.enabled ? `${p?.would_promote ?? 0} / ${p?.currently_pending ?? 0}` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button variant="ghost" size="icon" className="size-6" onClick={() => removeRow(k)}>
                        <Trash2 className="size-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Add-row form */}
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-2">
          <div>
            <div className="text-[10px] text-muted-foreground">{t("curation.autoApprove.colBuyer")}</div>
            <Input value={newBuyer} onChange={(e) => setNewBuyer(e.target.value)} placeholder="avereel" className="h-8 w-32" />
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">{t("curation.autoApprove.colKind")}</div>
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as Kind)}
              className="h-8 rounded-md border bg-background px-2 text-xs">
              <option value="singles">singles</option>
              <option value="sealed">sealed</option>
            </select>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">{t("curation.autoApprove.colThreshold")}</div>
            <Input type="number" min={0} max={1} step={0.01} value={newThreshold}
              onChange={(e) => setNewThreshold(e.target.value)} className="h-8 w-20" />
          </div>
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="size-4 mr-1" />{t("curation.autoApprove.addRow")}
          </Button>
        </div>

        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
        {runSummary && (
          <div className="rounded-md border border-green-500/50 bg-green-500/10 p-2 text-xs text-green-700 dark:text-green-400">
            {t("curation.autoApprove.runResult", { s: runSummary.s, se: runSummary.se, used: runSummary.used })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={!dirty || saving || running} onClick={saveAll}>
            {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : <Save className="size-4 mr-1" />}
            {t("curation.autoApprove.save")}
          </Button>
          <Button size="sm" disabled={saving || running || totalWouldPromote === 0} onClick={runNow}>
            {running ? <Loader2 className="size-4 animate-spin mr-1" /> : <Play className="size-4 mr-1" />}
            {t("curation.autoApprove.runNow", { n: totalWouldPromote })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
