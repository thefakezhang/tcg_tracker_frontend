import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, MAX_LOCK_HOLD_MS } from "./client";

const transport = vi.fn<typeof fetch>();
const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any")!;
const throwDescriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted")!;
function composition(native: boolean) {
  if (!native) Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true });
}
const response = () => new Response(JSON.stringify([{ card_id: 42 }]), {
  headers: { "Content-Type": "application/json" },
});
const read = (signal?: AbortSignal) => {
  let query = createClient().from("inventory_holdings_v").select("card_id").throwOnError();
  if (signal) query = query.abortSignal(signal);
  return Promise.resolve(query);
};
function observe<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  const done = promise.then(
    (value) => { state.settled = true; state.value = value; },
    (error: unknown) => { state.settled = true; state.error = error; },
  );
  return { state, done };
}
function hangUntilAborted() {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  transport.mockImplementation((_input, init) => {
    started();
    const signal = init!.signal!;
    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  return ready;
}

beforeEach(async () => {
  transport.mockReset();
  vi.stubGlobal("fetch", transport);
  // The real configured client has no session. Keep auth initialization out of
  // the fake request clock; every transport call below is an actual query/RPC.
  await createClient().auth.getSession();
  vi.useFakeTimers();
});
afterEach(async () => {
  await vi.runAllTimersAsync();
  Object.defineProperty(AbortSignal, "any", anyDescriptor);
  Object.defineProperty(AbortSignal.prototype, "throwIfAborted", throwDescriptor);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("configured Supabase request lifecycle", () => {
  it.each(["completed", "before", "active", "backoff"])("supports AbortController without newer signal APIs (%s)", async (stage) => {
    composition(false);
    Object.defineProperty(AbortSignal.prototype, "throwIfAborted", { value: undefined, configurable: true });
    const controller = new AbortController();
    Object.defineProperty(controller.signal, "reason", { value: undefined });
    if (stage === "completed") {
      transport.mockImplementation(async () => response());
      expect((await read(controller.signal)).data).toEqual([{ card_id: 42 }]);
      controller.abort();
      expect(transport).toHaveBeenCalledTimes(1);
      return;
    }
    if (stage === "before") controller.abort();
    if (stage === "backoff") transport.mockRejectedValue(new TypeError("offline"));
    else hangUntilAborted();
    const pending = observe(read(controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.state.settled).toBe(true);
    expect(pending.state.error).toMatchObject({ name: "AbortError" });
    expect(transport).toHaveBeenCalledTimes(stage === "before" ? 0 : 1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, { cause: "selection changed" }])("preserves explicit cancellation reasons: %s", async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    const pending = observe(read(controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.state.settled).toBe(true);
    expect(pending.state.error).toBe(reason);
    expect(transport).not.toHaveBeenCalled();
  });

  it("releases completed read listeners on a long-lived caller signal", async () => {
    const controller = new AbortController();
    transport.mockImplementation(async () => response());
    for (let index = 0; index < 10; index++) {
      expect((await read(controller.signal)).data).toEqual([{ card_id: 42 }]);
    }
    expect(transport).toHaveBeenCalledTimes(10);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("does not start an already cancelled read (native composition=%s)", async (native) => {
    composition(native);
    const controller = new AbortController();
    const reason = new DOMException("view closed", "AbortError");
    controller.abort(reason);
    hangUntilAborted();
    const pending = observe(read(controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.state.settled).toBe(true);
    expect(pending.state.error).toBe(reason);
    expect(transport).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("finishes an active cancelled read without retrying (native composition=%s)", async (native) => {
    composition(native);
    const controller = new AbortController();
    const reason = new DOMException("selected another lot", "AbortError");
    const ready = hangUntilAborted();
    const pending = observe(read(controller.signal));
    await ready;
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.state.settled).toBe(true);
    expect(pending.state.error).toBe(reason);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("cancels retry backoff with the caller's reason (native composition=%s)", async (native) => {
    composition(native);
    const controller = new AbortController();
    const reason = new DOMException("dialog closed", "AbortError");
    transport.mockRejectedValue(new TypeError("network disconnected"));
    const pending = observe(read(controller.signal));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(pending.state.settled).toBe(false);
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.state.settled).toBe(true);
    expect(pending.state.error).toBe(reason);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the existing two backoffs and succeeds on the third network attempt", async () => {
    transport.mockRejectedValueOnce(new TypeError("first disconnect"))
      .mockRejectedValueOnce(new TypeError("second disconnect"))
      .mockImplementationOnce(async () => response());
    const pending = observe(read());
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await pending.done;
    expect(transport).toHaveBeenCalledTimes(3);
    expect(pending.state.value?.data).toEqual([{ card_id: 42 }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps hung reads within the auth lock's existing hold bound", async () => {
    const ready = hangUntilAborted();
    const pending = observe(read());
    await ready;
    await vi.advanceTimersByTimeAsync(MAX_LOCK_HOLD_MS);
    expect(pending.state.settled).toBe(true);
    expect(pending.state.error).toMatchObject({ name: "TimeoutError", message: "request timeout" });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never retries a failed sale mutation", async () => {
    const failure = new TypeError("connection lost after send");
    transport.mockRejectedValue(failure);
    await expect(createClient().rpc("record_lot_sale", { p_items: [] }).throwOnError()).rejects.toBe(failure);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]?.method).toBe("POST");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not change HTTP-status retry policy", async () => {
    transport.mockResolvedValue(new Response(JSON.stringify({ message: "server refused" }), { status: 503 }));
    await expect(read()).rejects.toMatchObject({ message: "server refused" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("preserves cancellation after headers while the body is streaming (native composition=%s)", async (native) => {
    composition(native);
    const caller = new AbortController();
    const reason = new DOMException("left the page during download", "AbortError");
    let finishBody = () => {};
    transport.mockImplementation(async (_input, init) => {
      const signal = init!.signal!;
      return new Response(new ReadableStream({
        start(controller) {
          const abort = () => { controller.error(signal.reason); finishBody = () => {}; };
          signal.addEventListener("abort", abort, { once: true });
          finishBody = () => {
            signal.removeEventListener("abort", abort);
            controller.close();
          };
        },
      }), { headers: { "Content-Type": "application/json" } });
    });
    const pending = observe(read(caller.signal));
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(pending.state.settled).toBe(false);
      caller.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(pending.state.settled).toBe(true);
      expect(pending.state.error).toBe(reason);
      expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      finishBody();
      await pending.done;
    }
  });

  it("releases legacy forwarding listeners when every fetch attempt fails", async () => {
    composition(false);
    const controller = new AbortController();
    const failure = new TypeError("offline");
    transport.mockRejectedValue(failure);
    const pending = observe(read(controller.signal));
    await vi.advanceTimersByTimeAsync(750);
    expect(pending.state.error).toBe(failure);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
