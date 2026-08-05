"use client";

import useSWR, { type Key } from "swr";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

// Thin SWR wrapper for Supabase reads. Caching by `key` makes navigating back to
// a view instant and dedupes in-flight requests; `keepPreviousData` avoids the
// blank-flash on refetch. Returns a uniform shape so every view can show a real
// error + Retry instead of a silent blank screen (a failed read previously
// looked identical to "no data"). Pass `null` as key to skip the query.
export function useSupabaseQuery<T>(key: Key, fetcher: () => Promise<T>) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(key, fetcher, {
    revalidateOnFocus: false, // heavy queries — don't refetch on every tab focus
    keepPreviousData: true,
    errorRetryCount: 2,
  });
  return {
    data,
    error: error as Error | undefined,
    isLoading,
    isValidating,
    retry: () => mutate(),
  };
}

export type QueryErrorKind = "session-expired" | "forbidden" | "generic";

export function classifyQueryError(error: unknown): QueryErrorKind {
  if (!error || typeof error !== "object") return "generic";
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  const detail = [candidate.code, candidate.message, candidate.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const statuses = [candidate.status, candidate.code].map(String);
  if (
    statuses.includes("401")
    || /\bPGRST301\b/i.test(detail)
    || /\b(jwt|session|refresh[_ -]?token|access[_ -]?token)\b.*\b(expired|invalid|missing|not found)\b/i.test(detail)
    || /\b(expired|invalid|missing|not found)\b.*\b(jwt|session|refresh[_ -]?token|access[_ -]?token)\b/i.test(detail)
  ) {
    return "session-expired";
  }
  if (
    statuses.includes("403")
    || /\b(forbidden|permission denied|not authorized|unauthori[sz]ed|insufficient privilege)\b/i.test(detail)
  ) {
    return "forbidden";
  }
  return "generic";
}

export function QueryError({ error, onRetry }: { error?: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const kind = classifyQueryError(error);
  const title = kind === "session-expired"
    ? t("common.sessionExpired")
    : kind === "forbidden" ? t("common.accessDenied") : t("common.loadError");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <div className="min-w-0 text-destructive">
        <div>{title}</div>
        {kind === "session-expired" && <div className="text-xs text-muted-foreground">{t("common.sessionExpiredHelp")}</div>}
        {kind === "forbidden" && <div className="text-xs text-muted-foreground">{t("common.accessDeniedHelp")}</div>}
      </div>
      {kind === "session-expired" ? (
        <a
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
        >
          {t("common.signInAgain")}
        </a>
      ) : kind === "generic" ? (
        <Button variant="outline" size="sm" className="min-h-11 sm:min-h-11" onClick={onRetry}>{t("common.retry")}</Button>
      ) : null}
    </div>
  );
}
