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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QueryError, useSupabaseQuery } from "./use-query";

const selectClass =
  "h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

interface PlannerData {
  plans: PurchasePlan[];
  lines: PurchasePlanLine[];
  allocations: PurchaseAllocation[];
  coverage: DemandCoverage[];
}

interface CatalogResult {
  id: number;
  game: "pokemon" | "mtg" | "pokemon_sealed";
  label: string;
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

async function searchCatalog(game: CatalogResult["game"], raw: string): Promise<CatalogResult[]> {
  const tokens = raw.replace(/[%,()]/g, " ").split(/\s+/).map((v) => v.trim()).filter(Boolean);
  if (!tokens.length) return [];
  const supabase = createClient();
  if (game === "pokemon_sealed") {
    let query = supabase.from("pokemon_sealed_products").select("product_id, name, english_name, set_code");
    for (const token of tokens) {
      query = query.or(`name.ilike.%${token}%,english_name.ilike.%${token}%,set_code.ilike.%${token}%`);
    }
    const { data, error } = await query.limit(10);
    if (error) throw error;
    return (data ?? []).map((row: { product_id: number; name: string; english_name: string | null; set_code: string | null }) => ({
      id: row.product_id,
      game,
      label: `${row.english_name || row.name}${row.set_code && row.set_code !== "UNKNOWN" ? ` | ${row.set_code}` : ""}`,
    }));
  }
  if (game === "mtg") {
    let query = supabase
      .from("mtg_card_definitions_v")
      .select("card_id, regional_name, local_name, set_code, card_number, misc_info");
    for (const token of tokens) {
      query = query.or(
        `regional_name.ilike.%${token}%,local_name.ilike.%${token}%,set_code.ilike.%${token}%,card_number.ilike.%${token}%,misc_info.ilike.%${token}%`,
      );
    }
    const { data, error } = await query.limit(10);
    if (error) throw error;
    return (data ?? []).map((row: { card_id: number; regional_name: string; set_code: string; card_number: string }) => ({
      id: row.card_id,
      game,
      label: `${row.regional_name} | ${row.set_code} ${row.card_number}`,
    }));
  }
  let query = supabase
    .from("pokemon_card_definitions")
    .select("card_id, regional_name, english_name, set_code, card_number, misc_info");
  for (const token of tokens) {
    query = query.or(
      `regional_name.ilike.%${token}%,english_name.ilike.%${token}%,set_code.ilike.%${token}%,card_number.ilike.%${token}%,misc_info.ilike.%${token}%`,
    );
  }
  const { data, error } = await query.limit(10);
  if (error) throw error;
  return (data ?? []).map((row: { card_id: number; regional_name: string; english_name: string | null; set_code: string; card_number: string }) => ({
    id: row.card_id,
    game,
    label: `${row.english_name || row.regional_name} | ${row.set_code} ${row.card_number}`,
  }));
}

function money(value: number | null | undefined): string {
  return value == null ? "-" : `$${Number(value).toFixed(2)}`;
}

function itemMeta(line: PurchasePlanLine): string {
  return [line.set_code && line.set_code !== "UNKNOWN" ? line.set_code : null, line.card_number, line.misc_info && line.misc_info !== "UNKNOWN" ? line.misc_info : null]
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
  const [disposition, setDisposition] = useState<DemandCoverage | null>(null);
  const { data, error, isLoading, retry } = useSupabaseQuery(["purchase-planner", planId], () => fetchPlannerData(planId));

  useEffect(() => {
    if (planId == null && data?.plans[0]) setPlanId(data.plans[0].plan_id);
  }, [data?.plans, planId]);

  const plan = data?.plans.find((candidate) => candidate.plan_id === planId) ?? null;
  const allocations = data?.allocations ?? [];
  const coverage = data?.coverage ?? [];
  const lines = data?.lines ?? [];
  const summary = useMemo(() => summarizePlan(lines, coverage, allocations), [lines, coverage, allocations]);
  const editable = plan?.status === "draft" || plan?.status === "ready";

  async function removeLine(lineId: number) {
    if (!window.confirm(t("purchasePlanner.removeLineConfirm"))) return;
    const { error: deleteError } = await createClient().from("purchase_plan_lines").delete().eq("plan_line_id", lineId);
    if (deleteError) window.alert(deleteError.message);
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
            className={`${selectClass} min-w-48 flex-1 sm:flex-none`}
            value={planId ?? ""}
            onChange={(event) => setPlanId(event.target.value ? Number(event.target.value) : null)}
          >
            {(data?.plans ?? []).map((row) => (
              <option key={row.plan_id} value={row.plan_id}>{row.name} [{row.status}]</option>
            ))}
          </select>
          <Button variant="outline" onClick={() => setNewPlanOpen(true)}>
            <Plus className="size-4" /> {t("purchasePlanner.newPlan")}
          </Button>
          {plan && editable && (
            <Button onClick={() => setReviewOpen(true)}>
              <ShieldCheck className="size-4" /> {plan.status === "ready" ? t("purchasePlanner.order") : t("purchasePlanner.review")}
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

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={statusTone(plan.status)}>{t(`purchasePlanner.status.${plan.status}` as never)}</Badge>
              {plan.budget_amount != null && <span>{t("purchasePlanner.budget")}: {plan.budget_currency} {Number(plan.budget_amount).toFixed(2)}</span>}
              {plan.notes && <span className="hidden text-muted-foreground lg:inline">{plan.notes}</span>}
            </div>
            {editable && (
              <Button size="sm" onClick={() => setLineOpen(true)}><Plus className="size-4" /> {t("purchasePlanner.addLine")}</Button>
            )}
          </div>

          <Tabs defaultValue="cards">
            <TabsList>
              <TabsTrigger value="cards">{t("purchasePlanner.cardsTab")}</TabsTrigger>
              <TabsTrigger value="customers">{t("purchasePlanner.customersTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="cards" className="mt-2">
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

      <NewPlanDialog open={newPlanOpen} onOpenChange={setNewPlanOpen} onCreated={(id) => { setPlanId(id); retry(); }} />
      {plan && <AddLineDialog planId={plan.plan_id} open={lineOpen} onOpenChange={setLineOpen} onAdded={retry} />}
      <AllocationDialog line={allocationLine} allocations={allocations} editable={editable} open={allocationLine != null} onOpenChange={(open) => !open && setAllocationLine(null)} onChanged={retry} />
      {plan && <ReviewDialog plan={plan} open={reviewOpen} onOpenChange={setReviewOpen} onChanged={retry} />}
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
                  <div className="text-xs text-muted-foreground">{itemMeta(line) || t(`game.${line.game}` as never)}{line.game !== "pokemon_sealed" ? ` | ${line.psa_grade ? `PSA ${line.psa_grade}` : t("purchasePlanner.raw")}` : ""}</div>
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

function NewPlanDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error: insertError } = await createClient().from("purchase_plans").insert({
      name: name.trim(),
      budget_currency: "USD",
      budget_amount: budget ? Number(budget) : null,
      notes: notes.trim() || null,
    }).select("plan_id").single();
    setBusy(false);
    if (insertError) return setError(insertError.message);
    setName(""); setBudget(""); setNotes(""); onOpenChange(false); onCreated(Number(data.plan_id));
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("purchasePlanner.newPlan")}</DialogTitle><DialogDescription>{t("purchasePlanner.newPlanDescription")}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>{t("purchasePlanner.planName")}</Label><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("purchasePlanner.budgetUsd")}</Label><Input inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("purchasePlanner.notes")}</Label><Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
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
  const [quantity, setQuantity] = useState("1");
  const [source, setSource] = useState("");
  const [listingUrl, setListingUrl] = useState("");
  const [available, setAvailable] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [currency, setCurrency] = useState("JPY");
  const [landedCost, setLandedCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (!open || chosen || !term) { setResults([]); return; }
    const timer = setTimeout(() => searchCatalog(game, term).then(setResults).catch((reason: Error) => setError(reason.message)), 250);
    return () => clearTimeout(timer);
  }, [chosen, game, open, query]);

  useEffect(() => { if (!open) { setQuery(""); setResults([]); setChosen(null); setError(null); } }, [open]);

  async function add() {
    if (!chosen || !unitPrice || Number(quantity) <= 0) return;
    setBusy(true); setError(null);
    const { error: insertError } = await createClient().from("purchase_plan_lines").insert({
      plan_id: planId,
      game: chosen.game,
      card_id: chosen.game === "pokemon_sealed" ? null : chosen.id,
      product_id: chosen.game === "pokemon_sealed" ? chosen.id : null,
      psa_grade: chosen.game === "pokemon_sealed" ? null : Number(grade),
      planned_quantity: Number(quantity),
      source: source.trim() || null,
      source_listing_url: listingUrl.trim() || null,
      source_available_quantity: available ? Number(available) : null,
      unit_price_orig: Number(unitPrice),
      currency,
      landed_unit_cost_usd: landedCost ? Number(landedCost) : null,
      source_observed_at: new Date().toISOString(),
    });
    setBusy(false);
    if (insertError) return setError(insertError.message);
    onOpenChange(false); onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{t("purchasePlanner.addLine")}</DialogTitle><DialogDescription>{t("purchasePlanner.addLineDescription")}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <select className={selectClass} value={game} onChange={(event) => { setGame(event.target.value as CatalogResult["game"]); setChosen(null); setQuery(""); }}>
              {(["pokemon", "mtg", "pokemon_sealed"] as const).map((value) => <option key={value} value={value}>{t(`game.${value}` as never)}</option>)}
            </select>
            <div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={chosen?.label ?? query} onChange={(event) => { setChosen(null); setQuery(event.target.value); }} placeholder={t("purchasePlanner.searchCatalog")} /></div>
          </div>
          {!chosen && results.length > 0 && <div className="max-h-44 overflow-y-auto rounded-md border">{results.map((result) => <button key={result.id} type="button" className="block w-full border-b px-3 py-2 text-left text-xs last:border-0 hover:bg-muted" onClick={() => { setChosen(result); setQuery(result.label); }}>{result.label}</button>)}</div>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {game !== "pokemon_sealed" && <div className="space-y-1"><Label>{t("purchasePlanner.grade")}</Label><select className={selectClass} value={grade} onChange={(event) => setGrade(event.target.value)}><option value="0">{t("purchasePlanner.raw")}</option>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>PSA {value}</option>)}</select></div>}
            <div className="space-y-1"><Label>{t("purchasePlanner.quantity")}</Label><Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
            <div className="space-y-1"><Label>{t("purchasePlanner.available")}</Label><Input type="number" min="0" value={available} onChange={(event) => setAvailable(event.target.value)} /></div>
            <div className="space-y-1"><Label>{t("purchasePlanner.currency")}</Label><select className={selectClass} value={currency} onChange={(event) => setCurrency(event.target.value)}><option>JPY</option><option>USD</option></select></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>{t("purchasePlanner.source")}</Label><Input value={source} onChange={(event) => setSource(event.target.value)} /></div>
            <div className="space-y-1"><Label>{t("purchasePlanner.unitPrice")}</Label><Input inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></div>
            <div className="space-y-1"><Label>{t("purchasePlanner.landedUnitUsd")}</Label><Input inputMode="decimal" value={landedCost} onChange={(event) => setLandedCost(event.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>{t("purchasePlanner.listingUrl")}</Label><Input value={listingUrl} onChange={(event) => setListingUrl(event.target.value)} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button><Button onClick={add} disabled={busy || !chosen || !unitPrice}>{busy ? t("common.saving") : t("purchasePlanner.addLine")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
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
  const active = allocations.filter((allocation) => allocation.plan_line_id === line?.plan_line_id && !["released", "cancelled"].includes(allocation.status));
  const primaries = active.filter((allocation) => allocation.role === "primary");
  const selected = candidates.find((candidate) => candidate.customer_id === candidateId) ?? null;
  const origins = selected ? sortedOrigins(selected.demand_origins) : [];

  useEffect(() => {
    if (!open || !line) return;
    setBusy(true); setError(null); setCandidateId(null); setOriginKey("");
    createClient().from("customer_purchase_candidates_v").select("*").eq("plan_line_id", line.plan_line_id).order("top_priority")
      .then(({ data, error: queryError }) => { setBusy(false); if (queryError) setError(queryError.message); else setCandidates((data ?? []) as PurchaseCandidate[]); });
  }, [line, open]);

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
