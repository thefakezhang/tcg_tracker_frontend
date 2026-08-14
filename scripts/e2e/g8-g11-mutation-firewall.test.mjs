import { describe, expect, it, vi } from "vitest";
import { createRestMutationFirewall, requireParkedAnchorPage } from "./g8-g11-mutation-firewall.mjs";

function request(method, url = "https://catalog.test/rest/v1/rpc/record_opportunity_exposures") {
  return { method: () => method, url: () => url };
}

function routeFor(candidate) {
  return {
    request: () => candidate,
    continue: vi.fn().mockResolvedValue(undefined),
    fulfill: vi.fn().mockResolvedValue(undefined),
  };
}

describe("G8-G11 production REST mutation firewall", () => {
  it("accepts only one pre-existing about:blank anchor page", () => {
    const parked = { url: () => "about:blank" };

    expect(requireParkedAnchorPage([parked])).toBe(parked);
    expect(() => requireParkedAnchorPage([])).toThrow("expected one parked Edge anchor page, got 0");
    expect(() => requireParkedAnchorPage([{ url: () => "https://app.test/dashboard" }]))
      .toThrow("expected the Edge anchor page to be parked at about:blank");
  });

  it("blocks an observed REST mutation and derives zero escaped requests", async () => {
    const firewall = createRestMutationFirewall();
    const candidate = request("POST");
    const route = routeFor(candidate);

    firewall.observeRequest(candidate);
    await firewall.routeHandler(route);

    expect(route.fulfill).toHaveBeenCalledWith({
      status: 200,
      contentType: "application/json",
      body: "null",
    });
    expect(firewall.evidence()).toEqual({
      blockedRequests: [{ method: "POST", path: "/rest/v1/rpc/record_opportunity_exposures" }],
      observedMutationRequests: 1,
      allowedMutationRequests: 0,
      allowedMutationRequestDetails: [],
      passed: true,
    });
  });

  it("derives an observed REST mutation that escaped the route", () => {
    const firewall = createRestMutationFirewall();

    firewall.observeRequest(request("PATCH", "https://catalog.test/rest/v1/pokemon_card_definitions?id=eq.1"));

    expect(firewall.evidence()).toMatchObject({
      allowedMutationRequests: 1,
      observedMutationRequests: 1,
      allowedMutationRequestDetails: [{ method: "PATCH", path: "/rest/v1/pokemon_card_definitions" }],
      passed: false,
    });
  });

  it("counts one escaped request when only one of two identical mutations was blocked", async () => {
    const firewall = createRestMutationFirewall();
    const first = request("POST");
    const second = request("POST");

    firewall.observeRequest(first);
    firewall.observeRequest(second);
    await firewall.routeHandler(routeFor(first));

    expect(firewall.evidence()).toMatchObject({
      blockedRequests: [{ method: "POST", path: "/rest/v1/rpc/record_opportunity_exposures" }],
      observedMutationRequests: 2,
      allowedMutationRequests: 1,
      allowedMutationRequestDetails: [{ method: "POST", path: "/rest/v1/rpc/record_opportunity_exposures" }],
      passed: false,
    });
  });

  it("continues read-only REST requests without recording them", async () => {
    const firewall = createRestMutationFirewall();
    const candidate = request("GET", "https://catalog.test/rest/v1/pokemon_card_definitions");
    const route = routeFor(candidate);

    firewall.observeRequest(candidate);
    await firewall.routeHandler(route);

    expect(route.continue).toHaveBeenCalledOnce();
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(firewall.evidence()).toMatchObject({
      blockedRequests: [],
      observedMutationRequests: 0,
      allowedMutationRequests: 0,
      passed: true,
    });
  });
});
