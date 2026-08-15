import { roiHoldingKey, type RoiLine } from "./theoretical-roi";

export type InventoryConsignmentGame = "pokemon" | "mtg" | "pokemon_sealed";
export type InventoryConsignmentLine = RoiLine;

export interface InventoryConsignmentCounts {
  owned: number;
  consigned: number;
  available: number;
}

export interface SetLineConsignmentArgs {
  p_game: InventoryConsignmentGame;
  p_lot_line_id: number;
  p_consigned_qty: number;
}

export type SetLineConsignmentRpc = (
  args: SetLineConsignmentArgs,
) => PromiseLike<{ data: unknown; error: unknown }>;

export function normalizedConsignedQty(value: unknown, qtyOnHand: number): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(parsed, Math.max(0, Math.floor(qtyOnHand))));
}

export function isInventoryConsignmentGame(value: string): value is InventoryConsignmentGame {
  return value === "pokemon" || value === "mtg" || value === "pokemon_sealed";
}

export async function setInventoryLineConsignment(
  line: InventoryConsignmentLine,
  qty: number,
  rpc: SetLineConsignmentRpc,
): Promise<number> {
  if (!isInventoryConsignmentGame(line.game)) {
    throw new Error(`Unsupported inventory game: ${line.game}`);
  }
  if (!Number.isSafeInteger(qty) || qty < 0 || qty > line.qty_on_hand) {
    throw new Error(`Consigned quantity must be an integer from 0 to ${line.qty_on_hand}.`);
  }
  const { data, error } = await rpc({
    p_game: line.game,
    p_lot_line_id: line.lot_line_id,
    p_consigned_qty: qty,
  });
  if (error) throw error;
  return normalizedConsignedQty(data, line.qty_on_hand);
}

export interface ConsignLineArgs {
  p_game: InventoryConsignmentGame;
  p_lot_line_id: number;
  p_consigned_qty: number;
  p_consignee: string;
}

export interface RecordConsignmentSaleArgs {
  p_game: InventoryConsignmentGame;
  p_lot_line_id: number;
  p_sale_usd: number;
  p_fee_usd: number;
  p_sold_at: string;
}

export interface ClearConsignmentArgs {
  p_game: InventoryConsignmentGame;
  p_lot_line_id: number;
}

type Rpc<A> = (args: A) => PromiseLike<{ data: unknown; error: unknown }>;

// consign_line sets the consigned quantity AND records the consignee in one
// call; the backend requires a non-empty consignee (use setInventoryLineConsignment
// for the quantity-only path).
export async function consignInventoryLine(
  line: InventoryConsignmentLine,
  qty: number,
  consignee: string,
  rpc: Rpc<ConsignLineArgs>,
): Promise<number> {
  if (!isInventoryConsignmentGame(line.game)) throw new Error(`Unsupported inventory game: ${line.game}`);
  if (!Number.isSafeInteger(qty) || qty < 0 || qty > line.qty_on_hand) {
    throw new Error(`Consigned quantity must be an integer from 0 to ${line.qty_on_hand}.`);
  }
  if (consignee.trim() === "") throw new Error("A consignee is required.");
  const { data, error } = await rpc({ p_game: line.game, p_lot_line_id: line.lot_line_id, p_consigned_qty: qty, p_consignee: consignee.trim() });
  if (error) throw error;
  return normalizedConsignedQty(data, line.qty_on_hand);
}

export async function recordInventoryLineSale(
  line: InventoryConsignmentLine,
  input: { saleUsd: number; feeUsd: number; soldAt: string },
  rpc: Rpc<RecordConsignmentSaleArgs>,
): Promise<void> {
  if (!isInventoryConsignmentGame(line.game)) throw new Error(`Unsupported inventory game: ${line.game}`);
  if (!(input.saleUsd >= 0) || !(input.feeUsd >= 0)) throw new Error("Sale and fee must be non-negative.");
  const { error } = await rpc({ p_game: line.game, p_lot_line_id: line.lot_line_id, p_sale_usd: input.saleUsd, p_fee_usd: input.feeUsd, p_sold_at: input.soldAt });
  if (error) throw error;
}

export async function clearInventoryLineConsignment(
  line: InventoryConsignmentLine,
  rpc: Rpc<ClearConsignmentArgs>,
): Promise<void> {
  if (!isInventoryConsignmentGame(line.game)) throw new Error(`Unsupported inventory game: ${line.game}`);
  const { error } = await rpc({ p_game: line.game, p_lot_line_id: line.lot_line_id });
  if (error) throw error;
}

export function inventoryConsignmentLinesByHolding(
  lines: readonly InventoryConsignmentLine[],
): ReadonlyMap<string, InventoryConsignmentLine[]> {
  const groups = new Map<string, InventoryConsignmentLine[]>();
  for (const line of lines) {
    const key = roiHoldingKey(line);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) =>
      (b.acquired_at ?? "").localeCompare(a.acquired_at ?? "")
      || b.lot_line_id - a.lot_line_id
    );
  }
  return groups;
}

export function inventoryConsignmentCounts(
  qtyOnHand: number,
  lines: readonly InventoryConsignmentLine[],
): InventoryConsignmentCounts {
  const owned = Math.max(0, Math.floor(Number(qtyOnHand) || 0));
  const consigned = Math.min(
    owned,
    lines.reduce(
      (sum, line) => sum + normalizedConsignedQty(line.consigned_qty, line.qty_on_hand),
      0,
    ),
  );
  return { owned, consigned, available: owned - consigned };
}
