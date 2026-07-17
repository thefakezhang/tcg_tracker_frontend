// Regression guard for the PostgREST row-cap bug (see select-all.ts).
//
// The fake below is the whole point: it emulates the ONE server behaviour that
// makes this class of bug invisible - PostgREST honours .range() but silently
// clamps every response to max_rows, returning a short page with no error and no
// flag. Any helper that treats "fewer rows than I asked for" as "that's all of
// them" passes a naive test and still loses data in production.
import { describe, it, expect } from "vitest";
import { selectAll, selectAllByIds, chunkIds } from "./select-all";

// `cap` stands in for the server's max_rows. Deliberately a parameter: the real
// value is a server-side dial we cannot read from the client, so the helper must
// be correct without knowing it.
function fakeTable(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  let requests = 0;
  const build = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      order: () => b,
      range: (from: number, to: number) => {
        requests++;
        const want = to - from + 1;
        return Promise.resolve({ data: rows.slice(from, from + Math.min(want, cap)), error: null });
      },
    };
    return b;
  };
  return { build, requests: () => requests };
}

describe("selectAll", () => {
  it("returns every row when the result exceeds the cap", async () => {
    // The exact shape of the production bug: a 500-candidate review page whose
    // catalog anchors are 2907 rows. The old single .in() returned 1000 and 307
    // of 500 cards rendered with no anchors at all.
    const t = fakeTable(2907, 1000);
    const got = await selectAll<{ id: number }>(t.build, ["id"]);
    expect(got).toHaveLength(2907);
    expect(got.map((r) => r.id)).toEqual([...Array(2907).keys()]); // no gaps, no repeats
  });

  it("returns every row when the server's cap is SMALLER than the page we request", async () => {
    // max_rows is not ours to set and may be lowered without this code changing.
    // A short-read terminator would stop at 500 here and silently truncate -
    // reintroducing the original bug with no error, no type change, no test
    // failure anywhere else. This is the case that must never regress.
    const t = fakeTable(2907, 500);
    const got = await selectAll<{ id: number }>(t.build, ["id"]);
    expect(got).toHaveLength(2907);
    expect(got.map((r) => r.id)).toEqual([...Array(2907).keys()]);
  });

  it("terminates and stays complete when the total is an exact multiple of the cap", async () => {
    const t = fakeTable(2000, 1000);
    expect(await selectAll(t.build, ["id"])).toHaveLength(2000);
  });

  it("handles an empty result", async () => {
    expect(await selectAll(fakeTable(0, 1000).build, ["id"])).toHaveLength(0);
  });

  it("costs exactly one extra request to confirm a small result is complete", async () => {
    // The documented price of not knowing max_rows. A short page is ambiguous
    // (result ended, or the server clamped?), so we re-ask once and stop on the
    // empty page: 2 requests for a 6-row answer. Cheap, and it is what buys the
    // "cap smaller than PAGE" case above. Asserted so the cost stays visible and
    // bounded - if this ever grows past +1, paging has gone wrong.
    const t = fakeTable(6, 1000);
    expect(await selectAll(t.build, ["id"])).toHaveLength(6);
    expect(t.requests()).toBe(2);
  });

  it("throws rather than fetching an unbounded result into the browser", async () => {
    await expect(selectAll(fakeTable(200_000, 1000).build, ["id"])).rejects.toThrow(/exceeded/);
  });

  it("rejects an empty orderBy, since paging without a total order drops rows", async () => {
    await expect(selectAll(fakeTable(10, 1000).build, [])).rejects.toThrow(/orderBy/);
  });

  it("propagates a query error instead of returning a partial result", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const build = (): any => ({ order() { return this; }, range: () => Promise.resolve({ data: null, error: { message: "boom" } }) });
    await expect(selectAll(build, ["id"])).rejects.toMatchObject({ message: "boom" });
  });
});

describe("chunkIds", () => {
  it("splits a list into bounded chunks that cover every id exactly once", () => {
    const chunks = chunkIds([...Array(450).keys()], 200);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunks.flat()).toEqual([...Array(450).keys()]);
  });

  it("returns nothing for an empty list and one chunk when under size", () => {
    expect(chunkIds([], 200)).toEqual([]);
    expect(chunkIds([1, 2, 3], 200)).toEqual([[1, 2, 3]]);
  });
});

// A fake `.in(ids)` table: each id owns `fanout` rows (a card -> its price tiers).
// Honors .range(from,to) and clamps every page to `cap` (max_rows), and records
// which ids were actually queried so the dedup guarantee can be asserted.
function fakeIdTable(idCount: number, fanout: number, cap: number) {
  const queried: Array<string | number> = [];
  const build = (chunk: Array<string | number>) => {
    queried.push(...chunk);
    const rows = chunk.flatMap((id) => Array.from({ length: fanout }, (_, k) => ({ id, k })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      order: () => b,
      range: (from: number, to: number) =>
        Promise.resolve({ data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null }),
    };
    return b;
  };
  return { build, queried: () => queried, idCount };
}

describe("selectAllByIds", () => {
  it("returns every fan-out row when a chunk's result exceeds the cap", async () => {
    // 100 ids x 5 rows = 500 rows in one chunk, cap 200: must page within the chunk.
    const t = fakeIdTable(100, 5, 200);
    const ids = Array.from({ length: 100 }, (_, i) => i);
    const got = await selectAllByIds<{ id: number; k: number }>(ids, ["id", "k"], t.build, 1000);
    expect(got).toHaveLength(500);
  });

  it("covers every id across multiple chunks", async () => {
    const t = fakeIdTable(450, 2, 1000);
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const got = await selectAllByIds<{ id: number; k: number }>(ids, ["id", "k"], t.build, 200); // 3 chunks
    expect(got).toHaveLength(900);
    expect(new Set(got.map((r) => r.id)).size).toBe(450);
  });

  it("de-duplicates ids before querying", async () => {
    const t = fakeIdTable(3, 1, 1000);
    const got = await selectAllByIds<{ id: number }>([7, 7, 7, 8], ["id"], t.build, 500);
    expect(got).toHaveLength(2); // ids 7 and 8, once each (proves the dedup)
    // Only the two distinct ids ever reach the query (build may be re-invoked per
    // page, so assert the distinct set, not the call count).
    expect([...new Set(t.queried())].sort()).toEqual([7, 8]);
  });

  it("short-circuits on an empty id list", async () => {
    const t = fakeIdTable(0, 1, 1000);
    expect(await selectAllByIds([], ["id"], t.build)).toHaveLength(0);
    expect(t.queried()).toHaveLength(0); // no request at all
  });
});
