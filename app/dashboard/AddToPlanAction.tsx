"use client";

import { useCallback, useEffect, useState } from "react";
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

type PlanOption = { plan_id: number; name: string; status: string; trip_id: number | null };
type AddResult = { card_id: number; added: boolean; source: string | null; asking_price: number | null; reason: string | null };

export function AddToPlanAction({ cardIds, onAdded }: { cardIds: number[]; onAdded?: () => void }) {
  const { activeTripId } = useTrips();
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [ceiling, setCeiling] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AddResult[] | null>(null);

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

  async function add() {
    if (planId == null) return;
    setBusy(true); setError(null); setResults(null);
    const { data, error: rpcError } = await createClient().rpc("add_cards_to_purchase_plan", {
      p_plan_id: planId,
      p_card_ids: cardIds,
      p_quantity: Number(quantity) || 1,
      p_ceiling_jpy: ceiling ? Number(ceiling) : null,
    });
    setBusy(false);
    if (rpcError) { setError(formatMutationError(rpcError)); return; }
    setResults((data ?? []) as AddResult[]);
    onAdded?.();
  }

  if (!cardIds.length) return null;

  const addedCount = results?.filter((r) => r.added).length ?? 0;
  const skipped = results?.filter((r) => !r.added) ?? [];

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setResults(null); setOpen(true); }}>
        Add to plan
      </Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setResults(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add {cardIds.length} card{cardIds.length === 1 ? "" : "s"} to a plan</DialogTitle>
            <DialogDescription>
              Each card is added with its cheapest current JPY listing, as a want you can fill
              from any shop.
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="add-to-plan-qty">Copies wanted (each card)</Label>
                  <Input id="add-to-plan-qty" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="add-to-plan-ceiling">Max price ¥ (optional)</Label>
                  <Input id="add-to-plan-ceiling" inputMode="numeric" value={ceiling} onChange={(e) => setCeiling(e.target.value)} placeholder="no limit" />
                </div>
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
                        card {r.card_id} - {r.reason}
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
                {busy ? "Adding..." : `Add ${cardIds.length}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
