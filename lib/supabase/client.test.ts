import { describe, it, expect, vi, afterEach } from "vitest";
import { resilientAuthLock, AUTH_LOCK_MIN_WAIT_MS, MAX_LOCK_HOLD_MS } from "./client";

/**
 * auth-js recovers a seemingly-orphaned auth lock by STEALING it, which breaks
 * every other holder:
 *
 *   AbortError: Lock broken by another request with the 'steal' option.
 *
 * It steals after 5s, but one of our requests may legitimately hold the lock for
 * far longer, so a merely-slow token refresh is mistaken for a dead one and every
 * query queued behind it dies. Measured in a real browser with two dashboards
 * issuing 10 reads each across an 8s refresh: stock auth-js served 1 of 20 reads,
 * this lock serves 20 of 20. These pin the behaviours that produce that.
 */

const realNavigator = globalThis.navigator;
function installLockManager(impl: unknown) {
  Object.defineProperty(globalThis, "navigator", { value: { locks: impl }, configurable: true, writable: true });
}
afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { value: realNavigator, configurable: true, writable: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resilientAuthLock", () => {
  it("waits far longer than auth-js's 5s before suspecting an orphaned lock", () => {
    // The whole bug in one assertion: the steal trigger must outlast the longest
    // time fetchWithRetry can legitimately hold the lock, or slow == dead.
    expect(AUTH_LOCK_MIN_WAIT_MS).toBeGreaterThan(MAX_LOCK_HOLD_MS);
    expect(MAX_LOCK_HOLD_MS).toBeGreaterThan(5_000); // ...which auth-js's default is not
  });

  it("does not steal from a holder that is merely slow", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const held = new Promise<void>((r) => (release = r));
    const request = vi.fn(async (_n: string, opts: Record<string, unknown>, cb: (l: unknown) => Promise<unknown>) => {
      expect(opts.steal).toBeUndefined();
      await held;
      return cb({});
    });
    installLockManager({ request });

    const p = resilientAuthLock("auth", 5_000, async () => "ran");
    // Well past auth-js's 5s steal point, still no steal attempt.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(1);
    release!();
    await expect(p).resolves.toBe("ran");
  });

  it("raises the acquire wait to the floor even when auth-js asks for 5s", async () => {
    let captured: AbortSignal | undefined;
    const request = vi.fn(async (_n: string, opts: Record<string, unknown>, cb: (l: unknown) => Promise<unknown>) => {
      captured = opts.signal as AbortSignal;
      return cb({});
    });
    installLockManager({ request });
    await resilientAuthLock("auth", 5_000, async () => "ran");
    expect(captured).toBeInstanceOf(AbortSignal);
    expect(captured!.aborted).toBe(false);
  });

  it("steals only once the floor has genuinely elapsed", async () => {
    const calls: Record<string, unknown>[] = [];
    const request = vi.fn(async (_n: string, opts: Record<string, unknown>, cb: (l: unknown) => Promise<unknown>) => {
      calls.push(opts);
      if (calls.length === 1) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return cb({});
    });
    installLockManager({ request });
    await expect(resilientAuthLock("auth", 5_000, async () => "recovered")).resolves.toBe("recovered");
    expect(calls[1].steal).toBe(true); // recovery preserved, just not at 5s
  });

  it("lets the auto-refresh tick SKIP when another tab holds the lock", async () => {
    // acquireTimeout 0 is the tick asking "is anyone else doing auth work?".
    // Skipping is correct - the other tab's refresh lands in the shared cookie.
    // Queueing instead causes a redundant refresh and slows every query behind it.
    const request = vi.fn(async (_n: string, opts: Record<string, unknown>, cb: (l: unknown) => Promise<unknown>) => {
      expect(opts.ifAvailable).toBe(true);
      return cb(null); // contended: LockManager hands back a null lock
    });
    installLockManager({ request });
    const fn = vi.fn(async () => "ran");
    await expect(resilientAuthLock("auth", 0, fn)).rejects.toMatchObject({ isAcquireTimeout: true });
    expect(fn).not.toHaveBeenCalled(); // skipped, not queued
  });

  it("still runs the tick when the lock is free", async () => {
    const request = vi.fn(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb({}));
    installLockManager({ request });
    await expect(resilientAuthLock("auth", 0, async () => "ran")).resolves.toBe("ran");
  });

  it("runs unlocked where the browser has no LockManager", async () => {
    installLockManager(undefined);
    await expect(resilientAuthLock("auth", 0, async () => "ran")).resolves.toBe("ran");
  });
});
