"use client";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { classifyQueryError, useSupabaseQuery } from "./use-query";

export const SEALED_PLANNING_CANDIDATE_VIEW =
  "pokemon_sealed_purchase_candidate_listings_v";

export type SealedPlanningReadinessState =
  | "idle"
  | "checking"
  | "ready"
  | "unavailable"
  | "error";

export function isSealedPlanningSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";

  // These are the PostgreSQL and PostgREST missing-relation/schema-cache
  // responses emitted by this exact read. Permission, authentication,
  // missing-column, transport, and other failures must remain retryable
  // errors instead of being mistaken for an expected rollout state.
  return code === "42P01" || code === "PGRST205";
}

export async function readSealedPlanningReadiness(): Promise<"ready" | "unavailable"> {
  const { error } = await createClient()
    .from(SEALED_PLANNING_CANDIDATE_VIEW)
    .select("product_id")
    .limit(0);
  if (!error) return "ready";
  if (isSealedPlanningSchemaUnavailable(error)) return "unavailable";
  throw error;
}

export function useSealedPlanningReadiness(enabled = true) {
  const query = useSupabaseQuery<"ready" | "unavailable">(
    enabled ? ["sealed-planning-readiness", SEALED_PLANNING_CANDIDATE_VIEW] : null,
    readSealedPlanningReadiness,
  );

  let state: SealedPlanningReadinessState = "idle";
  if (enabled) {
    state = query.error
      ? "error"
      : query.data === "ready"
        ? "ready"
        : query.data === "unavailable"
          ? "unavailable"
          : "checking";
  }

  return { state, error: query.error, retry: query.retry };
}

export function SealedPlanningReadinessNotice({
  state,
  error,
  retry,
  id,
}: {
  state: SealedPlanningReadinessState;
  error?: unknown;
  retry: () => void;
  id: string;
}) {
  const { t } = useTranslation();
  if (state === "idle" || state === "ready") return null;

  if (state === "checking") {
    return (
      <div id={id} role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {t("sealedPlanning.checking")}
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div id={id} role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className="font-medium">{t("sealedPlanning.unavailable")}</div>
          <div className="text-xs text-muted-foreground">{t("sealedPlanning.unavailableHelp")}</div>
        </div>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={retry}>
          {t("sealedPlanning.checkAgain")}
        </Button>
      </div>
    );
  }

  const kind = classifyQueryError(error);
  const detail = kind === "session-expired"
    ? t("common.sessionExpired")
    : kind === "forbidden"
      ? t("common.accessDenied")
      : t("common.loadError");
  return (
    <div id={id} role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <div className="min-w-0 text-destructive">
        <div className="font-medium">{t("sealedPlanning.checkFailed")}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={retry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
