/**
 * Tarama benchmark harness tipleri — DESIGN.md §2 başarı kriterlerini ölçer.
 * Altın-set: gerçek fişlerin elle etiketli beklenen çıktısı. Harness her sağlayıcıyı
 * (DocAI / Gemini-flash / Gemini-pro) bu set üzerinde koşturup metrikleri çıkarır.
 */
import type { AnalyzedReceipt } from "../src/types.js";

/** Beklenen (elle etiketli) tek kalem. */
export interface GoldenItem {
  name: string;
  totalPriceCents: number;
  qty?: number;
}

/** Bir fişin elle etiketli beklenen sonucu (skorlama referansı). */
export interface GoldenExpected {
  /** ISO 4217 (ör. TRY). */
  currency: string;
  /** Fişin genel toplamı (kuruş). */
  totalCents: number;
  items: GoldenItem[];
}

/**
 * Altın-set vakası. İki moddan biri:
 *  - `imagePath`: golden dizinine göreli görüntü → gerçek sağlayıcıyla (Gemini/DocAI) koşulur.
 *  - `rawFixture`: önceden yakalanmış ham sağlayıcı çıktısı → ağ/anahtar olmadan harness'ı doğrular.
 */
export interface GoldenCase {
  id: string;
  imagePath?: string;
  rawFixture?: unknown;
  mimeType?: string;
  locale?: string;
  expected: GoldenExpected;
}

/** Tek vaka × tek sağlayıcı skoru. */
export interface CaseScore {
  caseId: string;
  provider: string;
  /** Sağlayıcı/şema hatası → vaka başarısız (skorlanamadı). */
  ok: boolean;
  error?: string;
  /** Kalem precision/recall/F1 (fiyat eşleşmesi temelli). */
  itemPrecision: number;
  itemRecall: number;
  itemF1: number;
  /** Eşleşen kalemlerde isim doğruluğu (0-1). */
  nameAccuracy: number;
  /** Genel toplam birebir tutuyor mu? */
  totalCorrect: boolean;
  /** Para birimi doğru mu? */
  currencyCorrect: boolean;
  /** Pipeline "toplam dengeli" dedi mi (aritmetik mutabakat)? */
  balanced: boolean;
  /** Kullanıcının düzeltmesi beklenen alan sayısı (flag + needsConfirmation proxy'si). */
  estimatedCorrections: number;
  /** Uçtan uca süre (ms). */
  elapsedMs: number;
}

/** Bir sağlayıcının tüm set üzerindeki ortalamaları. */
export interface ProviderSummary {
  provider: string;
  cases: number;
  okCases: number;
  meanItemF1: number;
  totalCorrectRate: number;
  currencyCorrectRate: number;
  meanEstimatedCorrections: number;
  p50ElapsedMs: number;
  p95ElapsedMs: number;
}

/** Harness'ın bir sağlayıcı sonucu üretebilmesi için gereken minimal arayüz. */
export type AnalyzeFn = (caseInput: {
  imageBase64: string;
  mimeType: string;
  locale?: string;
}) => Promise<AnalyzedReceipt>;
