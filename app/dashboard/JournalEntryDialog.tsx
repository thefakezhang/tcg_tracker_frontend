"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSaving } from "@/lib/use-saving";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";

const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

export interface GlAccount {
  account_id: number;
  code: string;
  name: string;
  type: string;
  is_cash: boolean;
  is_owner: boolean;
}

type Mode = "contribution" | "draw" | "transfer" | "custom";

// Post a balanced double-entry journal entry. The guided modes build the two legs
// so they always balance; "custom" lets you pick both sides.
export default function JournalEntryDialog({
  accounts, open, onOpenChange, onPosted,
}: {
  accounts: GlAccount[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPosted: () => void;
}) {
  const { t } = useTranslation();
  const { saving, save } = useSaving();
  const [mode, setMode] = useState<Mode>("contribution");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [acctA, setAcctA] = useState<number | "">("");
  const [acctB, setAcctB] = useState<number | "">("");

  const cash = accounts.filter((a) => a.is_cash);
  const ownerCapital = accounts.find((a) => a.code === "3000");
  const ownerDraws = accounts.find((a) => a.code === "3010");

  // Which accounts populate each dropdown for the current mode.
  const optsA = mode === "custom" ? accounts : cash;
  const optsB = mode === "custom" ? accounts : cash;

  // Seed sensible defaults when the dialog opens or the mode changes.
  useEffect(() => {
    if (!open) return;
    setAcctA(optsA[0]?.account_id ?? "");
    setAcctB(optsB.find((a) => a.account_id !== optsA[0]?.account_id)?.account_id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  function buildLines(amt: number): { account_id: number; amount_usd: number }[] | null {
    const A = Number(acctA), B = Number(acctB);
    if (mode === "contribution") {
      if (!A || !ownerCapital) return null;
      return [{ account_id: A, amount_usd: amt }, { account_id: ownerCapital.account_id, amount_usd: -amt }];
    }
    if (mode === "draw") {
      if (!A || !ownerDraws) return null;
      return [{ account_id: ownerDraws.account_id, amount_usd: amt }, { account_id: A, amount_usd: -amt }];
    }
    // transfer / custom: A is the debit side, B the credit side
    if (!A || !B || A === B) return null;
    return [{ account_id: A, amount_usd: amt }, { account_id: B, amount_usd: -amt }];
  }

  async function post() {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    const lines = buildLines(amt);
    if (!lines) return;
    const source =
      mode === "contribution" ? "capital" : mode === "draw" ? "draw" : mode === "transfer" ? "transfer" : "manual";
    const supabase = createClient();
    const ok = await save(async () =>
      supabase.rpc("gl_post_entry", {
        p_date: date, p_memo: memo || null, p_source: source, p_trip_id: null, p_lines: lines,
      })
    );
    if (!ok) return;
    setAmount(""); setMemo("");
    onOpenChange(false);
    onPosted();
  }

  // Labels for the two account pickers, per mode.
  const labelA =
    mode === "contribution" ? t("gl.intoAccount")
    : mode === "draw" ? t("gl.fromAccount")
    : mode === "transfer" ? t("gl.fromAccount")
    : t("gl.debit");
  const showB = mode === "transfer" || mode === "custom";
  const labelB = mode === "transfer" ? t("gl.toAccount") : t("gl.credit");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{t("gl.newEntry")}</DialogTitle></DialogHeader>
        <FieldGroup>
          <Field>
            <Label>{t("gl.entryType")}</Label>
            <select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="contribution">{t("gl.typeContribution")}</option>
              <option value="draw">{t("gl.typeDraw")}</option>
              <option value="transfer">{t("gl.typeTransfer")}</option>
              <option value="custom">{t("gl.typeCustom")}</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {mode === "contribution" ? t("gl.hintContribution")
                : mode === "draw" ? t("gl.hintDraw")
                : mode === "transfer" ? t("gl.hintTransfer")
                : t("gl.hintCustom")}
            </p>
          </Field>
          <Field>
            <Label>{labelA}</Label>
            <select className={selectClass} value={acctA} onChange={(e) => setAcctA(e.target.value ? Number(e.target.value) : "")}>
              {optsA.map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
            </select>
          </Field>
          {showB && (
            <Field>
              <Label>{labelB}</Label>
              <select className={selectClass} value={acctB} onChange={(e) => setAcctB(e.target.value ? Number(e.target.value) : "")}>
                {optsB.map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field>
            <Label>{t("gl.amount")}</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field>
            <Label>{t("trips.expenseDate")}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field>
            <Label>{t("gl.memo")}</Label>
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t("gl.memoPlaceholder")} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("trips.cancel")}</Button>
          <Button disabled={!amount || Number(amount) <= 0 || saving} onClick={post}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : t("gl.post")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
