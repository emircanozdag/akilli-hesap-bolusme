/**
 * Adım 3 (Paylaşım) atama doğrulaması — saf TS, UI/test edilebilir.
 * Eksik adet → sert blok; atanmamış kalem → yumuşak onay (App katmanında Alert).
 */
import type { SplitState } from "./logic";

/** Kalem başına pay/adet meta bilgisi. */
export interface ItemAssignmentMeta {
  assignedIds: string[];
  totalUnits: number;
  capEnforced: boolean;
  remaining: number;
  atCap: boolean;
  needsQtyAttention: boolean;
  qtyFullyAllocated: boolean;
  showWeightSteppers: boolean;
}

export interface ItemAssignmentIssue {
  itemId: string;
  itemName: string;
  kind: "unassigned" | "incomplete_qty";
  remaining?: number;
  qty?: number;
}

export interface Step3Validation {
  /** Eksik adet dağıtımı varsa true — ilerleme engellenir. */
  blocked: boolean;
  blockMessage: string | null;
  incompleteQty: ItemAssignmentIssue[];
  unassigned: ItemAssignmentIssue[];
  /** Atanmamış kalem varsa Alert onayı gerekir. */
  needsUnassignedConfirm: boolean;
  /** Footer'da gösterilecek özet metin. */
  footerHint: string | null;
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
  // Pay/adet sayaçları yalnızca qty ≥ 2 kalemlerde (9 su → 5+4 gibi). Tek adet: kişi seçimi yeterli.
  const showWeightSteppers =
    capEnforced &&
    (assignedIds.length >= 2 || (assignedIds.length >= 1 && remaining > 0));
  return {
    assignedIds,
    totalUnits,
    capEnforced,
    remaining,
    atCap,
    needsQtyAttention,
    qtyFullyAllocated,
    showWeightSteppers,
  };
}

/** Adım 3'te atama durumunu doğrular (equalSplit modu hariç — çağıran atlar). */
export function validateStep3Assignments(state: SplitState): Step3Validation {
  const incompleteQty: ItemAssignmentIssue[] = [];
  const unassigned: ItemAssignmentIssue[] = [];

  for (const item of state.items) {
    const name = item.name.trim() || "Kalem";
    const assigned = state.assignments[item.id] ?? {};
    const meta = getItemAssignmentMeta(item.qty, assigned);

    if (meta.assignedIds.length === 0) {
      unassigned.push({ itemId: item.id, itemName: name, kind: "unassigned" });
      continue;
    }

    if (meta.needsQtyAttention) {
      incompleteQty.push({
        itemId: item.id,
        itemName: name,
        kind: "incomplete_qty",
        remaining: meta.remaining,
        qty: item.qty,
      });
    }
  }

  const blocked = incompleteQty.length > 0;
  const needsUnassignedConfirm = unassigned.length > 0;

  let blockMessage: string | null = null;
  if (blocked) {
    if (incompleteQty.length === 1) {
      const issue = incompleteQty[0]!;
      blockMessage = `${issue.itemName}: ${issue.remaining} adet dağıtılmadı — payları tamamlayın.`;
    } else {
      blockMessage = `${incompleteQty.length} kalemda adet dağıtımı eksik — payları tamamlayın.`;
    }
  }

  let footerHint: string | null = null;
  if (blocked) {
    footerHint = blockMessage;
  } else if (needsUnassignedConfirm) {
    const n = unassigned.length;
    footerHint =
      n === 1
        ? "1 kalem atanmadı — herkese eşit bölünecek"
        : `${n} kalem atanmadı — herkese eşit bölünecek`;
  }

  return {
    blocked,
    blockMessage,
    incompleteQty,
    unassigned,
    needsUnassignedConfirm,
    footerHint,
  };
}
