import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the application's configured Supabase client, its GET wrapper, and
// PostgREST response/error decoding. Only the last HTTP boundary is controlled.
type Helpers = typeof import("./use-card-data");
type Client = ReturnType<typeof import("@/lib/supabase/client").createClient>;
let helpers: Helpers;
let client: Client;
let http: ReturnType<typeof vi.fn<typeof fetch>>;

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const resources = [
  {
    name: "exchange rates", table: "exchange_rates", columns: "from_currency,to_currency,rate",
    load: (h: Helpers, c: Client) => h.fetchRateMap(c),
    rows: [{ from_currency: "JPY", to_currency: "USD", rate: 0.0067 }],
    expected: new Map([["JPY", 0.0067]]), empty: new Map(),
  },
  {
    name: "conditions", table: "conditions", columns: "condition_id,tier",
    load: (h: Helpers, c: Client) => h.fetchConditionsCache(c),
    rows: [{ condition_id: 3, tier: 2 }, { condition_id: 1, tier: 1 }, { condition_id: 2, tier: 2 }],
    expected: { map: new Map([[3, 2], [1, 1], [2, 2]]), tiers: [1, 2] },
    empty: { map: new Map(), tiers: [] },
  },
  {
    name: "locations", table: "locations", columns: "location_id,name,market_region",
    load: (h: Helpers, c: Client) => h.fetchLocationMap(c),
    rows: [{ location_id: 1, name: "Shop", market_region: "JP" }, { location_id: 2, name: "Other" }],
    expected: new Map([[1, { name: "Shop", marketRegion: "JP" }], [2, { name: "Other", marketRegion: null }]]),
    empty: new Map(),
  },
];

beforeEach(async () => {
  vi.resetModules();
  http = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", http);
  helpers = await import("./use-card-data");
  client = (await import("@/lib/supabase/client")).createClient();
});
afterEach(async () => {
  await client?.auth.stopAutoRefresh();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(resources)("shared $name metadata", (resource) => {
  it("recovers on the next call after a transient HTTP error without rejecting current callers", async () => {
    http.mockResolvedValueOnce(response({ message: "temporarily unavailable", code: "PGRST000" }, 503))
      .mockResolvedValueOnce(response(resource.rows));
    await expect(resource.load(helpers, client)).resolves.toEqual(resource.empty);
    await expect(resource.load(helpers, client)).resolves.toEqual(resource.expected);
    expect(http).toHaveBeenCalledTimes(2);
    const url = new URL(String(http.mock.calls[1][0]));
    expect(url.origin).toBe("http://127.0.0.1:54321");
    expect(url.pathname).toBe(`/rest/v1/${resource.table}`);
    expect(url.searchParams.get("select")).toBe(resource.columns);
    if (resource.table === "exchange_rates") expect(url.searchParams.get("to_currency")).toBe("eq.USD");
    expect(http.mock.calls[1][1]?.method).toBe("GET");
  });

  it("shares one pending HTTP read across ten simultaneous callers", async () => {
    const read = deferred<Response>();
    // Each fetch gets a distinct Response, including on the original buggy
    // implementation; consuming one Response twice must not mask duplicates.
    http.mockImplementation(async () => (await read.promise).clone());
    const calls = Array.from({ length: 10 }, () => resource.load(helpers, client));
    await vi.waitFor(() => expect(http).toHaveBeenCalled());
    read.resolve(response(resource.rows));
    const values = await Promise.all(calls);
    for (const value of values) expect(value).toEqual(resource.expected);
    expect(http).toHaveBeenCalledTimes(1);
    expect(new Set(values).size).toBe(1);
    expect(await resource.load(helpers, client)).toBe(values[0]);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("releases an unexpectedly rejected load without changing its rejection contract", async () => {
    const failure = new Error("query construction failed");
    vi.spyOn(client, "from").mockImplementationOnce(() => { throw failure; });
    await expect(resource.load(helpers, client)).rejects.toBe(failure);
    http.mockResolvedValueOnce(response(resource.rows));
    await expect(resource.load(helpers, client)).resolves.toEqual(resource.expected);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("caches a successful empty result instead of treating it as a failure", async () => {
    http.mockImplementation(async () => response([]));
    const first = await resource.load(helpers, client);
    expect(first).toEqual(resource.empty);
    expect(await resource.load(helpers, client)).toBe(first);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("clears failed shared work so later callers can retry", async () => {
    const read = deferred<Response>();
    http.mockImplementationOnce(() => read.promise)
      .mockImplementation(async () => response(resource.rows));
    const first = resource.load(helpers, client), second = resource.load(helpers, client);
    await vi.waitFor(() => expect(http).toHaveBeenCalled());
    read.resolve(response({ message: "temporarily unavailable" }, 503));
    await expect(Promise.all([first, second])).resolves.toEqual([resource.empty, resource.empty]);
    await expect(resource.load(helpers, client)).resolves.toEqual(resource.expected);
    expect(http).toHaveBeenCalledTimes(2);
  });
});

describe("location refresh ordering", () => {
  const oldRows = [{ location_id: 1, name: "Old shop", market_region: "US" }];
  const newRows = [{ location_id: 1, name: "Current shop", market_region: "JP" }];
  const newMap = new Map([[1, { name: "Current shop", marketRegion: "JP" }]]);

  it("does not let a pre-refresh completion replace the refreshed cache", async () => {
    const oldRead = deferred<Response>();
    http.mockImplementationOnce(() => oldRead.promise).mockResolvedValueOnce(response(newRows));
    const old = helpers.fetchLocationMap(client);
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(1));
    expect(await helpers.refreshLocationMap(client)).toEqual(newMap);
    oldRead.resolve(response(oldRows));
    expect((await old).get(1)?.name).toBe("Old shop");
    expect(await helpers.fetchLocationMap(client)).toEqual(newMap);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("does not let a pre-refresh completion clear the new pending read", async () => {
    const oldRead = deferred<Response>(), freshRead = deferred<Response>();
    http.mockImplementationOnce(() => oldRead.promise)
      .mockImplementation(async () => (await freshRead.promise).clone());
    const old = helpers.fetchLocationMap(client);
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(1));
    const fresh = helpers.refreshLocationMap(client);
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(2));
    oldRead.resolve(response(oldRows));
    await old;
    const joined = helpers.fetchLocationMap(client);
    freshRead.resolve(response(newRows));
    expect(await joined).toEqual(newMap);
    expect(await fresh).toEqual(newMap);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("shares a refresh across simultaneous refresh and ordinary callers", async () => {
    http.mockResolvedValueOnce(response(oldRows));
    await helpers.fetchLocationMap(client);
    const freshRead = deferred<Response>();
    http.mockImplementation(async () => (await freshRead.promise).clone());
    const calls = [helpers.refreshLocationMap(client), helpers.refreshLocationMap(client), helpers.fetchLocationMap(client)];
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(2));
    freshRead.resolve(response(newRows));
    const values = await Promise.all(calls);
    for (const value of values) expect(value).toEqual(newMap);
    expect(new Set(values).size).toBe(1);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("recovers after a failed refresh even if an obsolete load succeeds later", async () => {
    const oldRead = deferred<Response>();
    http.mockImplementationOnce(() => oldRead.promise)
      .mockResolvedValueOnce(response({ message: "unavailable" }, 503))
      .mockResolvedValueOnce(response(newRows));
    const old = helpers.fetchLocationMap(client);
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(1));
    expect(await helpers.refreshLocationMap(client)).toEqual(new Map());
    oldRead.resolve(response(oldRows));
    await old;
    expect(await helpers.fetchLocationMap(client)).toEqual(newMap);
    expect(http).toHaveBeenCalledTimes(3);
  });

});
