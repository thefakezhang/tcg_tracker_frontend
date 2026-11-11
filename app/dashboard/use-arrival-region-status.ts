"use client";

// The one owner of the Arrivals focus status on the tab. The region panel
// (which changes the focus) and the feed's region filter (which lists every
// region and asks for a read once when an unread one is selected) both read
// and change it through this controller, so a change made in either shows in
// both at once.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type ArrivalRegionStatus,
  type ReadRun,
  type RegionAction,
  type RegionActionSender,
  type RegionStatusLoader,
  loadRegionStatus,
  sendRegionAction,
} from "./arrival-regions";

export type RegionStatusState =
  | { status: "loading" }
  | { status: "ready"; data: ArrivalRegionStatus }
  | { status: "unavailable" }
  | { status: "error"; error: Error };

export type ArrivalRegionStatusController = {
  state: RegionStatusState;
  /**
   * Loads the status again and resolves with it, or with null when it is
   * unavailable, failed, or a later load or change overtook it. Quiet keeps
   * the current status on screen while it loads and when the load fails, for
   * a background refresh; otherwise the loading and error states show.
   */
  reload: (options?: { quiet?: boolean }) => Promise<ArrivalRegionStatus | null>;
  /** Sends one change and adopts the status the RPC answers with; rejects with the refusal. */
  send: (action: RegionAction) => Promise<ArrivalRegionStatus>;
  /**
   * The newest read-once answer per region this session (`read_run`; null
   * when the backend gave none, as before migration 000642). Only a read-once
   * request carries it, so a status reload leaves it as it was.
   */
  readRuns: ReadonlyMap<string, ReadRun | null>;
};

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useArrivalRegionStatus(
  loader: RegionStatusLoader = loadRegionStatus,
  sender: RegionActionSender = sendRegionAction,
): ArrivalRegionStatusController {
  const [state, setState] = useState<RegionStatusState>({ status: "loading" });
  const [readRuns, setReadRuns] = useState<ReadonlyMap<string, ReadRun | null>>(() => new Map());
  // Each load takes a generation; a load that a later load or a change has
  // overtaken is dropped, so a slow load never undoes a change.
  const generation = useRef(0);

  const reload = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const current = ++generation.current;
    if (!quiet) setState({ status: "loading" });
    try {
      const data = await loader();
      if (generation.current !== current) return null;
      if (data !== null) setState({ status: "ready", data });
      else if (!quiet) setState({ status: "unavailable" });
      return data;
    } catch (reason) {
      if (generation.current === current && !quiet) setState({ status: "error", error: asError(reason) });
      return null;
    }
  }, [loader]);

  // A change drops any load still in flight, which may have read the status
  // from before it, and the status the RPC answers with is the one after it.
  const send = useCallback(async (action: RegionAction) => {
    generation.current += 1;
    const data = await sender(action);
    setState({ status: "ready", data });
    if (action.action === "request_read") {
      setReadRuns((known) => new Map(known).set(action.region, data.read_run));
    }
    return data;
  }, [sender]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return useMemo(() => ({ state, reload, send, readRuns }), [state, reload, send, readRuns]);
}
