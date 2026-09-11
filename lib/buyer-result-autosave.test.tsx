// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useBuyerResultAutosave,
  type BuyerPersistResult,
  type BuyerResultRow,
} from "./buyer-result-autosave";

const row = (note: string | null = null): BuyerResultRow => ({
  plan_line_id: 1,
  outcome: "purchased",
  purchased_quantity: 1,
  unit_price_jpy: 1000,
  condition_seen: "LP",
  note,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("buyer result autosave", () => {
  it("debounces an edited cell and publishes pending, saving, then saved", async () => {
    const request = deferred<BuyerPersistResult>();
    const persist = vi.fn(() => request.promise);
    const { result } = renderHook(() => useBuyerResultAutosave({ persist, debounceMs: 20 }));
    act(() => result.current.replaceRows([row()]));

    act(() => result.current.queue(row(), row("typed"), ["note"]));
    expect(result.current.states[1].phase).toBe("pending");
    expect(persist).not.toHaveBeenCalled();

    await act(async () => { await new Promise((done) => setTimeout(done, 30)); });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result.current.states[1].phase).toBe("saving");

    await act(async () => {
      request.resolve({ ok: true });
      await request.promise;
    });
    await waitFor(() => expect(result.current.states[1].phase).toBe("saved"));
  });

  it("serializes newer input behind an in-flight save so an older response cannot win", async () => {
    const first = deferred<BuyerPersistResult>();
    const second = deferred<BuyerPersistResult>();
    const persist = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useBuyerResultAutosave({ persist, debounceMs: 1000 }));
    act(() => result.current.replaceRows([row()]));
    let flush!: Promise<boolean>;

    act(() => {
      result.current.queue(row(), row("first"), ["note"]);
      flush = result.current.flush(1);
    });
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.queue(result.current.currentRow(1)!, row("newest"), ["note"]);
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result.current.currentRow(1)?.note).toBe("newest");

    await act(async () => {
      first.resolve({ ok: true });
      await first.promise;
    });
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    expect(persist.mock.calls[1][0].note).toBe("newest");

    await act(async () => {
      second.resolve({ ok: true });
      await flush;
    });
    expect(result.current.currentRow(1)?.note).toBe("newest");
    expect(result.current.confirmedRow(1)?.note).toBe("newest");
  });

  it("keeps a transient failure for an explicit retry", async () => {
    const persist = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: "temporary failure", terminal: false })
      .mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useBuyerResultAutosave({ persist }));
    act(() => result.current.replaceRows([row()]));
    act(() => result.current.queue(row(), row("keep me"), ["note"]));

    await act(async () => { await result.current.flush(1); });
    expect(result.current.states[1]).toMatchObject({
      phase: "error",
      message: "temporary failure",
      retryable: true,
    });
    expect(result.current.currentRow(1)?.note).toBe("keep me");

    act(() => result.current.retry(1));
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.states[1].phase).toBe("saved"));
    expect(result.current.confirmedRow(1)?.note).toBe("keep me");
  });

  it("Escape removes an unsent edit and restores the server-confirmed row", async () => {
    const persist = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useBuyerResultAutosave({ persist, debounceMs: 20 }));
    act(() => result.current.replaceRows([row()]));
    act(() => result.current.queue(row(), row("mistake"), ["note"]));
    act(() => result.current.revert(1));

    await act(async () => { await new Promise((done) => setTimeout(done, 30)); });
    expect(persist).not.toHaveBeenCalled();
    expect(result.current.currentRow(1)?.note).toBeNull();
    expect(result.current.states[1].phase).toBe("saved");
  });

  it("settles as saved when an in-flight escaped edit fails and is retried", async () => {
    const request = deferred<BuyerPersistResult>();
    const persist = vi.fn(() => request.promise);
    const { result } = renderHook(() => useBuyerResultAutosave({ persist, debounceMs: 1000 }));
    act(() => result.current.replaceRows([row()]));
    let flush!: Promise<boolean>;

    act(() => {
      result.current.queue(row(), row("in flight"), ["note"]);
      flush = result.current.flush(1);
    });
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    act(() => result.current.revert(1));
    expect(result.current.currentRow(1)?.note).toBeNull();

    await act(async () => {
      request.resolve({ ok: false, message: "temporary failure", terminal: false });
      await flush;
    });
    expect(result.current.states[1].phase).toBe("error");

    act(() => result.current.retry(1));
    await waitFor(() => expect(result.current.states[1].phase).toBe("saved"));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result.current.confirmedRow(1)?.note).toBeNull();
  });
});
