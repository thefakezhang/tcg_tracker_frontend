"use client";

import { useState, useCallback } from "react";

// Standard feedback for a save/mutation: a `saving` flag for disabling +
// spinning the button, and surfacing any error (Supabase `{ error }` result or a
// thrown one) instead of silently doing nothing. `save(fn)` returns true on
// success so the caller can then close the dialog / refetch.
export function useSaving() {
  const [saving, setSaving] = useState(false);
  const save = useCallback(async (fn: () => PromiseLike<unknown>): Promise<boolean> => {
    setSaving(true);
    try {
      const result = await fn();
      const err = (result as { error?: { message?: string } | null } | null)?.error;
      if (err) { alert(err.message ?? "Something went wrong."); return false; }
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);
  return { saving, save };
}
