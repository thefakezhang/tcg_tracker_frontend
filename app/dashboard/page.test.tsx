// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";

const state = vi.hoisted(() => ({
  activeTripId: null as number | null,
  activeBuylistId: null as number | null,
  activeGame: "pokemon",
  hydrated: true,
}));
vi.mock("./TripContext", () => ({ useTrips: () => state }));
vi.mock("./BuyListContext", () => ({ useBuyList: () => state }));
vi.mock("./GameContext", () => ({ useGame: () => state }));
vi.mock("./UrlStateSync", () => ({ useUrlHydrated: () => state.hydrated }));
vi.mock("./ViewLoading", () => ({ default: () => <p role="status">Loading</p> }));
vi.mock("./CardBrowser", () => ({ default: () => <p>Card browser</p> }));
vi.mock("./SealedBrowser", () => ({ default: () => <p>Sealed browser</p> }));
vi.mock("./TripDashboard", () => ({ default: ({ tripId }: { tripId: number }) => <p>Trip {tripId}</p> }));
vi.mock("./BuyListView", () => ({ default: ({ buylistId }: { buylistId: number }) => <p>Buylist {buylistId}</p> }));
vi.mock("./CurationView", () => ({ default: () => <p>Singles review</p> }));
vi.mock("./SealedCurationView", () => ({ default: () => <p>Sealed review</p> }));

beforeEach(() => Object.assign(state, { activeTripId: null, activeBuylistId: null, activeGame: "pokemon", hydrated: true }));
afterEach(cleanup);

describe("lazy dashboard routing", () => {
  it("waits for URL hydration before showing a default view", () => {
    state.hydrated = false;
    const { container } = render(<DashboardPage />);
    expect(container.textContent).toBe("");
  });

  it.each([
    [{}, "Card browser"],
    [{ activeGame: "pokemon_sealed" }, "Sealed browser"],
    [{ activeTripId: 42 }, "Trip 42"],
    [{ activeBuylistId: 17 }, "Buylist 17"],
    [{ activeTripId: -3 }, "Singles review"],
    [{ activeTripId: -9 }, "Sealed review"],
  ])("loads the selected workspace with its original props: %j", async (selection, label) => {
    Object.assign(state, selection);
    render(<DashboardPage />);
    expect(await screen.findByText(label as string)).toBeTruthy();
  });

  it("switches workspaces and preserves registry priority over a buylist", async () => {
    const { rerender } = render(<DashboardPage />);
    await screen.findByText("Card browser");
    Object.assign(state, { activeTripId: -9, activeBuylistId: 17 });
    rerender(<DashboardPage />);
    expect(await screen.findByText("Sealed review")).toBeTruthy();
    expect(screen.queryByText("Card browser")).toBeNull();
    expect(screen.queryByText("Buylist 17")).toBeNull();
  });
});
