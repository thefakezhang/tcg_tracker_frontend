// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useEffect, useMemo, useState } from "react";

afterEach(cleanup);

type Plan = { plan_id: number; trip_id: number | null };

// Reproduces the planner's plan-selection pair in isolation.
//
// It crashed with "Maximum update depth exceeded" when the first plan belonged
// to a trip other than the active one: one effect selected plans[0], the other
// cleared it for not matching the filter, and the first selected it again.
function PlanSelection({ plans, activeTrip }: { plans: Plan[]; activeTrip: number | "all" | "none" }) {
  const [planId, setPlanId] = useState<number | null>(null);

  const visiblePlans = useMemo(
    () =>
      plans.filter((p) => {
        if (activeTrip === "all") return true;
        if (activeTrip === "none") return p.trip_id == null;
        return p.trip_id === activeTrip;
      }),
    [plans, activeTrip],
  );

  // Auto-select from the VISIBLE plans. Selecting from all of them is what
  // made the two effects fight.
  useEffect(() => {
    if (planId == null && visiblePlans[0]) setPlanId(visiblePlans[0].plan_id);
  }, [visiblePlans, planId]);

  useEffect(() => {
    if (planId == null) return;
    const current = plans.find((p) => p.plan_id === planId);
    if (current && !visiblePlans.some((p) => p.plan_id === current.plan_id)) {
      setPlanId(visiblePlans[0]?.plan_id ?? null);
    }
  }, [activeTrip, planId, plans, visiblePlans]);

  return <div data-testid="selected">{planId ?? "none"}</div>;
}

describe("planner plan selection", () => {
  // The crash case: the newest plan is on another trip, so the unfiltered
  // auto-select kept handing the filter something it had to reject.
  it("settles on a plan from the active trip without looping", () => {
    render(
      <PlanSelection
        plans={[
          { plan_id: 9, trip_id: 3 }, // newest, on a DIFFERENT trip
          { plan_id: 5, trip_id: 7 }, // on the active trip
        ]}
        activeTrip={7}
      />,
    );
    expect(screen.getByTestId("selected").textContent).toBe("5");
  });

  // No plan on the active trip must settle at "none" rather than oscillating
  // between a hidden plan and null.
  it("settles on none when the active trip has no plan", () => {
    render(<PlanSelection plans={[{ plan_id: 9, trip_id: 3 }]} activeTrip={7} />);
    expect(screen.getByTestId("selected").textContent).toBe("none");
  });

  it("selects the newest when no trip filter is applied", () => {
    render(
      <PlanSelection
        plans={[{ plan_id: 9, trip_id: 3 }, { plan_id: 5, trip_id: 7 }]}
        activeTrip="all"
      />,
    );
    expect(screen.getByTestId("selected").textContent).toBe("9");
  });

  // Five real plans had no trip at all. Hiding them whenever a trip was active
  // made them unreachable - there was no control to change the filter either.
  // Untripped plans have their own filter value. Showing them under every trip
  // made the filter look inert, because most plans have no trip.
  it("shows untripped plans only under 'none'", () => {
    const plans = [{ plan_id: 4, trip_id: null }, { plan_id: 9, trip_id: 3 }];
    const { unmount } = render(<PlanSelection plans={plans} activeTrip="none" />);
    expect(screen.getByTestId("selected").textContent).toBe("4");
    unmount();

    render(<PlanSelection plans={plans} activeTrip={3} />);
    expect(screen.getByTestId("selected").textContent).toBe("9");
  });

  // A plan genuinely belonging to another trip still stays hidden.
  it("still hides a plan that belongs to a different trip", () => {
    render(<PlanSelection plans={[{ plan_id: 9, trip_id: 3 }]} activeTrip={8} />);
    expect(screen.getByTestId("selected").textContent).toBe("none");
  });

  // The default. Every plan reachable without touching the control.
  it("shows every plan under 'all'", () => {
    render(
      <PlanSelection
        plans={[{ plan_id: 4, trip_id: null }, { plan_id: 9, trip_id: 3 }]}
        activeTrip="all"
      />,
    );
    expect(screen.getByTestId("selected").textContent).toBe("4");
  });
});
