export interface ObservationBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface UnresolvedObservationPrice {
  amountJpy: number;
  tier: string | null;
  sourceBox: ObservationBox;
  effectiveBox: ObservationBox;
  method: string;
  ocrConfidence: number | null;
}

export interface UnresolvedBuylistObservationRow {
  routingOutcomeId: number;
  observationOrdinal: number;
  routedAt: string;
  tweetId: string;
  buyerHandle: string;
  twitterHandle: string;
  tweetUrl: string;
  sourceImageIndex: number;
  sourceImageUrl: string;
  sourceContentSha256: string;
  policyVersion: string;
  schemaVersion: 1;
  sourceCellIndex: number;
  sourceImageWidth: number;
  sourceImageHeight: number;
  productKind: "singles" | "sealed";
  grade: {
    status: "observed" | "not_observed" | "not_applicable";
    value: string | null;
  };
  variant: string | null;
  sourceGeometry: { card: ObservationBox; price: ObservationBox | null };
  effectiveGeometry: { card: ObservationBox; price: ObservationBox | null };
  prices: UnresolvedObservationPrice[];
}

function record(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed unresolved buylist observation");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error("Malformed unresolved buylist observation");
  }
  return value as number;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Malformed unresolved buylist observation");
  }
  return value;
}

function nullableText(value: unknown): string | null {
  if (value == null) return null;
  return text(value);
}

function box(value: unknown, width: number, height: number): ObservationBox {
  const raw = record(value);
  const parsed = {
    x0: integer(raw.x0, 0),
    y0: integer(raw.y0, 0),
    x1: integer(raw.x1, 1),
    y1: integer(raw.y1, 1),
  };
  if (
    parsed.x1 <= parsed.x0
    || parsed.y1 <= parsed.y0
    || parsed.x1 > width
    || parsed.y1 > height
  ) {
    throw new Error("Malformed unresolved buylist observation");
  }
  return parsed;
}

function geometry(
  value: unknown,
  width: number,
  height: number,
): { card: ObservationBox; price: ObservationBox | null } {
  const raw = record(value);
  return {
    card: box(raw.card, width, height),
    price: raw.price == null ? null : box(raw.price, width, height),
  };
}

function parseRow(value: unknown): UnresolvedBuylistObservationRow {
  const raw = record(value);
  const observation = record(raw.observation);
  const identity = record(observation.identity);
  if (
    identity.status !== "unresolved"
    || identity.reason !== "matcher_abstained"
    || identity.catalog_id !== null
    || observation.financial_eligibility !== "ineligible_unresolved_identity"
    || observation.price_side !== "bid"
    || observation.schema_version !== 1
  ) {
    throw new Error("Malformed unresolved buylist observation");
  }

  const sourceImageWidth = integer(observation.source_image_width, 1);
  const sourceImageHeight = integer(observation.source_image_height, 1);
  const sourceImageIndex = integer(raw.source_image_index, 0);
  if (integer(observation.source_image_index, 0) !== sourceImageIndex) {
    throw new Error("Malformed unresolved buylist observation");
  }
  if (observation.product_kind !== "singles" && observation.product_kind !== "sealed") {
    throw new Error("Malformed unresolved buylist observation");
  }

  const grade = record(observation.grade);
  if (
    grade.status !== "observed"
    && grade.status !== "not_observed"
    && grade.status !== "not_applicable"
  ) {
    throw new Error("Malformed unresolved buylist observation");
  }
  const gradeValue = nullableText(grade.value);
  if ((grade.status === "observed") !== (gradeValue != null)) {
    throw new Error("Malformed unresolved buylist observation");
  }
  if (
    (observation.product_kind === "sealed") !== (grade.status === "not_applicable")
  ) {
    throw new Error("Malformed unresolved buylist observation");
  }

  if (
    !Array.isArray(observation.prices)
    || observation.prices.length === 0
    || observation.prices.length > 100
  ) {
    throw new Error("Malformed unresolved buylist observation");
  }
  const prices = observation.prices.map((value): UnresolvedObservationPrice => {
    const price = record(value);
    const evidence = record(price.evidence);
    if (evidence.verified !== true) {
      throw new Error("Malformed unresolved buylist observation");
    }
    const confidence = evidence.ocr_confidence;
    if (
      confidence != null
      && (
        typeof confidence !== "number"
        || !Number.isFinite(confidence)
        || confidence < 0
        || confidence > 1
      )
    ) {
      throw new Error("Malformed unresolved buylist observation");
    }
    const amountJpy = integer(price.amount_jpy, 1);
    if (amountJpy > 100_000_000) {
      throw new Error("Malformed unresolved buylist observation");
    }
    return {
      amountJpy,
      tier: nullableText(price.tier),
      sourceBox: box(price.source_bbox, sourceImageWidth, sourceImageHeight),
      effectiveBox: box(price.effective_bbox, sourceImageWidth, sourceImageHeight),
      method: text(evidence.method),
      ocrConfidence: confidence == null ? null : confidence,
    };
  });

  const routedAt = text(raw.routed_at);
  if (Number.isNaN(new Date(routedAt).getTime())) {
    throw new Error("Malformed unresolved buylist observation");
  }
  const digest = raw.source_content_sha256;
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error("Malformed unresolved buylist observation");
  }
  return {
    routingOutcomeId: integer(raw.routing_outcome_id, 1),
    observationOrdinal: integer(raw.observation_ordinal, 1),
    routedAt,
    tweetId: text(raw.tweet_id),
    buyerHandle: text(raw.buyer_handle),
    twitterHandle: text(raw.twitter_handle),
    tweetUrl: text(raw.tweet_url),
    sourceImageIndex,
    sourceImageUrl: text(raw.source_image_url),
    sourceContentSha256: digest,
    policyVersion: text(raw.policy_version),
    schemaVersion: 1,
    sourceCellIndex: integer(observation.source_cell_index, 0),
    sourceImageWidth,
    sourceImageHeight,
    productKind: observation.product_kind,
    grade: { status: grade.status, value: gradeValue },
    variant: nullableText(observation.variant),
    sourceGeometry: geometry(
      observation.source_geometry,
      sourceImageWidth,
      sourceImageHeight,
    ),
    effectiveGeometry: geometry(
      observation.effective_geometry,
      sourceImageWidth,
      sourceImageHeight,
    ),
    prices,
  };
}

export function parseUnresolvedBuylistObservationRows(
  value: unknown,
): UnresolvedBuylistObservationRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Malformed unresolved buylist observation response");
  }
  return value.map(parseRow);
}

export function observationCursor(
  rows: UnresolvedBuylistObservationRow[],
): { routingOutcomeId: number; observationOrdinal: number } | null {
  const last = rows.at(-1);
  return last == null
    ? null
    : {
        routingOutcomeId: last.routingOutcomeId,
        observationOrdinal: last.observationOrdinal,
      };
}

export function formatObservationBox(value: ObservationBox): string {
  return `[${value.x0}, ${value.y0}, ${value.x1}, ${value.y1}]`;
}
