const SAFE_REST_METHODS = new Set(["GET", "HEAD"]);

function requestEvidence(request) {
  const url = new URL(request.url());
  return { method: request.method(), path: url.pathname };
}

function evidenceKey(evidence) {
  return `${evidence.method} ${evidence.path}`;
}

function isRestMutation(request) {
  const { pathname } = new URL(request.url());
  return (pathname === "/rest/v1" || pathname.startsWith("/rest/v1/"))
    && !SAFE_REST_METHODS.has(request.method());
}

export function createRestMutationFirewall() {
  const observedMutations = [];
  const blockedRequests = [];

  function observeRequest(request) {
    if (isRestMutation(request)) observedMutations.push(requestEvidence(request));
  }

  async function routeHandler(route) {
    const request = route.request();
    if (!isRestMutation(request)) return route.continue();
    blockedRequests.push(requestEvidence(request));
    await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  }

  function evidence() {
    const unmatchedBlocked = new Map();
    for (const blocked of blockedRequests) {
      const key = evidenceKey(blocked);
      unmatchedBlocked.set(key, (unmatchedBlocked.get(key) ?? 0) + 1);
    }
    const allowedMutationRequestDetails = observedMutations.filter((observed) => {
      const key = evidenceKey(observed);
      const remaining = unmatchedBlocked.get(key) ?? 0;
      if (remaining === 0) return true;
      unmatchedBlocked.set(key, remaining - 1);
      return false;
    });
    return {
      blockedRequests: [...blockedRequests],
      observedMutationRequests: observedMutations.length,
      allowedMutationRequests: allowedMutationRequestDetails.length,
      allowedMutationRequestDetails,
      passed: allowedMutationRequestDetails.length === 0,
    };
  }

  return { observeRequest, routeHandler, evidence };
}

export function requireParkedAnchorPage(pages) {
  if (pages.length !== 1) {
    throw new Error(`expected one parked Edge anchor page, got ${pages.length}`);
  }
  const page = pages[0];
  if (page.url() !== "about:blank") {
    throw new Error(`expected the Edge anchor page to be parked at about:blank before installing the mutation firewall, got ${page.url()}`);
  }
  return page;
}
