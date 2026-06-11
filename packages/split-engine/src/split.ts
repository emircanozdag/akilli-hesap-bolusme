/**
 * Bölüşme motoru — DESIGN.md §4 "Bölüşme Algoritması".
 *
 * Kişinin payı = kalem payları + oransal vergi payı + oransal/eşit bahşiş payı.
 * Tüm hesap kuruş-int üzerinde, en büyük kalan yöntemiyle yapılır; toplam korunur.
 * Bu modül SAFTIR: UI/IO/ağ bağımlılığı yok, %100 deterministik ve test edilebilir.
 */

import { distributeByWeights, distributeEqually } from "./largest-remainder.js";
import { sumCents, type Cents } from "./money.js";
import type {
  Assignment,
  PersonSplit,
  SplitInput,
  SplitResult,
  SplitWarning,
} from "./types.js";

export function computeSplit(input: SplitInput): SplitResult {
  const {
    receipt,
    people,
    assignments,
    tipOverrideCents,
    tipMode = "proportional",
    unassignedStrategy = "error",
  } = input;

  if (people.length === 0) {
    throw new RangeError("En az bir kişi gerekli (sıfıra bölme koruması).");
  }

  const personIndex = new Map<string, number>();
  people.forEach((p, i) => {
    if (personIndex.has(p.id)) {
      throw new RangeError(`Yinelenen kişi id: ${p.id}`);
    }
    personIndex.set(p.id, i);
  });

  const warnings: SplitWarning[] = [];

  // --- Katman 1: kalem payları ------------------------------------------------
  const itemsBase = new Array<Cents>(people.length).fill(0);

  const assignmentsByItem = groupAssignmentsByItem(assignments, personIndex);

  receipt.lineItems.forEach((item, itemIdx) => {
    const assigned = assignmentsByItem.get(item.id);

    if (!assigned || assigned.length === 0) {
      if (unassignedStrategy === "error") {
        throw new RangeError(
          `Atanmamış kalem: "${item.name}" (${item.id}). ` +
            `unassignedStrategy:"equal" ile herkese eşit bölebilirsiniz.`,
        );
      }
      // "equal": atanmamış kalem herkese eşit dağıtılır.
      const shares = distributeEqually(item.totalPriceCents, people.length, {
        rotationOffset: itemIdx,
      });
      shares.forEach((share, i) => (itemsBase[i]! += share));
      warnings.push({
        code: "UNASSIGNED_ITEMS",
        message: `Atanmamış kalem herkese eşit bölündü: ${item.name}`,
        detail: { lineItemId: item.id },
      });
      return;
    }

    // Atanmış kalem: ağırlıklara göre (paylaşılan = çok kişi) böl.
    const weights = assigned.map((a) => a.weight ?? 1);
    const shares = distributeByWeights(item.totalPriceCents, weights);
    assigned.forEach((a, k) => {
      itemsBase[personIndex.get(a.personId)!]! += shares[k]!;
    });
  });

  // İndirim: negatif oransal düşüm (§4 kenar durumu). Kalem tabanına uygulanır.
  applyDiscount(itemsBase, receipt.charges.discountCents);

  // --- Katman 2: oransal vergi -----------------------------------------------
  const taxLayer = receipt.charges.taxIncludedInItems
    ? new Array<Cents>(people.length).fill(0)
    : distributeProportional(receipt.charges.taxCents, itemsBase);

  // --- Katman 3: bahşiş + servis ---------------------------------------------
  const gratuityCents =
    (tipOverrideCents ?? receipt.charges.tipCents) + receipt.charges.serviceChargeCents;

  const tipLayer =
    tipMode === "equal"
      ? distributeEqually(gratuityCents, people.length)
      : distributeProportional(gratuityCents, itemsBase);

  // --- Birleştir --------------------------------------------------------------
  const perPerson: PersonSplit[] = people.map((p, i) => {
    const items = itemsBase[i]!;
    const tax = taxLayer[i]!;
    const tip = tipLayer[i]!;
    const total = items + tax + tip;
    if (total < 0) {
      warnings.push({
        code: "NEGATIVE_TOTAL",
        message: `${p.name} için negatif toplam: ${total}`,
        detail: { personId: p.id, totalCents: total },
      });
    }
    return { personId: p.id, itemsCents: items, taxCents: tax, tipCents: tip, totalCents: total };
  });

  const totalCents = sumCents(perPerson.map((s) => s.totalCents));

  // Veri tutarlılığı uyarısı (§5 validation): kalemler toplamı = ara toplam mı?
  const itemsSum = sumCents(receipt.lineItems.map((i) => i.totalPriceCents));
  if (itemsSum !== receipt.charges.subtotalCents) {
    warnings.push({
      code: "ITEMS_SUM_MISMATCH",
      message: "Kalemler toplamı fiş ara toplamıyla eşleşmiyor.",
      detail: { itemsSum, subtotalCents: receipt.charges.subtotalCents },
    });
  }

  return { perPerson, totalCents, warnings };
}

function groupAssignmentsByItem(
  assignments: readonly Assignment[],
  personIndex: ReadonlyMap<string, number>,
): Map<string, Assignment[]> {
  const byItem = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!personIndex.has(a.personId)) {
      throw new RangeError(`Atama bilinmeyen kişiye işaret ediyor: ${a.personId}`);
    }
    if ((a.weight ?? 1) < 0) {
      throw new RangeError(`Atama ağırlığı negatif olamaz: ${a.personId}`);
    }
    const list = byItem.get(a.lineItemId);
    if (list) list.push(a);
    else byItem.set(a.lineItemId, [a]);
  }
  return byItem;
}

/**
 * Bir tutarı kişilerin kalem tabanına oransal dağıtır.
 * Taban toplamı 0 ise (ör. tüm kalemler bedava) eşit dağıtıma düşer.
 */
function distributeProportional(amount: Cents, weights: readonly Cents[]): Cents[] {
  if (amount === 0) return new Array<Cents>(weights.length).fill(0);
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight <= 0) {
    return distributeEqually(amount, weights.length);
  }
  return distributeByWeights(amount, weights);
}

/** İndirimi (pozitif kuruş) kalem tabanından oransal düşer (§4). */
function applyDiscount(itemsBase: Cents[], discountCents: Cents): void {
  if (discountCents <= 0) return;
  const reductions = distributeProportional(discountCents, itemsBase);
  reductions.forEach((r, i) => (itemsBase[i]! -= r));
}
