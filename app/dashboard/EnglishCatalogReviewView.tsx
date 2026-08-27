"use client";

import { useMemo, useState } from "react";
import { ExternalLink, ImageOff, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { useTranslation } from "@/lib/i18n";
import { QueryError, useSupabaseQuery } from "./use-query";

export type EnglishCatalogOutcome =
  | "imported"
  | "review_required"
  | "no_product"
  | "rejected";

export interface EnglishCatalogCandidateRow {
  candidate_key: string;
  tcgplayer_group_id: number | string;
  tcgplayer_product_id: number | string | null;
  tcgplayer_group_name: string;
  set_code: string;
  raw_collector_number: string | null;
  card_number: string | null;
  regional_name: string | null;
  clean_name: string | null;
  rarity: string | null;
  image_url: string | null;
  outcome: EnglishCatalogOutcome;
  reason: string;
  evidence: Record<string, unknown>;
  evidence_sha256: string;
  imported_card_uid: string | null;
  imported_card_id: number | null;
  review_version: number | string;
  first_seen_at: string;
  last_seen_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  review_evidence_url: string | null;
}

export interface EnglishCatalogImportReport {
  snapshot_groups: number;
  snapshot_products: number;
  reviewed_groups: number;
  unmapped_groups: number;
  auto_import_products: number;
  review_products: number;
  no_product_groups: number;
  external_requests_performed: number;
  estimated_feed_requests: number;
  snapshot_bytes: number;
  crosswalk_bytes: number;
  estimated_definition_rows: number;
  estimated_tcgplayer_identifier_rows: number;
  estimated_durable_candidate_rows: number;
  estimated_durable_event_rows: number;
}

export interface EnglishCatalogImportRun {
  run_uid: string;
  snapshot_sha256: string;
  crosswalk_sha256: string;
  report: EnglishCatalogImportReport;
  actor: string;
  completed_at: string;
}

interface EnglishCatalogData {
  candidates: EnglishCatalogCandidateRow[];
  runs: EnglishCatalogImportRun[];
}

export async function fetchEnglishCatalogCandidates(
  supabase: ReturnType<typeof createClient>,
): Promise<EnglishCatalogCandidateRow[]> {
  return selectAll<EnglishCatalogCandidateRow>(
    () => supabase.from("pokemon_english_catalog_review_v").select("*"),
    ["candidate_key"],
  );
}

export async function fetchEnglishCatalogRuns(
  supabase: ReturnType<typeof createClient>,
): Promise<EnglishCatalogImportRun[]> {
  return selectAll<EnglishCatalogImportRun>(
    () => supabase.from("pokemon_english_catalog_import_runs").select("*"),
    ["run_uid"],
  );
}

export async function reviewEnglishCatalogCandidate(
  supabase: ReturnType<typeof createClient>,
  input: {
    candidateKey: string;
    expectedVersion: number;
    decision: "confirm_import" | "reject";
    evidenceUrl: string;
    note: string;
  },
): Promise<unknown> {
  const { data, error } = await supabase.rpc(
    "review_pokemon_english_catalog_candidate",
    {
      p_candidate_key: input.candidateKey,
      p_decision: input.decision,
      p_expected_version: input.expectedVersion,
      p_evidence_url: input.evidenceUrl.trim(),
      p_note: input.note.trim(),
    },
  );
  if (error) throw error;
  return data;
}

function readableError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function CatalogRunSummary({ run }: { run?: EnglishCatalogImportRun }) {
  const { t } = useTranslation();
  if (!run) {
    return (
      <Card className="min-w-0 border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          {t("englishCatalog.noImportReport")}
        </CardContent>
      </Card>
    );
  }
  const report = run.report;
  return (
    <Card className="min-w-0" data-testid="english-catalog-run-summary">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("englishCatalog.coverageTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-2 text-sm">
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border p-2">
            <div className="text-xs text-muted-foreground">{t("englishCatalog.sourceCoverage")}</div>
            <div className="font-medium">{report.snapshot_products} {t("englishCatalog.products")}</div>
            <div className="text-xs text-muted-foreground">
              {report.snapshot_groups} {t("englishCatalog.groups")} · {report.reviewed_groups} {t("englishCatalog.reviewed")}
            </div>
          </div>
          <div className="rounded border p-2">
            <div className="text-xs text-muted-foreground">{t("englishCatalog.partition")}</div>
            <div className="font-medium">{report.auto_import_products} / {report.review_products} / {report.no_product_groups}</div>
            <div className="text-xs text-muted-foreground">{t("englishCatalog.partitionOrder")}</div>
          </div>
          <div className="rounded border p-2">
            <div className="text-xs text-muted-foreground">{t("englishCatalog.requestLoad")}</div>
            <div className="font-medium">{report.external_requests_performed} {t("englishCatalog.requestsRun")}</div>
            <div className="text-xs text-muted-foreground">
              {report.estimated_feed_requests} {t("englishCatalog.estimatedRequests")} · {report.snapshot_bytes} B
            </div>
          </div>
          <div className="rounded border p-2">
            <div className="text-xs text-muted-foreground">{t("englishCatalog.storageLoad")}</div>
            <div className="font-medium">
              {report.estimated_definition_rows} + {report.estimated_tcgplayer_identifier_rows}
            </div>
            <div className="text-xs text-muted-foreground">
              {report.estimated_durable_candidate_rows} {t("englishCatalog.candidates")} · {report.estimated_durable_event_rows} {t("englishCatalog.events")}
            </div>
          </div>
        </div>
        <p className="break-all text-xs text-muted-foreground">
          {t("englishCatalog.sourceDigest")}: {run.snapshot_sha256} · {t("englishCatalog.crosswalkDigest")}: {run.crosswalk_sha256}
        </p>
      </CardContent>
    </Card>
  );
}

export function CatalogCandidateCard({
  row,
  onSaved,
}: {
  row: EnglishCatalogCandidateRow;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"confirm_import" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const evidenceReady = /^https:\/\/[^\s#]+$/.test(evidenceUrl.trim())
    && note.trim().length > 0
    && note.trim().length <= 500;
  const productURL = row.tcgplayer_product_id == null
    ? null
    : `https://www.tcgplayer.com/product/${row.tcgplayer_product_id}`;

  const decide = async (decision: "confirm_import" | "reject") => {
    setBusy(decision);
    setError(null);
    try {
      await reviewEnglishCatalogCandidate(createClient(), {
        candidateKey: row.candidate_key,
        expectedVersion: Number(row.review_version),
        decision,
        evidenceUrl,
        note,
      });
      await onSaved();
    } catch (reviewError) {
      setError(readableError(reviewError));
    } finally {
      setBusy(null);
    }
  };

  const badgeVariant = row.outcome === "rejected"
    ? "destructive"
    : row.outcome === "imported"
      ? "default"
      : "outline";
  return (
    <Card className="min-w-0 overflow-hidden" data-catalog-outcome={row.outcome}>
      <CardHeader className="min-w-0 gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={badgeVariant}>{t(`englishCatalog.outcome.${row.outcome}`)}</Badge>
          <Badge variant="secondary">{row.set_code} · {row.card_number ?? t("common.unknown")}</Badge>
          <span className="break-words text-xs text-muted-foreground">{row.reason.replaceAll("_", " ")}</span>
        </div>
        <CardTitle className="break-words text-base">
          {row.regional_name ?? t("englishCatalog.noProductName")}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div className="grid min-w-0 gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
          {row.image_url ? (
            <img
              src={row.image_url}
              alt={row.regional_name ?? t("englishCatalog.productImage")}
              className="aspect-[5/7] w-full rounded bg-muted object-contain"
              loading="lazy"
            />
          ) : (
            <div className="flex aspect-[5/7] w-full items-center justify-center rounded bg-muted">
              <ImageOff className="size-7 text-muted-foreground" aria-hidden="true" />
            </div>
          )}
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("englishCatalog.group")}</dt>
            <dd className="break-words">{row.tcgplayer_group_name} ({row.tcgplayer_group_id})</dd>
            <dt className="text-muted-foreground">{t("englishCatalog.identity")}</dt>
            <dd className="break-words">{row.set_code} · {row.card_number ?? t("common.unknown")}</dd>
            <dt className="text-muted-foreground">{t("englishCatalog.rawNumber")}</dt>
            <dd className="break-words">{row.raw_collector_number ?? t("common.unknown")}</dd>
            <dt className="text-muted-foreground">TCGplayer productId</dt>
            <dd className="break-all">
              {productURL ? (
                <a className="inline-flex min-h-11 items-center gap-1 underline underline-offset-2 sm:min-h-0" href={productURL} target="_blank" rel="noreferrer">
                  {row.tcgplayer_product_id}<ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ) : t("englishCatalog.noProduct")}
            </dd>
            <dt className="text-muted-foreground">{t("englishCatalog.importedCard")}</dt>
            <dd className="break-all">{row.imported_card_id ?? t("common.unknown")}</dd>
          </dl>
        </div>

        {row.outcome === "no_product" && (
          <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-900 dark:text-amber-200">
            {t("englishCatalog.noProductHelp")}
          </p>
        )}
        <details className="min-w-0 rounded border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("englishCatalog.productEvidence")}</summary>
          <pre className="mt-2 max-h-52 min-w-0 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
            {JSON.stringify(row.evidence, null, 2)}
          </pre>
          <p className="mt-2 break-all text-xs text-muted-foreground">SHA-256 {row.evidence_sha256}</p>
        </details>

        {row.outcome === "review_required" && (
          <div className="min-w-0 space-y-3 rounded border p-3">
            <p className="text-xs text-muted-foreground">{t("englishCatalog.reviewHelp")}</p>
            <label className="block min-w-0 space-y-1 text-sm">
              <span>{t("counterpart.evidenceUrl")}</span>
              <Input type="url" inputMode="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} className="min-h-11 min-w-0" />
            </label>
            <label className="block min-w-0 space-y-1 text-sm">
              <span>{t("counterpart.decisionNote")}</span>
              <Textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} className="min-h-24 min-w-0" />
            </label>
            {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button className="min-h-11" disabled={!evidenceReady || busy != null} onClick={() => void decide("confirm_import")}>
                {busy === "confirm_import" ? t("counterpart.saving") : t("englishCatalog.confirmImport")}
              </Button>
              <Button variant="outline" className="min-h-11" disabled={!evidenceReady || busy != null} onClick={() => void decide("reject")}>
                {busy === "reject" ? t("counterpart.saving") : t("englishCatalog.reject")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function EnglishCatalogReviewView() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"attention" | EnglishCatalogOutcome>("attention");
  const [announcement, setAnnouncement] = useState("");
  const query = useSupabaseQuery<EnglishCatalogData>(
    ["pokemon-english-catalog-review"],
    async () => {
      const supabase = createClient();
      const [candidates, runs] = await Promise.all([
        fetchEnglishCatalogCandidates(supabase),
        fetchEnglishCatalogRuns(supabase),
      ]);
      return { candidates, runs };
    },
  );
  const rows = useMemo(() => {
    const candidates = query.data?.candidates ?? [];
    return candidates.filter((row) => filter === "attention"
      ? row.outcome === "review_required" || row.outcome === "no_product"
      : row.outcome === filter);
  }, [filter, query.data]);
  const latestRun = useMemo(
    () => [...(query.data?.runs ?? [])].sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0],
    [query.data],
  );
  const saved = async () => {
    setAnnouncement(t("englishCatalog.saved"));
    await query.retry();
  };
  const filters: Array<"attention" | EnglishCatalogOutcome> = [
    "attention", "review_required", "no_product", "imported", "rejected",
  ];

  return (
    <main className="min-w-0 overflow-x-hidden p-3 sm:p-5">
      <div className="mx-auto min-w-0 max-w-6xl space-y-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{t("englishCatalog.title")}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("englishCatalog.help")}</p>
          </div>
          <Button variant="outline" className="min-h-11 shrink-0" disabled={query.isValidating} onClick={() => void query.retry()}>
            <RefreshCw className={query.isValidating ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
            {t("counterpart.refresh")}
          </Button>
        </div>

        <CatalogRunSummary run={latestRun} />
        <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label={t("englishCatalog.filters")}>
          {filters.map((value) => (
            <Button key={value} variant={filter === value ? "default" : "outline"} className="min-h-11" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {t(`englishCatalog.filter.${value}`)}
            </Button>
          ))}
        </div>
        <p aria-live="polite" className="sr-only">{announcement}</p>
        {query.error && <QueryError error={query.error} onRetry={() => void query.retry()} />}
        {query.isLoading && !query.data && <div className="rounded border p-6 text-sm text-muted-foreground">{t("common.loading")}</div>}
        {!query.isLoading && !query.error && rows.length === 0 && (
          <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">{t("englishCatalog.empty")}</div>
        )}
        <div className="min-w-0 space-y-4">
          {rows.map((row) => <CatalogCandidateCard key={row.candidate_key} row={row} onSaved={saved} />)}
        </div>
      </div>
    </main>
  );
}
