export function parseSaleQuantity(value: string, maximum: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const quantity = Number(trimmed);
  const max = Math.max(0, Math.floor(Number(maximum) || 0));
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > max) return null;
  return quantity;
}
