export interface InventoryReconciliationInput {
  observedQuantity: number;
  reason: string;
  notes: string;
}

export interface PokemonReconciliationScope {
  cardId: number;
  conditionId: number | null;
  psaGrade: number | null;
  leg: "import" | "export";
  ledgerQuantity: number;
}

export interface PokemonInventoryShortageArgs {
  p_card_id: number;
  p_expected_quantity: number;
  p_observed_quantity: number;
  p_reason: string;
  p_adjusted_at: string;
  p_notes: string | null;
  p_condition_id: number | null;
  p_psa_grade: number | null;
  p_leg: "import" | "export";
}

export function parsePhysicalCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null;
}

export function inventoryShortage(
  ledgerQuantity: number,
  observedQuantity: number,
): number | null {
  if (!Number.isSafeInteger(ledgerQuantity) || ledgerQuantity < 0) return null;
  if (!Number.isSafeInteger(observedQuantity) || observedQuantity < 0) return null;
  if (observedQuantity > ledgerQuantity) return null;
  return ledgerQuantity - observedQuantity;
}

export function validReconciliationReason(reason: string): boolean {
  const normalized = reason.trim();
  return normalized.length >= 1
    && normalized.length <= 500
    && !/[\u0000-\u001f\u007f]/.test(normalized);
}

export function buildPokemonInventoryShortageArgs(
  scope: PokemonReconciliationScope,
  input: InventoryReconciliationInput,
  adjustedAt: string,
): PokemonInventoryShortageArgs {
  const shortage = inventoryShortage(scope.ledgerQuantity, input.observedQuantity);
  if (shortage == null || shortage === 0) {
    throw new Error("physical count must be lower than the current ledger quantity");
  }
  if (!validReconciliationReason(input.reason)) {
    throw new Error("reconciliation reason must contain 1 to 500 printable characters");
  }
  if (!Number.isInteger(scope.cardId) || scope.cardId <= 0) {
    throw new Error("Pokemon card id is required for reconciliation");
  }
  if (!adjustedAt || Number.isNaN(Date.parse(adjustedAt))) {
    throw new Error("reconciliation timestamp is invalid");
  }

  return {
    p_card_id: scope.cardId,
    p_expected_quantity: scope.ledgerQuantity,
    p_observed_quantity: input.observedQuantity,
    p_reason: input.reason.trim(),
    p_adjusted_at: adjustedAt,
    p_notes: input.notes.trim() || null,
    p_condition_id: scope.conditionId,
    p_psa_grade: scope.psaGrade,
    p_leg: scope.leg,
  };
}
