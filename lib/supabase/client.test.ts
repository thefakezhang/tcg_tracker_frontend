import { describe, it, expect, vi, afterEach } from "vitest";
import { waitingNavigatorLock } from "./client";

/**
 * GoTrue's default lock throws the instant another holder exists:
 *
 *   Error: Acquiring an exclusive Navigator LockManager lock
 *     "lock:sb-<ref>-auth-token" immediately failed
 *
 * A second tab is enough. The rejection is unhandled, the token refresh never
 * runs, and every authenticated query then hangs until the fetch timeout - a
 * dashboard that renders but shows no data. These pin the waiting behaviour.
 */

const realNavigator = globalThis.navigator;

function installLockManager(impl: unknown) {
  Object.defineProperty(globalThis, "navigator", {
    value: { locks: impl },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: realNavigator,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
});

describe("waitingNavigatorLock", () => {
  it("never asks for ifAvailable, which is what fails instantly under contention", async () => {
    const request = vi.fn(async (_name: string, opts: Record<string, unknown>, cb: () => Promise<unknown>) => {
      expect(opts.ifAvailable).toBeUndefined();
      expect(opts.mode).toBe("exclusive");
      return cb();
    });
    installLockManager({ request });
    // acquireTimeout 0 is the exact call GoTrue makes on its no-queue paths.
    await expect(waitingNavigatorLock("auth", 0, async () => "ran")).resolves.toBe("ran");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("waits for a holder to release instead of throwing", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((r) => (release = r));
    const request = vi.fn(async (_n: string, _o: unknown, cb: () => Promise<unknown>) => {
      await held; // simulate another tab holding the auth lock
      return cb();
    });
    installLockManager({ request });

    let settled = false;
    const p = waitingNavigatorLock("auth", 0, async () => "ran").then((v) => {
      settled = true;
      return v;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // must not have failed immediately
    release!();
    await expect(p).resolves.toBe("ran");
  });

  it("passes an abort signal so a stuck holder cannot hang forever", async () => {
    const request = vi.fn(async (_n: string, opts: Record<string, unknown>) => {
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      return undefined;
    });
    installLockManager({ request });
    await waitingNavigatorLock("auth", 50, async () => "ran");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("runs unlocked where the browser has no LockManager", async () => {
    installLockManager(undefined);
    await expect(waitingNavigatorLock("auth", 0, async () => "ran")).resolves.toBe("ran");
  });
});
