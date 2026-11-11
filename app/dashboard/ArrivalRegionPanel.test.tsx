// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ArrivalRegionPanel from "./ArrivalRegionPanel";
import { LanguageProvider } from "./LanguageContext";
import {
  ArrivalRegionRequestError,
  type ArrivalRegion,
  type ArrivalRegionStatus,
  type RegionAction,
} from "./arrival-regions";

const NOW = Date.parse("2026-11-02T05:00:00Z");   // 14:00 JST

function region(overrides: Partial<ArrivalRegion> & Pick<ArrivalRegion, "region" | "position">): ArrivalRegion {
  return {
    default_focus: false,
    in_focus: false,
    focus_kind: "off",
    focus_until: null,
    focus_set_by: null,
    focus_set_at: null,
    in_focus_last_run: false,
    lists: 1,
    readable_lists: 1,
    shops: 12,
    list_only_shops: 12,
    last_read_at: null,
    pending_request: null,
    last_fulfilled: null,
    ...overrides,
  };
}

const AKIHABARA = region({
  region: "akihabara", position: 0, default_focus: true, in_focus: true, focus_kind: "default",
  in_focus_last_run: true, lists: 2, readable_lists: 2, shops: 140, list_only_shops: 60,
  last_read_at: "2026-11-02T03:58:25Z",
});
const OSAKA = region({ region: "osaka", position: 10, shops: 24, list_only_shops: 24 });
const SAPPORO = region({ region: "sapporo", position: 6, readable_lists: 0, shops: 14 });

function status(regions: ArrivalRegion[], focusSource: "default" | "operator" = "default"): ArrivalRegionStatus {
  return { today: "2026-11-02", focus_source: focusSource, published_at: "2026-11-02T04:00:00Z", regions };
}

function panel(
  loader: () => Promise<ArrivalRegionStatus | null>,
  sender = vi.fn(async (_action: RegionAction) => status([AKIHABARA, SAPPORO, OSAKA])),
  onStatus?: (status: ArrivalRegionStatus) => void,
) {
  render(
    <LanguageProvider>
      <ArrivalRegionPanel loader={loader} sender={sender} now={() => NOW} onStatus={onStatus} />
    </LanguageProvider>,
  );
  return sender;
}

async function openPanel() {
  fireEvent.click(await screen.findByRole("button", { name: "Show regions" }));
}

function row(name: string) {
  const element = screen.getAllByTestId("arrival-region").find(
    (item) => item.getAttribute("data-region") === name,
  );
  if (!element) throw new Error(`no row for ${name}`);
  return within(element);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ArrivalRegionPanel", () => {
  it("summarises the hourly focus and shows each region's focus, shops, lists and last read", async () => {
    panel(async () => status([AKIHABARA, SAPPORO, OSAKA]));
    expect(await screen.findByText("Read hourly: Akihabara (default focus)")).toBeTruthy();
    await openPanel();

    const names = screen.getAllByTestId("arrival-region").map((item) => item.getAttribute("data-region"));
    expect(names).toEqual(["akihabara", "sapporo", "osaka"]);
    expect(row("akihabara").getByTestId("arrival-region-status").textContent).toBe("In focus (default)");
    expect(row("akihabara").getByTestId("arrival-region-meta").textContent).toBe(
      "140 shops · 2 of 2 lists readable · Last read 1 hour ago",
    );
    expect(row("osaka").getByTestId("arrival-region-status").textContent).toBe("Not in focus");
    expect(row("osaka").getByTestId("arrival-region-meta").textContent).toContain("Not read yet");
    // A focus region is read hourly: no read-once button, a way out instead.
    expect(row("akihabara").queryByRole("button", { name: "Read once" })).toBeNull();
    expect(row("akihabara").getByRole("button", { name: "Remove" })).toBeTruthy();
    // A region whose lists are not filled yet offers no read-once button at
    // all, and says why.
    expect(row("sapporo").queryByRole("button", { name: "Read once" })).toBeNull();
    expect(row("sapporo").getByTestId("arrival-region-nolist").textContent).toBe("No readable list yet");
    expect(row("osaka").queryByTestId("arrival-region-nolist")).toBeNull();
    expect(screen.getByText("Last published by the run of 1 hour ago")).toBeTruthy();
  });

  it("asks for a region to be read once and shows the request as pending until a run fulfils it", async () => {
    const pendingOsaka = {
      ...OSAKA, pending_request: { request_id: 5, requested_at: "2026-11-02T04:59:00Z", requested_by: "op@example.test" },
    };
    const sender = panel(
      async () => status([AKIHABARA, SAPPORO, OSAKA]),
      vi.fn(async () => status([AKIHABARA, SAPPORO, pendingOsaka])),
    );
    await openPanel();
    fireEvent.click(row("osaka").getByRole("button", { name: "Read once" }));

    expect(sender).toHaveBeenCalledWith({ action: "request_read", region: "osaka" });
    const pending = await waitFor(() => row("osaka").getByRole("button", { name: "Read once pending" }));
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(row("osaka").getByTestId("arrival-region-pending").textContent).toBe(
      "Read once requested 1 minute ago; the next run in shop hours reads it",
    );
    expect(screen.getByTestId("arrival-regions-summary").textContent).toContain("1 read-once request pending");
  });

  it("hands every status it shows to the feed's region filter, the loaded one and each change's", async () => {
    const onStatus = vi.fn<(status: ArrivalRegionStatus) => void>();
    const changed = status([AKIHABARA, { ...OSAKA, in_focus: true, focus_kind: "operator" }], "operator");
    panel(async () => status([AKIHABARA, SAPPORO, OSAKA]), vi.fn(async () => changed), onStatus);

    await waitFor(() => {
      expect(onStatus).toHaveBeenCalledTimes(1);
    });
    expect(onStatus.mock.calls[0][0].regions.map((entry) => entry.region)).toEqual(["akihabara", "sapporo", "osaka"]);
    await openPanel();
    fireEvent.click(row("osaka").getByRole("button", { name: "Add focus" }));
    await waitFor(() => {
      expect(onStatus).toHaveBeenLastCalledWith(changed);
    });
  });

  it("hears nothing while the backend has no region controls", async () => {
    const onStatus = vi.fn<(status: ArrivalRegionStatus) => void>();
    panel(async () => null, undefined, onStatus);
    expect(await screen.findByText(/Region controls appear once the backend migration is applied/)).toBeTruthy();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("shows when a region was last read once", async () => {
    const read = {
      ...OSAKA,
      last_read_at: "2026-11-02T03:00:40Z",
      last_fulfilled: { request_id: 5, fulfilled_at: "2026-11-02T03:01:00Z", fulfilled_run_id: "2026-11-02T03:00:00+00:00" },
    };
    panel(async () => status([AKIHABARA, read]));
    await openPanel();
    expect(row("osaka").getByTestId("arrival-region-fulfilled").textContent).toBe("Read once 2 hours ago");
    expect(row("osaka").getByRole("button", { name: "Read once" })).toBeTruthy();
  });

  it("adds a region to the focus, until a Tokyo date, and removes it", async () => {
    const sender = panel(async () => status([AKIHABARA, OSAKA]));
    await openPanel();

    fireEvent.click(row("osaka").getByRole("button", { name: "Add focus" }));
    expect(sender).toHaveBeenLastCalledWith({ action: "set_focus", region: "osaka", until: null });
    await waitFor(() => expect(row("osaka").getByRole("button", { name: "Add focus" })).toBeTruthy());

    fireEvent.click(row("osaka").getByRole("button", { name: "Focus until" }));
    const input = row("osaka").getByLabelText("Last day in focus (Tokyo date)") as HTMLInputElement;
    // A Tokyo date from today to a year ahead, a week by default.
    expect([input.min, input.max, input.value]).toEqual(["2026-11-02", "2027-11-03", "2026-11-09"]);
    fireEvent.change(input, { target: { value: "2026-11-10" } });
    fireEvent.click(row("osaka").getByRole("button", { name: "Save" }));
    expect(sender).toHaveBeenLastCalledWith({ action: "set_focus", region: "osaka", until: "2026-11-10" });

    await waitFor(() => expect(row("akihabara").getByRole("button", { name: "Remove" })).toBeTruthy());
    fireEvent.click(row("akihabara").getByRole("button", { name: "Remove" }));
    expect(sender).toHaveBeenLastCalledWith({ action: "clear_focus", region: "akihabara" });
  });

  it("refuses a date outside the range before sending it", async () => {
    const sender = panel(async () => status([AKIHABARA, OSAKA]));
    await openPanel();
    fireEvent.click(row("osaka").getByRole("button", { name: "Focus until" }));
    const input = row("osaka").getByLabelText("Last day in focus (Tokyo date)");
    fireEvent.change(input, { target: { value: "2026-11-01" } });
    expect((row("osaka").getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row("osaka").getByRole("button", { name: "Cancel" }));
    expect(row("osaka").queryByLabelText("Last day in focus (Tokyo date)")).toBeNull();
    expect(sender).not.toHaveBeenCalled();
  });

  it("shows a focus until a date, and keeps it in focus without an end", async () => {
    const trip = {
      ...OSAKA, in_focus: true, focus_kind: "until" as const, focus_until: "2026-11-10",
      focus_set_by: "op@example.test", focus_set_at: "2026-11-02T04:00:00Z",
    };
    const operator = status([AKIHABARA, trip], "operator");
    const sender = panel(async () => operator, vi.fn(async () => operator));
    expect(await screen.findByText("Read hourly: Akihabara, Osaka")).toBeTruthy();
    await openPanel();
    expect(row("osaka").getByTestId("arrival-region-status").textContent).toBe("In focus until Nov 10, 2026");
    expect(row("osaka").queryByRole("button", { name: "Read once" })).toBeNull();
    // The operator's focus can always go back to the roster default.
    fireEvent.click(screen.getByRole("button", { name: "Return to default focus" }));
    expect(sender).toHaveBeenLastCalledWith({ action: "reset_focus" });
    await waitFor(() => expect(row("osaka").getByRole("button", { name: "Keep in focus" })).toBeTruthy());
    fireEvent.click(row("osaka").getByRole("button", { name: "Keep in focus" }));
    expect(sender).toHaveBeenLastCalledWith({ action: "set_focus", region: "osaka", until: null });
  });

  it("keeps the panel and says why when a change is refused", async () => {
    panel(
      async () => status([AKIHABARA, OSAKA]),
      vi.fn(async () => { throw new ArrivalRegionRequestError(400, "region has no readable list yet"); }),
    );
    await openPanel();
    fireEvent.click(row("osaka").getByRole("button", { name: "Read once" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The change was not saved: region has no readable list yet",
    );
    expect(row("osaka").getByRole("button", { name: "Read once" })).toBeTruthy();
  });

  it("says the controls wait for the backend migration, and offers nothing to press", async () => {
    panel(async () => null);
    expect(await screen.findByText(/Region controls appear once the backend migration is applied/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show regions" })).toBeNull();
  });

  it("says the run has not published regions yet", async () => {
    panel(async () => ({ ...status([]), published_at: null }));
    await openPanel();
    expect(screen.getByTestId("arrival-regions-unpublished").textContent).toContain(
      "has not published its regions yet",
    );
  });

  it("reports a failed load and retries it", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValueOnce(status([AKIHABARA]));
    panel(loader);
    await openPanel();
    expect((await screen.findByRole("alert")).textContent).toContain("Regions could not be loaded");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByText("Read hourly: Akihabara (default focus)")).toBeTruthy();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("speaks Japanese", async () => {
    localStorage.setItem("language", "ja");
    panel(async () => status([AKIHABARA, OSAKA]));
    expect(await screen.findByText("毎時読む地域: 秋葉原（既定）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "地域を表示" }));
    expect(row("osaka").getByRole("button", { name: "1 回だけ読む" })).toBeTruthy();
    expect(row("osaka").getByTestId("arrival-region-status").textContent).toBe("フォーカス外");
    expect(row("akihabara").getByTestId("arrival-region-status").textContent).toBe("フォーカス中（既定）");
  });

  it("gives every control a 44 px target", async () => {
    panel(async () => status([AKIHABARA, OSAKA], "operator"));
    await openPanel();
    const buttons = within(screen.getByTestId("arrival-regions")).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(4);
    for (const button of buttons) {
      // 44 px on phones and, overriding the Button's compact desktop height,
      // at every wider width too.
      expect(button.className, button.textContent ?? "").toMatch(/(^|\s)min-h-11(\s|$)/);
      expect(button.className, button.textContent ?? "").toMatch(/(^|\s)sm:min-h-11(\s|$)/);
      expect(button.className).not.toMatch(/sm:min-h-0/);
    }
  });
});
