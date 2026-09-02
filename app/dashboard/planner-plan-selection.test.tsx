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
function PlanSelection({ plans, activeTrip }: { plans: Plan[]; activeTrip: number | "all" }) {
  const [planId, setPlanId] = useState<number | null>(null);

  const visiblePlans = useMemo(
    () => plans.filter((p) => activeTrip === "all" || p.trip_id === activeTrip),
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
    if (current && activeTrip !== "all" && current.trip_id !== activeTrip) {
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
});
