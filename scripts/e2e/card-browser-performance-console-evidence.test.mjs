import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyConsoleEvidence,
  expectedUnavailableConsoleError,
  recordsStartedInSample,
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
