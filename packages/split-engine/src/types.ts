/**
 * Bölüşme motorunun tipleri — DESIGN.md §5 (OCR şeması) + §8 (atama katmanı).
 *
 * OCR çıktısı ("fişte ne var") ve atama katmanı ("kullanıcı kararı") AYRI tutulur.
 * Motorun girdisi = OCR çıktısı + atama katmanı. Çıktısı = kişi başı bölüşüm.
 * Tüm parasal alanlar KURUŞ (integer) — bkz. money.ts.
 */

import type { Cents } from "./money.js";

// --- OCR çıktısı katmanı (§5) -------------------------------------------------

export interface LineItem {
  id: string;
  name: string;
  /** Adet (varsayılan 1). Fiyatlandırma totalPriceCents üzerinden yapılır. */
  qty: number;
  /** Kalemin toplam fiyatı (qty dahil), kuruş. İndirim için negatif olabilir. */
  totalPriceCents: Cents;
}

export interface Charges {
  /** Kalemler ara toplamı (kuruş). */
  subtotalCents: Cents;
  /** Vergi/KDV (kuruş). */
  taxCents: Cents;
  /** Servis bedeli (kuruş). MVP'de bahşiş gibi davranır. */
  serviceChargeCents: Cents;
  /** İndirim (kuruş, pozitif değer; düşülür). */
  discountCents: Cents;
  /** Bahşiş (kuruş). Atama katmanındaki tip bunu geçersiz kılabilir. */
  tipCents: Cents;
  /** Fiş genel toplamı (kuruş) — doğrulama referansı. */
  totalCents: Cents;
  /**
   * KDV kalem fiyatlarına dahil mi? true ise vergi katmanı atlanır (§4/§5).
   */
  taxIncludedInItems: boolean;
}

export interface Receipt {
  lineItems: LineItem[];
  charges: Charges;
}

// --- Atama katmanı (§8) -------------------------------------------------------

export interface Person {
  id: string;
  name: string;
  color?: string;
}

/**
 * Bir kalemin hangi kişilere atandığı (M:N). Paylaşılan kalemde birden çok kişi.
 * `weight` eşitsiz pay içindir (ör. biri 2 porsiyon aldı), varsayılan 1.
 */
export interface Assignment {
  lineItemId: string;
  personId: string;
  weight?: number;
}

export type TipMode = "proportional" | "equal";

/** Atanmamış kalem politikası — DESIGN.md §4 kenar durumları. */
export type UnassignedStrategy = "error" | "equal";

export interface SplitInput {
  receipt: Receipt;
  people: Person[];
  assignments: Assignment[];
  /**
   * Bahşiş tutarını geçersiz kılar (kuruş). Verilmezse charges.tipCents kullanılır.
   */
  tipOverrideCents?: Cents;
  /** Bahşiş dağıtım modu (varsayılan: proportional). */
  tipMode?: TipMode;
  /** Atanmamış kalem davranışı (varsayılan: error). */
  unassignedStrategy?: UnassignedStrategy;
}

// --- Çıktı --------------------------------------------------------------------

/** Kişi başı bölüşüm — DESIGN.md §4 üç katman. */
export interface PersonSplit {
  personId: string;
  /** Kalem payları toplamı (kuruş). */
  itemsCents: Cents;
  /** Oransal vergi payı (kuruş). KDV dahilse 0. */
  taxCents: Cents;
  /** Bahşiş + servis payı (kuruş). */
  tipCents: Cents;
  /** Toplam pay (kuruş) = items + tax + tip. */
  totalCents: Cents;
}

export interface SplitWarning {
  code:
    | "ITEMS_SUM_MISMATCH"
    | "UNASSIGNED_ITEMS"
    | "NEGATIVE_TOTAL";
  message: string;
  detail?: Record<string, unknown>;
}

export interface SplitResult {
  perPerson: PersonSplit[];
  /** Tüm payların toplamı (kuruş). İnvariant: dağıtılan toplam ile eşit. */
  totalCents: Cents;
  warnings: SplitWarning[];
}
