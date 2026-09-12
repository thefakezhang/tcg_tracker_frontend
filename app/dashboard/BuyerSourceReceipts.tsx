"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { formatMutationError } from "@/lib/mutation-error";

type PendingReceipt = {
  context: string;
  path: string;
  originalName: string;
};

// Keep an uploaded object available for registration retry. Evidence is never
// deleted to clear an error, and a retry does not upload the same bytes again.
export function BuyerSourceReceipts({
  planId, source, receiptCount, readOnly, onUploaded, onError,
}: {
  planId: number;
  source: string;
  receiptCount: number;
  readOnly: boolean;
  onUploaded: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const canonicalSource = source.trim().toLowerCase();
  const context = `${planId}/${canonicalSource}`;
  const current = useRef(context);
  current.current = context;
  const sequence = useRef(0);
  const inFlight = useRef<string | null>(null);
  const [busyContext, setBusyContext] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReceipt | null>(null);
  const receipt = pending?.context === context ? pending : null;
  const busy = busyContext === context;
  const inputId = `receipt-${planId}-${canonicalSource}`;

  useEffect(() => () => { sequence.current += 1; }, [context]);

  async function save(file?: File) {
    if (readOnly || inFlight.current === context || (!file && !receipt)) return;
    const request = ++sequence.current;
    const isCurrent = () => current.current === context && sequence.current === request;
    inFlight.current = context;
    setBusyContext(context);
    onError("");
    try {
      const supabase = createClient();
      let uploaded = receipt;
      if (file) {
        if (!Number.isSafeInteger(planId) || planId <= 0 || !/^[a-z0-9_-]+$/.test(canonicalSource)) {
          throw new Error(t("buyer.receiptInvalidDestination"));
        }
        const safeName = file.name.replace(/[^\w.\-]/g, "_");
        const path = `plan-receipts/${context}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage.from("lot-receipts").upload(path, file);
        if (!isCurrent()) return;
        if (error) throw error;
        uploaded = { context, path, originalName: file.name };
        setPending(uploaded);
      }
      if (!uploaded) return;
      const { error } = await supabase.rpc("buyer_record_source_receipt", {
        p_plan_id: planId,
        p_source: canonicalSource,
        p_storage_path: uploaded.path,
        p_original_name: uploaded.originalName,
      });
      if (!isCurrent()) return;
      if (error) throw error;
      setPending(null);
      onUploaded();
    } catch (error) {
      if (isCurrent()) onError(formatMutationError(error));
    } finally {
      if (isCurrent()) {
        inFlight.current = null;
        setBusyContext(null);
      }
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      {receiptCount > 0 && <span className="text-muted-foreground">{t("buyer.receiptCount", { count: String(receiptCount) })}</span>}
      {receipt && (
        <>
          <span role="status" className="text-muted-foreground">{t("buyer.receiptAwaitingRegistration")}</span>
          {!readOnly && (
            <button type="button" disabled={busy} onClick={() => void save()}
              className="min-h-11 rounded border px-3 hover:bg-accent disabled:opacity-50">
              {busy ? t("buyer.uploading") : t("buyer.retryReceipt")}
            </button>
          )}
        </>
      )}
      {!readOnly && !receipt && (
        <>
          <label htmlFor={inputId} className="flex min-h-11 cursor-pointer items-center rounded border px-3 hover:bg-accent sm:min-h-0 sm:px-2 sm:py-0.5">
            {busy ? t("buyer.uploading") : receiptCount ? t("buyer.addReceipt") : t("buyer.uploadReceipt")}
          </label>
          <input id={inputId} type="file" accept="image/*,application/pdf" className="hidden" disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void save(file);
            }} />
        </>
      )}
    </div>
  );
}
