// What a purchase plan is actually doing right now.
//
// `status` on the row records what the OPERATOR did - drafted it, marked it
// ready, placed the order, reconciled it. It deliberately says nothing about
// the buyer, so between "ordered" and "reconciled" it cannot distinguish a
// plan nobody has started from one being actively bought. Those are facts
// about the data, so they are derived here rather than becoming more statuses
// somebody has to remember to set.
export type PlanState =
  | "draft"
  | "ready"
  | "awaiting"    // ordered, buyer has recorded nothing yet
  | "buying"      // ordered, results are coming in
  | "reconciled"
  | "cancelled";

export function planState(input: {
  status: string;
  recordedCount?: number | null;
}): PlanState {
  switch (input.status) {
    case "draft":
    case "ready":
    case "cancelled":
    case "reconciled":
      return input.status;
    case "ordered":
      return (input.recordedCount ?? 0) > 0 ? "buying" : "awaiting";
    default:
      // An unknown status must not silently masquerade as a known one.
      return "draft";
  }
}

export function planStateLabel(state: PlanState): string {
  switch (state) {
    case "draft": return "Draft";
    case "ready": return "Ready to order";
    case "awaiting": return "Ordered - buyer has not started";
    case "buying": return "Buying in progress";
    case "reconciled": return "Reconciled - closed";
    case "cancelled": return "Cancelled";
  }
}
