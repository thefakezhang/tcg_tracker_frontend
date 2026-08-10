"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, CircleStop, Gauge, Play, RotateCcw,
  ShieldCheck, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import {
  calibrationProgress,
  parseAutoAcceptStatus,
  percent,
  sourceStatusKey,
  type AutoAcceptSourceStatus,
  unreviewedSamples,
} from "@/lib/image-autoaccept";
import { useSupabaseQuery, QueryError } from "./use-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface CalibrationSample {
  sample_uid: string;
  sample_rank: number;
  source_author_handle: string;
  candidate_kind: "singles" | "sealed";
  classifier_fingerprint: string;
  candidate_id: number;
  candidate_status: string;
  source_image_url: string;
  source_tweet_url: string | null;
  source_image_width: number;
  source_image_height: number;
  frozen_effective_geometry: { card?: Box | null; price?: Box | null };
  frozen_target_id: number | null;
  frozen_grade_or_condition: string | null;
  frozen_price_jpy: number;
  frozen_identity_confidence: number;
  price_evidence: Record<string, unknown> | null;
  matched_name: string | null;
  matched_meta: string | null;
  matched_image_url: string | null;
  current_label_uid: string | null;
  current_verdict: Verdict | null;
  current_notes: string | null;
}

type Verdict = "pass" | "wrong_price" | "wrong_identity" | "bad_geometry" | "not_price" | "unreviewable";

function CropPreview({ sample, kind }: { sample: CalibrationSample; kind: "card" | "price" }) {
  const { t } = useTranslation();
  const box = sample.frozen_effective_geometry?.[kind] ?? null;
  if (!box) {
    return (
      <div className="flex min-h-28 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        {t("autoAccept.noCrop")}
      </div>
    );
  }
  const cropWidth = Math.max(1, box.x1 - box.x0);
  const cropHeight = Math.max(1, box.y1 - box.y0);
  const xPosition = sample.source_image_width === cropWidth
    ? 0
    : (box.x0 / (sample.source_image_width - cropWidth)) * 100;
  const yPosition = sample.source_image_height === cropHeight
    ? 0
    : (box.y0 / (sample.source_image_height - cropHeight)) * 100;
  return (
    <div
      role="img"
      aria-label={kind === "card" ? t("autoAccept.detectedCard") : t("autoAccept.detectedPrice")}
      className="w-full rounded-lg bg-muted bg-no-repeat shadow-inner"
      style={{
        aspectRatio: `${cropWidth} / ${cropHeight}`,
        maxHeight: kind === "card" ? "18rem" : "9rem",
        backgroundImage: `url(${JSON.stringify(sample.source_image_url)})`,
        backgroundSize: `${(sample.source_image_width / cropWidth) * 100}% ${(sample.source_image_height / cropHeight) * 100}%`,
        backgroundPosition: `${xPosition}% ${yPosition}%`,
      }}
    />
  );
}

function SourceCard({
  source,
  selected,
  busy,
  onSelect,
  onConfigure,
  onRun,
}: {
  source: AutoAcceptSourceStatus;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onConfigure: (enabled: boolean) => void;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const progress = calibrationProgress(source);
  return (
    <Card className={selected ? "ring-2 ring-primary" : ""}>
      <CardContent className="min-w-0 space-y-3 p-4">
        <button
          type="button"
          onClick={onSelect}
          className="min-h-11 w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{source.source}</div>
              <div className="text-xs text-muted-foreground">{t(`autoAccept.kind.${source.kind}`)}</div>
            </div>
            <Badge variant={source.enabled ? "default" : source.calibration_ready ? "secondary" : "outline"}>
              {source.enabled
                ? t("autoAccept.enabled")
                : source.calibration_ready
                  ? t("autoAccept.ready")
                  : t("autoAccept.calibrating")}
            </Badge>
          </div>
        </button>
        <div>
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span>{t("autoAccept.reviewProgress", { reviewed: source.reviewed, required: 381 })}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-muted-foreground">{t("autoAccept.wilson")}</dt><dd className="font-medium">{percent(source.wilson_lower_95)}</dd></div>
          <div><dt className="text-muted-foreground">{t("autoAccept.failures")}</dt><dd className={source.failures ? "font-medium text-destructive" : "font-medium"}>{source.failures}</dd></div>
          <div><dt className="text-muted-foreground">{t("autoAccept.unreviewed")}</dt><dd className="font-medium">{unreviewedSamples(source)}</dd></div>
          <div><dt className="text-muted-foreground">{t("autoAccept.eligible")}</dt><dd className="font-medium">{source.eligible_revisions}</dd></div>
          <div><dt className="text-muted-foreground">{t("autoAccept.canary")}</dt><dd className="font-medium">{source.canary_passed ? t("autoAccept.canaryPassed") : t("autoAccept.canaryRequired")}</dd></div>
        </dl>
        <div className="break-all font-mono text-[10px] text-muted-foreground" title={source.fingerprint}>
          {source.fingerprint.slice(0, 16)}…
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant={source.enabled ? "outline" : "default"}
            className="min-h-11"
            disabled={busy || (!source.enabled && !source.calibration_ready)}
            onClick={() => onConfigure(!source.enabled)}
          >
            {source.enabled ? t("autoAccept.disableSource") : t("autoAccept.enableCanary")}
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy || !source.enabled}
            onClick={onRun}
          >
            <Play className="size-4" />
            {t("autoAccept.runCanary")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ImageAutoAcceptView() {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [correctingLatest, setCorrectingLatest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("image_curation_autoaccept_status");
    if (error) throw error;
    return parseAutoAcceptStatus(data);
  }, []);
  const statusQuery = useSupabaseQuery("image-autoaccept-status", fetchStatus);
  const sources = useMemo(() => statusQuery.data?.sources ?? [], [statusQuery.data]);

  useEffect(() => {
    if (!sources.length) {
      setSelectedKey(null);
      return;
    }
    if (selectedKey && sources.some((source) => sourceStatusKey(source) === selectedKey)) return;
    const next = sources.find((source) => unreviewedSamples(source) > 0) ?? sources[0];
    setSelectedKey(sourceStatusKey(next));
  }, [selectedKey, sources]);

  useEffect(() => {
    setCorrectingLatest(false);
  }, [selectedKey]);

  const selected = sources.find((source) => sourceStatusKey(source) === selectedKey) ?? null;
  const fetchSample = useCallback(async (): Promise<CalibrationSample | null> => {
    if (!selected) return null;
    const supabase = createClient();
    let query = supabase
      .from("image_curation_autoaccept_calibration_queue_v")
      .select("*")
      .eq("source_author_handle", selected.source)
      .eq("candidate_kind", selected.kind)
      .eq("classifier_fingerprint", selected.fingerprint);
    query = correctingLatest
      ? query.not("current_label_uid", "is", null).order("labeled_at", { ascending: false })
      : query.is("current_label_uid", null).order("sample_rank", { ascending: true });
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    return data as CalibrationSample | null;
  }, [correctingLatest, selected]);
  const sampleQuery = useSupabaseQuery(
    selected ? ["image-autoaccept-sample", selectedKey, correctingLatest] : null,
    fetchSample,
  );
  const sample = sampleQuery.data ?? null;

  const refresh = useCallback(async () => {
    await Promise.all([statusQuery.retry(), sampleQuery.retry()]);
  }, [sampleQuery, statusQuery]);

  const requireReason = () => {
    if (notes.trim().length >= 5) return true;
    setMessage(t("autoAccept.reasonRequired"));
    return false;
  };

  const label = async (verdict: Verdict) => {
    if (!sample || (verdict !== "pass" && !requireReason())) return;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("label_image_curation_autoaccept_sample", {
        p_sample_uid: sample.sample_uid,
        p_verdict: verdict,
        p_notes: notes.trim() || null,
        p_supersedes_label_uid: sample.current_label_uid,
      });
      if (error) throw error;
      setNotes("");
      setCorrectingLatest(false);
      setMessage(t("autoAccept.labelSaved"));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const configure = async (source: AutoAcceptSourceStatus, enabled: boolean) => {
    if (enabled && !requireReason()) return;
    const operationReason = notes.trim().length >= 5
      ? notes.trim()
      : "catalog source emergency disable";
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("configure_image_curation_auto_approve", {
        p_source_author_handle: source.source,
        p_candidate_kind: source.kind,
        p_classifier_fingerprint: source.fingerprint,
        p_identity_threshold: 0.99,
        p_per_run_cap: source.per_run_cap ?? 25,
        p_daily_cap: source.daily_cap ?? 100,
        p_enabled: enabled,
        p_reason: operationReason,
      });
      if (error) throw error;
      setMessage(enabled ? t("autoAccept.sourceEnabled") : t("autoAccept.sourceDisabled"));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const setGlobal = async (enabled: boolean) => {
    if (enabled && !requireReason()) return;
    if (enabled && !window.confirm(t("autoAccept.confirmGlobalEnable"))) return;
    const operationReason = notes.trim().length >= 5
      ? notes.trim()
      : "catalog emergency stop";
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_image_curation_autoaccept_control", {
        p_global_enabled: enabled,
        p_daily_cap: statusQuery.data?.control.daily_cap ?? 250,
        p_reason: operationReason,
      });
      if (error) throw error;
      setMessage(enabled ? t("autoAccept.globalEnabled") : t("autoAccept.globalStopped"));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const runCanary = async (source: AutoAcceptSourceStatus) => {
    if (!requireReason()) return;
    if (!window.confirm(t("autoAccept.confirmCanary", { cap: source.per_run_cap ?? 25 }))) return;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("run_calibrated_image_curation_autoaccept", {
        p_source_author_handle: source.source,
        p_candidate_kind: source.kind,
        p_max: source.per_run_cap ?? 25,
        p_request_id: crypto.randomUUID(),
        p_canary: true,
        p_reason: notes.trim(),
      });
      if (error) throw error;
      const summary = data && typeof data === "object" && "summary" in data
        ? (data as { summary?: { promoted?: number; failed?: number } }).summary
        : null;
      setMessage(t("autoAccept.canaryResult", {
        promoted: summary?.promoted ?? 0,
        failed: summary?.failed ?? 0,
      }));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (runUid: string) => {
    if (!requireReason() || !window.confirm(t("autoAccept.confirmRollback"))) return;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("rollback_image_curation_autoaccept_run", {
        p_run_uid: runUid,
        p_reason: notes.trim(),
      });
      if (error) throw error;
      const result = data as { completed?: number; conflicted?: number; failed?: number } | null;
      setMessage(t("autoAccept.rollbackResult", {
        completed: result?.completed ?? 0,
        conflicted: result?.conflicted ?? 0,
        failed: result?.failed ?? 0,
      }));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const globalEnabled = statusQuery.data?.control.global_enabled ?? false;
  const anySourceEnabled = sources.some((source) => source.enabled && source.canary_passed);
  const evidence = sample?.price_evidence ?? null;
  const evidenceMethod = evidence && typeof evidence.method === "string" ? evidence.method : "-";

  return (
    <div className="min-w-0 space-y-5 p-1 sm:p-4">
      <section className={`rounded-xl border p-4 ${globalEnabled ? "border-amber-500/60 bg-amber-500/10" : "bg-muted/30"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold">
              {globalEnabled ? <Gauge className="size-5 text-amber-600" /> : <ShieldCheck className="size-5 text-green-600" />}
              {globalEnabled ? t("autoAccept.globalOn") : t("autoAccept.globalOff")}
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t("autoAccept.globalExplanation")}
            </p>
          </div>
          <Button
            variant={globalEnabled ? "destructive" : "default"}
            className="min-h-11 w-full sm:w-auto"
            disabled={busy || (!globalEnabled && !anySourceEnabled)}
            onClick={() => setGlobal(!globalEnabled)}
          >
            {globalEnabled ? <CircleStop className="size-4" /> : <ShieldCheck className="size-4" />}
            {globalEnabled ? t("autoAccept.emergencyStop") : t("autoAccept.enableAutomation")}
          </Button>
        </div>
      </section>

      <div className="space-y-2">
        <Label htmlFor="autoaccept-notes">{t("autoAccept.operatorReason")}</Label>
        <Textarea
          id="autoaccept-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="min-h-20"
          placeholder={t("autoAccept.operatorReasonPlaceholder")}
        />
        <p className="text-xs text-muted-foreground">{t("autoAccept.reasonHelp")}</p>
      </div>

      {message && <div role="status" className="break-words rounded-lg border bg-muted/30 p-3 text-sm">{message}</div>}
      {statusQuery.error && <QueryError error={statusQuery.error} onRetry={statusQuery.retry} />}

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">{t("autoAccept.sourceReadiness")}</h2>
          <p className="text-sm text-muted-foreground">{t("autoAccept.sourceReadinessHelp")}</p>
        </div>
        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sources.map((source) => (
            <SourceCard
              key={sourceStatusKey(source)}
              source={source}
              selected={sourceStatusKey(source) === selectedKey}
              busy={busy}
              onSelect={() => setSelectedKey(sourceStatusKey(source))}
              onConfigure={(enabled) => configure(source, enabled)}
              onRun={() => runCanary(source)}
            />
          ))}
        </div>
        {!statusQuery.isLoading && sources.length === 0 && (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t("autoAccept.noEvidenceRuns")}
          </div>
        )}
      </section>

      {selected && (
        <section className="space-y-3">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{t("autoAccept.calibrationReview")}</h2>
                <p className="text-sm text-muted-foreground">
                  {correctingLatest
                    ? t("autoAccept.correctionHelp", { source: selected.source })
                    : t("autoAccept.calibrationReviewHelp", { source: selected.source })}
                </p>
              </div>
              <Button
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                disabled={busy}
                onClick={() => setCorrectingLatest((value) => !value)}
              >
                <RotateCcw className="size-4" />
                {correctingLatest ? t("autoAccept.backToQueue") : t("autoAccept.correctLatest")}
              </Button>
            </div>
          </div>
          {sampleQuery.error && <QueryError error={sampleQuery.error} onRetry={sampleQuery.retry} />}
          {sample ? (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span>{sample.matched_name ?? t("autoAccept.unknownMatch")}</span>
                  <Badge variant="outline">#{sample.sample_rank}</Badge>
                  <Badge variant="secondary">¥{sample.frozen_price_jpy.toLocaleString()}</Badge>
                  {sample.current_verdict && <Badge variant="outline">{t(`autoAccept.verdict.${sample.current_verdict}`)}</Badge>}
                </CardTitle>
                <div className="break-words text-xs text-muted-foreground">
                  {sample.matched_meta} · {sample.frozen_grade_or_condition} · {t("autoAccept.identity", { value: (sample.frozen_identity_confidence * 100).toFixed(1) })}
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4 pt-2">
                <div className="grid min-w-0 gap-4 md:grid-cols-3">
                  <figure className="min-w-0 space-y-1">
                    <CropPreview sample={sample} kind="card" />
                    <figcaption className="text-center text-xs text-muted-foreground">{t("autoAccept.detectedCard")}</figcaption>
                  </figure>
                  <figure className="min-w-0 space-y-1">
                    <CropPreview sample={sample} kind="price" />
                    <figcaption className="text-center text-xs text-muted-foreground">{t("autoAccept.detectedPrice")}</figcaption>
                  </figure>
                  <figure className="min-w-0 space-y-1">
                    {sample.matched_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sample.matched_image_url} alt={sample.matched_name ?? ""} className="mx-auto max-h-72 w-full rounded-lg bg-muted object-contain" />
                    ) : (
                      <div className="flex min-h-28 items-center justify-center rounded-lg bg-muted text-muted-foreground">?</div>
                    )}
                    <figcaption className="text-center text-xs text-muted-foreground">{t("autoAccept.catalogMatch")}</figcaption>
                  </figure>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{t("autoAccept.evidenceMethod", { method: evidenceMethod })}</Badge>
                  {sample.source_tweet_url && (
                    <a href={sample.source_tweet_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-md px-2 underline">
                      {t("autoAccept.openSource")}
                    </a>
                  )}
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <div className="mb-2 font-medium">{t("autoAccept.reviewQuestion")}</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Button className="min-h-11" disabled={busy} onClick={() => label("pass")}>
                      <Check className="size-4" />{t("autoAccept.pass")}
                    </Button>
                    <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => label("wrong_price")}>
                      <X className="size-4" />{t("autoAccept.wrongPrice")}
                    </Button>
                    <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => label("wrong_identity")}>
                      <X className="size-4" />{t("autoAccept.wrongCard")}
                    </Button>
                    <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => label("bad_geometry")}>
                      <AlertTriangle className="size-4" />{t("autoAccept.badCrop")}
                    </Button>
                    <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => label("not_price")}>
                      <X className="size-4" />{t("autoAccept.notPrice")}
                    </Button>
                    <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => label("unreviewable")}>
                      {t("autoAccept.cannotTell")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : !sampleQuery.isLoading ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {t("autoAccept.reviewQueueEmpty")}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
          )}
        </section>
      )}

      {!!statusQuery.data?.recent_runs.length && (
        <section className="space-y-3">
          <h2 className="font-semibold">{t("autoAccept.recentRuns")}</h2>
          <div className="grid min-w-0 gap-2">
            {statusQuery.data.recent_runs.map((run) => (
              <div key={run.run_uid} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <span>{run.source_author_handle ?? t("autoAccept.allSources")} · {run.candidate_kind ?? t("autoAccept.allKinds")}</span>
                    <Badge variant="outline">{t(`autoAccept.runMode.${run.execution_mode}`)}</Badge>
                  </div>
                  <div className="break-words text-xs text-muted-foreground">
                    {new Date(run.started_at).toLocaleString()} · {t("autoAccept.runSummary", {
                      promoted: typeof run.summary.promoted === "number" ? run.summary.promoted : 0,
                      failed: typeof run.summary.failed === "number" ? run.summary.failed : 0,
                    })}
                  </div>
                  {run.reason && <div className="break-words text-xs text-muted-foreground">{run.reason}</div>}
                </div>
                <Button variant="outline" className="min-h-11 w-full sm:w-auto" disabled={busy} onClick={() => rollback(run.run_uid)}>
                  <RotateCcw className="size-4" />{t("autoAccept.rollback")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
