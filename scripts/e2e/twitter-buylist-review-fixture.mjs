import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const dependencyRoot = process.env.TCG_FRONTEND_DEPENDENCY_ROOT;
const require = dependencyRoot
  ? createRequire(`${dependencyRoot}/package.json`)
  : createRequire(import.meta.url);
const { chromium } = require("playwright");

const {
  APP_URL: appUrl,
  E2E_API_URL: apiUrl,
  E2E_FIXTURE_TOKEN: fixtureToken,
  E2E_ARTIFACT_ROOT: artifactRoot,
} = process.env;
if (!appUrl || !apiUrl || !fixtureToken || !artifactRoot) {
  throw new Error("APP_URL, E2E_API_URL, E2E_FIXTURE_TOKEN, and E2E_ARTIFACT_ROOT are required");
}
if (
  process.env.E2E_HEADED !== "1"
  || process.env.TCG_TWITTER_BUYLIST_REVIEW_XVFB !== "1"
  || !process.env.DISPLAY
) {
  throw new Error("Twitter buylist review acceptance requires headed Chromium under Xvfb");
}
mkdirSync(artifactRoot, { recursive: true });

const sourceSHA = "b37525560be9471f0375f4c3745a1f6829ac0456402b88f96e842d023a8ac323";
const processTweetReportSHA = "18adad2127b11c15c4f3c1a2c905799d827374876228d7a6d4a7972b11defe5c";
const tohokuUID = "4edf0d33-d1fa-459b-9645-30a332144fda";
const pretendBossUID = "e798eed8-c2dd-4c36-96e3-0fbb5a7db31c";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fixture(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: {
      apikey: fixtureToken,
      Authorization: `Bearer ${fixtureToken}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const responseText = await response.text();
  let body;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch {
    body = responseText;
  }
  assert(response.ok, `${options.method ?? "GET"} ${path} returned ${response.status}: ${responseText}`);
  return body;
}

async function waitForFixture(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await fixture("/__fixture__/state");
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become true: ${JSON.stringify(latest)}`);
}

async function assertNoHorizontalOverflow(page, root, stage) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  const fixtureBounds = await root.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      width: rect.width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });
  assert(
    dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${stage} page overflow: ${JSON.stringify(dimensions)}`,
  );
  assert(
    fixtureBounds.x >= -0.5 && fixtureBounds.x + fixtureBounds.width <= dimensions.viewport + 0.5,
    `${stage} fixture escapes viewport: ${JSON.stringify(fixtureBounds)}`,
  );
  assert(
    fixtureBounds.scrollWidth <= fixtureBounds.clientWidth + 1,
    `${stage} fixture content is clipped: ${JSON.stringify(fixtureBounds)}`,
  );
  return { dimensions, fixture: fixtureBounds };
}

async function assertTouchTarget(locator, label) {
  const box = await locator.boundingBox();
  assert(box, `${label} has no measurable bounds`);
  assert(
    box.width >= 43.5 && box.height >= 43.5,
    `${label} is ${box.width}x${box.height}, below 44px`,
  );
  return box;
}

async function capture(page, name) {
  const path = `${artifactRoot}/${name}.png`;
  await page.screenshot({
    path,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    timeout: 30_000,
  });
  return path;
}

async function preparePage(browser, viewport, label) {
  const context = await browser.newContext({
    viewport,
    hasTouch: label === "phone",
    isMobile: label === "phone",
  });
  const page = await context.newPage();
  const dialogs = [];
  const consoleErrors = [];
  const expectedStaleNetworkErrors = [];
  const unexpectedHTTPResponses = [];
  const outsideRequests = [];
  const requestFailures = [];
  page.on("dialog", async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.dismiss();
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const content = message.text();
    if (content.includes("409 (Conflict)")) {
      expectedStaleNetworkErrors.push(content);
      return;
    }
    const location = message.location();
    const diagnostic = location.url
      ? `${content} (${location.url}:${location.lineNumber}:${location.columnNumber})`
      : content;
    consoleErrors.push(diagnostic);
    console.error(`${label} browser console error: ${diagnostic}`);
  });
  page.on("pageerror", (error) => {
    const content = error instanceof Error ? error.message : String(error);
    consoleErrors.push(content);
    console.error(`${label} browser page error: ${content}`);
  });
  page.on("requestfailed", (request) => {
    const failure = {
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    };
    requestFailures.push(failure);
    console.error(`${label} browser request failed: ${JSON.stringify(failure)}`);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const failure = { url: response.url(), status: response.status() };
    if (failure.status === 409 && failure.url.includes("approve_twitter_buylist_review")) return;
    unexpectedHTTPResponses.push(failure);
    console.error(`${label} browser HTTP error: ${JSON.stringify(failure)}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") outsideRequests.push(request.url());
  });
  await page.goto(`${appUrl}/e2e/twitter-buylist-review`, { waitUntil: "networkidle" });
  const root = page.getByTestId("twitter-buylist-review-fixture");
  await root.waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "Pending", exact: true }).click();
  return {
    context,
    page,
    root,
    dialogs,
    consoleErrors,
    expectedStaleNetworkErrors,
    unexpectedHTTPResponses,
    outsideRequests,
    requestFailures,
    label,
  };
}

function candidateCard(page, name) {
  return page.locator("[data-candidate-idx]").filter({ hasText: name });
}

function assertApprovalPayload(record, expected) {
  const payload = record.request;
  assert(payload.p_candidate_kind === "singles", `approval kind mismatch: ${JSON.stringify(payload)}`);
  assert(payload.p_candidate_id === expected.candidateId, `approval candidate mismatch: ${JSON.stringify(payload)}`);
  assert(payload.p_expected_review_sha256 === expected.sha, `approval SHA mismatch: ${JSON.stringify(payload)}`);
  assert(typeof payload.p_request_id === "string" && payload.p_request_id.length > 0, "approval request id missing");
  assert(payload.p_target_id === null, `unchanged target must be null: ${JSON.stringify(payload)}`);
  assert(payload.p_grade_or_condition === null, `unchanged grade must be null: ${JSON.stringify(payload)}`);
  assert(payload.p_price_jpy === null, `unchanged price must be null: ${JSON.stringify(payload)}`);
  assert(payload.p_curator_notes === null, `unchanged notes must be null: ${JSON.stringify(payload)}`);
}

function assertClaim(result, expected) {
  const payload = result.claim.payload;
  assert(result.candidate_uid === expected.candidateUID, `candidate UID mismatch: ${JSON.stringify(result)}`);
  assert(result.detector_price_jpy === expected.detectorPrice, `detector price changed: ${JSON.stringify(result)}`);
  assert(result.effective_price_jpy === expected.effectivePrice, `effective price mismatch: ${JSON.stringify(result)}`);
  assert(result.due_ids.includes(result.claim.alert_outbox_id), `claimed alert was not due: ${JSON.stringify(result)}`);
  assert(payload.buyer_handle === "cardrush_poke", `buyer mismatch: ${JSON.stringify(payload)}`);
  assert(payload.twitter_handle === "cardrush_poke", `Twitter account mismatch: ${JSON.stringify(payload)}`);
  assert(payload.tweet_id === "2112078363095715923", `tweet mismatch: ${JSON.stringify(payload)}`);
  assert(payload.item_uid === expected.entityUID, `item UID mismatch: ${JSON.stringify(payload)}`);
  assert(payload.candidate_uid === expected.candidateUID, `payload candidate mismatch: ${JSON.stringify(payload)}`);
  assert(payload.price_jpy === expected.effectivePrice, `payload effective price mismatch: ${JSON.stringify(payload)}`);
  assert(payload.candidate_detector_price_jpy === expected.detectorPrice, `payload detector price changed: ${JSON.stringify(payload)}`);
  assert(payload.candidate_price_proof === "curator_listing_effect", `price proof mismatch: ${JSON.stringify(payload)}`);
  assert(payload.observed_grade_or_condition === "psa_10", `quote grade mismatch: ${JSON.stringify(payload)}`);
  assert(payload.unverified === false, `reviewed alert stayed unverified: ${JSON.stringify(payload)}`);
  assert(result.authority.decisions === 1, `decision count mismatch: ${JSON.stringify(result.authority)}`);
  assert(result.authority.effects === 1, `effect count mismatch: ${JSON.stringify(result.authority)}`);
  assert(result.authority.actor_subject === "curator-1880-browser", `actor mismatch: ${JSON.stringify(result.authority)}`);
  assert(result.authority.action === "approve", `decision action mismatch: ${JSON.stringify(result.authority)}`);
  assert(result.authority.entity_uid === expected.entityUID, `authority entity mismatch: ${JSON.stringify(result.authority)}`);
  assert(result.authority.grade_or_condition === "psa_10", `authority grade mismatch: ${JSON.stringify(result.authority)}`);
  assert(result.authority.effective_price_jpy === expected.effectivePrice, `authority price mismatch: ${JSON.stringify(result.authority)}`);
  assert(result.authority.route_actionability === "review_required", `route was rewritten: ${JSON.stringify(result.authority)}`);
  assert(result.authority.route_uncertainty_flags === '["unverified_item_identity"]', `route flags changed: ${JSON.stringify(result.authority)}`);
  assert(result.authority.alert_status === "sending", `Claim did not stop before transport: ${JSON.stringify(result.authority)}`);
}

const initialState = await fixture("/__fixture__/state");
assert(initialState.source_sha256 === sourceSHA, "fixture source SHA drifted");
assert(initialState.process_tweet_report_sha256 === processTweetReportSHA, "producer report SHA drifted");
assert(initialState.candidates.length === 2, `candidate count=${initialState.candidates.length}, want 2`);
const tohoku = initialState.candidates.find((row) => row.entity_uid === tohokuUID);
const pretend = initialState.candidates.find((row) => row.entity_uid === pretendBossUID);
assert(tohoku && pretend, `actual producer subjects missing: ${JSON.stringify(initialState)}`);
assert(tohoku.status === "pending" && pretend.status === "pending", "producer candidates did not begin pending");

const browser = await chromium.launch({ headless: false });
const evidence = {
  source: {
    sha256: sourceSHA,
    width: 2000,
    height: 1414,
    processTweetReportSHA256: processTweetReportSHA,
  },
  initialState,
  desktop: null,
  phone: null,
};

try {
  const desktop = await preparePage(browser, { width: 1440, height: 1000 }, "desktop");
  try {
    const card = candidateCard(desktop.page, "Tohoku Pikachu");
    await card.getByText("Tohoku Pikachu", { exact: true }).waitFor();
    await card.getByText("¥270,000", { exact: true }).waitFor();
    await card.getByText(
      "Exact source, item, and price evidence ready for approval.",
      { exact: true },
    ).waitFor();
    const approve = card.getByRole("button", { name: "Mark correct" });
    await assertTouchTarget(approve, "desktop reviewed approval");
    assert(await approve.isEnabled(), "desktop approval stayed disabled after actual source rendered");

    const stale = await fixture("/__fixture__/mutate-stale", {
      method: "POST",
      body: { candidate_id: tohoku.candidate_id },
    });
    assert(stale.before_sha256 === tohoku.review_sha256, "stale setup did not begin from the rendered SHA");
    assert(stale.detector_price_jpy === 270000, "stale setup rewrote detector evidence");
    assert(stale.effective_price_jpy === 271000, "stale setup did not change current effective price");

    await desktop.page.keyboard.press("y");
    await card.getByText("¥271,000", { exact: true }).waitFor();
    await card.getByText(
      "Exact source, item, and price evidence ready for approval.",
      { exact: true },
    ).waitFor();
    const afterStale = await waitForFixture(
      (state) => state.approval_requests.length === 1,
      "one stale approval",
    );
    assertApprovalPayload(afterStale.approval_requests[0], {
      candidateId: tohoku.candidate_id,
      sha: stale.before_sha256,
    });
    assert(afterStale.approval_requests[0].outcome.ok === false, "stale approval unexpectedly mutated");
    assert(afterStale.approval_requests[0].outcome.sqlstate === "40001", "stale approval lost SQLSTATE 40001");
    assert(desktop.dialogs.length === 0, `stale recovery opened a dialog: ${JSON.stringify(desktop.dialogs)}`);

    await card.getByRole("button", { name: "Mark correct" }).click();
    await desktop.page.getByRole("button", { name: "Undo last (Tohoku Pikachu)" }).waitFor();
    const approvedState = await waitForFixture(
      (state) => state.approval_requests.length === 2,
      "refreshed desktop approval",
    );
    assertApprovalPayload(approvedState.approval_requests[1], {
      candidateId: tohoku.candidate_id,
      sha: stale.after_sha256,
    });
    assert(approvedState.approval_requests[1].outcome.ok === true, "refreshed approval failed");
    assert(
      approvedState.approval_requests[0].request.p_request_id
        !== approvedState.approval_requests[1].request.p_request_id,
      "stale recovery reused the original request id",
    );

    const claim = await fixture("/__fixture__/reconcile-claim", {
      method: "POST",
      body: { candidate_id: tohoku.candidate_id },
    });
    assertClaim(claim, {
      candidateUID: tohoku.candidate_uid,
      entityUID: tohokuUID,
      detectorPrice: 270000,
      effectivePrice: 271000,
    });
    const overflow = await assertNoHorizontalOverflow(
      desktop.page,
      desktop.root,
      "desktop actual Cardrush review",
    );
    const screenshot = await capture(
      desktop.page,
      "desktop-actual-cardrush-after-stale-recovery",
    );
    assert(desktop.consoleErrors.length === 0, `desktop console errors: ${JSON.stringify(desktop.consoleErrors)}`);
    assert(desktop.expectedStaleNetworkErrors.length === 1, "desktop did not observe exactly one stale CAS response");
    assert(desktop.unexpectedHTTPResponses.length === 0, `desktop HTTP errors: ${JSON.stringify(desktop.unexpectedHTTPResponses)}`);
    assert(desktop.outsideRequests.length === 0, `desktop attempted external requests: ${JSON.stringify(desktop.outsideRequests)}`);
    assert(desktop.requestFailures.length === 0, `desktop request failures: ${JSON.stringify(desktop.requestFailures)}`);
    evidence.desktop = {
      candidate: tohoku,
      stale,
      approvalRequests: approvedState.approval_requests.slice(0, 2),
      claim,
      overflow,
      screenshot,
      dialogs: desktop.dialogs,
      consoleErrors: desktop.consoleErrors,
      expectedStaleNetworkErrors: desktop.expectedStaleNetworkErrors,
      unexpectedHTTPResponses: desktop.unexpectedHTTPResponses,
      requestFailures: desktop.requestFailures,
    };
  } finally {
    await desktop.context.close();
  }

  const phone = await preparePage(browser, { width: 390, height: 844 }, "phone");
  try {
    const card = candidateCard(phone.page, "Pretend Boss Pikachu");
    await card.getByText("Pretend Boss Pikachu", { exact: true }).waitFor();
    await card.getByText("¥380,000", { exact: true }).waitFor();
    await card.getByText(
      "Exact source, item, and price evidence ready for approval.",
      { exact: true },
    ).waitFor();
    const approve = card.getByRole("button", { name: "Mark correct" });
    await assertTouchTarget(approve, "phone reviewed approval");
    assert(await approve.isEnabled(), "phone approval stayed disabled after actual source rendered");
    await approve.tap();
    await phone.page.getByRole("button", { name: "Undo last (Pretend Boss Pikachu)" }).waitFor();
    const approvedState = await waitForFixture(
      (state) => state.approval_requests.length === 3,
      "phone approval",
    );
    assertApprovalPayload(approvedState.approval_requests[2], {
      candidateId: pretend.candidate_id,
      sha: pretend.review_sha256,
    });
    assert(approvedState.approval_requests[2].outcome.ok === true, "phone approval failed");

    const claim = await fixture("/__fixture__/reconcile-claim", {
      method: "POST",
      body: { candidate_id: pretend.candidate_id },
    });
    assertClaim(claim, {
      candidateUID: pretend.candidate_uid,
      entityUID: pretendBossUID,
      detectorPrice: 380000,
      effectivePrice: 380000,
    });
    const overflow = await assertNoHorizontalOverflow(
      phone.page,
      phone.root,
      "phone actual Cardrush review",
    );
    const screenshot = await capture(phone.page, "phone-actual-cardrush-review");
    assert(phone.dialogs.length === 0, `phone opened a dialog: ${JSON.stringify(phone.dialogs)}`);
    assert(phone.consoleErrors.length === 0, `phone console errors: ${JSON.stringify(phone.consoleErrors)}`);
    assert(phone.expectedStaleNetworkErrors.length === 0, "phone observed an unexpected stale response");
    assert(phone.unexpectedHTTPResponses.length === 0, `phone HTTP errors: ${JSON.stringify(phone.unexpectedHTTPResponses)}`);
    assert(phone.outsideRequests.length === 0, `phone attempted external requests: ${JSON.stringify(phone.outsideRequests)}`);
    assert(phone.requestFailures.length === 0, `phone request failures: ${JSON.stringify(phone.requestFailures)}`);
    evidence.phone = {
      candidate: pretend,
      approvalRequest: approvedState.approval_requests[2],
      claim,
      overflow,
      screenshot,
      dialogs: phone.dialogs,
      consoleErrors: phone.consoleErrors,
      unexpectedHTTPResponses: phone.unexpectedHTTPResponses,
      requestFailures: phone.requestFailures,
    };
  } finally {
    await phone.context.close();
  }
} finally {
  await browser.close();
}

const evidencePath = `${artifactRoot}/evidence.json`;
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Twitter buylist actual-PostgreSQL browser acceptance passed: ${evidencePath}`);
