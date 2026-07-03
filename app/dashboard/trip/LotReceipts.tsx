"use client";

import { useCallback, useEffect, useState } from "react";
import { ImageOff, Upload, Trash2, Loader2, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Label } from "@/components/ui/label";

// Receipt photos attached to an acquisition lot. Files live in the private
// 'lot-receipts' Storage bucket; acquisition_lot_receipts is the lot→file index
// (migration 083). Private bucket ⇒ thumbnails/links use short-lived signed URLs.
interface Receipt {
  receipt_id: number;
  storage_path: string;
  original_name: string | null;
  url: string | null;
}

const BUCKET = "lot-receipts";
const ACCEPT = "image/*,application/pdf";

function isPdf(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase().endsWith(".pdf");
}

export default function LotReceipts({ lotId }: { lotId: number }) {
  const { t } = useTranslation();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState(false);

  const fetchReceipts = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("acquisition_lot_receipts")
      .select("receipt_id, storage_path, original_name")
      .eq("lot_id", lotId)
      .order("uploaded_at", { ascending: false });
    const rows = (data as { receipt_id: number; storage_path: string; original_name: string | null }[]) ?? [];
    const withUrls = await Promise.all(rows.map(async (r) => {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
      return { ...r, url: s?.signedUrl ?? null };
    }));
    setReceipts(withUrls);
  }, [lotId]);

  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${lotId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || "image/jpeg" });
      if (upErr) { alert(upErr.message); continue; }
      const { error: insErr } = await supabase
        .from("acquisition_lot_receipts")
        .insert({ lot_id: lotId, storage_path: path, original_name: file.name });
      if (insErr) alert(insErr.message);
    }
    setBusy(false);
    await fetchReceipts();
  }

  async function remove(r: Receipt) {
    const supabase = createClient();
    await supabase.storage.from(BUCKET).remove([r.storage_path]);
    await supabase.from("acquisition_lot_receipts").delete().eq("receipt_id", r.receipt_id);
    await fetchReceipts();
  }

  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{t("trips.receipts")}</Label>
        <label className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {t("trips.uploadReceipt")}
          <input type="file" accept={ACCEPT} multiple className="hidden" disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      </div>
      {receipts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("trips.noReceipts")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
          {receipts.map((r) => (
            <div key={r.receipt_id} className="group relative aspect-square overflow-hidden rounded-md border bg-background">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" title={r.original_name ?? ""} className="block size-full">
                  {isPdf(r.original_name) ? (
                    <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center">
                      <FileText className="size-6 text-muted-foreground" />
                      <span className="line-clamp-2 break-all text-[10px] text-muted-foreground">{r.original_name}</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.url} alt={r.original_name ?? "receipt"} loading="lazy" className="size-full object-cover" />
                  )}
                </a>
              ) : (
                <div className="flex size-full items-center justify-center"><ImageOff className="size-6 text-muted-foreground" /></div>
              )}
              <button onClick={() => remove(r)} title={t("trips.delete")}
                className="absolute right-1 top-1 rounded bg-black/60 p-1 opacity-0 transition group-hover:opacity-100">
                <Trash2 className="size-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
