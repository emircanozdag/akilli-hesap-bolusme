/**
 * Orkestrasyon çıktı tipleri — DESIGN.md §5/§7.
 * Ham OCR → doğrulanmış + normalize + regional zenginleştirilmiş "AnalyzedReceipt".
 * Çıktının `receipt` alanı doğrudan @ahb/split-engine'e verilebilir.
 */
import type { Receipt } from "@ahb/split-engine";
import type { RawMeta } from "./schema.js";

/** Bölgesel bahşiş davranışı — AI üretmez, locale'e göre biz enjekte ederiz (§5/§7). */
export interface Regional {
  /** ISO 3166-1 alpha-2 (ör. TR, US). Tespit edilemezse undefined. */
  country?: string;
  tippingNorm: "expected" | "optional" | "included" | "none";
  /** Önerilen bahşiş yüzdeleri (ör. [15, 18, 20]). */
  suggestedTipPercentages: number[];
  note?: string;
}

export interface ArithmeticCheck {
  itemsSumCents: number;
  declaredSubtotalCents: number;
  declaredTotalCents: number;
  /** Beklenen toplam ile beyan edilen toplam tutuyor mu? */
  balanced: boolean;
  /** Beklenen − beyan (kuruş). 0 ise tam tutar. */
  discrepancyCents: number;
}

export type FlagReason =
  | "low_confidence"
  | "qty_price_mismatch"
  | "missing_currency"
  | "unbalanced_total";

export interface FieldFlag {
  /** İlgili alan: kalem id'si ya da "currency" / "total" gibi tekil alan. */
  target: string;
  reason: FlagReason;
  message: string;
}

export interface AnalyzedReceipt {
  /** @ahb/split-engine uyumlu, normalize edilmiş fiş. */
  receipt: Receipt;
  meta: RawMeta;
  regional: Regional;
  /** Kalem id → confidence (0-1). */
  itemConfidence: Record<string, number>;
  /** Kullanıcı dikkatine sunulacak alanlar (düzeltme ekranı işaretleri). */
  flags: FieldFlag[];
  /** Onaylanmadan ilerlenemeyecek kritik alanlar (currency/total). */
  needsConfirmation: string[];
  arithmetic: ArithmeticCheck;
  /** Bilgilendirici uyarılar (kullanıcıyı bloklamaz). */
  warnings: string[];
  /** Bu sonucun önbellekten mi geldiği. */
  cached: boolean;
}

export interface AnalyzeInput {
  /** base64 (data URL prefix'siz) görüntü. */
  imageBase64: string;
  /** ör. "image/jpeg". */
  mimeType: string;
  /** İstemciden gelen ipuçları (cihaz locale'i vb.). */
  hints?: {
    locale?: string;
  };
}
