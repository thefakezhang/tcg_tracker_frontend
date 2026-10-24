// When an arrival post was observed, for ordering and for the Arrivals time
// window.
//
// A shop re-surfaces an arrival post by retweeting it, and that means the stock
// is still there, so a re-posted row is as current as its latest boost: its
// time is the later of the tweet time (else the collection time) and
// `last_boosted_at`. The backend orders `twitter_arrival_posts` rows by the
// same rule, and the API route's cursor must carry the same value for paging
// to follow that order, so the rule lives here, shared by the route and the
// dashboard. Rows without the field are unchanged.

export type ArrivalObservedFields = {
  tweet_created_at: string | null;
  acquired_at: string;
  /** When the shop last re-surfaced the post; absent or null when never. */
  last_boosted_at?: string | null;
};

/** The later of a row's base time and its last boost; the base when there is no readable boost. */
export function laterOf(base: string, boosted: string | null | undefined): string {
  if (boosted == null) return base;
  const boostedEpoch = Date.parse(boosted);
  if (Number.isNaN(boostedEpoch)) return base;
  const baseEpoch = Date.parse(base);
  if (Number.isNaN(baseEpoch)) return boosted;
  return boostedEpoch > baseEpoch ? boosted : base;
}

/** The time a post is ordered by: when the shop posted it, else when it was collected, lifted to a later re-post. */
export function arrivalObservedAt(row: ArrivalObservedFields): string {
  return laterOf(row.tweet_created_at ?? row.acquired_at, row.last_boosted_at);
}
