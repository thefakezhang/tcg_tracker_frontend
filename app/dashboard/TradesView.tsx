"use client";

// Recording a trade: cards out, cards in, and cash closing the gap.
//
// A trade is two sides that settle against each other. Both sides are ordinary
// rows booked through the paths that already exist - the outbound is a lot sale
// with its own FIFO and COGS, the inbound an acquisition lot with its own
// landed cost - and a trade is the record that they were one event, plus the
// assertion that they balance:
//
//     value_in = value_out + cash        (cash signed: + paid, - received)
//
// This screen used to only LINK: you built the sale and the lot by hand
// elsewhere, then picked them from two dropdowns. That was deliberate - it
// keeps a trade's outbound side realising a real gain or loss against the cards
// given up, instead of inventing a parallel way to dispose of stock - but it
// left the operator unable to record a trade at all without an engineer doing
// four steps first. For one card out and forty vintage singles in, unusable.
//
// It now RECORDS, through backend record_trade (migration 000575), which is the
// same four steps in one transaction. The principle above is intact, because
// record_trade calls record_lot_sale and finalize_acquisition_lot rather than
// writing the rows itself: the outbound side still realises a real gain or loss.
// The link-only dialog is retired; link_trade remains the backend primitive
// record_trade finishes with, and unlink_trade is still here to undo one.

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Check, Loader2, Link2Off, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { formatMutationError } from "@/lib/mutation-error";
import { signedCash, deriveValueIn, type CashDirection } from "@/lib/trades";
import {
  canRecordTrade, itemProblems, itemsInPayload, itemsOutPayload,
  type ItemProblem, type TradeGame, type TradeItemDraft,
} from "@/lib/trade-items";
import { externalIdMatches, smartSearchFilters } from "@/lib/card-search";
import { selectAll } from "@/lib/supabase/select-all";
import { formatDate } from "@/lib/dates";
import { formatUsd } from "@/lib/money";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useLanguage } from "./LanguageContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TradeRow {
  trade_id: number;
  traded_at: string;
  counterparty: string | null;
  cash_usd: number;
  sale_group: number;
  value_out_usd: number;
  lot_id: number;
  value_in_usd: number;
  balanced: boolean;
  imbalance_usd: number;
  notes: string | null;
}


type SupabaseClient = ReturnType<typeof createClient>;

export async function fetchTrades(supabase: SupabaseClient): Promise<TradeRow[]> {
  const rows = await selectAll<TradeRow>(
    () => supabase
      .from("trades_v")
      .select("trade_id, traded_at, counterparty, cash_usd, sale_group, value_out_usd, lot_id, value_in_usd, balanced, imbalance_usd, notes"),
    ["traded_at", "trade_id"],
  );
  return rows.sort((a, b) =>
    b.traded_at.localeCompare(a.traded_at) || b.trade_id - a.trade_id,
  );
}

export default function TradesView() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [unlinking, setUnlinking] = useState<number | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<number | null>(null);
  const [unlinkError, setUnlinkError] = useState<{ tradeId: number; message: string } | null>(null);

  const trades = useSupabaseQuery<TradeRow[]>("trades:list", async () => {
    return fetchTrades(createClient());
  });

  const unlink = useCallback(async (tradeId: number) => {
    setUnlinkError(null);
    setUnlinking(tradeId);
    try {
      const { error } = await createClient().rpc("unlink_trade", { p_trade_id: tradeId });
      if (error) throw error;
      await trades.retry();
    } catch (error) {
      setUnlinkError({
        tradeId,
        message: t("trades.unlinkError", { error: formatMutationError(error) }),
      });
    } finally {
      setUnlinking(null);
    }
  }, [t, trades]);

  if (trades.error) return <div className="p-4"><QueryError error={trades.error} onRetry={trades.retry} /></div>;

  const rows = trades.data ?? [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <p className="max-w-prose text-sm text-muted-foreground">{t("trades.intro")}</p>
        <Button className="min-h-12 sm:min-h-9" onClick={() => setOpen(true)}>
          <ArrowLeftRight className="size-4" aria-hidden /><span className="ml-1">{t("trades.record")}</span>
        </Button>
      </div>

      {trades.isLoading && !trades.data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <ArrowLeftRight className="size-8" aria-hidden />
          <p className="text-sm">{t("trades.empty")}</p>
          <p className="max-w-md text-xs">{t("trades.emptyHint")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.trade_id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.counterparty || t("trades.noCounterparty")}
                    <span className="ml-2 font-normal text-muted-foreground">{formatDate(r.traded_at, language)}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t("trades.sidesSummary", {
                      out: formatUsd(r.value_out_usd),
                      sale: String(r.sale_group),
                      in: formatUsd(r.value_in_usd),
                      lot: String(r.lot_id),
                    })}
                  </p>
                </div>
                {r.cash_usd !== 0 && (
                  <Badge variant="outline" className="tabular-nums">
                    {r.cash_usd > 0
                      ? t("trades.cashPaidBadge", { amount: formatUsd(r.cash_usd) })
                      : t("trades.cashReceivedBadge", { amount: formatUsd(Math.abs(r.cash_usd)) })}
                  </Badge>
                )}
                {/* Both sides are mandatory and the RPC refuses an imbalance, so a
                    false here means something drifted after the fact. Shown rather
                    than assumed away. */}
                {!r.balanced && (
                  <Badge variant="outline" className="border-destructive/50 text-destructive">
                    <TriangleAlert className="mr-1 size-3" aria-hidden />
                    {t("trades.outOfBalance", { amount: formatUsd(r.imbalance_usd) })}
                  </Badge>
                )}
                <Button variant="outline" size="sm" className="min-h-12 sm:min-h-9"
                  disabled={unlinking != null} onClick={() => setConfirmUnlink(r.trade_id)}>
                  <Link2Off className="mr-1 size-4" aria-hidden />
                  {t("trades.unlink")}
                </Button>
              </div>
              {unlinkError?.tradeId === r.trade_id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p role="alert" className="text-sm text-destructive">{unlinkError.message}</p>
                  <Button type="button" variant="outline" size="sm" className="min-h-12 sm:min-h-9" onClick={() => setConfirmUnlink(r.trade_id)}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={confirmUnlink != null} onOpenChange={(nextOpen) => {
        if (!nextOpen) setConfirmUnlink(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("trades.unlinkTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("trades.unlinkHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={unlinking != null}
              onClick={() => {
                const tradeId = confirmUnlink;
                setConfirmUnlink(null);
                if (tradeId != null) void unlink(tradeId);
              }}
            >
              {t("trades.unlink")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RecordTradeDialog open={open} onOpenChange={setOpen} onRecorded={() => { setOpen(false); trades.retry(); }} />
    </div>
  );
}
function RecordTradeDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRecorded: () => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const [itemsOut, setItemsOut] = useState<TradeItemDraft[]>([]);
  const [itemsIn, setItemsIn] = useState<TradeItemDraft[]>([]);
  const [valueOut, setValueOut] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [direction, setDirection] = useState<CashDirection>("none");
  const [counterparty, setCounterparty] = useState("");
  const [tradedAt, setTradedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const signed = signedCash({
    cashAmount: cashAmount === "" ? 0 : Number(cashAmount),
    direction,
  });
  const valueOutUsd = valueOut.trim() === "" ? null : Number(valueOut);
  // value_in is DERIVED, never typed. The backend computes the same figure from
  // the same two inputs, so the two sides cannot disagree. This is only the
  // preview of what it will be.
  const valueInUsd = valueOutUsd == null ? null : deriveValueIn(valueOutUsd, signed);

  const outProblems = itemProblems(itemsOut, true);
  const inProblems = itemProblems(itemsIn, false);
  const recordable = canRecordTrade({ itemsOut, itemsIn, valueOutUsd, signedCashUsd: signed });

  const reset = useCallback(() => {
    setItemsOut([]); setItemsIn([]); setValueOut(""); setCashAmount("");
    setDirection("none"); setCounterparty(""); setNotes("");
    setTradedAt(new Date().toISOString().slice(0, 10));
    setMutationError(null);
  }, []);

  const submit = useCallback(async () => {
    if (!recordable || valueOutUsd == null) return;
    setSaving(true);
    setMutationError(null);
    try {
      const { error } = await createClient().rpc("record_trade", {
        p_items_out: itemsOutPayload(itemsOut),
        p_items_in: itemsInPayload(itemsIn),
        p_value_out: valueOutUsd,
        p_cash_usd: signed,
        p_counterparty: counterparty.trim() || null,
        p_traded_at: tradedAt || null,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      reset();
      props.onRecorded();
    } catch (error) {
      setMutationError(t("trades.recordError", { error: formatMutationError(error) }));
    } finally {
      setSaving(false);
    }
  }, [recordable, valueOutUsd, itemsOut, itemsIn, signed, counterparty, tradedAt, notes, props, t, reset]);

  return (
    <Dialog open={props.open} onOpenChange={(v) => { if (!v) reset(); props.onOpenChange(v); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{t("trades.record")}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("trades.dialogHint")}</p>

          {/* Two baskets. The outgoing one is picked from stock we hold, because
              you cannot give away what you do not have; the incoming one from
              the catalogue, because you do not hold it yet. */}
          <TradeBasket
            side="out"
            items={itemsOut}
            problems={outProblems}
            onChange={setItemsOut}
          />
          <TradeBasket
            side="in"
            items={itemsIn}
            problems={inProblems}
            onChange={setItemsIn}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("trades.valueOutLabel")}</span>
              <Input inputMode="decimal" value={valueOut} placeholder="0.00"
                onChange={(e) => setValueOut(e.target.value)} />
              <span className="block text-xs text-muted-foreground">{t("trades.valueOutHint")}</span>
            </label>

            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("trades.cashLabel")}</span>
              <div className="flex gap-2">
                <select aria-label={t("trades.cashDirection")}
                  className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                  value={direction} onChange={(e) => setDirection(e.target.value as CashDirection)}>
                  <option value="none">{t("trades.cashNone")}</option>
                  <option value="paid">{t("trades.cashPaid")}</option>
                  <option value="received">{t("trades.cashReceived")}</option>
                </select>
                <Input inputMode="decimal" className="flex-1" placeholder="0.00"
                  disabled={direction === "none"} value={direction === "none" ? "" : cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)} />
              </div>
              <span className="block text-xs text-muted-foreground">{t("trades.cashHint")}</span>
            </div>
          </div>

          {/* The identity, shown as it resolves. value_in is not an input. */}
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">{t("trades.derivedIn")}</span>
              <span className="font-medium tabular-nums">
                {valueInUsd == null ? "-" : formatUsd(valueInUsd)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("trades.identityHint", {
                out: valueOutUsd == null ? "-" : formatUsd(valueOutUsd),
                cash: formatUsd(signed),
                in: valueInUsd == null ? "-" : formatUsd(valueInUsd),
              })}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("trades.counterparty")}</span>
              <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("trades.tradedAt")}</span>
              <Input type="date" value={tradedAt} onChange={(e) => setTradedAt(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("trades.notes")}</span>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>

          {mutationError && <p role="alert" className="text-sm text-destructive">{mutationError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" className="min-h-12 sm:min-h-9"
            onClick={() => props.onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button className="min-h-12 sm:min-h-9" disabled={saving || !recordable} onClick={submit}>
            {saving ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
                    : <Check className="mr-1 size-4" aria-hidden />}
            {t("trades.record")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One basket, with its own search. The two sides search different things, which
// is the only real difference between them: outgoing must exist in inventory,
// incoming is a catalogue lookup plus a condition you choose.
function TradeBasket(props: {
  side: "out" | "in";
  items: TradeItemDraft[];
  problems: ItemProblem[];
  onChange: (items: TradeItemDraft[]) => void;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const [conditions, setConditions] = useState<Array<{ condition_id: number; code: string }>>([]);
  const [conditionId, setConditionId] = useState<number | null>(null);

  useEffect(() => {
    if (props.side !== "in") return;
    createClient().from("conditions").select("condition_id, code").eq("standard", "tcgplayer")
      .then(({ data }) => {
        const rows = (data as Array<{ condition_id: number; code: string }>) ?? [];
        setConditions(rows);
        setConditionId(rows.find((c) => c.code === "NM")?.condition_id ?? rows[0]?.condition_id ?? null);
      });
  }, [props.side]);

  const results = useSupabaseQuery<TradeSearchHit[]>(
    term.trim() ? `trades:search:${props.side}:${term.trim()}` : null,
    async () => searchForBasket(createClient(), props.side, term.trim(), conditionId),
  );

  const add = (hit: TradeSearchHit) => {
    const key = `${hit.game}:${hit.itemId}:${hit.conditionId ?? "s"}:${hit.psaGrade}`;
    if (props.items.some((i) => i.key === key)) return;
    props.onChange([...props.items, { ...hit, key, quantity: 1 }]);
    setTerm("");
  };
  const patch = (key: string, p: Partial<TradeItemDraft>) =>
    props.onChange(props.items.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const drop = (key: string) => props.onChange(props.items.filter((i) => i.key !== key));

  const label = props.side === "out" ? t("trades.basketOut") : t("trades.basketIn");
  const hint = props.side === "out" ? t("trades.basketOutHint") : t("trades.basketInHint");

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>

      <div className="flex gap-2">
        <Input value={term} placeholder={t("trades.searchPlaceholder")}
          onChange={(e) => setTerm(e.target.value)} />
        {props.side === "in" && conditions.length > 0 && (
          <select aria-label={t("trades.condition")}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={conditionId ?? ""} onChange={(e) => setConditionId(Number(e.target.value))}>
            {conditions.map((c) => <option key={c.condition_id} value={c.condition_id}>{c.code}</option>)}
          </select>
        )}
      </div>

      {results.error && <QueryError error={results.error} onRetry={results.retry} />}
      {term.trim() && (results.data?.length ?? 0) > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded border bg-background p-1">
          {results.data!.map((hit) => (
            <li key={`${hit.game}:${hit.itemId}:${hit.conditionId ?? "s"}`}>
              <button type="button" onClick={() => add(hit)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted">
                <span className="truncate">{hit.label}</span>
                {hit.available != null && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("trades.haveQty", { n: String(hit.available) })}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {props.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("trades.basketEmpty")}</p>
      ) : (
        <ul className="space-y-1">
          {props.items.map((item) => {
            const problem = props.problems.find((p) => p.key === item.key);
            return (
              <li key={item.key} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                <Input aria-label={t("trades.quantity")} inputMode="numeric"
                  className="h-8 w-16" value={String(item.quantity)}
                  onChange={(e) => patch(item.key, { quantity: Math.floor(Number(e.target.value) || 0) })} />
                {props.side === "in" && (
                  <Input aria-label={t("trades.marketValue")} inputMode="decimal"
                    className="h-8 w-24" placeholder={t("trades.marketValuePlaceholder")}
                    value={item.marketValueUsd == null ? "" : String(item.marketValueUsd)}
                    onChange={(e) => patch(item.key, {
                      marketValueUsd: e.target.value.trim() === "" ? null : Number(e.target.value),
                    })} />
                )}
                <Button variant="ghost" size="sm" className="h-8" onClick={() => drop(item.key)}>
                  {t("trades.removeItem")}
                </Button>
                {problem && (
                  <span role="alert" className="w-full text-xs text-destructive">
                    {t(`trades.problem.${problem.reason}` as "trades.problem.quantity")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// What a search row offers up. The outgoing side fills conditionId and
// available from the holding; the incoming side takes the condition from the
// picker beside the box, because the card is not ours yet.
interface TradeSearchHit {
  game: TradeGame;
  itemId: number;
  conditionId: number | null;
  psaGrade: number;
  label: string;
  available?: number;
  sealedCondition?: string | null;
  variantEdition?: string | null;
}

function hitLabel(parts: Array<string | null | undefined>): string {
  // "UNKNOWN" is this schema's null; never show it (see AGENTS.md conventions).
  return parts.filter((p) => p && p !== "UNKNOWN").join(" ");
}

export async function searchForBasket(
  supabase: SupabaseClient,
  side: "out" | "in",
  term: string,
  conditionId: number | null,
): Promise<TradeSearchHit[]> {
  if (side === "out") {
    // Outgoing stock must be stock we hold, so this reads the holdings view
    // rather than the catalogue: it already carries the condition, the grade
    // and how many are on hand, so a row cannot name a holding we lack.
    // Bounded by .limit(25), so no selectAll paging is needed.
    // Same contract as every other search bar in the app (lib/card-search): a
    // name/set/number term, a pasted uid (full or the displayed 8-hex prefix),
    // or an exact platform external id. `name` here is the JAPANESE regional
    // name, so english_name has to be in the text columns or "pikachu" matches
    // nothing; item_uid and the external ids are what make a paste land.
    // Both columns come from the view via backend migrations 000576 and 000577.
    const heldExt = await externalIdMatches(
      supabase, "pokemon_external_identifiers", "card_id", term,
    );
    let q = supabase
      .from("inventory_holdings_v")
      .select(
        "game, card_id, product_id, item_uid, name, english_name, set_code, " +
          "card_number, condition_id, psa_grade, qty_on_hand, sealed_condition, " +
          "variant_edition, variant_label",
      )
      .gt("qty_on_hand", 0);
    for (const f of smartSearchFilters(
      term,
      ["name", "english_name", "set_code", "card_number"],
      "item_uid",
      "card_id",
      heldExt,
    )) {
      q = q.or(f);
    }
    const { data } = await q.limit(25);
    const rows = (data as Array<{
      game: string; card_id: number | null; product_id: number | null;
      name: string; english_name: string | null;
      set_code: string | null; card_number: string | null;
      condition_id: number | null; psa_grade: number | null; qty_on_hand: number;
      sealed_condition: string | null; variant_edition: string | null;
      variant_label: string | null;
    }>) ?? [];
    return rows.map((r) => {
      const sealed = r.game === "pokemon_sealed";
      return {
        game: (sealed ? "pokemon_sealed" : r.game === "mtg" ? "mtg" : "pokemon") as TradeGame,
        itemId: (sealed ? r.product_id : r.card_id) ?? 0,
        conditionId: sealed ? null : r.condition_id,
        psaGrade: r.psa_grade ?? 0,
        available: r.qty_on_hand,
        sealedCondition: r.sealed_condition,
        variantEdition: r.variant_edition,
        label: hitLabel([
          r.english_name ?? r.name, r.set_code, r.card_number, r.variant_label,
          r.psa_grade ? `PSA ${r.psa_grade}` : null,
        ]),
      };
    });
  }

  // Incoming cards are not ours yet, so this is a catalogue lookup and the
  // condition comes from the picker. Pokemon and MTG singles only: trading for
  // sealed product is rare enough that sending it through the lot screen beats
  // a half-built path here.
  const pokemonExt = await externalIdMatches(supabase, "pokemon_external_identifiers", "card_id", term);
  let pq = supabase
    .from("pokemon_card_definitions")
    .select("card_id, regional_name, english_name, set_code, card_number");
  for (const f of smartSearchFilters(
    term,
    ["regional_name", "english_name", "set_code", "card_number"],
    "card_uid", "card_id", pokemonExt,
  )) {
    pq = pq.or(f);
  }
  const { data: pdata } = await pq.limit(20);
  const pokemon: TradeSearchHit[] = ((pdata as Array<{
    card_id: number; regional_name: string; english_name: string | null;
    set_code: string | null; card_number: string | null;
  }>) ?? []).map((r) => ({
    game: "pokemon",
    itemId: r.card_id,
    conditionId,
    psaGrade: 0,
    label: hitLabel([r.english_name ?? r.regional_name, r.set_code, r.card_number]),
  }));

  const mtgExt = await externalIdMatches(supabase, "mtg_external_identifiers", "card_id", term);
  let mq = supabase
    .from("mtg_card_definitions_v")
    .select("card_id, regional_name, set_code, card_number");
  for (const f of smartSearchFilters(
    term,
    ["regional_name", "local_name", "set_code", "card_number"],
    "card_uid", "card_id", mtgExt,
  )) {
    mq = mq.or(f);
  }
  const { data: mdata } = await mq.limit(10);
  const mtg: TradeSearchHit[] = ((mdata as Array<{
    card_id: number; regional_name: string; set_code: string | null; card_number: string | null;
  }>) ?? []).map((r) => ({
    game: "mtg",
    itemId: r.card_id,
    conditionId,
    psaGrade: 0,
    label: hitLabel([r.regional_name, r.set_code, r.card_number]),
  }));

  return [...pokemon, ...mtg];
}
