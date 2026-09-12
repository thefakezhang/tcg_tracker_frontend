"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { externalIdMatches, smartSearchFilters } from "@/lib/card-search";
import { PurchaseReconciliationDialog } from "./PurchaseReconciliationDialog";
import { useTrips } from "./TripContext";
import { useTranslation } from "@/lib/i18n";
import {
  sortedOrigins,
  summarizePlan,
  type DemandCoverage,
  type DemandOrigin,
  type PlanValidation,
  type PurchaseAllocation,
  type PurchaseCandidate,
  type PurchasePlan,
  type PurchasePlanLine,
} from "@/lib/purchase-planning";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatMutationError } from "@/lib/mutation-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QueryError, useSupabaseQuery } from "./use-query";
import {
  conditionLabel,
  editionLabel,
  SEALED_CONDITIONS,
  SEALED_EDITIONS,
} from "./use-sealed-data";
import {
  SealedPlanningReadinessNotice,
  useSealedPlanningReadiness,
} from "./sealed-planning-readiness";
import {
  landedPerCardJpy,
  loadCurrentPurchaseFeePolicy,
  purchaseFeePercent,
  type PurchaseFeePolicyState,
} from "./purchase-fee-policy";

export { landedPerCardJpy } from "./purchase-fee-policy";

import { formatUsd } from "@/lib/money";
const selectClass =
  "h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

interface PlannerData {
  plans: PurchasePlan[];
  lines: PurchasePlanLine[];
  allocations: PurchaseAllocation[];
  coverage: DemandCoverage[];
}

export interface CatalogResult {
  id: number;
  game: "pokemon" | "mtg" | "pokemon_sealed";
  label: string;
  sealedCondition: string | null;
  variantEdition: string | null;
}

async function fetchPlannerData(planId: number | null): Promise<PlannerData> {
  const supabase = createClient();
  const { data: planRows, error: planError } = await supabase
    .from("purchase_plans")
    .select("*")
    .order("created_at", { ascending: false });
  if (planError) throw planError;
  const plans = (planRows ?? []) as PurchasePlan[];
  const selected = planId ?? plans[0]?.plan_id ?? null;
  if (selected == null) return { plans, lines: [], allocations: [], coverage: [] };

  const [lineResult, allocationResult, coverageResult] = await Promise.all([
    supabase.from("purchase_plan_lines_v").select("*").eq("plan_id", selected).order("plan_line_id"),
    supabase.from("purchase_plan_allocations_v").select("*").eq("plan_id", selected).order("allocation_id"),
    supabase
      .from("purchase_plan_coverage_v")
      .select("*")
      .eq("plan_id", selected)
      .order("customer_name")
      .order("priority"),
  ]);
  if (lineResult.error) throw lineResult.error;
  if (allocationResult.error) throw allocationResult.error;
  if (coverageResult.error) throw coverageResult.error;
  return {
    plans,
    lines: (lineResult.data ?? []) as PurchasePlanLine[],
    allocations: (allocationResult.data ?? []) as PurchaseAllocation[],
    coverage: (coverageResult.data ?? []) as DemandCoverage[],
  };
}

// Per-game search config, the same shape the Card Index and match-review
// dialog use. Kept here only because this dialog searches three catalogs; the
// SEMANTICS come from lib/card-search so every surface accepts the same terms.
const CATALOG_SEARCH = {
  pokemon: {
    table: "pokemon_card_definitions",
    select: "card_id, card_uid, regional_name, english_name, set_code, card_number, misc_info",
    extIdsTable: "pokemon_external_identifiers",
    idCol: "card_id",
    uidCol: "card_uid",
    textCols: ["regional_name", "english_name", "set_code", "card_number", "misc_info"],
  },
  mtg: {
    table: "mtg_card_definitions_v",
    select: "card_id, card_uid, regional_name, local_name, set_code, card_number, misc_info",
    extIdsTable: "mtg_external_identifiers",
    idCol: "card_id",
    uidCol: "card_uid",
    textCols: ["regional_name", "local_name", "set_code", "card_number", "misc_info"],
  },
  pokemon_sealed: {
    table: "pokemon_sealed_products",
    select: "product_id, product_uid, name, english_name, set_code, sealed_condition, variant_edition",
    extIdsTable: "pokemon_sealed_external_identifiers",
    idCol: "product_id",
    uidCol: "product_uid",
    textCols: ["name", "english_name", "set_code"],
  },
} as const;

// Find a card the way every other card search in the app does.
//
// This dialog used to carry its own matcher over name/set/number only, so the
// one identifier that is unambiguous - the card's UUID, which the UI itself
// displays - found nothing here while working everywhere else. Pasting a
// tcgplayer or snkrdunk id did not work either. The shared helpers in
// lib/card-search are the semantics; this function only picks the catalog.
async function searchCatalog(game: CatalogResult["game"], raw: string): Promise<CatalogResult[]> {
  const term = raw.trim();
  if (!term) return [];
  const cfg = CATALOG_SEARCH[game];
  const supabase = createClient();
  const extIds = await externalIdMatches(supabase, cfg.extIdsTable, cfg.idCol, term);

  // Each filter is applied in sequence: chained or() calls AND together, so a
  // multi-word term means every token must match something, while a pasted
  // identifier comes back as a single disjunct that stands alone.
  let query = supabase.from(cfg.table).select(cfg.select);
  for (const filter of smartSearchFilters(term, [...cfg.textCols], cfg.uidCol, cfg.idCol, extIds)) {
    query = query.or(filter);
  }
  const { data, error } = await query.limit(10);
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => {
    if (game === "pokemon_sealed") {
      const setCode = row.set_code as string | null;
      return {
        id: row.product_id as number,
        game,
        label: `${(row.english_name as string) || (row.name as string)}${setCode && setCode !== "UNKNOWN" ? ` | ${setCode}` : ""} | ${row.variant_edition as string} · ${row.sealed_condition as string}`,
        sealedCondition: row.sealed_condition as string,
        variantEdition: row.variant_edition as string,
      };
    }
    const name = (row.english_name as string) || (row.local_name as string) || (row.regional_name as string);
    return {
      id: row.card_id as number,
      game,
      label: `${name} | ${row.set_code as string} ${row.card_number as string}`,
      sealedCondition: null,
      variantEdition: null,
    };
  });
}

function money(value: number | null | undefined): string {
  return value == null ? "-" : formatUsd(Number(value));
}

// Prices get typed the way they are read: "8,000", "¥8000", "8000 JPY". Number()
// returns NaN for every one of those, and NaN serialises to null, so the row
// saved with NO PRICE and no error - the agent then opens the line and sees a
// dash where the asking price should be.
//
// Returns null when there is no number in the text at all, which the caller
// reports rather than stores.
export function parseTypedPrice(text: string): number | null {
  // A minus is refused rather than stripped: turning "-5" into 5 is the same
  // silent transformation this function exists to stop.
  if (text.includes("-")) return null;
  const cleaned = text.replace(/[,\s]/g, "").replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// The shops we crawl, offered so a hand-typed line matches a crawled one.
const KNOWN_SOURCES = [
  "snkrdunk", "cardrush", "hareruya2", "fukufuku", "shinsoku",
  "torecabank", "big_tcg", "cardkingdom", "surugaya",
];

function itemMeta(line: PurchasePlanLine, t: ReturnType<typeof useTranslation>["t"]): string {
  return [
    line.set_code && line.set_code !== "UNKNOWN" ? line.set_code : null,
    line.card_number,
    line.game === "pokemon_sealed" && line.variant_edition
      ? editionLabel(t, line.variant_edition)
      : null,
    line.game === "pokemon_sealed" && line.sealed_condition
      ? conditionLabel(t, line.sealed_condition)
      : null,
    line.misc_info && line.misc_info !== "UNKNOWN" ? line.misc_info : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function statusTone(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "ready" || status === "covered") return "default";
  if (status === "ordered" || status === "covered_elsewhere" || status === "deferred" || status === "out_of_scope") return "secondary";
  if (status === "partial" || status === "unavailable" || status === "unreviewed") return "destructive";
  return "outline";
}

export default function PurchasePlannerView() {
  const { t } = useTranslation();
  const [planId, setPlanId] = useState<number | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [lineOpen, setLineOpen] = useState(false);
  const [allocationLine, setAllocationLine] = useState<PurchasePlanLine | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Plans are bound to a trip. Without this the selector accumulates every
  // plan ever made, and after a handful of trips it is unusable.
  //
  // The filter is the operator's own, and it starts at every plan. It must NOT
  // fall back to activeTripId: that value carries the dashboard's VIEW
  // SENTINEL, not a trip - this view is itself sentinel -14 - so filtering on
  // it compared every plan's trip_id against -14, matched nothing, and emptied
  // the plan picker entirely. Reaching this component at all means the sentinel
  // is negative, so the fallback could never once have been a real trip.
  const { trips } = useTrips();
  const [tripFilter, setTripFilter] = useState<number | "all" | "none">("all");
  const effectiveTrip = tripFilter;
  const [disposition, setDisposition] = useState<DemandCoverage | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const { data, error, isLoading, retry } = useSupabaseQuery(["purchase-planner", planId], () => fetchPlannerData(planId));

  // Memoised because it is an effect dependency below. As a bare filter it was
  // a new array on every render, so that effect ran on every render.
  const visiblePlans = useMemo(
    () => (data?.plans ?? []).filter((p) => {
      if (effectiveTrip === "all") return true;
      // Untripped plans get their OWN value rather than showing under every
      // trip, so each option shows exactly what it says.
      if (effectiveTrip === "none") return p.trip_id == null;
      return p.trip_id === effectiveTrip;
    }),
    [data?.plans, effectiveTrip],
  );
  const plan = data?.plans.find((candidate) => candidate.plan_id === planId) ?? null;
  // One rule: the selected plan is one the operator can actually see.
  //
  // This was two effects, and they disagreed. One re-selected from EVERY plan
  // whenever nothing was selected; the other cleared any plan outside the
  // current trip. With a trip filter that matches no plan, each undid the
  // other - select plan from another trip, clear it, select it again - and the
  // planner died on React error #185, "Maximum update depth exceeded".
  //
  // Selecting from the same set the filter enforces is what makes it settle,
  // rather than the two effects agreeing by luck about which plans exist.
  useEffect(() => {
    if (planId != null && visiblePlans.some((p) => p.plan_id === planId)) return;
    const next = visiblePlans[0]?.plan_id ?? null;
    if (next !== planId) setPlanId(next);
  }, [visiblePlans, planId]);
  const allocations = data?.allocations ?? [];
  const coverage = data?.coverage ?? [];
  const lines = data?.lines ?? [];
  const summary = useMemo(() => summarizePlan(lines, coverage, allocations), [lines, coverage, allocations]);
  const editable = plan?.status === "draft" || plan?.status === "ready";

  // Offered only for a plan nothing has happened to. The database refuses the
  // rest - a placed plan cascades to the agent's recorded purchases - so this
  // decides what to show, never what is permitted.
  const deletable = plan != null && plan.status !== "ordered" && plan.status !== "reconciled";

  async function deletePlan() {
    if (!plan) return;
    const { error: deleteError } = await createClient()
      .from("purchase_plans").delete().eq("plan_id", plan.plan_id);
    setDeleteOpen(false);
    if (deleteError) { setLineError(formatMutationError(deleteError)); return; }
    // Let the selection effect pick the next visible plan rather than guessing
    // here, so there is still one rule deciding what is selected.
    setPlanId(null);
    retry();
  }

  async function removeLine(lineId: number) {
    if (!window.confirm(t("purchasePlanner.removeLineConfirm"))) return;
    setLineError(null);
    const { error: deleteError } = await createClient().from("purchase_plan_lines").delete().eq("plan_line_id", lineId);
    if (deleteError) setLineError(deleteError.message);
    else retry();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">{t("purchasePlanner.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("purchasePlanner.subtitle")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("purchasePlanner.tripFilter")}
            className={`${selectClass} w-44 shrink-0`}
            value={tripFilter}
            onChange={(event) => {
              const raw = event.target.value;
              setTripFilter(raw === "all" || raw === "none" ? raw : Number(raw));
            }}
          >
            <option value="all">{t("purchasePlanner.allTrips")}</option>
            <option value="none">{t("purchasePlanner.noTrip")}</option>
            {trips.map((trip) => (
              <option key={trip.trip_id} value={trip.trip_id}>{trip.name}</option>
            ))}
          </select>
          <select
            className={`${selectClass} min-w-48 flex-1 sm:flex-none`}
            value={planId ?? ""}
            onChange={(event) => setPlanId(event.target.value ? Number(event.target.value) : null)}
          >
            {visiblePlans.map((row) => (
              <option key={row.plan_id} value={row.plan_id}>
                {row.name} [{t(`purchasePlanner.status.${row.status}`)}]
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => setNewPlanOpen(true)}>
            <Plus className="size-4" /> {t("purchasePlanner.newPlan")}
          </Button>
          {deletable && (
            <Button variant="outline" onClick={() => setDeleteOpen(true)} aria-label={t("purchasePlanner.deletePlan")}>
              <Trash2 className="size-4" /> {t("purchasePlanner.deletePlan")}
            </Button>
          )}
          {plan && editable && (
            <Button onClick={() => setReviewOpen(true)}>
              <ShieldCheck className="size-4" />
              {/* It never sent anything. Sending is the Send button beside the
                  buying agent; this advances the operator's own workflow. */}
              {t(plan.status === "ready" ? "purchasePlanner.markAsOrdered" : "purchasePlanner.reviewPlan")}
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !plan ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <ClipboardList className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">{t("purchasePlanner.emptyTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("purchasePlanner.emptyDescription")}</p>
            </div>
            <Button onClick={() => setNewPlanOpen(true)}><Plus className="size-4" /> {t("purchasePlanner.newPlan")}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
            <SummaryCard label={t("purchasePlanner.lines")} value={summary.lineCount} />
            <SummaryCard label={t("purchasePlanner.units")} value={summary.plannedUnits} />
            <SummaryCard label={t("purchasePlanner.committed")} value={summary.committedUnits} tone="good" />
            <SummaryCard label={t("purchasePlanner.requested")} value={summary.requestedUnits} />
            <SummaryCard label={t("purchasePlanner.speculative")} value={summary.speculativeUnits} tone={summary.speculativeUnits ? "warn" : undefined} />
            <SummaryCard label={t("purchasePlanner.landedTotal")} value={money(summary.landedTotalUsd)} />
          </div>

          {plan?.handed_back_at && (
        // The end of his job and the start of yours. Worth its own line rather
        // than a badge among others: it is the moment the list becomes ready
        // to reconcile, and nothing else on this screen says so.
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            {t("reconciliation.handedBack")}
          </span>
          <span className="text-muted-foreground">
            {t("reconciliation.handedBackAt", { date: new Date(plan.handed_back_at).toLocaleString() })}
          </span>
        </div>
      )}
      {plan && (plan.status === "ordered" || plan.status === "reconciled") && <BuyerProgressStrip planId={plan.plan_id} />}
      {((plan.status === "ordered" && plan.handed_back_at) || plan.status === "reconciled") && (
        <Button className="min-h-11" onClick={() => setReconciliationOpen(true)}>
          {t(plan.status === "reconciled" ? "reconciliation.view" : "reconciliation.open")}
        </Button>
      )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={statusTone(plan.status)}>{t(`purchasePlanner.status.${plan.status}` as never)}</Badge>
              {plan.budget_amount != null && <span>{t("purchasePlanner.budget")}: {plan.budget_currency} {Number(plan.budget_amount).toFixed(2)}</span>}
              {plan.notes && <span className="hidden text-muted-foreground lg:inline">{plan.notes}</span>}
            </div>
            {/* Not gated on `editable`: once the plan is ordered the buyer is
                actually out shopping, which is exactly when the operator most
                needs to see who has it and when it went. Only reassignment
                freezes, and guard_purchase_plan_mutation enforces that. */}
            <PlanBuyerControl plan={plan} onChanged={retry} canReassign={editable} />
            {editable ? (
              <Button size="sm" onClick={() => setLineOpen(true)}><Plus className="size-4" /> {t("purchasePlanner.addLine")}</Button>
            ) : (
              // Hiding the button entirely read as a missing feature. The plan
              // is frozen on purpose once ordered - the buyer is shopping
              // against it, and adding lines underneath him would mean he is
              // working from a list that changed - so say that instead.
              <span className="text-xs text-muted-foreground">
                {plan.status === "ordered"
                  ? t("purchasePlanner.orderedFrozen")
                  : t("purchasePlanner.linesFrozen", { status: t(`purchasePlanner.status.${plan.status}`) })}
              </span>
            )}
          </div>

          <Tabs defaultValue="cards">
            <TabsList>
              <TabsTrigger value="cards">{t("purchasePlanner.cardsTab")}</TabsTrigger>
              <TabsTrigger value="customers">{t("purchasePlanner.customersTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="cards" className="mt-2">
              {lineError && <p role="alert" className="mb-2 text-sm text-destructive">{lineError}</p>}
              <PlanLines
                lines={lines}
                allocations={allocations}
                editable={editable}
                onAllocate={setAllocationLine}
                onRemove={removeLine}
              />
            </TabsContent>
            <TabsContent value="customers" className="mt-2">
              <CoverageTable coverage={coverage} onDisposition={editable ? setDisposition : undefined} />
            </TabsContent>
          </Tabs>
        </>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("purchasePlanner.deletePlanTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("purchasePlanner.deletePlanBody", { name: plan?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deletePlan()}>{t("purchasePlanner.deletePlan")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NewPlanDialog
        open={newPlanOpen}
        onOpenChange={setNewPlanOpen}
        onCreated={(id, planTrip) => {
          // Move the filter to the new plan's trip, so a plan the operator just
          // made is one he can see. Without this the filter swallows it and the
          // create reads as having failed - and it was also how the selection
          // loop got started, by selecting a plan the filter then rejected.
          setTripFilter(planTrip ?? "none");
          setPlanId(id);
          retry();
        }}
      />
      {plan && <AddLineDialog planId={plan.plan_id} open={lineOpen} onOpenChange={setLineOpen} onAdded={retry} />}
      <AllocationDialog line={allocationLine} allocations={allocations} editable={editable} open={allocationLine != null} onOpenChange={(open) => !open && setAllocationLine(null)} onChanged={retry} />
      {plan && <ReviewDialog plan={plan} open={reviewOpen} onOpenChange={setReviewOpen} onChanged={retry} />}
      {plan && <PurchaseReconciliationDialog key={plan.plan_id} planId={plan.plan_id} open={reconciliationOpen} onOpenChange={setReconciliationOpen} onFinalized={retry} />}
      {plan && <DispositionDialog planId={plan.plan_id} demand={disposition} open={disposition != null} onOpenChange={(open) => !open && setDisposition(null)} onChanged={retry} />}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "warn" }) {
  return (
    <Card size="sm">
      <CardHeader><CardTitle className="text-xs text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className={`text-xl font-semibold tabular-nums ${tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : ""}`}>{value}</CardContent>
    </Card>
  );
}

function PlanLines({ lines, allocations, editable, onAllocate, onRemove }: {
  lines: PurchasePlanLine[];
  allocations: PurchaseAllocation[];
  editable: boolean;
  onAllocate: (line: PurchasePlanLine) => void;
  onRemove: (lineId: number) => void;
}) {
  const { t } = useTranslation();
  if (!lines.length) return <p className="rounded-md border p-8 text-center text-sm text-muted-foreground">{t("purchasePlanner.noLines")}</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[940px] text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t("purchasePlanner.item")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("purchasePlanner.source")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("purchasePlanner.cost")}</th>
            <th className="px-3 py-2 text-center font-medium">{t("purchasePlanner.quantity")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("purchasePlanner.forCustomers")}</th>
            <th className="px-3 py-2 text-center font-medium">{t("purchasePlanner.backups")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("purchasePlanner.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const lineAllocations = allocations.filter((allocation) => allocation.plan_line_id === line.plan_line_id && !["released", "cancelled"].includes(allocation.status));
            const primary = lineAllocations.filter((allocation) => allocation.role === "primary");
            return (
              <tr key={line.plan_line_id} className="border-t align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{line.item_name || `#${line.card_id ?? line.product_id}`}</div>
                  <div className="text-xs text-muted-foreground">{itemMeta(line, t) || t(`game.${line.game}` as never)}{line.game !== "pokemon_sealed" ? ` | ${line.psa_grade ? `PSA ${line.psa_grade}` : t("purchasePlanner.raw")}` : ""}</div>
                </td>
                <td className="px-3 py-2 text-xs">
                  <div>{line.source || "-"}</div>
                  {line.source_listing_url && <a href={line.source_listing_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{t("purchasePlanner.openListing")} <ExternalLink className="size-3" /></a>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <div>{line.unit_price_orig != null ? `${line.currency} ${Number(line.unit_price_orig).toFixed(2)}` : "-"}</div>
                  <div className="text-xs text-muted-foreground">{money(line.landed_unit_cost_usd)} {t("purchasePlanner.landed")}</div>
                </td>
                <td className="px-3 py-2 text-center tabular-nums">
                  <div>{line.primary_quantity}/{line.planned_quantity}</div>
                  {line.speculative_quantity > 0 && <Badge variant="outline" className="mt-1 text-[10px] text-amber-600">{line.speculative_quantity} {t("purchasePlanner.open")}</Badge>}
                </td>
                <td className="px-3 py-2">
                  {primary.length ? primary.map((allocation) => (
                    <div key={allocation.allocation_id} className="flex items-center gap-1.5">
                      <span>{allocation.customer_name}</span>
                      <Badge variant={allocation.demand_snapshot.intent === "committed" ? "default" : "secondary"} className="text-[10px]">{allocation.quantity}x {String(allocation.demand_snapshot.intent ?? "")}</Badge>
                    </div>
                  )) : <span className="text-xs text-muted-foreground">{t("purchasePlanner.unassigned")}</span>}
                </td>
                <td className="px-3 py-2 text-center tabular-nums">{line.backup_count}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="outline" size="sm" onClick={() => onAllocate(line)}><UserPlus className="size-3.5" /> {t("purchasePlanner.allocate")}</Button>
                    {editable && <Button variant="ghost" size="icon-sm" onClick={() => onRemove(line.plan_line_id)} aria-label={t("purchasePlanner.removeLine")}><Trash2 className="size-3.5" /></Button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CoverageTable({ coverage, onDisposition }: { coverage: DemandCoverage[]; onDisposition?: (row: DemandCoverage) => void }) {
  const { t } = useTranslation();
  const grouped = useMemo(() => {
    const result = new Map<number, { name: string; rows: DemandCoverage[] }>();
    for (const row of coverage) {
      const current = result.get(row.customer_id) ?? { name: row.customer_name, rows: [] };
      current.rows.push(row);
      result.set(row.customer_id, current);
    }
    return [...result.entries()];
  }, [coverage]);
  if (!coverage.length) return <p className="rounded-md border p-8 text-center text-sm text-muted-foreground">{t("purchasePlanner.noTrackedDemand")}</p>;
  return (
    <div className="space-y-2">
      {grouped.map(([customerId, group]) => {
        const covered = group.rows.filter((row) => row.coverage_state === "covered").length;
        return (
          <Card key={customerId} size="sm">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Users className="size-4" /> {group.name}</span>
                <span className="text-xs text-muted-foreground">{covered}/{group.rows.length} {t("purchasePlanner.covered")}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {group.rows.map((row) => (
                <div key={`${row.demand_type}-${row.demand_id}`} className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{row.demand_label}</span>
                      <Badge variant={row.intent === "committed" ? "default" : "secondary"} className="text-[10px]">{row.intent}</Badge>
                      <Badge variant={statusTone(row.coverage_state)} className="text-[10px]">{t(`purchasePlanner.coverage.${row.coverage_state}` as never)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      P{row.priority} | {row.covered_this_plan}/{row.target_quantity} {t("purchasePlanner.inThisPlan")}
                      {row.covered_other_plans > 0 ? ` | ${row.covered_other_plans} ${t("purchasePlanner.inOtherPlans")}` : ""}
                      {row.disposition_note ? ` | ${row.disposition_note}` : ""}
                    </div>
                  </div>
                  {onDisposition && !["covered", "covered_elsewhere"].includes(row.coverage_state) && (
                    <Button variant="outline" size="sm" onClick={() => onDisposition(row)}>{t("purchasePlanner.resolve")}</Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function NewPlanDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: number, tripId: number | null) => void }) {
  const { t } = useTranslation();
  const { trips, activeTripId } = useTrips();
  const [tripId, setTripId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  // JPY by default: the buying agent pays Japanese shops in yen, and a budget
  // in a currency he does not spend cannot be compared to what he spends -
  // which is why the over-budget warning never fired on plans made here.
  const [currency, setCurrency] = useState("JPY");
  const [buyer, setBuyer] = useState("");
  const [buyers, setBuyers] = useState<AssignableBuyer[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void createClient().rpc("assignable_buyers")
      .then(({ data }) => setBuyers((data ?? []) as AssignableBuyer[]));
    setTripId(activeTripId);
  }, [open, activeTripId]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error: insertError } = await createClient().from("purchase_plans").insert({
      name: name.trim(),
      budget_currency: currency,
      budget_amount: budget ? Number(budget) : null,
      assigned_buyer_email: buyer || null,
      trip_id: tripId,
      notes: notes.trim() || null,
    }).select("plan_id").single();
    setBusy(false);
    if (insertError) return setError(insertError.message);
    setName(""); setBudget(""); setNotes(""); setBuyer(""); onOpenChange(false); onCreated(Number(data.plan_id), tripId);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("purchasePlanner.newPlan")}</DialogTitle><DialogDescription>{t("purchasePlanner.newPlanDescription")}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="new-plan-name">{t("purchasePlanner.planName")}</Label><Input id="new-plan-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div className="space-y-1"><Label htmlFor="new-plan-budget">Budget</Label><Input id="new-plan-budget" inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="new-plan-currency">Currency</Label><select id="new-plan-currency" className={selectClass} value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="JPY">JPY</option><option value="USD">USD</option></select></div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-plan-trip">Trip</Label>
            <select id="new-plan-trip" className={selectClass} value={tripId ?? ""} onChange={(e) => setTripId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">No trip</option>
              {trips.map((trip) => (
                <option key={trip.trip_id} value={trip.trip_id}>
                  {trip.name}{trip.status === "active" ? " (active)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-plan-buyer">Send to</Label>
            <select id="new-plan-buyer" className={selectClass} value={buyer} onChange={(e) => setBuyer(e.target.value)}>
              <option value="">Nobody yet - assign later</option>
              {buyers.map((b) => (
                <option key={b.email} value={b.email}>
                  {b.email}{b.has_account ? "" : t("purchasePlanner.buyerNoAccount")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1"><Label htmlFor="new-plan-notes">{t("purchasePlanner.notes")}</Label><Textarea id="new-plan-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button><Button onClick={create} disabled={busy || !name.trim()}>{busy ? t("common.saving") : t("common.save")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLineDialog({ planId, open, onOpenChange, onAdded }: { planId: number; open: boolean; onOpenChange: (open: boolean) => void; onAdded: () => void }) {
  const { t } = useTranslation();
  const [game, setGame] = useState<CatalogResult["game"]>("pokemon");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [chosen, setChosen] = useState<CatalogResult | null>(null);
  const [grade, setGrade] = useState("0");
  const [candidates, setCandidates] = useState<CandidateListing[] | null>(null);
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  const [manual, setManual] = useState(false);
  const [manualSource, setManualSource] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualCurrency, setManualCurrency] = useState("JPY");
  const [manualQty, setManualQty] = useState("1");
  const [manualSealedCondition, setManualSealedCondition] = useState("standard");
  const [manualVariantEdition, setManualVariantEdition] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feePolicy, setFeePolicy] = useState<PurchaseFeePolicyState>({
    status: "idle",
    policy: null,
  });
  const sealedPlanning = useSealedPlanningReadiness(open && game === "pokemon_sealed");
  const sealedPlanningBlocked = game === "pokemon_sealed" && sealedPlanning.state !== "ready";
  const sealedPlanningNoticeId = "planner-sealed-planning-readiness";

  useEffect(() => {
    const term = query.trim();
    if (!open || chosen || !term || sealedPlanningBlocked) { setResults([]); return; }
    const timer = setTimeout(() => searchCatalog(game, term).then(setResults).catch((reason: Error) => setError(reason.message)), 250);
    return () => clearTimeout(timer);
  }, [chosen, game, open, query, sealedPlanningBlocked]);

  // The whole point: once a card is chosen, offer the listings we already
  // crawled instead of asking the operator to retype source, URL and price.
  useEffect(() => {
    if (!chosen || chosen.game === "mtg" || (chosen.game === "pokemon_sealed" && sealedPlanning.state !== "ready")) { setCandidates(null); return; }
    let live = true;
    setCandidates(null);
    const sealed = chosen.game === "pokemon_sealed";
    let request = createClient()
      .from(sealed
        ? "pokemon_sealed_purchase_candidate_listings_v"
        : "pokemon_purchase_candidate_listings_v")
      .select(sealed
        ? "listing_id,product_id,sealed_condition,variant_edition,source,listing_url,asking_price,currency,observed_at,stale,available_quantity"
        : "card_id,source,listing_url,asking_price,currency,observed_at,stale,available_quantity")
      .eq(sealed ? "product_id" : "card_id", chosen.id);
    if (sealed) {
      request = request
        .eq("sealed_condition", chosen.sealedCondition)
        .eq("variant_edition", chosen.variantEdition);
    }
    void request
      .order("asking_price")
      .order("source")
      .then(({ data, error: candidateError }) => {
        if (!live) return;
        if (candidateError) {
          setError(candidateError.message);
          setCandidates([]);
          return;
        }
        setCandidates((data ?? []) as CandidateListing[]);
      });
    return () => { live = false; };
  }, [chosen, sealedPlanning.state]);

  useEffect(() => {
    if (!open || !chosen || chosen.game === "mtg") {
      setFeePolicy({ status: "idle", policy: null });
      return;
    }
    let live = true;
    setFeePolicy({ status: "loading", policy: null });
    void loadCurrentPurchaseFeePolicy().then((policy) => {
      if (!live) return;
      setFeePolicy(policy
        ? { status: "ready", policy }
        : { status: "unavailable", policy: null });
    });
    return () => { live = false; };
  }, [chosen, open]);

  useEffect(() => {
    if (!open) {
      setQuery(""); setResults([]); setChosen(null); setError(null);
      setCandidates(null); setPicked(new Map()); setManual(false);
      setFeePolicy({ status: "idle", policy: null });
      // The hand-entry fields too. They used to survive the dialog closing, so
      // the next card opened with the previous card's shop, price, quantity
      // and - worst - its LISTING URL still filled in. A stale per-listing URL
      // points the buying agent at a different card's listing, and a stale
      // price is simply wrong with nothing to catch it: the apparel guard only
      // fires for snkrdunk lines on a card that has an apparel id, and no
      // guard exists for the price at all.
      setManualSource(""); setManualPrice(""); setManualCurrency("JPY");
      setManualQty("1"); setManualUrl("");
      setManualSealedCondition("standard"); setManualVariantEdition("standard");
    }
  }, [open]);

  function chooseResult(result: CatalogResult) {
    if (result.game === "pokemon_sealed" && sealedPlanning.state !== "ready") return;
    setChosen(result);
    setQuery(result.label);
    setPicked(new Map());
    if (result.game === "pokemon_sealed") {
      setManualSealedCondition(result.sealedCondition ?? "standard");
      setManualVariantEdition(result.variantEdition ?? "standard");
    }
  }

  async function addPicked() {
    if (!chosen) return;
    if (chosen.game === "pokemon_sealed" && sealedPlanning.state !== "ready") return;
    const rows = (candidates ?? [])
      .filter((candidate) => picked.has(candidateListingKey(candidate)))
      .map((candidate) => candidatePlanLine(
        planId,
        chosen,
        grade,
        candidate,
        picked.get(candidateListingKey(candidate)) ?? 1,
      ));
    if (!rows.length) return;
    setBusy(true); setError(null);
    const { error: insertError } = await createClient().from("purchase_plan_lines").insert(rows);
    setBusy(false);
    if (insertError) return setError(insertError.message);
    onOpenChange(false); onAdded();
  }

  // What the Add button is still waiting for, in the order the operator fills
  // the form in. Null means it is ready.
  const manualBlockedBy = !chosen
    ? "Choose a card in the search above before adding it by hand."
    : !manualPrice.trim()
      ? "Enter a unit price."
      : parseTypedPrice(manualPrice) == null
        ? "That unit price is not a number."
        : Number.isInteger(Number(manualQty))
          && Number(manualQty) >= 1
          && Number(manualQty) <= 1000
          ? null
          : "Quantity must be a whole number from 1 to 1,000.";

  async function addManual() {
    if (manualBlockedBy) return;
    if (!chosen) return;
    if (chosen.game === "pokemon_sealed" && sealedPlanning.state !== "ready") return;
    setBusy(true); setError(null);
    const { error: insertError } = await createClient().from("purchase_plan_lines").insert(
      manualPlanLine(
        planId,
        chosen,
        grade,
        manualSealedCondition,
        manualVariantEdition,
        manualQty,
        manualSource,
        manualUrl,
        manualPrice,
        manualCurrency,
        new Date().toISOString(),
      ),
    );
    setBusy(false);
    if (insertError) return setError(insertError.message);
    onOpenChange(false); onAdded();
  }

  const pickedCount = picked.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("purchasePlanner.addLine")}</DialogTitle>
          <DialogDescription>Search a card, then pick the listings to buy it from.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]">
            <select className={`${selectClass} min-h-11 sm:min-h-9`} value={game} onChange={(event) => { setGame(event.target.value as CatalogResult["game"]); setChosen(null); setQuery(""); setCandidates(null); setPicked(new Map()); }}>
              {(["pokemon", "mtg", "pokemon_sealed"] as const).map((value) => <option key={value} value={value}>{t(`game.${value}` as never)}</option>)}
            </select>
            <div className="relative"><Search className="absolute left-2 top-3.5 size-4 text-muted-foreground sm:top-2" /><Input className="min-h-11 pl-8 sm:min-h-8" value={chosen?.label ?? query} onChange={(event) => { setChosen(null); setQuery(event.target.value); }} placeholder={t("purchasePlanner.searchCatalog")} disabled={sealedPlanningBlocked} aria-describedby={sealedPlanningBlocked ? sealedPlanningNoticeId : undefined} /></div>
          </div>
          {game === "pokemon_sealed" && (
            <SealedPlanningReadinessNotice
              id={sealedPlanningNoticeId}
              state={sealedPlanning.state}
              error={sealedPlanning.error}
              retry={sealedPlanning.retry}
            />
          )}
          {!chosen && results.length > 0 && <div className="max-h-44 overflow-y-auto rounded-md border">{results.map((result) => <button key={`${result.id}:${result.sealedCondition}:${result.variantEdition}`} type="button" className="block min-h-11 w-full border-b px-3 py-2 text-left text-xs last:border-0 hover:bg-muted" onClick={() => chooseResult(result)}>{result.label}</button>)}</div>}

          {chosen && game !== "pokemon_sealed" && (
            <div className="flex min-w-0 items-center gap-2">
              <Label className="text-xs">{t("purchasePlanner.grade")}</Label>
              <select className={`${selectClass} min-h-11 min-w-0 flex-1 sm:min-h-9`} value={grade} onChange={(event) => setGrade(event.target.value)}>
                <option value="0">{t("purchasePlanner.raw")}</option>
                {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>PSA {value}</option>)}
              </select>
            </div>
          )}

          {chosen && (chosen.game === "pokemon" || chosen.game === "pokemon_sealed") && (
            <CandidatePicker
              candidates={candidates}
              feePolicy={feePolicy}
              picked={picked}
              onToggle={(key, qty) => {
                const next = new Map(picked);
                if (next.has(key)) next.delete(key); else next.set(key, qty);
                setPicked(next);
              }}
              onQuantity={(key, qty) => {
                const next = new Map(picked);
                next.set(key, qty);
                setPicked(next);
              }}
            />
          )}

          <button type="button" className="min-h-11 text-xs underline underline-offset-2 text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setManual((v) => !v)} disabled={sealedPlanningBlocked} aria-describedby={sealedPlanningBlocked ? sealedPlanningNoticeId : undefined}>
            {manual ? "Hide manual entry" : "Enter a listing manually (a shop we do not crawl)"}
          </button>
          {manual && (
            <fieldset
              className="space-y-2 rounded-md border p-3 disabled:opacity-60"
              disabled={sealedPlanningBlocked}
              aria-describedby={sealedPlanningBlocked ? sealedPlanningNoticeId : undefined}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="space-y-1"><Label htmlFor="manual-source">{t("purchasePlanner.source")}</Label><Input id="manual-source" list="known-sources" value={manualSource} onChange={(e) => setManualSource(e.target.value)} placeholder="snkrdunk" /><datalist id="known-sources">{KNOWN_SOURCES.map((name) => <option key={name} value={name} />)}</datalist></div>
                <div className="space-y-1"><Label htmlFor="manual-price">{t("purchasePlanner.unitPrice")}</Label><Input id="manual-price" inputMode="decimal" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="manual-currency">{t("purchasePlanner.currency")}</Label><select id="manual-currency" className={selectClass} value={manualCurrency} onChange={(e) => setManualCurrency(e.target.value)}><option>JPY</option><option>USD</option></select></div>
                <div className="space-y-1"><Label htmlFor="manual-qty">{t("purchasePlanner.quantity")}</Label><Input id="manual-qty" type="number" min="1" max="1000" step="1" value={manualQty} onChange={(e) => setManualQty(e.target.value)} /></div>
                {chosen?.game === "pokemon_sealed" && (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="manual-sealed-condition">{t("column.condition")}</Label>
                      <select id="manual-sealed-condition" className={selectClass} value={manualSealedCondition} onChange={(event) => setManualSealedCondition(event.target.value)}>
                        {SEALED_CONDITIONS.filter((value) => value !== "best").map((value) => <option key={value} value={value}>{conditionLabel(t, value)}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="manual-sealed-edition">{t("column.edition")}</Label>
                      <select id="manual-sealed-edition" className={selectClass} value={manualVariantEdition} onChange={(event) => setManualVariantEdition(event.target.value)}>
                        {SEALED_EDITIONS.filter((value) => value !== "best").map((value) => <option key={value} value={value}>{editionLabel(t, value)}</option>)}
                      </select>
                    </div>
                  </>
                )}
                <div className="space-y-1 sm:col-span-5"><Label htmlFor="manual-url">{t("purchasePlanner.listingUrl")}</Label><Input id="manual-url" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://snkrdunk.com/apparels/107574/used/49500200" /></div>
              </div>
              {/* Say what is still missing. The Add button needs a card as well
                  as a price, and a card is chosen in the search ABOVE this
                  panel - so filling every visible field here left the button
                  dead with nothing on screen explaining why. */}
              {manualBlockedBy && (
                <p id="manual-blocked" className="text-xs text-muted-foreground">{manualBlockedBy}</p>
              )}
            </fieldset>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          {manual
            ? <Button onClick={addManual} disabled={sealedPlanningBlocked || busy || manualBlockedBy != null} aria-describedby={sealedPlanningBlocked ? sealedPlanningNoticeId : manualBlockedBy ? "manual-blocked" : undefined}>{busy ? t("common.saving") : t("purchasePlanner.addLine")}</Button>
            : <Button onClick={addPicked} disabled={sealedPlanningBlocked || busy || pickedCount === 0} aria-describedby={sealedPlanningBlocked ? sealedPlanningNoticeId : undefined}>{busy ? t("common.saving") : `Add ${pickedCount || ""} ${pickedCount === 1 ? "line" : "lines"}`.trim()}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type CandidateListing = {
  listing_id?: number;
  product_id?: number;
  sealed_condition?: string | null;
  variant_edition?: string | null;
  source: string;
  listing_url: string;
  asking_price: number;
  currency: string;
  observed_at: string;
  stale: boolean;
  // Copies the shop reported when we looked. null means it did not say, which
  // is NOT none - the listing is still purchasable at an unknown depth.
  available_quantity: number | null;
};

export function candidateListingKey(candidate: CandidateListing): string {
  return [
    candidate.listing_id ?? "url",
    candidate.source,
    candidate.listing_url,
    candidate.sealed_condition ?? "card",
    candidate.variant_edition ?? "card",
  ].join(":");
}

export function candidatePlanLine(
  planId: number,
  chosen: CatalogResult,
  grade: string,
  candidate: CandidateListing,
  quantity: number,
) {
  const sealed = chosen.game === "pokemon_sealed";
  return {
    plan_id: planId,
    game: chosen.game,
    card_id: sealed ? null : chosen.id,
    product_id: sealed ? chosen.id : null,
    psa_grade: sealed ? null : Number(grade),
    sealed_condition: sealed
      ? candidate.sealed_condition ?? chosen.sealedCondition
      : null,
    variant_edition: sealed
      ? candidate.variant_edition ?? chosen.variantEdition
      : null,
    planned_quantity: quantity,
    source: candidate.source,
    source_listing_url: candidate.listing_url,
    unit_price_orig: candidate.asking_price,
    currency: candidate.currency,
    // Keep the crawl time. Replacing it with now hides a stale observation.
    source_observed_at: candidate.observed_at,
  };
}

export function manualPlanLine(
  planId: number,
  chosen: CatalogResult,
  grade: string,
  sealedCondition: string,
  variantEdition: string,
  quantity: string,
  source: string,
  listingUrl: string,
  unitPrice: string,
  currency: string,
  observedAt: string,
) {
  const sealed = chosen.game === "pokemon_sealed";
  return {
    plan_id: planId,
    game: chosen.game,
    card_id: sealed ? null : chosen.id,
    product_id: sealed ? chosen.id : null,
    psa_grade: sealed ? null : Number(grade),
    sealed_condition: sealed ? sealedCondition : null,
    variant_edition: sealed ? variantEdition : null,
    planned_quantity: Number(quantity),
    // Source normalization keeps one checkout and one fee group per shop.
    source: source.trim().toLowerCase() || null,
    source_listing_url: listingUrl.trim() || null,
    unit_price_orig: parseTypedPrice(unitPrice),
    currency,
    source_observed_at: observedAt,
  };
}

export function CandidatePicker({
  candidates, feePolicy, picked, onToggle, onQuantity,
}: {
  candidates: CandidateListing[] | null;
  feePolicy: PurchaseFeePolicyState;
  picked: Map<string, number>;
  onToggle: (key: string, qty: number) => void;
  onQuantity: (key: string, qty: number) => void;
}) {
  const { t } = useTranslation();
  if (candidates === null) return <p className="text-sm text-muted-foreground">Loading listings…</p>;
  if (!candidates.length) {
    return (
      <p className="rounded-md border p-3 text-sm text-muted-foreground">
        No current listings for this card. Use manual entry below.
      </p>
    );
  }
  // JPY first: those are the ones the buying agent can actually order, and the
  // fee model only applies to them. Ranking a USD listing against a JPY one by
  // raw number would be meaningless.
  const jpy = candidates.filter((c) => c.currency === "JPY");
  const other = candidates.filter((c) => c.currency !== "JPY");
  const policyNotice = feePolicy.status === "ready"
    ? t("purchasePlanner.feePolicy", {
        rate: purchaseFeePercent(feePolicy.policy),
        amount: Math.round(feePolicy.policy.lineFeeJpy).toLocaleString(),
        date: feePolicy.policy.effectiveFrom,
      })
    : feePolicy.status === "loading"
      ? t("purchasePlanner.feePolicyLoading")
      : t("purchasePlanner.feePolicyUnavailable");

  const row = (c: CandidateListing) => {
    const key = candidateListingKey(c);
    const qty = picked.get(key) ?? 1;
    const on = picked.has(key);
    return (
      <tr key={key} className="border-t">
        <td className="px-2 py-1">
          <label className="inline-flex size-11 cursor-pointer items-center justify-center sm:size-6">
            <input type="checkbox" className="size-6 sm:size-4" checked={on} onChange={() => onToggle(key, qty)} aria-label={`select ${c.source}`} />
          </label>
        </td>
        <td className="px-2 py-1">{c.source}</td>
        <td className="px-2 py-1 text-xs text-muted-foreground">
          {c.sealed_condition && c.variant_edition
            ? `${editionLabel(t, c.variant_edition)} · ${conditionLabel(t, c.sealed_condition)}`
            : "-"}
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          {Math.round(c.asking_price).toLocaleString()} {c.currency}
        </td>
        <td className="px-2 py-1 text-right">
          <input
            type="number" min="1" max="1000" step="1" value={qty} disabled={!on}
            onChange={(e) => onQuantity(key, Math.min(1000, Math.max(1, Math.floor(Number(e.target.value)))))}
            className="min-h-11 w-16 bg-transparent text-right tabular-nums disabled:text-muted-foreground/40 sm:min-h-0"
          />
        </td>
        <td className="px-2 py-1 text-right tabular-nums">
          {c.available_quantity == null ? (
            // Not "0" and not "-": the shop has it, we just were not told how
            // many, and showing a number here would invent one.
            <span className="text-muted-foreground" title="This shop does not publish a count">unknown</span>
          ) : (
            // Asking for more than the shop holds is the whole reason the count
            // is here, so it has to be visible at a glance rather than inferred.
            <span className={on && qty > c.available_quantity ? "font-medium text-destructive" : "text-muted-foreground"}
                  title={on && qty > c.available_quantity
                    ? `Only ${c.available_quantity} on hand; ${qty - c.available_quantity} would need another shop`
                    : undefined}>
              {c.available_quantity.toLocaleString()}
            </span>
          )}
        </td>
        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
          {c.currency !== "JPY"
            ? "-"
            : feePolicy.status === "ready"
              ? t("purchasePlanner.perCardJpy", {
                  amount: Math.round(landedPerCardJpy(
                    c.asking_price,
                    qty,
                    feePolicy.policy,
                  )).toLocaleString(),
                })
              : t("purchasePlanner.feeEstimateUnavailableShort")}
        </td>
        <td className="px-2 py-1 text-xs text-muted-foreground">
          {c.stale ? <span title={c.observed_at}>price may be stale</span> : new Date(c.observed_at).toLocaleDateString()}
        </td>
        <td className="px-2 py-1">
          <a href={c.listing_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center justify-center text-xs underline underline-offset-2 hover:text-primary sm:min-h-0 sm:min-w-0">open</a>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-2">
      <p
        className="text-xs text-muted-foreground"
        role="status"
        data-fee-policy-status={feePolicy.status}
      >
        {policyNotice}
      </p>
      <div
        className="max-h-72 min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded-md border"
        data-testid="purchase-fee-candidates"
      >
        <table className="w-full min-w-[680px] text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-1"></th>
            <th className="px-2 py-1 text-left font-normal">Source</th>
            <th className="px-2 py-1 text-left font-normal">Variant</th>
            <th className="px-2 py-1 text-right font-normal">Asking</th>
            <th className="px-2 py-1 text-right font-normal">Qty</th>
            <th className="px-2 py-1 text-right font-normal">In stock</th>
            <th className="px-2 py-1 text-right font-normal">Landed w/ fees</th>
            <th className="px-2 py-1 text-left font-normal">Seen</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {jpy.map(row)}
          {other.length > 0 && (
            <tr className="border-t bg-muted/30">
              <td colSpan={9} className="px-2 py-1 text-xs text-muted-foreground">
                Not orderable through the JP buyer - the fee model does not apply
              </td>
            </tr>
          )}
          {other.map(row)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AllocationDialog({ line, allocations, editable, open, onOpenChange, onChanged }: { line: PurchasePlanLine | null; allocations: PurchaseAllocation[]; editable: boolean; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<PurchaseCandidate[]>([]);
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [originKey, setOriginKey] = useState("");
  const [role, setRole] = useState<"primary" | "backup">("primary");
  const [primaryId, setPrimaryId] = useState("");
  const [rank, setRank] = useState("1");
  const [quantity, setQuantity] = useState("1");
  const [salePrice, setSalePrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Custom order: a customer who asked for this card without ever putting it
  // on a wishlist. They cannot appear as a candidate, because a candidate is
  // derived from existing demand.
  const [allCustomers, setAllCustomers] = useState<{ customer_id: number; name: string }[]>([]);
  const [customOrderId, setCustomOrderId] = useState<number | null>(null);
  const [customIntent, setCustomIntent] = useState<"requested" | "committed">("requested");
  const [customerQuery, setCustomerQuery] = useState("");
  const active = allocations.filter((allocation) => allocation.plan_line_id === line?.plan_line_id && !["released", "cancelled"].includes(allocation.status));
  const primaries = active.filter((allocation) => allocation.role === "primary");
  const selected = candidates.find((candidate) => candidate.customer_id === candidateId) ?? null;
  const origins = selected ? sortedOrigins(selected.demand_origins) : [];

  useEffect(() => {
    if (!open || !line) return;
    setBusy(true); setError(null); setCandidateId(null); setOriginKey("");
    createClient().from("customer_purchase_candidates_v").select("*").eq("plan_line_id", line.plan_line_id).order("top_priority")
      .then(({ data, error: queryError }) => { setBusy(false); if (queryError) setError(queryError.message); else setCandidates((data ?? []) as PurchaseCandidate[]); });
    void createClient().from("customers").select("customer_id,name").order("name")
      .then(({ data }) => setAllCustomers((data ?? []) as { customer_id: number; name: string }[]));
    setCustomOrderId(null); setCustomerQuery("");
  }, [line, open]);

  // Records the ask as real demand and allocates in one call, so the copy is
  // never promised to somebody the rest of the system cannot see.
  async function addCustomOrder() {
    if (!line || customOrderId == null) return;
    setBusy(true); setError(null);
    const { error: rpcError } = await createClient().rpc("assign_plan_line_to_customer", {
      p_plan_line_id: line.plan_line_id,
      p_customer_id: customOrderId,
      p_quantity: Number(quantity) || 1,
      p_role: role,
      p_intent: customIntent,
      p_note: null,
      p_agreed_sale_price_usd: salePrice ? Number(salePrice) : null,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setCustomOrderId(null); setCustomerQuery(""); onChanged();
    const { data } = await createClient().from("customer_purchase_candidates_v").select("*").eq("plan_line_id", line.plan_line_id).order("top_priority");
    setCandidates((data ?? []) as PurchaseCandidate[]);
  }

  async function add() {
    if (!line || !selected || !originKey) return;
    const [demandType, id] = originKey.split(":");
    setBusy(true); setError(null);
    const { error: rpcError } = await createClient().rpc("add_purchase_plan_allocation", {
      p_plan_line_id: line.plan_line_id,
      p_customer_id: selected.customer_id,
      p_demand_type: demandType,
      p_demand_id: Number(id),
      p_role: role,
      p_quantity: Number(quantity),
      p_backup_rank: role === "backup" ? Number(rank) : null,
      p_backs_up_allocation_id: role === "backup" ? Number(primaryId) : null,
      p_proposed_sale_price_usd: salePrice ? Number(salePrice) : null,
      p_agreed_sale_price_usd: null,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setCandidateId(null); setOriginKey(""); onChanged();
    const { data } = await createClient().from("customer_purchase_candidates_v").select("*").eq("plan_line_id", line.plan_line_id).order("top_priority");
    setCandidates((data ?? []) as PurchaseCandidate[]);
  }

  async function release(allocationId: number) {
    const reason = window.prompt(t("purchasePlanner.releaseReason")) ?? "";
    const { error: rpcError } = await createClient().rpc("release_purchase_plan_allocation", { p_allocation_id: allocationId, p_reason: reason || null });
    if (rpcError) setError(rpcError.message); else onChanged();
  }

  async function promote(allocationId: number) {
    const reason = window.prompt(t("purchasePlanner.promoteReason")) ?? "";
    const { error: rpcError } = await createClient().rpc("promote_purchase_plan_backup", { p_backup_allocation_id: allocationId, p_reason: reason || null });
    if (rpcError) setError(rpcError.message); else onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t("purchasePlanner.allocateTitle")}</DialogTitle><DialogDescription>{line?.item_name}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>{t("purchasePlanner.currentAssignments")}</Label>
            {active.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">{t("purchasePlanner.unassigned")}</p> : <div className="mt-1 space-y-1">{active.map((allocation) => <div key={allocation.allocation_id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"><Badge variant={allocation.role === "primary" ? "default" : "outline"}>{allocation.role}{allocation.backup_rank ? ` #${allocation.backup_rank}` : ""}</Badge><span className="flex-1">{allocation.customer_name} | {allocation.demand_label} | {allocation.quantity}x</span>{editable && allocation.role === "backup" && <Button variant="outline" size="sm" onClick={() => promote(allocation.allocation_id)}>{t("purchasePlanner.promote")}</Button>}{editable && <Button variant="ghost" size="icon-sm" onClick={() => release(allocation.allocation_id)}><Trash2 className="size-3.5" /></Button>}</div>)}</div>}
          </div>
          {editable && <div className="space-y-2 border-t pt-3">
            <Label>{t("purchasePlanner.customerCandidates")}</Label>
            {!busy && candidates.length === 0 ? <p className="text-xs text-muted-foreground">{t("purchasePlanner.noCandidates")}</p> : <div className="grid gap-2 sm:grid-cols-2">{candidates.map((candidate) => <button type="button" key={candidate.customer_id} onClick={() => { setCandidateId(candidate.customer_id); const first = sortedOrigins(candidate.demand_origins)[0]; setOriginKey(first ? `${first.type}:${first.id}` : ""); }} className={`rounded-md border p-2 text-left ${candidateId === candidate.customer_id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{candidate.customer_name}</span><Badge variant={candidate.strongest_intent === "committed" ? "default" : "secondary"}>{candidate.strongest_intent}</Badge></div><div className="text-xs text-muted-foreground">P{candidate.top_priority} | {candidate.remaining_demand_quantity} {t("purchasePlanner.remaining")}{candidate.top_customer_ceiling_usd != null ? ` | <=${money(candidate.top_customer_ceiling_usd)}` : ""}</div></button>)}</div>}
          </div>}
          {editable && !selected && (
            <div className="space-y-2 border-t pt-3">
              <Label>Custom order - assign anyone</Label>
              <p className="text-xs text-muted-foreground">
                Not being on a customer&apos;s wishlist does not mean they did not ask for it.
                Choosing someone here records the request as demand, so the copy shows up as
                spoken for everywhere else.
              </p>
              <Input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Search customers..."
              />
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {allCustomers
                  .filter((c) => c.name.toLowerCase().includes(customerQuery.trim().toLowerCase()))
                  .slice(0, 50)
                  .map((c) => (
                    <button
                      key={c.customer_id}
                      type="button"
                      onClick={() => setCustomOrderId(c.customer_id)}
                      className={`block w-full border-b px-3 py-1.5 text-left text-xs last:border-0 ${
                        customOrderId === c.customer_id ? "bg-primary/10 font-medium" : "hover:bg-muted"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
              </div>
              {customOrderId != null && (
                <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label>How firm</Label>
                    <select className={selectClass} value={customIntent} onChange={(e) => setCustomIntent(e.target.value as "requested" | "committed")}>
                      <option value="requested">Asked for it</option>
                      <option value="committed">Committed to buy</option>
                    </select>
                  </div>
                  <div className="space-y-1"><Label>{t("purchasePlanner.quantity")}</Label><Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
                  <div className="space-y-1"><Label>{t("purchasePlanner.proposedSale")}</Label><Input inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></div>
                  <div className="sm:col-span-3">
                    <Button size="sm" onClick={addCustomOrder} disabled={busy}>
                      {busy ? t("common.saving") : "Record custom order and assign"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {editable && selected && <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2"><Label>{t("purchasePlanner.demandOrigin")}</Label><select className={selectClass} value={originKey} onChange={(event) => setOriginKey(event.target.value)}>{origins.map((origin: DemandOrigin) => <option key={`${origin.type}:${origin.id}`} value={`${origin.type}:${origin.id}`}>{origin.intent} | P{origin.priority} | {origin.label} | {origin.remaining_quantity} {t("purchasePlanner.remaining")}</option>)}</select></div>
            <div className="space-y-1"><Label>{t("purchasePlanner.role")}</Label><select className={selectClass} value={role} onChange={(event) => setRole(event.target.value as "primary" | "backup")}><option value="primary">{t("purchasePlanner.primary")}</option><option value="backup" disabled={!primaries.length}>{t("purchasePlanner.backup")}</option></select></div>
            <div className="space-y-1"><Label>{t("purchasePlanner.quantity")}</Label><Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
            {role === "backup" && <><div className="space-y-1"><Label>{t("purchasePlanner.backsUp")}</Label><select className={selectClass} value={primaryId} onChange={(event) => setPrimaryId(event.target.value)}><option value="">{t("purchasePlanner.choosePrimary")}</option>{primaries.map((allocation) => <option key={allocation.allocation_id} value={allocation.allocation_id}>{allocation.customer_name}</option>)}</select></div><div className="space-y-1"><Label>{t("purchasePlanner.backupRank")}</Label><Input type="number" min="1" value={rank} onChange={(event) => setRank(event.target.value)} /></div></>}
            <div className="space-y-1"><Label>{t("purchasePlanner.proposedSale")}</Label><Input inputMode="decimal" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} /></div>
          </div>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>{editable && <Button onClick={add} disabled={busy || !selected || !originKey || (role === "backup" && !primaryId)}>{t("purchasePlanner.assign")}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ plan, open, onOpenChange, onChanged }: { plan: PurchasePlan; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [validation, setValidation] = useState<PlanValidation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setBusy(true); setError(null); setAcknowledged(false);
    createClient().rpc("validate_purchase_plan", { p_plan_id: plan.plan_id }).then(({ data, error: rpcError }) => { setBusy(false); if (rpcError) setError(rpcError.message); else setValidation(data as unknown as PlanValidation); });
  }, [open, plan.plan_id]);
  async function advance() {
    setBusy(true); setError(null);
    const rpc = plan.status === "ready" ? "mark_purchase_plan_ordered" : "mark_purchase_plan_ready";
    const { error: rpcError } = await createClient().rpc(rpc, { p_plan_id: plan.plan_id, p_acknowledge_warnings: acknowledged });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    onOpenChange(false); onChanged();
  }
  const hasWarnings = (validation?.warnings.length ?? 0) > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{plan.status === "ready" ? t("purchasePlanner.orderReview") : t("purchasePlanner.readinessReview")}</DialogTitle><DialogDescription>{t("purchasePlanner.reviewDescription")}</DialogDescription></DialogHeader>
        {busy && !validation ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : validation && <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-md border p-2"><div className="text-lg font-semibold">{validation.summary.planned_quantity}</div>{t("purchasePlanner.units")}</div><div className="rounded-md border p-2"><div className="text-lg font-semibold">{validation.summary.primary_quantity}</div>{t("purchasePlanner.assigned")}</div><div className="rounded-md border p-2"><div className="text-lg font-semibold">{money(validation.summary.landed_total_usd)}</div>{t("purchasePlanner.landedTotal")}</div></div>
          <ValidationSection icon={<AlertTriangle className="size-4 text-destructive" />} title={t("purchasePlanner.blockers")} items={validation.blockers} empty={t("purchasePlanner.noBlockers")} />
          <ValidationSection icon={<AlertTriangle className="size-4 text-amber-500" />} title={t("purchasePlanner.warnings")} items={validation.warnings} empty={t("purchasePlanner.noWarnings")} />
          {hasWarnings && <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><input className="mt-1" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{t("purchasePlanner.acknowledgeWarnings")}</span></label>}
        </div>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button><Button onClick={advance} disabled={busy || !validation?.valid || (hasWarnings && !acknowledged)}>{plan.status === "ready" ? t("purchasePlanner.confirmOrdered") : t("purchasePlanner.markReady")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValidationSection({ icon, title, items, empty }: { icon: React.ReactNode; title: string; items: PlanValidation["warnings"]; empty: string }) {
  return <div><div className="mb-1 flex items-center gap-1.5 font-medium">{icon}{title}</div>{items.length ? <div className="space-y-1">{items.map((item, index) => <div key={`${item.code}-${item.line_id}-${index}`} className="rounded-md border px-2 py-1.5 text-xs"><span className="font-medium">{item.code}</span>{item.line_id ? ` | #${item.line_id}` : ""}: {item.detail}</div>)}</div> : <div className="flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 className="size-3.5" />{empty}</div>}</div>;
}

function DispositionDialog({ planId, demand, open, onOpenChange, onChanged }: { planId: number; demand: DemandCoverage | null; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("deferred");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setNote(demand?.disposition_note ?? ""); setError(null); } }, [demand?.disposition_note, open]);
  async function save() {
    if (!demand || !note.trim()) return;
    setBusy(true); setError(null);
    const { error: rpcError } = await createClient().rpc("set_purchase_plan_demand_disposition", { p_plan_id: planId, p_demand_type: demand.demand_type, p_demand_id: demand.demand_id, p_disposition: value, p_note: note.trim() });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    onOpenChange(false); onChanged();
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{t("purchasePlanner.resolveDemand")}</DialogTitle><DialogDescription>{demand?.customer_name} | {demand?.demand_label}</DialogDescription></DialogHeader><div className="space-y-3"><div className="space-y-1"><Label>{t("purchasePlanner.disposition")}</Label><select className={selectClass} value={value} onChange={(event) => setValue(event.target.value)}><option value="deferred">{t("purchasePlanner.coverage.deferred")}</option><option value="unavailable">{t("purchasePlanner.coverage.unavailable")}</option><option value="out_of_scope">{t("purchasePlanner.coverage.out_of_scope")}</option></select></div><div className="space-y-1"><Label>{t("purchasePlanner.reasonRequired")}</Label><Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></div>{error && <p className="text-sm text-destructive">{error}</p>}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button><Button onClick={save} disabled={busy || !note.trim()}>{t("common.save")}</Button></DialogFooter></DialogContent></Dialog>;
}


// What the buying agent has actually bought, while he is still buying.
//
// The planner above shows what was ASKED for - every line reads "0/20, 20 open"
// no matter how much has been purchased - which is exactly the wrong number to
// budget against mid-trip. This strip reads purchase_plan_progress_v, whose
// fee projection uses the same rules reconciliation applies, so the total shown
// here is the total that will land.
function BuyerProgressStrip({ planId }: { planId: number }) {
  const { t } = useTranslation();
  const [row, setRow] = useState<{
    purchased_lines: number; open_lines: number; unavailable_lines: number;
    cards_bought: number; card_value_jpy: number; projected_handling_jpy: number;
    projected_line_fee_jpy: number; projected_total_jpy: number;
    budget_amount: number | null; budget_currency: string | null;
  } | null>(null);

  const [shops, setShops] = useState<ShopProgress[]>([]);

  // This strip used to load once and never look again, so the operator watched
  // a frozen number while the agent was actually in a shop spending against it.
  // Poll while the tab is open, and catch up immediately on focus - the common
  // case is the operator coming back to the window to check on him.
  useEffect(() => {
    let live = true;
    const supabase = createClient();

    async function load() {
      const [progress, bySource] = await Promise.all([
        supabase
          .from("purchase_plan_progress_v")
          .select("purchased_lines,open_lines,unavailable_lines,cards_bought,card_value_jpy," +
                  "projected_handling_jpy,projected_line_fee_jpy,projected_total_jpy,budget_amount,budget_currency")
          .eq("plan_id", planId)
          .maybeSingle(),
        supabase
          .from("purchase_plan_source_progress_v")
          .select("source,total_lines,recorded_lines,purchased_lines,cards_bought," +
                  "card_value_jpy,shipping_jpy,other_costs_jpy,agent_payout_jpy,spent_total_jpy")
          .eq("plan_id", planId)
          .order("source"),
      ]);
      if (!live) return;
      setRow(progress.data as typeof row);
      setShops((bySource.data ?? []) as ShopProgress[]);
    }

    void load();
    const timer = setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [planId]);

  if (!row || row.purchased_lines === 0) return null;

  const jpy = (n: number) => "JPY " + Math.round(n).toLocaleString();
  // Budget is only comparable when the plan is budgeted in the same currency
  // the buyer pays in; comparing JPY spend to a USD budget would be a lie.
  const overBudget =
    row.budget_amount != null && row.budget_currency === "JPY" &&
    row.projected_total_jpy > row.budget_amount;

  return (
    <div role="region" aria-label={t("purchasePlanner.buyerProgress")} className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1 rounded-md border px-3 py-2 text-sm">
      <span className="font-medium">{t("purchasePlanner.buyerProgress")}</span>
      <span>{t("purchasePlanner.progressCounts", { bought: String(row.purchased_lines), open: String(row.open_lines), unavailable: String(row.unavailable_lines) })}</span>
      <span>{t("purchasePlanner.cardsBought", { count: String(row.cards_bought) })}</span>
      <span className="text-muted-foreground">
        {t("purchasePlanner.progressCosts", { cards: jpy(row.card_value_jpy), handling: jpy(row.projected_handling_jpy), fees: jpy(row.projected_line_fee_jpy) })}
      </span>
      <span className={overBudget ? "font-semibold text-destructive" : "font-semibold"}>
        {t("purchasePlanner.projectedCost", { amount: jpy(row.projected_total_jpy) })}
        {row.budget_amount != null && row.budget_currency === "JPY" && (
          <span className="ml-2 font-normal text-muted-foreground">
            {t("purchasePlanner.ofBudget", { amount: jpy(row.budget_amount) })}
          </span>
        )}
      </span>
      {overBudget && (
        <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
          {t("purchasePlanner.overBudgetBy", { amount: jpy(row.projected_total_jpy - (row.budget_amount ?? 0)) })}
        </span>
      )}

      {/* The agent checks out one shop at a time and enters that shop's
          shipping there, so the plan-wide figure above hides where the money
          actually went and what he is owed for each stop. */}
      {shops.length > 0 && (
        <div className="basis-full overflow-x-auto">
        <table className="w-full min-w-[36rem] text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3 font-normal">{t("purchasePlanner.progressShop")}</th>
              <th className="py-1 pr-3 font-normal">{t("purchasePlanner.progressWorked")}</th>
              <th className="py-1 pr-3 font-normal">{t("purchasePlanner.progressBought")}</th>
              <th className="py-1 pr-3 text-right font-normal">{t("purchasePlanner.progressCards")}</th>
              <th className="py-1 pr-3 text-right font-normal">{t("purchasePlanner.progressShipping")}</th>
              <th className="py-1 pr-3 text-right font-normal">{t("purchasePlanner.progressOther")}</th>
              <th className="py-1 pr-3 text-right font-normal">{t("purchasePlanner.progressFee")}</th>
              <th className="py-1 text-right font-normal">{t("purchasePlanner.progressSpent")}</th>
            </tr>
          </thead>
          <tbody>
            {shops.map((s) => (
              <tr key={s.source} className="border-t">
                <td className="py-1 pr-3 font-medium">{s.source}</td>
                <td className="py-1 pr-3">{s.recorded_lines}/{s.total_lines}</td>
                <td className="py-1 pr-3">{s.purchased_lines}</td>
                <td className="py-1 pr-3 text-right">{jpy(s.card_value_jpy)}</td>
                <td className="py-1 pr-3 text-right">{jpy(s.shipping_jpy)}</td>
                <td className="py-1 pr-3 text-right">{jpy(s.other_costs_jpy)}</td>
                <td className="py-1 pr-3 text-right">{jpy(s.agent_payout_jpy)}</td>
                <td className="py-1 text-right font-medium">{jpy(s.spent_total_jpy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

type ShopProgress = {
  source: string;
  total_lines: number;
  recorded_lines: number;
  purchased_lines: number;
  cards_bought: number;
  card_value_jpy: number;
  shipping_jpy: number;
  other_costs_jpy: number;
  agent_payout_jpy: number;
  spent_total_jpy: number;
};


type AssignableBuyer = { email: string; has_account: boolean; last_sign_in: string | null };

// Choosing who a plan goes to.
//
// assigned_buyer_email has existed since the buyer flow shipped and every
// buyer-facing query scopes on it, but nothing ever exposed a way to SET it -
// so a plan could be built and then sent to nobody. Assignment has to happen
// while the plan is still editable: guard_purchase_plan_mutation freezes the
// row once it is ordered, which is correct, because the buyer is shopping
// against it by then.
function PlanBuyerControl({
  plan, onChanged, canReassign,
}: { plan: PurchasePlan; onChanged: () => void; canReassign: boolean }) {
  const { t, language } = useTranslation();
  const [buyers, setBuyers] = useState<AssignableBuyer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void createClient().rpc("assignable_buyers")
      .then(({ data }) => setBuyers((data ?? []) as AssignableBuyer[]));
  }, []);

  async function assign(email: string) {
    setSaving(true); setError(null);
    const { error: updateError } = await createClient()
      .from("purchase_plans")
      .update({ assigned_buyer_email: email || null })
      .eq("plan_id", plan.plan_id);
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    onChanged();
  }

  // Sending is a button, not a side effect.
  //
  // This used to read `plan.status !== "draft"` and render a green "Sent"
  // badge from it, which was true before the operator had done anything and
  // named no moment at all. Now the badge reflects purchase_plans.sent_at:
  // somebody pressed send, and this is when.
  const sent = plan.sent_at != null;

  async function send() {
    setSaving(true); setError(null);
    const { error: rpcError } = await createClient()
      .rpc("send_purchase_plan", { p_plan_id: plan.plan_id });
    setSaving(false);
    if (rpcError) { setError(formatMutationError(rpcError)); return; }
    onChanged();
  }

  async function recall() {
    setSaving(true); setError(null);
    const { error: rpcError } = await createClient()
      .rpc("recall_purchase_plan", { p_plan_id: plan.plan_id });
    setSaving(false);
    if (rpcError) { setError(formatMutationError(rpcError)); return; }
    onChanged();
  }

  return (
    <div role="group" aria-label={t("purchasePlanner.buyingAgent")} className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      <label htmlFor={`plan-buyer-${plan.plan_id}`} className="text-muted-foreground">{t("purchasePlanner.buyingAgent")}</label>
      <select
        id={`plan-buyer-${plan.plan_id}`}
        className={`${selectClass} min-h-11 min-w-0`}
        value={plan.assigned_buyer_email ?? ""}
        disabled={saving || !canReassign}
        onChange={(e) => void assign(e.target.value)}
      >
        <option value="">{t("purchasePlanner.nobodyYet")}</option>
        {buyers.map((b) => (
          <option key={b.email} value={b.email}>
            {b.email}{b.has_account ? "" : t("purchasePlanner.buyerNoAccount")}
          </option>
        ))}
      </select>

      {sent ? (
        <>
          <span
            className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-600 dark:text-emerald-400"
            title={new Date(plan.sent_at!).toLocaleString()}
          >
            {t("purchasePlanner.sentOn", { date: new Date(plan.sent_at!).toLocaleDateString(language === "ja" ? "ja-JP" : "en-US") })}
          </span>
          {/* Recall refuses server-side once he has recorded anything, because
              by then he is standing in a shop working from the list. The
              button stays visible so the refusal can say that. */}
          <Button type="button" size="sm" variant="outline" className="min-h-11 min-w-11" disabled={saving} onClick={() => void recall()}>
            {t("purchasePlanner.recallPlan")}
          </Button>
          {/* The screen he is actually looking at, from here. Not having this
              is why a Google-translated page with an unreadable dropdown went
              unnoticed for a day: the person who could fix it could not see
              it. Read only - his entries stay his. */}
          <a
            href="/dashboard/buyer-view"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center rounded border px-3 py-2 underline-offset-2 hover:bg-accent hover:underline"
          >
            {t("purchasePlanner.seeBuyerScreen")}
          </a>
        </>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            className="min-h-11 min-w-11"
            disabled={saving || !plan.assigned_buyer_email}
            onClick={() => void send()}
          >
            {t("purchasePlanner.sendToBuyer")}
          </Button>
          <span className="text-muted-foreground">
            {plan.assigned_buyer_email
              ? t("purchasePlanner.notSentHelp")
              : t("purchasePlanner.chooseBuyerFirst")}
          </span>
        </>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
