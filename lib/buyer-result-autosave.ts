import { useCallback, useEffect, useRef, useState } from "react";

export type BuyerResultField =
  | "outcome"
  | "purchased_quantity"
  | "unit_price_jpy"
  | "condition_seen"
  | "note";

export type BuyerResultRow = {
  plan_line_id: number;
  outcome: string;
  purchased_quantity: number;
  unit_price_jpy: number | null;
  condition_seen: string | null;
  note: string | null;
};

export type BuyerSaveState = {
  phase: "pending" | "saving" | "saved" | "error";
  message?: string;
  retryable?: boolean;
  savedAt?: number;
};

export type BuyerPersistResult =
  | { ok: true }
  | { ok: false; message: string; terminal: boolean };

type Job<Row extends BuyerResultRow> = {
  confirmed: Row;
  desired: Row;
  fields: Set<BuyerResultField>;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<boolean> | null;
  blocked: boolean;
};

type Options<Row extends BuyerResultRow> = {
  persist: (row: Row) => Promise<BuyerPersistResult>;
  onSaved?: (row: Row) => void;
  debounceMs?: number;
};

const writableFields: readonly BuyerResultField[] = [
  "outcome",
  "purchased_quantity",
  "unit_price_jpy",
  "condition_seen",
  "note",
];

function sameResult<Row extends BuyerResultRow>(left: Row, right: Row): boolean {
  return writableFields.every((field) => left[field] === right[field]);
}

/**
 * A serial, per-line autosave queue.
 *
 * A second edit never races the first request. It stays as the desired row and
 * is sent only after the earlier response has been reconciled. This makes a
 * late response unable to overwrite newer input. Transient failures retain the
 * desired row for explicit retry, while terminal ownership or finalization
 * refusals restore the last server-confirmed row.
 */
export function useBuyerResultAutosave<Row extends BuyerResultRow>({
  persist,
  onSaved,
  debounceMs = 450,
}: Options<Row>) {
  const [rows, setRowsState] = useState<Row[] | null>(null);
  const [states, setStates] = useState<Record<number, BuyerSaveState>>({});
  const rowsRef = useRef<Row[] | null>(null);
  const confirmedRef = useRef(new Map<number, Row>());
  const jobsRef = useRef(new Map<number, Job<Row>>());
  const mountedRef = useRef(true);
  const optionsRef = useRef({ persist, onSaved, debounceMs });
  optionsRef.current = { persist, onSaved, debounceMs };

  const publishState = useCallback((id: number, state: BuyerSaveState) => {
    if (!mountedRef.current) return;
    setStates((current) => ({ ...current, [id]: state }));
  }, []);

  const replaceDisplayedRow = useCallback((next: Row) => {
    const current = rowsRef.current;
    if (!current?.some((row) => row.plan_line_id === next.plan_line_id)) return;
    const changed = current.map((row) =>
      row.plan_line_id === next.plan_line_id ? next : row,
    );
    rowsRef.current = changed;
    if (mountedRef.current) setRowsState(changed);
  }, []);

  const drainRef = useRef<(id: number) => Promise<boolean>>(async () => true);

  const drain = useCallback(async (id: number): Promise<boolean> => {
    let job = jobsRef.current.get(id);
    if (!job) return true;

    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    if (job.blocked) return false;

    if (job.inFlight) {
      await job.inFlight;
      job = jobsRef.current.get(id);
      if (!job) return true;
      if (job.blocked) return false;
      return drainRef.current(id);
    }

    if (sameResult(job.desired, job.confirmed)) {
      jobsRef.current.delete(id);
      publishState(id, { phase: "saved", savedAt: Date.now() });
      return true;
    }

    const sent = job.desired;
    publishState(id, { phase: "saving" });
    const request = (async () => {
      const result = await optionsRef.current.persist(sent);
      const current = jobsRef.current.get(id);
      if (!current) return result.ok;
      current.inFlight = null;

      if (!result.ok) {
        if (result.terminal) {
          jobsRef.current.delete(id);
          replaceDisplayedRow(current.confirmed);
          publishState(id, {
            phase: "error",
            message: result.message,
            retryable: false,
          });
        } else {
          current.blocked = true;
          publishState(id, {
            phase: "error",
            message: result.message,
            retryable: true,
          });
        }
        return false;
      }

      current.confirmed = sent;
      confirmedRef.current.set(id, sent);
      optionsRef.current.onSaved?.(sent);
      if (sameResult(current.desired, sent)) {
        jobsRef.current.delete(id);
        publishState(id, { phase: "saved", savedAt: Date.now() });
        return true;
      }

      publishState(id, { phase: "pending" });
      return true;
    })();

    job.inFlight = request;
    await request;

    job = jobsRef.current.get(id);
    if (!job) return true;
    if (job.blocked) return false;
    return drainRef.current(id);
  }, [publishState, replaceDisplayedRow]);
  drainRef.current = drain;

  const replaceRows = useCallback((incoming: Row[]) => {
    const displayed = incoming.map((row) => {
      const job = jobsRef.current.get(row.plan_line_id);
      if (job) return job.desired;
      confirmedRef.current.set(row.plan_line_id, row);
      return row;
    });
    rowsRef.current = displayed;
    setRowsState(displayed);
    setStates((current) => Object.fromEntries(incoming.map((row) => [
      row.plan_line_id,
      jobsRef.current.has(row.plan_line_id)
        ? current[row.plan_line_id] ?? { phase: "pending" as const }
        : { phase: "saved" as const },
    ])));
  }, []);

  const queue = useCallback((prior: Row, next: Row, fields: Iterable<BuyerResultField>) => {
    const id = prior.plan_line_id;
    let job = jobsRef.current.get(id);
    if (!job) {
      job = {
        confirmed: confirmedRef.current.get(id) ?? prior,
        desired: next,
        fields: new Set(fields),
        timer: null,
        inFlight: null,
        blocked: false,
      };
      jobsRef.current.set(id, job);
    } else {
      job.desired = next;
      for (const field of fields) job.fields.add(field);
      job.blocked = false;
    }

    replaceDisplayedRow(next);
    if (sameResult(job.desired, job.confirmed) && !job.inFlight) {
      if (job.timer) clearTimeout(job.timer);
      jobsRef.current.delete(id);
      publishState(id, { phase: "saved", savedAt: Date.now() });
      return;
    }

    publishState(id, { phase: "pending" });
    if (job.inFlight) return;
    if (job.timer) clearTimeout(job.timer);
    job.timer = setTimeout(() => void drainRef.current(id), optionsRef.current.debounceMs);
  }, [publishState, replaceDisplayedRow]);

  const flush = useCallback((id: number) => drainRef.current(id), []);

  const flushAll = useCallback(async (): Promise<boolean> => {
    const ids = [...jobsRef.current.keys()];
    const results = await Promise.all(ids.map((id) => drainRef.current(id)));
    return results.every(Boolean);
  }, []);

  const retry = useCallback((id: number) => {
    const job = jobsRef.current.get(id);
    if (!job) return;
    job.blocked = false;
    publishState(id, { phase: "pending" });
    void drainRef.current(id);
  }, [publishState]);

  const revert = useCallback((id: number) => {
    const job = jobsRef.current.get(id);
    if (!job) return;
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    job.desired = job.confirmed;
    job.blocked = false;
    replaceDisplayedRow(job.confirmed);

    // A request that already reached the server cannot be cancelled safely.
    // Keep the job alive so its completion is followed by a compensating write
    // of the last confirmed value. Before a request starts, Escape is local and
    // removes the job without making a network call.
    if (job.inFlight) {
      publishState(id, { phase: "pending" });
      return;
    }
    jobsRef.current.delete(id);
    publishState(id, { phase: "saved", savedAt: Date.now() });
  }, [publishState, replaceDisplayedRow]);

  const currentRow = useCallback((id: number): Row | undefined =>
    jobsRef.current.get(id)?.desired
      ?? rowsRef.current?.find((row) => row.plan_line_id === id), []);

  const confirmedRow = useCallback((id: number): Row | undefined =>
    confirmedRef.current.get(id), []);

  useEffect(() => {
    mountedRef.current = true;
    const flushPending = () => { void flushAll(); };
    window.addEventListener("pagehide", flushPending);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      for (const job of jobsRef.current.values()) {
        if (job.timer) {
          clearTimeout(job.timer);
          job.timer = null;
        }
      }
      // React cannot await cleanup, but invoking drain starts every unsent RPC
      // synchronously before the component releases its references.
      void flushAll();
      mountedRef.current = false;
    };
  }, [flushAll]);

  return {
    rows,
    states,
    replaceRows,
    queue,
    flush,
    flushAll,
    retry,
    revert,
    currentRow,
    confirmedRow,
  };
}
