"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// #6: per lot-line consignment control. Self-contained - it reads and writes the
// consignment fields (000243: consignee + consignment sale) for one lot line, so
// LotManager only has to render it. game is 'pokemon' | 'mtg' | 'pokemon_sealed'
// (the RPCs and the lot_lines tables key on that).
const LINE_TABLE: Record<string, string> = {
  pokemon: "pokemon_lot_lines",
  mtg: "mtg_lot_lines",
  pokemon_sealed: "pokemon_sealed_lot_lines",
};

interface State {
  consignee: string | null;
  consignedQty: number;
  soldAt: string | null;
  saleUsd: number | null;
  feeUsd: number | null;
}

export default function ConsignmentControl({
  game,
  lineId,
  qtyRemaining,
}: {
  game: string;
  lineId: number;
  qtyRemaining: number | null | undefined;
}) {
  const { t } = useTranslation();
  const [st, setSt] = useState<State | null>(null);
  const [mode, setMode] = useState<"none" | "consign" | "sale">("none");
  const [saving, setSaving] = useState(false);
  // form drafts
  const [consignee, setConsignee] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");

  const table = LINE_TABLE[game];

  const load = useCallback(async () => {
    if (!table) return;
    const { data } = await createClient()
      .from(table)
      .select("consignee, consigned_qty, consignment_sold_at, consignment_sale_usd, consignment_fee_usd")
      .eq("line_id", lineId)
      .maybeSingle();
    const row = data as {
      consignee: string | null; consigned_qty: number | null;
      consignment_sold_at: string | null; consignment_sale_usd: number | string | null;
      consignment_fee_usd: number | string | null;
    } | null;
    setSt({
      consignee: row?.consignee ?? null,
      consignedQty: Number(row?.consigned_qty ?? 0),
      soldAt: row?.consignment_sold_at ?? null,
      saleUsd: row?.consignment_sale_usd != null ? Number(row.consignment_sale_usd) : null,
      feeUsd: row?.consignment_fee_usd != null ? Number(row.consignment_fee_usd) : null,
    });
  }, [table, lineId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setSaving(true);
    try {
      const { error } = await fn();
      if (error) { console.error("consignment:", error); return; }
      setMode("none");
      await load();
    } finally { setSaving(false); }
  };

  if (!table || !st) return null;

  const active = !!st.consignee && st.consignedQty > 0;
  const sold = !!st.soldAt;
  const supabase = () => createClient();

  return (
    <div className="text-xs">
      {active ? (
        <div className="space-y-0.5">
          <div className="font-medium">
            {t("consign.toLabel", { consignee: st.consignee ?? "", qty: st.consignedQty })}
          </div>
          {sold ? (
            <div className="text-muted-foreground">
              {t("consign.soldFor", { amount: `$${(st.saleUsd ?? 0).toFixed(2)}` })}
              {st.feeUsd ? ` (${t("consign.net", { amount: `$${((st.saleUsd ?? 0) - (st.feeUsd ?? 0)).toFixed(2)}` })})` : ""}
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="text-primary underline disabled:opacity-50" disabled={saving} onClick={() => setMode(mode === "sale" ? "none" : "sale")}>
                {t("consign.recordSale")}
              </button>
              <button type="button" className="text-muted-foreground underline disabled:opacity-50" disabled={saving} onClick={() => run(() => supabase().rpc("clear_line_consignment", { p_game: game, p_lot_line_id: lineId }))}>
                {t("consign.clear")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button type="button" className="text-primary underline disabled:opacity-50" disabled={saving} onClick={() => setMode(mode === "consign" ? "none" : "consign")}>
          {t("consign.consign")}
        </button>
      )}

      {mode === "consign" && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Input className="h-7 w-28" placeholder={t("consign.consignee")} value={consignee} onChange={(e) => setConsignee(e.target.value)} />
          <Input className="h-7 w-14" type="number" min={1} max={qtyRemaining ?? undefined} value={qty} onChange={(e) => setQty(e.target.value)} title={t("consign.qty")} />
          <Button size="sm" className="h-7" disabled={saving || !consignee.trim()} onClick={() => run(() => supabase().rpc("consign_line", { p_game: game, p_lot_line_id: lineId, p_consigned_qty: Number(qty) || 1, p_consignee: consignee.trim() }))}>
            {t("common.save")}
          </Button>
        </div>
      )}

      {mode === "sale" && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Input className="h-7 w-20" type="number" step="0.01" placeholder={t("consign.price")} value={price} onChange={(e) => setPrice(e.target.value)} />
          <Input className="h-7 w-20" type="number" step="0.01" placeholder={t("consign.fee")} value={fee} onChange={(e) => setFee(e.target.value)} />
          <Button size="sm" className="h-7" disabled={saving || price === ""} onClick={() => run(() => supabase().rpc("record_line_consignment_sale", { p_game: game, p_lot_line_id: lineId, p_sale_usd: Number(price), p_fee_usd: Number(fee) || 0 }))}>
            {t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
