"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ReviewQueueGame = "pokemon_sealed" | "pokemon" | "mtg";
export const MATCH_REVIEW_SENTINEL = -6;

export interface ReviewQueueTarget {
  game: ReviewQueueGame;
  source: string;
}

interface ReviewQueueNavigationValue {
  target: ReviewQueueTarget | null;
  openReviewQueue: (target: ReviewQueueTarget) => void;
  consumeTarget: () => void;
}

const ReviewQueueNavigationContext = createContext<ReviewQueueNavigationValue | null>(null);

/**
 * Carries a one-shot initial filter between sentinel-routed dashboard views.
 * The app deliberately has no URL routing yet, so Source Health cannot encode
 * its drill-down in a query string. The route consumes this target on mount so
 * a later ordinary sidebar visit starts at the unfiltered queue.
 */
export function ReviewQueueNavigationProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<ReviewQueueTarget | null>(null);
  const openReviewQueue = useCallback((next: ReviewQueueTarget) => setTarget(next), []);
  const consumeTarget = useCallback(() => setTarget(null), []);
  const value = useMemo(
    () => ({ target, openReviewQueue, consumeTarget }),
    [target, openReviewQueue, consumeTarget],
  );

  return (
    <ReviewQueueNavigationContext value={value}>
      {children}
    </ReviewQueueNavigationContext>
  );
}

export function useReviewQueueNavigation() {
  const value = useContext(ReviewQueueNavigationContext);
  if (!value) throw new Error("useReviewQueueNavigation must be used within ReviewQueueNavigationProvider");
  return value;
}
