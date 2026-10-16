"use client";

import useSWR, { type Key } from "swr";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { EXTERNAL_IDENTIFIER_LOOKUP_ERROR_CODE } from "@/lib/card-search";

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

export type QueryErrorKind =
  | "session-expired"
  | "forbidden"
  | "external-identifier"
  | "schema"
  | "timeout"
  | "generic";

// A read that names a column or relation the database does not have. The
// operator cannot fix it and Retry cannot help: every attempt fails the same
// way until a migration lands.
//
// Worth distinguishing because the generic message hid a total outage. net_roi
// reached pokemon_price_summaries and never reached the view the browser reads,
// so every card-browser request answered 400 42703 for both games on every
// device, and the operator was shown only "Couldn't load data". The relation
// name in PostgREST's own message is what identified it; this surfaces that
// instead of discarding it.
const SCHEMA_ERROR_CODES = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "42883", // undefined_function, e.g. a renamed RPC
  "PGRST200", // embed: no relationship found between the relations
  "PGRST204", // column not found in the schema cache
]);

// A read the database gave up on. Unlike a schema error this is worth
// retrying: the next attempt may land when the table is quieter.
const TIMEOUT_ERROR_CODES = new Set([
  "57014", // query_canceled, which is what a statement timeout raises
]);

export function classifyQueryError(error: unknown): QueryErrorKind {
  if (!error || typeof error !== "object") return "generic";
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  const detail = [candidate.code, candidate.message, candidate.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const statuses = [candidate.status, candidate.code].map(String);
  if (
    candidate.code === EXTERNAL_IDENTIFIER_LOOKUP_ERROR_CODE
    || candidate.name === "ExternalIdentifierLookupError"
  ) {
    return "external-identifier";
  }
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
  if (typeof candidate.code === "string" && SCHEMA_ERROR_CODES.has(candidate.code)) {
    return "schema";
  }
  if (typeof candidate.code === "string" && TIMEOUT_ERROR_CODES.has(candidate.code)) {
    return "timeout";
  }
  return "generic";
}

// The code and message, when the error carries them. Nothing else: no stack,
// no SQL, no request URL.
export function readFailureDetail(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return [code, message].filter(Boolean).join(" · ");
}

export function QueryError({ error, onRetry }: { error?: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const kind = classifyQueryError(error);
  const title = kind === "session-expired"
    ? t("common.sessionExpired")
    : kind === "forbidden"
      ? t("common.accessDenied")
      : kind === "external-identifier"
        ? t("common.externalIdentifierLookupError")
        : kind === "schema"
          ? t("common.schemaError")
          : kind === "timeout"
            ? t("common.timeoutError")
            : t("common.loadError");
  // PostgREST's message names the relation and column, which is the one piece
  // of information that identifies the fix. Shown verbatim for a schema error
  // only, where there is nothing the operator could mistake it for.
  const detail = kind === "schema" ? readFailureDetail(error) : "";
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <div className="min-w-0 text-destructive">
        <div>{title}</div>
        {kind === "session-expired" && <div className="text-xs text-muted-foreground">{t("common.sessionExpiredHelp")}</div>}
        {kind === "forbidden" && <div className="text-xs text-muted-foreground">{t("common.accessDeniedHelp")}</div>}
        {kind === "external-identifier" && <div className="text-xs text-muted-foreground">{t("common.externalIdentifierLookupHelp")}</div>}
        {kind === "schema" && <div className="text-xs text-muted-foreground">{t("common.schemaErrorHelp")}</div>}
        {kind === "schema" && detail && <div className="mt-1 break-words font-mono text-xs text-muted-foreground">{detail}</div>}
        {kind === "timeout" && <div className="text-xs text-muted-foreground">{t("common.timeoutErrorHelp")}</div>}
      </div>
      {kind === "session-expired" ? (
        <a
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
        >
          {t("common.signInAgain")}
        </a>
      ) : kind === "generic" || kind === "external-identifier" || kind === "timeout" ? (
        <Button variant="outline" size="sm" className="min-h-11 sm:min-h-11" onClick={onRetry}>{t("common.retry")}</Button>
      ) : null}
    </div>
  );
}
