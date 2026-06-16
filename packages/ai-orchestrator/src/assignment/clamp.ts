/**
 * Pay/adet kısıtları — mobil assignment-validation ile aynı mantık.
 * Orchestrator saf TS; UI bağımlılığı yok.
 */

export interface ItemAssignmentMeta {
  assignedIds: string[];
  totalUnits: number;
  capEnforced: boolean;
  remaining: number;
  atCap: boolean;
  needsQtyAttention: boolean;
  qtyFullyAllocated: boolean;
}

/** Payların toplamını kaleme ait adede (qty) sığdırır. */
export function clampWeightsToQty(
  weights: Record<string, number>,
  qty: number,
): Record<string, number> {
  const ids = Object.keys(weights).filter((id) => (weights[id] ?? 0) > 0);
  if (ids.length === 0 || qty < 2) return weights;
  const next: Record<string, number> = { ...weights };
  let sum = ids.reduce((s, id) => s + (next[id] ?? 0), 0);
  while (sum > qty) {
    let maxId: string | null = null;
    for (const id of ids) {
      if ((next[id] ?? 0) > 1 && (maxId === null || (next[id] ?? 0) > (next[maxId] ?? 0))) {
        maxId = id;
      }
    }
    if (maxId === null) break;
    next[maxId] = (next[maxId] ?? 0) - 1;
    sum -= 1;
  }
  return next;
}

export function getItemAssignmentMeta(
  qty: number,
  assigned: Record<string, number>,
): ItemAssignmentMeta {
  const assignedIds = Object.keys(assigned).filter((id) => (assigned[id] ?? 0) > 0);
  const totalUnits = assignedIds.reduce((s, id) => s + (assigned[id] ?? 0), 0);
  const capEnforced = qty >= 2;
  const remaining = capEnforced ? Math.max(0, qty - totalUnits) : 0;
  const atCap = capEnforced && totalUnits >= qty;
  const needsQtyAttention = capEnforced && assignedIds.length >= 1 && remaining > 0;
  const qtyFullyAllocated = capEnforced && assignedIds.length >= 1 && remaining === 0;
  return {
    assignedIds,
    totalUnits,
    capEnforced,
    remaining,
    atCap,
    needsQtyAttention,
    qtyFullyAllocated,
  };
}
