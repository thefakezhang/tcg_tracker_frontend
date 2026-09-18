"use client";

// Data access for the scanner batch review screen.
//
// Reads staged proposals out of scanner_batches / scanner_batch_captures and
// writes decisions through the two SECURITY DEFINER RPCs. The browser never
// writes those tables directly: decide_scanner_batch_capture derives whether a
// decision was a confirmation or a correction from the stored proposal, so a
// client that wrote the column itself could claim it confirmed something it
// actually overrode, and the drift signal would be worthless.
//
// Backend contract: internal/db/migrations/000413_scanner_batch_staging.up.sql.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAll, selectAllByIds } from "@/lib/supabase/select-all";
import {
  type Candidate,
  type Decision,
  type ScanCapture,
  asParkReason,
  parseCandidates,
} from "@/lib/scan-review";
import { POKEMON_CARD_DEF_COLS, type CardDefinition } from "./use-card-data";
import { useSupabaseQuery } from "./use-query";

// Capture bytes live in a private bucket, so they are reachable only through a
// short-lived signed URL minted for the authenticated owner. Deliberately not
// /api/proxy-image: that route is restricted to public http(s) hosts on purpose,
// and pointing it at private storage would turn it into an open proxy on our
// own origin.
const CAPTURE_BUCKET = "inventory-card-media";
const SIGNED_URL_TTL_SECONDS = 3600;

export interface ScanBatchSummary {
  batchId: string;
  batchLabel: string;
  leg: "import" | "export";
  recognizer: string;
  inventorySource: string;
  stagedAt: string;
  total: number;
  decided: number;
}

export interface ConditionOption {
  conditionId: number;
  code: string;
}

export interface CandidateCard {
  cardUid: string;
  cardId: string;
  name: string;
  englishName: string | null;
  setCode: string;
  cardNumber: string | null;
  miscInfo: string | null;
  imageUrl: string | null;
  rarity: string | null;
  /** Best sell price we hold for this card, in its own currency. Evidence for
   *  the identity decision: two prints that look alike often differ mostly in
   *  value, which is the clearest signal the choice matters at all. */
  price: number | null;
  currency: string | null;
}

export interface CaptureImages {
  front: string | null;
  back: string | null;
}

// Batch list. Small and bounded by how many scan runs the operator has staged.
export function useScanBatches() {
  return useSupabaseQuery<ScanBatchSummary[]>("scan-review:batches", async () => {
    const supabase = createClient();
    const batches = await selectAll<{
      batch_id: string;
      batch_label: string;
      leg: "import" | "export";
      recognizer: string;
      inventory_source: string;
      staged_at: string;
    }>(
      () =>
        supabase
          .from("scanner_batches")
          .select("batch_id, batch_label, leg, recognizer, inventory_source, staged_at") as never,
      ["batch_id"],
    );

    // Progress per batch. One row per capture is a function of the data, so it
    // pages rather than trusting a single read to be complete.
    const captures = await selectAll<{ batch_id: string; decision: string | null }>(
      () => supabase.from("scanner_batch_captures").select("batch_id, decision") as never,
      ["batch_id", "capture_id"],
    );
    const totals = new Map<string, { total: number; decided: number }>();
    for (const row of captures) {
      const entry = totals.get(row.batch_id) ?? { total: 0, decided: 0 };
      entry.total += 1;
      if (row.decision != null) entry.decided += 1;
      totals.set(row.batch_id, entry);
    }

    return batches
      .map((b) => ({
        batchId: b.batch_id,
        batchLabel: b.batch_label,
        leg: b.leg,
        recognizer: b.recognizer,
        inventorySource: b.inventory_source,
        stagedAt: b.staged_at,
        total: totals.get(b.batch_id)?.total ?? 0,
        decided: totals.get(b.batch_id)?.decided ?? 0,
      }))
      .sort((a, b) => b.batchLabel.localeCompare(a.batchLabel));
  });
}

interface CaptureRow {
  capture_id: string;
  ordinal: number;
  front_object_key: string | null;
  back_object_key: string | null;
  mime_type: string | null;
  candidates: unknown;
  proposed_card_uid: string | null;
  proposed_score: number | null;
  top_margin: number | null;
  park_reason: string | null;
  park_detail: string | null;
  decision: string | null;
  decided_card_uid: string | null;
  decided_condition_id: number | null;
}

const CAPTURE_COLS =
  "capture_id, ordinal, front_object_key, back_object_key, mime_type, candidates, proposed_card_uid, proposed_score, top_margin, park_reason, park_detail, decision, decided_card_uid, decided_condition_id";

function toCapture(row: CaptureRow): ScanCapture {
  return {
    captureId: row.capture_id,
    ordinal: row.ordinal,
    frontObjectKey: row.front_object_key,
    backObjectKey: row.back_object_key,
    mimeType: row.mime_type,
    candidates: parseCandidates(row.candidates),
    proposedCardUid: row.proposed_card_uid,
    proposedScore: row.proposed_score,
    topMargin: row.top_margin,
    parkReason: asParkReason(row.park_reason),
    parkDetail: row.park_detail,
    decision: (row.decision as Decision | null) ?? null,
    decidedCardUid: row.decided_card_uid,
    decidedConditionId: row.decided_condition_id,
  };
}

// Every card uid the screen has to be able to name: the shortlist, the
// proposal, and whatever was actually decided (which may be neither).
function referencedCardUids(captures: ScanCapture[]): string[] {
  const uids = new Set<string>();
  for (const capture of captures) {
    for (const candidate of capture.candidates) uids.add(candidate.cardUid);
    if (capture.proposedCardUid) uids.add(capture.proposedCardUid);
    if (capture.decidedCardUid) uids.add(capture.decidedCardUid);
  }
  return [...uids];
}

export async function fetchCardsByUid(uids: string[]): Promise<Map<string, CandidateCard>> {
  const byUid = new Map<string, CandidateCard>();
  if (uids.length === 0) return byUid;
  const supabase = createClient();

  // The uid list is complete (it came from captures we fully paged), so feeding
  // it back as an .in() filter is sound - but it still chunks, because a few
  // hundred uuids overflow the URL long before they trouble the row cap.
  const defs = await selectAllByIds<CardDefinition>(
    uids,
    ["card_id"],
    (chunk) =>
      supabase.from("pokemon_card_definitions").select(POKEMON_CARD_DEF_COLS).in("card_uid", chunk),
  );

  const priceByCardId = new Map<string, { price: number | null; currency: string | null }>();
  const cardIds = defs.map((d) => d.card_id);
  if (cardIds.length > 0) {
    const summaries = await selectAllByIds<{
      card_id: string;
      best_sell_price: number | null;
      best_sell_currency: string | null;
    }>(
      cardIds,
      ["card_id"],
      (chunk) =>
        supabase
          .from("pokemon_price_summaries")
          .select("card_id, best_sell_price, best_sell_currency")
          .eq("tier", 0)
          .in("card_id", chunk),
    );
    for (const row of summaries) {
      if (priceByCardId.has(row.card_id)) continue;
      priceByCardId.set(row.card_id, {
        price: row.best_sell_price,
        currency: row.best_sell_currency,
      });
    }
  }

  for (const def of defs) {
    if (!def.card_uid) continue;
    const price = priceByCardId.get(def.card_id);
    byUid.set(def.card_uid, {
      cardUid: def.card_uid,
      cardId: def.card_id,
      name: def.regional_name,
      englishName: def.english_name ?? null,
      setCode: def.set_code,
      cardNumber: def.card_number,
      miscInfo: def.misc_info,
      imageUrl: def.image_url,
      rarity: def.rarity ?? null,
      price: price?.price ?? null,
      currency: price?.currency ?? null,
    });
  }
  return byUid;
}

export interface ScanBatchData {
  captures: ScanCapture[];
  cards: Map<string, CandidateCard>;
  images: Map<string, CaptureImages>;
}

export function useScanBatch(batchId: string | null) {
  return useSupabaseQuery<ScanBatchData>(
    batchId ? `scan-review:batch:${batchId}` : null,
    async () => {
      const supabase = createClient();
      const rows = await selectAll<CaptureRow>(
        () =>
          supabase
            .from("scanner_batch_captures")
            .select(CAPTURE_COLS)
            .eq("batch_id", batchId as string) as never,
        ["ordinal"],
      );
      const captures = rows.map(toCapture);
      const cards = await fetchCardsByUid(referencedCardUids(captures));

      // One signed-URL call for the whole batch rather than one per image: a
      // 200-capture batch is 400 objects, and per-image round trips would make
      // the screen unusable before the operator saw anything.
      const keys = captures
        .flatMap((c) => [c.frontObjectKey, c.backObjectKey])
        .filter((k): k is string => typeof k === "string" && k.length > 0);
      const signed = new Map<string, string>();
      if (keys.length > 0) {
        const { data } = await supabase.storage
          .from(CAPTURE_BUCKET)
          .createSignedUrls([...new Set(keys)], SIGNED_URL_TTL_SECONDS);
        for (const entry of data ?? []) {
          if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
        }
      }

      const images = new Map<string, CaptureImages>();
      for (const capture of captures) {
        images.set(capture.captureId, {
          front: capture.frontObjectKey ? signed.get(capture.frontObjectKey) ?? null : null,
          back: capture.backObjectKey ? signed.get(capture.backObjectKey) ?? null : null,
        });
      }

      return { captures, cards, images };
    },
  );
}

export function useTcgplayerConditions() {
  const [conditions, setConditions] = useState<ConditionOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    // The RPC rejects anything that is not a TCGplayer condition: inventory
    // grades on that scale and so does the eBay leg, so a Japanese source's
    // scale here would put a code into inventory the listing cannot express.
    supabase
      .from("conditions")
      .select("condition_id, code")
      .eq("standard", "tcgplayer")
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data as { condition_id: number; code: string }[] | null) ?? [];
        setConditions(rows.map((r) => ({ conditionId: r.condition_id, code: r.code })));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultConditionId = useMemo(
    () => conditions.find((c) => c.code === "NM")?.conditionId ?? conditions[0]?.conditionId ?? null,
    [conditions],
  );
  return { conditions, defaultConditionId };
}

export interface DecideResult {
  captureId: string;
  decision: Decision;
  decidedCardUid: string;
  decidedConditionId: number;
  availableQuantity: number;
  replayed: boolean;
}

export function useScanDecisions() {
  const decide = useCallback(
    async (captureId: string, cardUid: string, conditionId: number): Promise<DecideResult> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("decide_scanner_batch_capture", {
        p_capture_id: captureId,
        p_card_uid: cardUid,
        p_condition_id: conditionId,
      });
      if (error) throw error;
      const row = data as {
        capture_id: string;
        decision: Decision;
        decided_card_uid: string;
        decided_condition_id: number;
        available_quantity: number;
        replayed: boolean;
      };
      return {
        captureId: row.capture_id,
        decision: row.decision,
        decidedCardUid: row.decided_card_uid,
        decidedConditionId: row.decided_condition_id,
        availableQuantity: row.available_quantity,
        replayed: row.replayed,
      };
    },
    [],
  );

  const clear = useCallback(async (captureId: string): Promise<void> => {
    const supabase = createClient();
    const { error } = await supabase.rpc("clear_scanner_batch_capture_decision", {
      p_capture_id: captureId,
    });
    if (error) throw error;
  }, []);

  return { decide, clear };
}

export type { Candidate };
