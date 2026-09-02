"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { formatMutationError } from "@/lib/mutation-error";
import { useTrips } from "./TripContext";

// Add the selected cards to a purchase plan without leaving the browser.
//
// Adding used to be one card at a time inside the planner, and nothing outside
// the planner touched plans at all. Selecting cards here is where the operator
// already decides what to buy, so this is where adding belongs.
//
// Each card becomes a WANT with its cheapest current JPY listing attached, so a
// bulk-added card carries a cap across sources rather than being nailed to
// whichever shop happened to be cheapest at planning time.
//
// Quantity and ceiling are PER CARD. A selection is heterogeneous by nature - a
// bulk common wanted twenty deep sits next to a single chase card - so one
// number for all of them is wrong for every card but the one it was chosen for.
// The shared value survives only as a default to seed the rows with.

export type PlanCard = { id: number; name: string };
type PlanOption = { plan_id: number; name: string; status: string; trip_id: number | null };
type AddResult = { card_id: number; added: boolean; source: string | null; asking_price: number | null; reason: string | null };
type Wanted = { quantity: string; ceiling: string };

export function AddToPlanAction({ cards, onAdded }: { cards: PlanCard[]; onAdded?: () => void }) {
  const { activeTripId } = useTrips();
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [wanted, setWanted] = useState<Record<number, Wanted>>({});
  const [bulkQuantity, setBulkQuantity] = useState("1");
  const [bulkCeiling, setBulkCeiling] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AddResult[] | null>(null);

  const names = useMemo(() => new Map(cards.map((c) => [c.id, c.name])), [cards]);

  const load = useCallback(async () => {
    // Only a plan that can still take lines: the row freezes once ordered,
    // because the buyer is shopping against it by then.
    const { data } = await createClient()
      .from("purchase_plans")
      .select("plan_id,name,status,trip_id")
      .in("status", ["draft", "ready"])
      .order("plan_id", { ascending: false });
    const rows = (data ?? []) as PlanOption[];
    setPlans(rows);
    setPlanId((current) =>
      current ?? rows.find((p) => p.trip_id === activeTripId)?.plan_id ?? rows[0]?.plan_id ?? null,
    );
  }, [activeTripId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  // Open with every card at one copy and no cap, so the dialog is answerable
  // immediately and the operator only touches the rows they care about.
  useEffect(() => {
    if (!open) return;
    setWanted(Object.fromEntries(cards.map((c) => [c.id, { quantity: "1", ceiling: "" }])));
    setBulkQuantity("1");
    setBulkCeiling("");
  }, [open, cards]);

  function setRow(id: number, patch: Partial<Wanted>) {
    setWanted((current) => ({ ...current, [id]: { ...(current[id] ?? { quantity: "1", ceiling: "" }), ...patch } }));
  }

  function applyToAll() {
    setWanted(Object.fromEntries(cards.map((c) => [c.id, { quantity: bulkQuantity || "1", ceiling: bulkCeiling }])));
  }

  async function add() {
    if (planId == null) return;
    setBusy(true); setError(null); setResults(null);
    const items = cards.map((c) => {
      const row = wanted[c.id] ?? { quantity: "1", ceiling: "" };
      return {
        card_id: c.id,
        quantity: Number(row.quantity) || 1,
        ceiling_jpy: row.ceiling ? Number(row.ceiling) : null,
      };
    });
    const { data, error: rpcError } = await createClient().rpc("add_cards_to_purchase_plan", {
      p_plan_id: planId,
      p_items: items,
    });
    setBusy(false);
    if (rpcError) { setError(formatMutationError(rpcError)); return; }
    setResults((data ?? []) as AddResult[]);
    onAdded?.();
  }

  if (!cards.length) return null;

  const addedCount = results?.filter((r) => r.added).length ?? 0;
  const skipped = results?.filter((r) => !r.added) ?? [];
  const totalCopies = cards.reduce((sum, c) => sum + (Number(wanted[c.id]?.quantity) || 1), 0);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setResults(null); setOpen(true); }}>
        Add to plan
      </Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setResults(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add {cards.length} card{cards.length === 1 ? "" : "s"} to a plan</DialogTitle>
            <DialogDescription>
              Each card is added with its cheapest current JPY listing, as a want you can fill
              from any shop. Copies and cap are set per card.
            </DialogDescription>
          </DialogHeader>

          {results === null ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="add-to-plan-plan">Plan</Label>
                <select
                  id="add-to-plan-plan"
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                  value={planId ?? ""}
                  onChange={(e) => setPlanId(e.target.value ? Number(e.target.value) : null)}
                >
                  {plans.length === 0 && <option value="">No draft plans - create one first</option>}
                  {plans.map((p) => (
                    <option key={p.plan_id} value={p.plan_id}>{p.name} [{p.status}]</option>
                  ))}
                </select>
              </div>

              {cards.length > 1 && (
                // A default to seed the rows, not a value applied behind the
                // operator's back - nothing changes until Apply is pressed.
                <div className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                  <div className="space-y-1">
                    <Label htmlFor="add-to-plan-bulk-qty" className="text-xs">Copies</Label>
                    <Input
                      id="add-to-plan-bulk-qty"
                      type="number"
                      min="1"
                      className="h-8 w-20"
                      value={bulkQuantity}
                      onChange={(e) => setBulkQuantity(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="add-to-plan-bulk-ceiling" className="text-xs">Max ¥</Label>
                    <Input
                      id="add-to-plan-bulk-ceiling"
                      inputMode="numeric"
                      className="h-8 w-24"
                      placeholder="no limit"
                      value={bulkCeiling}
                      onChange={(e) => setBulkCeiling(e.target.value)}
                    />
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={applyToAll}>
                    Apply to all
                  </Button>
                </div>
              )}

              <div className="rounded-md border">
                <div className="text-muted-foreground grid grid-cols-[1fr_5rem_6rem] gap-2 border-b px-3 py-1.5 text-xs">
                  <span>Card</span>
                  <span>Copies</span>
                  <span>Max ¥</span>
                </div>
                <ul className="max-h-72 overflow-y-auto">
                  {cards.map((card) => (
                    <li key={card.id} className="grid grid-cols-[1fr_5rem_6rem] items-center gap-2 border-b px-3 py-1.5 last:border-0">
                      <span className="truncate text-sm" title={card.name}>{card.name}</span>
                      <Input
                        type="number"
                        min="1"
                        className="h-8"
                        aria-label={`Copies of ${card.name}`}
                        value={wanted[card.id]?.quantity ?? "1"}
                        onChange={(e) => setRow(card.id, { quantity: e.target.value })}
                      />
                      <Input
                        inputMode="numeric"
                        className="h-8"
                        placeholder="none"
                        aria-label={`Max price for ${card.name}`}
                        value={wanted[card.id]?.ceiling ?? ""}
                        onChange={(e) => setRow(card.id, { ceiling: e.target.value })}
                      />
                    </li>
                  ))}
                </ul>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          ) : (
            // What actually happened, per card. A partial success the operator
            // cannot see is worse than a slow dialog: a card would be believed
            // on the list when it is not.
            <div className="space-y-2 text-sm">
              <p className="font-medium">
                Added {addedCount} of {results.length}
              </p>
              {skipped.length > 0 && (
                <div className="rounded-md border">
                  <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">Not added</div>
                  <ul className="max-h-56 overflow-y-auto">
                    {skipped.map((r) => (
                      <li key={r.card_id} className="border-b px-3 py-1.5 text-xs last:border-0">
                        {names.get(r.card_id) ?? `card ${r.card_id}`} - {r.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {results === null ? "Cancel" : "Done"}
            </Button>
            {results === null && (
              <Button onClick={add} disabled={busy || planId == null}>
                {busy ? "Adding..." : `Add ${totalCopies} cop${totalCopies === 1 ? "y" : "ies"}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
