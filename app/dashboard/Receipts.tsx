"use client";

import { useCallback, useEffect, useState } from "react";
import { ImageOff, Upload, Trash2, Loader2, Paperclip, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// Generic receipt-photo gallery for any owning entity (expense, sale lot, …).
// Rows live in the polymorphic `receipts` table (migration 094) keyed by
// (owner_type, owner_id); files live in the private 'lot-receipts' bucket.
// Private bucket ⇒ previews use short-lived signed URLs. Loads lazily on open.
const BUCKET = "lot-receipts";
const ACCEPT = "image/*,application/pdf";

function isPdf(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase().endsWith(".pdf");
}

interface Receipt {
  receipt_id: number;
  storage_path: string;
  original_name: string | null;
  url: string | null;
}

export default function ReceiptsDialog({
  ownerType,
  ownerId,
  initialCount,
}: {
  ownerType: string;
  ownerId: number;
  // Attachment count from the caller's batch lookup, so the paperclip shows how
  // many files are attached WITHOUT opening the dialog (it only self-counts once
  // opened). Lists pass this; a lone dialog can omit it.
  initialCount?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [count, setCount] = useState<number | null>(initialCount ?? null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Adopt a refreshed batch count while closed; once open, our own fetch wins.
  useEffect(() => {
    if (!open && initialCount != null) setCount(initialCount);
  }, [initialCount, open]);

  const fetchReceipts = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("receipts")
      .select("receipt_id, storage_path, original_name")
      .eq("owner_type", ownerType)
      .eq("owner_id", ownerId)
      .order("uploaded_at", { ascending: false });
    const rows = (data as Omit<Receipt, "url">[]) ?? [];
    setCount(rows.length);
    const withUrls = await Promise.all(rows.map(async (r) => {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
      return { ...r, url: s?.signedUrl ?? null };
    }));
    setReceipts(withUrls);
  }, [ownerType, ownerId]);

  useEffect(() => { if (open) fetchReceipts(); }, [open, fetchReceipts]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setUploadError(null);
    const supabase = createClient();
    const prefix = ownerType.replace(/[^a-z0-9]+/gi, "_");
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${prefix}/${ownerId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || "image/jpeg" });
      if (upErr) { failed.push(`${file.name}: ${upErr.message}`); continue; }
      const { error: insErr } = await supabase
        .from("receipts")
        .insert({ owner_type: ownerType, owner_id: ownerId, storage_path: path, original_name: file.name });
      if (insErr) failed.push(`${file.name}: ${insErr.message}`);
    }
    setBusy(false);
    if (failed.length) setUploadError(failed.join(" · "));
    await fetchReceipts();
  }

  async function remove(r: Receipt) {
    const supabase = createClient();
    await supabase.storage.from(BUCKET).remove([r.storage_path]);
    await supabase.from("receipts").delete().eq("receipt_id", r.receipt_id);
    await fetchReceipts();
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-muted-foreground"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={t("trips.receipts")}
      >
        <Paperclip className="size-3.5" />
        {count != null && count > 0 ? count : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t("trips.receipts")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className={`inline-flex w-fit cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent ${busy ? "pointer-events-none opacity-60" : ""}`}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {t("trips.uploadReceipt")}
              <input type="file" accept={ACCEPT} multiple className="hidden" disabled={busy} onChange={(e) => upload(e.target.files)} />
            </label>
            {uploadError && <p role="alert" className="text-xs text-destructive">{uploadError}</p>}
            {receipts.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("trips.noReceipts")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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
        </DialogContent>
      </Dialog>
    </>
  );
}
