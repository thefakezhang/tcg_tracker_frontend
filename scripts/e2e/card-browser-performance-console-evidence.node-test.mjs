import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyConsoleEvidence,
  expectedUnavailableConsoleError,
  recordsMatchingExactCardIdCohort,
  recordsStartedInSample,
  retainEnrichmentRequestEvidence,
} from "./card-browser-performance-console-evidence.mjs";

const rpcURL = "http://127.0.0.1:54321/rest/v1/rpc/pokemon_card_browser_enrichment";
const unavailableRecord = {
  endpoint: "pokemon_card_browser_enrichment",
  kind: "bounded",
  method: "POST",
  status: 404,
  url: rpcURL,
};
const unavailableResponse = { method: "POST", status: 404, url: rpcURL };

function classify(overrides = {}) {
  return classifyConsoleEvidence({
    forceUnavailable: true,
    consoleErrors: [expectedUnavailableConsoleError],
    records: [unavailableRecord],
    responseStatuses: [unavailableResponse],
    ...overrides,
  });
}

test("classifies one console 404 only when tied to the exact forced unavailable RPC", () => {
  assert.deepEqual(classify(), {
    hasExactUnavailableEvidence: true,
    expectedConsoleErrors: [expectedUnavailableConsoleError],
    unexpectedConsoleErrors: [],
    unavailableRecordCount: 1,
    unavailableResponseCount: 1,
    expectedMessageCount: 1,
  });
});

test("does not classify the 404 outside the forced unavailable path", () => {
  const result = classify({ forceUnavailable: false });
  assert.equal(result.hasExactUnavailableEvidence, false);
  assert.deepEqual(result.expectedConsoleErrors, []);
  assert.deepEqual(result.unexpectedConsoleErrors, [expectedUnavailableConsoleError]);
});

test("fails classification when the matching response evidence is absent or mismatched", () => {
  for (const responseStatuses of [
    [],
    [{ ...unavailableResponse, status: 500 }],
    [{ ...unavailableResponse, url: "http://127.0.0.1:54321/rest/v1/rpc/another_function" }],
  ]) {
    const result = classify({ responseStatuses });
    assert.equal(result.hasExactUnavailableEvidence, false);
    assert.deepEqual(result.unexpectedConsoleErrors, [expectedUnavailableConsoleError]);
  }
});

test("fails classification when the recorded RPC evidence is absent or duplicated", () => {
  for (const records of [[], [unavailableRecord, unavailableRecord]]) {
    const result = classify({ records });
    assert.equal(result.hasExactUnavailableEvidence, false);
    assert.deepEqual(result.unexpectedConsoleErrors, [expectedUnavailableConsoleError]);
  }
});

test("retains every additional or duplicate console error as unexpected", () => {
  const additional = classify({
    consoleErrors: [expectedUnavailableConsoleError, "application failed"],
  });
  assert.equal(additional.hasExactUnavailableEvidence, true);
  assert.deepEqual(additional.expectedConsoleErrors, [expectedUnavailableConsoleError]);
  assert.deepEqual(additional.unexpectedConsoleErrors, ["application failed"]);

  const duplicate = classify({
    consoleErrors: [expectedUnavailableConsoleError, expectedUnavailableConsoleError],
  });
  assert.equal(duplicate.hasExactUnavailableEvidence, false);
  assert.deepEqual(duplicate.expectedConsoleErrors, []);
  assert.deepEqual(duplicate.unexpectedConsoleErrors, [expectedUnavailableConsoleError, expectedUnavailableConsoleError]);
});

test("attributes records by request start instead of completion time", () => {
  const records = [
    { endpoint: "initial", requestedAt: 90, completedAt: 130 },
    { endpoint: "boundary", requestedAt: 100, completedAt: 140 },
    { endpoint: "measured", requestedAt: 110, completedAt: 120 },
    { endpoint: "missing-start", completedAt: 150 },
  ];
  assert.deepEqual(
    recordsStartedInSample(records, 100).map((record) => record.endpoint),
    ["boundary", "measured"],
  );
});

test("rejects a non-finite sample boundary", () => {
  assert.throws(() => recordsStartedInSample([], Number.NaN), /finite timestamp/);
});

test("attributes exactly one request to an ordered final card cohort", () => {
  const records = [
    { endpoint: "initial", requestBody: { p_card_ids: [3, 2, 1] } },
    { endpoint: "result", requestBody: { p_card_ids: [6, 5, 4] } },
  ];
  assert.deepEqual(
    recordsMatchingExactCardIdCohort(records, [6, 5, 4]).map((record) => record.endpoint),
    ["result"],
  );
});

test("retains duplicate requests for the exact cohort so the caller can fail closed", () => {
  const records = [
    { endpoint: "result-1", requestBody: { p_card_ids: [6, 5, 4] } },
    { endpoint: "result-2", requestBody: { p_card_ids: [6, 5, 4] } },
  ];
  assert.deepEqual(
    recordsMatchingExactCardIdCohort(records, [6, 5, 4]).map((record) => record.endpoint),
    ["result-1", "result-2"],
  );
});

test("does not mask duplicate, reordered, malformed, or different-size cohorts", () => {
  const records = [
    { endpoint: "duplicate", requestBody: { p_card_ids: [6, 5, 5] } },
    { endpoint: "reordered", requestBody: { p_card_ids: [4, 5, 6] } },
    { endpoint: "string", requestBody: { p_card_ids: [6, 5, "4"] } },
    { endpoint: "short", requestBody: { p_card_ids: [6, 5] } },
    { endpoint: "missing", requestBody: {} },
  ];
  assert.deepEqual(recordsMatchingExactCardIdCohort(records, [6, 5, 4]), []);
  assert.throws(
    () => recordsMatchingExactCardIdCohort(records, [6, 5, 5]),
    /unique positive-integer cohort/,
  );
});

test("matches no request for an empty final cohort unless an empty RPC was recorded", () => {
  const records = [
    { endpoint: "initial", requestBody: { p_card_ids: [3, 2, 1] } },
  ];
  assert.deepEqual(recordsMatchingExactCardIdCohort(records, []), []);
  assert.deepEqual(
    recordsMatchingExactCardIdCohort([
      ...records,
      { endpoint: "invalid-empty-rpc", requestBody: { p_card_ids: [] } },
    ], []).map((record) => record.endpoint),
    ["invalid-empty-rpc"],
  );
});

test("retains request timing, status, body, and per-request bytes", () => {
  assert.deepEqual(retainEnrichmentRequestEvidence({
    method: "POST",
    url: rpcURL,
    requestBody: { p_card_ids: [3, 2, 1] },
    requestedAt: 100,
    completedAt: 130,
    status: 404,
    bytes: 37,
    ignored: "not durable",
  }), {
    method: "POST",
    url: rpcURL,
    requestBody: { p_card_ids: [3, 2, 1] },
    requestedAt: 100,
    completedAt: 130,
    status: 404,
    bytes: 37,
  });
});

test("fails closed when retained timestamps or bytes are missing or malformed", () => {
  const complete = {
    method: "POST",
    url: rpcURL,
    requestBody: { p_card_ids: [3, 2, 1] },
    requestedAt: 100,
    completedAt: 130,
    bytes: 37,
  };
  assert.throws(
    () => retainEnrichmentRequestEvidence({ ...complete, requestedAt: Number.NaN }),
    /timestamps must be finite/,
  );
  assert.throws(
    () => retainEnrichmentRequestEvidence({ ...complete, bytes: undefined }),
    /bytes must be a nonnegative integer/,
  );
  assert.throws(
    () => retainEnrichmentRequestEvidence({ ...complete, bytes: -1 }),
    /bytes must be a nonnegative integer/,
  );
});
