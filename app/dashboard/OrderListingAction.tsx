"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { formatMutationError } from "@/lib/mutation-error";
import { useTrips } from "./TripContext";

// Order one listing into a purchase plan, from inside the card detail view.
//
// The browser's multi-select answers a different question. Ticking cards and
// then being asked "how many?" in a dialog showing a name and nothing else
// throws away every input to the decision: the operator put it plainly - "I
// lose all the information about the cards, like buy and sell prices, price
// trends, sources and depth".
//
// All of that is already on screen here, so the decision is made against it and
// the ORDER CARRIES THE LISTING the operator was looking at, rather than a
// re-derived cheapest that may be a different shop by the time they click.

type PlanOption = { plan_id: number; name: string; status: string; trip_id: number | null };
type AddResult = {
  card_id: number;
  added: boolean;
  source: string | null;
  asking_price: number | null;
  available_quantity: number | null;
  reason: string | null;
};

export function OrderListingAction({
  cardId,
  cardName,
  source,
  price,
  currencySymbol,
  availableQuantity,
  onOrdered,
}: {
  cardId: number;
  cardName: string;
  source: string;
  price: number;
  currencySymbol: string;
  availableQuantity?: number | null;
  onOrdered?: () => void;
}) {
  const { activeTripId } = useTrips();
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddResult | null>(null);

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

  const wanted = Number(quantity) || 1;
  // Depth is known often enough to be worth acting on, and an over-ask is the
  // whole reason it was captured. Unknown depth stays silent rather than
  // guessing - a shop that publishes no count still has the card.
  const short = availableQuantity != null && wanted > availableQuantity;

  async function order() {
    if (planId == null) return;
    setBusy(true); setError(null); setResult(null);
    const { data, error: rpcError } = await createClient().rpc("add_cards_to_purchase_plan", {
      p_plan_id: planId,
      // The chosen shop travels with the order. Without it the RPC would pick
      // the cheapest listing, which may not be the one on screen.
      p_items: [{ card_id: cardId, quantity: wanted, source }],
    });
    setBusy(false);
    if (rpcError) { setError(formatMutationError(rpcError)); return; }
    const rows = (data ?? []) as AddResult[];
    setResult(rows[0] ?? null);
    onOrdered?.();
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 cursor-pointer px-1.5 text-xs"
        aria-label={`Add ${cardName} from ${source} to a purchase plan`}
        onClick={(e) => { e.stopPropagation(); setResult(null); setOpen(true); }}
      >
        + Plan
      </Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setResult(null); }}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Order from {source}</DialogTitle>
            <DialogDescription>
              {cardName} - {currencySymbol}{Math.round(price).toLocaleString()}
              {availableQuantity != null && ` - ${availableQuantity} in stock`}
            </DialogDescription>
          </DialogHeader>

          {result === null ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="order-plan">Plan</Label>
                <select
                  id="order-plan"
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
              <div className="space-y-1">
                <Label htmlFor="order-qty">Copies</Label>
                <Input
                  id="order-qty"
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              {/* Visible at the moment of choosing, not discovered later by the
                  buyer standing in the shop. */}
              {short && (
                <p role="status" className="text-destructive text-sm">
                  {source} has {availableQuantity} of {wanted}. The rest needs another shop.
                </p>
              )}
              {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              {result.added ? (
                <p className="font-medium">
                  Added {wanted} from {result.source}
                </p>
              ) : (
                // A refusal names the shop, because the operator chose it and a
                // silent substitution would look like success.
                <p role="alert" className="text-destructive">Not added - {result.reason}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {result === null ? "Cancel" : "Done"}
            </Button>
            {result === null && (
              <Button onClick={order} disabled={busy || planId == null}>
                {busy ? "Adding..." : `Add ${wanted}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
