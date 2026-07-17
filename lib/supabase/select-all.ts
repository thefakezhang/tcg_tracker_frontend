// Paged reads that survive PostgREST's row cap.
//
// PostgREST truncates EVERY response at `max_rows` (1000 on this project,
// supabase/config.toml) and reports the truncation nowhere: no error, no flag -
// the caller just gets 1000 rows and believes that is the whole answer. A query
// that returns one row per id is safe while the id list stays under the cap; a
// query that FANS OUT (one card -> its ~6 platform links) blows through it long
// before the caller notices.
//
// That is not hypothetical. The match-review queue loads 500 candidates, then
// fetched their catalog anchors in a single `.in(card_id, [500 ids])`. Those 500
// cards own 2907 link rows, so 1907 were dropped; PostgREST returned the first
// 1000 in card_id order, and every card past that cutoff rendered with NO
// anchors - a card carrying 6 live links (tcgplayer, collectr, pricecharting,
// snkrdunk, shinsoku, SKU) looked brand-new to the curator. 307 of 500 rows on
// the page were affected, and the card straddling the cutoff showed a PARTIAL
// link set, which is worse than none: it reads as "this card has no tcgplayer
// id" when it does.
//
// selectAll pages with .range() until a short read, so the caller gets every
// row or throws. Use it for any read whose row count is a function of the data
// (link fan-outs, id gates) rather than of a page size you control.
// Structural shape of the two builder methods paging needs. Typed here rather
// than imported: PostgrestFilterBuilder takes 4-7 generics that a caller-agnostic
// helper can't supply, and pinning them would couple this file to the SDK version.
interface PagedBuilder {
  order(column: string, opts: { ascending: boolean }): PagedBuilder;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

// The window we ASK for. The server may hand back fewer rows than this - either
// because the result ended, or because max_rows clamped us - and we deliberately
// never assume which. Paging advances by the row count actually returned and
// stops only on an EMPTY page, so this helper stays correct whatever max_rows is
// set to (1000 today per supabase/config.toml, but that is a server-side dial we
// don't control and can't read back from the client). Hardcoding the cap here
// and treating a short read as "done" is precisely the bug this file fixes: if
// the real cap were ever lower than PAGE, every caller would silently truncate
// again, in a way no test or type would catch.
const PAGE = 1000;

// A hard stop on total rows, so a runaway filter can't pin the browser fetching
// a whole table. Crossing it means the caller is asking for the wrong thing
// (filter server-side instead) - fail loudly rather than half-answer, which is
// the exact failure mode this file exists to kill.
const MAX_ROWS = 100_000;

/**
 * Fetch every row a query matches, transparently paging past the PostgREST cap.
 *
 * `build` must return a FRESH builder each call - a PostgREST builder is a
 * one-shot thenable, so reusing one across pages replays the first request.
 *
 * `orderBy` must be a TOTAL order (unique across the result set, e.g. a table's
 * unique key). Ordering by a non-unique column lets Postgres return ties in a
 * different order per page, which silently duplicates and drops rows across the
 * page boundary.
 */
export async function selectAll<T>(
  build: () => PagedBuilder,
  orderBy: string[],
): Promise<T[]> {
  if (orderBy.length === 0) throw new Error("selectAll: orderBy must name at least one column");
  const out: T[] = [];
  for (;;) {
    let q = build();
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(out.length, out.length + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    // Advance by what we actually received and stop only when a page comes back
    // empty. A short page is ambiguous - end of results, or the server's cap -
    // so we re-ask from the new offset instead of guessing. Worst case that
    // costs one extra empty request; the alternative costs silent data loss.
    if (rows.length === 0) return out;
    out.push(...rows);
    if (out.length >= MAX_ROWS) {
      throw new Error(`selectAll: exceeded ${MAX_ROWS} rows; narrow the query server-side`);
    }
  }
}

/**
 * Split an id list into chunks small enough to keep a `.in(...)` URL under the
 * ~16KB request-line limit. A few hundred numeric ids is fine; tens of
 * thousands is not a query, it's a join that belongs in the database.
 */
export function chunkIds<T>(ids: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Fetch every row matching an `.in(col, ids)` filter, safe on BOTH axes: the id
 * list is chunked so the request URL never overflows, and each chunk's result is
 * paged so a fan-out (one id -> many rows, e.g. a card -> its price-summary tiers)
 * can't be truncated at the PostgREST cap. Use whenever the filter is a
 * caller-supplied id list whose matched-row count is a function of the data.
 *
 * `build(chunk)` must return a FRESH builder with the chunk applied as the
 * `.in(...)`; `orderBy` must be a total order over the result (see selectAll).
 * `ids` is de-duplicated first, since a repeated id only widens the URL.
 */
export async function selectAllByIds<T>(
  ids: Array<string | number>,
  orderBy: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (chunk: Array<string | number>) => any,
  chunkSize = 500,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const out: T[] = [];
  for (const chunk of chunkIds(unique, chunkSize)) {
    out.push(...(await selectAll<T>(() => build(chunk), orderBy)));
  }
  return out;
}
