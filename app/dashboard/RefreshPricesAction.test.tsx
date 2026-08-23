// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RefreshPricesAction } from "./RefreshPricesAction";

// One in-flight row shape, plus the knobs each test uses to drive the poll.
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  inFlight: [] as { request_id: number }[],
  pollError: null as { message: string } | null,
  polls: 0,
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    // Only refresh_requests is read here, and only for the in-flight probe.
    from: () => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.in = chain;
      builder.limit = () => {
        mocks.polls += 1;
        return Promise.resolve({
          data: mocks.pollError ? null : mocks.inFlight,
          error: mocks.pollError,
        });
      };
      return builder;
    },
  }),
}));

// Fake timers throughout. The watch polls on a ten-second interval, and waiting
// that out for real would make this file slow enough to perturb the rest of the
// suite rather than merely being slow itself.
beforeEach(() => {
  vi.useFakeTimers();
  mocks.rpc.mockReset();
  mocks.inFlight = [];
  mocks.pollError = null;
  mocks.polls = 0;
  // card_refresh_targets answers first (so the button renders at all), then
  // request_card_refresh answers the click.
  mocks.rpc.mockImplementation((name: string) => {
    if (name === "card_refresh_targets") {
      return Promise.resolve({
        data: [{ card_id: 7, targetable: [{ source: "tcgplayer", lane: "http", eta_class: "minutes" }], not_targetable: [] }],
        error: null,
      });
    }
    return Promise.resolve({
      data: [{ card_id: 7, queued: [{ source: "tcgplayer", lane: "http", eta_class: "minutes" }], already_pending: [], not_targetable: [] }],
      error: null,
    });
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Let pending promises settle without advancing the clock. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Advance past one poll interval, flushing the async poll it triggers. */
async function tickPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
}

async function clickRefresh() {
  await settle(); // card_refresh_targets resolves, so the button renders
  const button = screen.getByRole("button");
  await act(async () => {
    fireEvent.click(button);
  });
  await settle(); // the queue RPC resolves and the watch starts
}

describe("RefreshPricesAction completion watch", () => {
  it("tells the caller once the queued work has drained", async () => {
    // The whole point of the button: after the worker finishes, the caller has
    // to re-read the card, or the view keeps showing the age it rendered with
    // and the refresh looks like it did nothing.
    const onRefreshed = vi.fn();
    mocks.inFlight = [{ request_id: 1 }];
    render(<RefreshPricesAction cardIds={[7]} onRefreshed={onRefreshed} />);
    await clickRefresh();

    expect(mocks.polls).toBeGreaterThan(0);
    expect(onRefreshed).not.toHaveBeenCalled();

    mocks.inFlight = [];
    await tickPoll();
    expect(onRefreshed).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting while work is still outstanding", async () => {
    const onRefreshed = vi.fn();
    mocks.inFlight = [{ request_id: 1 }];
    render(<RefreshPricesAction cardIds={[7]} onRefreshed={onRefreshed} />);
    await clickRefresh();

    await tickPoll();
    await tickPoll();
    expect(mocks.polls).toBeGreaterThan(1);
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it("keeps waiting when a poll fails rather than claiming the refresh landed", async () => {
    // A failed read says nothing about the work. Treating it as "no rows left"
    // would refetch stale prices and stamp them as current - worse than waiting.
    const onRefreshed = vi.fn();
    mocks.inFlight = [];
    mocks.pollError = { message: "network" };
    render(<RefreshPricesAction cardIds={[7]} onRefreshed={onRefreshed} />);
    await clickRefresh();

    await tickPoll();
    expect(mocks.polls).toBeGreaterThan(0);
    expect(onRefreshed).not.toHaveBeenCalled();

    // Once the read works again the completion is reported normally.
    mocks.pollError = null;
    await tickPoll();
    expect(onRefreshed).toHaveBeenCalledTimes(1);
  });

  it("stops polling after the watch window rather than following forever", async () => {
    const onRefreshed = vi.fn();
    mocks.inFlight = [{ request_id: 1 }];
    render(<RefreshPricesAction cardIds={[7]} onRefreshed={onRefreshed} />);
    await clickRefresh();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    });
    const settledPolls = mocks.polls;
    await tickPoll();
    await tickPoll();
    expect(mocks.polls).toBe(settledPolls);
    // Giving up is not the same as succeeding: the caller is never told the
    // prices landed when they did not.
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it("never starts a watch when nothing was queued", async () => {
    // Every source was already pending or not targetable, so there is no
    // completion of ours to wait for and no reason to poll.
    const onRefreshed = vi.fn();
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "card_refresh_targets") {
        return Promise.resolve({
          data: [{ card_id: 7, targetable: [{ source: "tcgplayer", lane: "http", eta_class: "minutes" }], not_targetable: [] }],
          error: null,
        });
      }
      return Promise.resolve({
        data: [{ card_id: 7, queued: [], already_pending: ["tcgplayer"], not_targetable: [] }],
        error: null,
      });
    });
    render(<RefreshPricesAction cardIds={[7]} onRefreshed={onRefreshed} />);
    await clickRefresh();

    expect(screen.getByText(/alreadyPending/)).toBeTruthy();
    await tickPoll();
    expect(mocks.polls).toBe(0);
    expect(onRefreshed).not.toHaveBeenCalled();
  });
});
