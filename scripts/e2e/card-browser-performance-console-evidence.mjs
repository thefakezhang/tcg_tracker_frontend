export const expectedUnavailableConsoleError = "Failed to load resource: the server responded with a status of 404 (Not Found)";

const boundedEndpoint = "pokemon_card_browser_enrichment";

function isBoundedRPCURL(rawURL) {
  try {
    return new URL(rawURL).pathname.endsWith(`/rpc/${boundedEndpoint}`);
  } catch {
    return false;
  }
}

export function classifyConsoleEvidence({ forceUnavailable, consoleErrors, records, responseStatuses }) {
  const unavailableRecords = records.filter((record) => (
    record.kind === "bounded"
    && record.endpoint === boundedEndpoint
    && record.method === "POST"
    && record.status === 404
    && isBoundedRPCURL(record.url)
  ));
  const unavailableResponses = responseStatuses.filter((response) => (
    response.method === "POST"
    && response.status === 404
    && isBoundedRPCURL(response.url)
  ));
  const expectedMessageIndexes = consoleErrors
    .map((message, index) => message === expectedUnavailableConsoleError ? index : -1)
    .filter((index) => index >= 0);
  const hasExactUnavailableEvidence = forceUnavailable
    && unavailableRecords.length === 1
    && unavailableResponses.length === 1
    && unavailableRecords[0].url === unavailableResponses[0].url
    && expectedMessageIndexes.length === 1;
  const expectedMessageIndex = hasExactUnavailableEvidence ? expectedMessageIndexes[0] : -1;

  return {
    hasExactUnavailableEvidence,
    expectedConsoleErrors: expectedMessageIndex < 0 ? [] : [consoleErrors[expectedMessageIndex]],
    unexpectedConsoleErrors: consoleErrors.filter((_, index) => index !== expectedMessageIndex),
    unavailableRecordCount: unavailableRecords.length,
    unavailableResponseCount: unavailableResponses.length,
    expectedMessageCount: expectedMessageIndexes.length,
  };
}

export function recordsStartedInSample(records, sampleStartedAt) {
  if (!Number.isFinite(sampleStartedAt)) {
    throw new TypeError("sampleStartedAt must be a finite timestamp");
  }
  return records.filter((record) => (
    Number.isFinite(record.requestedAt) && record.requestedAt >= sampleStartedAt
  ));
}

function isUniqueCardIdCohort(cardIds) {
  return Array.isArray(cardIds)
    && cardIds.every((cardId) => Number.isSafeInteger(cardId) && cardId > 0)
    && new Set(cardIds).size === cardIds.length;
}

export function recordsMatchingExactCardIdCohort(records, finalCardIds) {
  if (!isUniqueCardIdCohort(finalCardIds)) {
    throw new TypeError("finalCardIds must be a unique positive-integer cohort");
  }
  return records.filter((record) => {
    const requestedCardIds = record.requestBody?.p_card_ids;
    return isUniqueCardIdCohort(requestedCardIds)
      && requestedCardIds.length === finalCardIds.length
      && requestedCardIds.every((cardId, index) => cardId === finalCardIds[index]);
  });
}

export function retainEnrichmentRequestEvidence({
  method,
  url,
  requestBody,
  requestedAt,
  completedAt,
  status,
  bytes,
}) {
  if (!Number.isFinite(requestedAt) || !Number.isFinite(completedAt)) {
    throw new TypeError("retained request timestamps must be finite");
  }
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new TypeError("retained request bytes must be a nonnegative integer");
  }
  return {
    method,
    url,
    requestBody,
    requestedAt,
    completedAt,
    status: status ?? 200,
    bytes,
  };
}
