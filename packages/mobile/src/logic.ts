/**
 * UI durumu ↔ @ahb/split-engine köprüsü (web adaptörüyle aynı saf mantık).
 * Motor deterministik; bu katman form girdisini SplitInput'a çevirir ve
 * yüzde bahşiş / KDV-dahil gibi kullanıcı kolaylıklarını yönetir.
 */
import {
  computeSplit,
  formatCents,
  toCents,
  type Cents,
  type SplitResult,
  type TipMode,
} from "@ahb/split-engine";
import type { AnalyzedReceipt } from "@ahb/ai-orchestrator";

export interface ItemRow {
  id: string;
  name: string;
  /** Kullanıcı girdisi (ham metin), ör. "19,99". */
  price: string;
  /** Adisyondan yakalanan adet (qty). Pay sayaçlarının üst sınırı. Manuel kalemde 1. */
  qty: number;
}

export interface PersonRow {
  id: string;
  name: string;
  color: string;
}

export interface TaxState {
  /** KDV kalem fiyatlarına dahil mi? true ise ayrı vergi katmanı yok. */
  included: boolean;
  value: string;
}

export interface TipState {
  mode: TipMode;
  /** true → value bir yüzdedir; false → tutardır. */
  isPercent: boolean;
  value: string;
}

export interface SplitState {
  currency: string;
  items: ItemRow[];
  people: PersonRow[];
  /**
   * itemId → { personId: pay/adet (weight) }. Ağırlık ≥ 1 ise kişi o kaleme atanmış.
   * Tüm ağırlıklar eşitse eşit bölünür; "9 su → 3/6" gibi durumlar için ağırlık değişir.
   */
  assignments: Record<string, Record<string, number>>;
  tax: TaxState;
  tip: TipState;
}

export interface ComputedSplit {
  result: SplitResult;
  subtotalCents: Cents;
  taxCents: Cents;
  tipCents: Cents;
  grandTotalCents: Cents;
}

/** Geçersiz/boş girdiyi 0 kabul eden güvenli ayrıştırma (UI çökmez). */
export function safeToCents(raw: string): Cents {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  try {
    return toCents(trimmed);
  } catch {
    return 0;
  }
}

export function isValidAmount(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  try {
    toCents(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function buildSubtotal(items: readonly ItemRow[]): Cents {
  return items.reduce((acc, it) => acc + safeToCents(it.price), 0);
}

/**
 * UI durumundan kişi başı bölüşümü hesaplar.
 * Kişi ya da kalem yoksa null döner (UI bunu boş durum gösterir).
 */
export function computeFromState(state: SplitState): ComputedSplit | null {
  if (state.people.length === 0 || state.items.length === 0) return null;

  const subtotalCents = buildSubtotal(state.items);
  const taxCents = state.tax.included ? 0 : safeToCents(state.tax.value);

  const tipCents = state.tip.isPercent
    ? percentOf(subtotalCents, state.tip.value)
    : safeToCents(state.tip.value);

  const result = computeSplit({
    receipt: {
      lineItems: state.items.map((it) => ({
        id: it.id,
        name: it.name.trim() || "Kalem",
        qty: Math.max(1, Math.round(it.qty || 1)),
        totalPriceCents: safeToCents(it.price),
      })),
      charges: {
        subtotalCents,
        taxCents,
        serviceChargeCents: 0,
        discountCents: 0,
        tipCents,
        totalCents: subtotalCents + taxCents + tipCents,
        taxIncludedInItems: state.tax.included,
      },
    },
    people: state.people.map((p) => ({ id: p.id, name: p.name.trim() || "Kişi", color: p.color })),
    assignments: Object.entries(state.assignments).flatMap(([lineItemId, weights]) =>
      Object.entries(weights)
        .filter(([, weight]) => weight > 0)
        .map(([personId, weight]) => ({ lineItemId, personId, weight })),
    ),
    tipMode: state.tip.mode,
    // Atanmamış kalemleri herkese eşit böl + uyar (akıcı UX).
    unassignedStrategy: "equal",
  });

  return { result, subtotalCents, taxCents, tipCents, grandTotalCents: result.totalCents };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: "₺",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

export function currencySymbol(code?: string): string {
  if (!code) return "₺";
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

/**
 * Orkestratör çıktısını UI durumuna çevirir. Kişiler korunur; atamalar sıfırlanır
 * (kullanıcı kimin ne yediğini işaretler — DESIGN.md §3 atama adımı).
 */
export function analyzedToState(analyzed: AnalyzedReceipt, prevPeople: PersonRow[]): SplitState {
  const { receipt, meta } = analyzed;
  const suggestedTip = analyzed.regional.suggestedTipPercentages[0];
  return {
    currency: currencySymbol(meta.currency),
    people: prevPeople,
    items: receipt.lineItems.map((li) => ({
      id: li.id,
      name: li.name,
      price: formatCents(li.totalPriceCents),
      qty: Math.max(1, Math.round(li.qty || 1)),
    })),
    assignments: {},
    tax: {
      included: receipt.charges.taxIncludedInItems,
      value: receipt.charges.taxIncludedInItems ? "" : formatCents(receipt.charges.taxCents),
    },
    tip:
      receipt.charges.tipCents > 0
        ? { mode: "proportional", isPercent: false, value: formatCents(receipt.charges.tipCents) }
        : {
            mode: "proportional",
            isPercent: true,
            value: suggestedTip !== undefined ? String(suggestedTip) : "",
          },
  };
}

/** Yüzdeyi kuruş tutara çevirir (kuruş-int korunur). */
function percentOf(baseCents: Cents, percentRaw: string): Cents {
  const pct = Number(percentRaw.trim().replace(",", "."));
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round((baseCents * pct) / 100);
}

export { formatCents };
