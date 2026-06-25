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

// Inline error banner with a Retry button, for read failures.
export function QueryError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <span className="text-destructive">{t("common.loadError")}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>{t("common.retry")}</Button>
    </div>
  );
}
