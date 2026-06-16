/**
 * Orkestrasyon güvenilirlik hattı — DESIGN.md §7.
 */
import type { Charges, LineItem, Receipt } from "@ahb/split-engine";
import { normalizeDiscountLines } from "./normalize-discounts.js";
import { rawOcrResultSchema, type RawOcrResult } from "./schema.js";
import { resolveRegional } from "./regional.js";
import type { VisionProvider } from "./provider.js";
import type {
  AnalyzeInput,
  AnalyzedReceipt,
  ArithmeticCheck,
  FieldFlag,
} from "./types.js";

export interface OrchestrateOptions {
  /** Bu eşiğin altındaki confidence flag'lenir (varsayılan 0.6). */
  confidenceThreshold?: number;
}

export class OrchestrationError extends Error {
  override name = "OrchestrationError";
  constructor(
    message: string,
    readonly code: "SCHEMA_INVALID",
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

export async function orchestrate(
  provider: VisionProvider,
  input: AnalyzeInput,
  options: OrchestrateOptions = {},
): Promise<AnalyzedReceipt> {
  const raw = await provider.analyze(input);
  return analyzeRaw(raw, input, options);
}

/** Provider çıktısını (ham JSON) doğrulayıp analiz sonucu üretir. Saf fonksiyon. */
export function analyzeRaw(
  raw: unknown,
  input: AnalyzeInput,
  options: OrchestrateOptions = {},
): AnalyzedReceipt {
  const threshold = options.confidenceThreshold ?? 0.6;

  const parsed = rawOcrResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrchestrationError(
      "OCR çıktısı şemaya uymuyor.",
      "SCHEMA_INVALID",
      parsed.error.issues,
    );
  }
  const data: RawOcrResult = normalizeDiscountLines(parsed.data);

  const flags: FieldFlag[] = [];
  const warnings: string[] = [];
  const needsConfirmation: string[] = [];

  const currency = data.meta.currency?.trim().toUpperCase();
  const lineItems: LineItem[] = data.lineItems.map((it, i) => ({
    id: `li_${i}`,
    name: it.name.trim(),
    qty: it.qty,
    totalPriceCents: it.totalPriceCents,
  }));

  const itemConfidence: Record<string, number> = {};
  data.lineItems.forEach((it, i) => {
    itemConfidence[`li_${i}`] = it.confidence;
  });

  const itemsSumCents = data.lineItems.reduce((acc, it) => acc + it.totalPriceCents, 0);
  const c = data.charges;
  const expectedTotal =
    c.subtotalCents +
    (c.taxIncludedInItems ? 0 : c.taxCents) +
    c.serviceChargeCents +
    c.tipCents -
    c.discountCents;
  const discrepancyCents = c.totalCents - expectedTotal;
  const balanced = discrepancyCents === 0;

  const arithmetic: ArithmeticCheck = {
    itemsSumCents,
    declaredSubtotalCents: c.subtotalCents,
    declaredTotalCents: c.totalCents,
    balanced,
    discrepancyCents,
  };

  if (itemsSumCents !== c.subtotalCents) {
    warnings.push(
      `Kalemler toplamı (${itemsSumCents}) ara toplamdan (${c.subtotalCents}) farklı.`,
    );
  }

  data.lineItems.forEach((it, i) => {
    if (it.unitPriceCents !== undefined) {
      const expected = it.unitPriceCents * it.qty;
      if (expected !== it.totalPriceCents) {
        flags.push({
          target: `li_${i}`,
          reason: "qty_price_mismatch",
          message: `"${it.name}": adet×birim (${expected}) ≠ toplam (${it.totalPriceCents}).`,
        });
      }
    }
  });

  const regional = resolveRegional({
    ...(data.meta.locale !== undefined ? { locale: data.meta.locale } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(input.hints?.locale !== undefined ? { hintLocale: input.hints.locale } : {}),
  });

  data.lineItems.forEach((it, i) => {
    if (it.confidence < threshold) {
      flags.push({
        target: `li_${i}`,
        reason: "low_confidence",
        message: `"${it.name}" düşük güvenle okundu (${it.confidence.toFixed(2)}). Kontrol et.`,
      });
    }
  });

  if (!currency || data.meta.currencyConfidence < threshold) {
    flags.push({
      target: "currency",
      reason: "missing_currency",
      message: "Para birimi belirsiz; lütfen onayla.",
    });
    needsConfirmation.push("currency");
  }
  if (!balanced) {
    flags.push({
      target: "total",
      reason: "unbalanced_total",
      message: `Toplam tutmuyor (fark ${discrepancyCents} kuruş); kalemleri/toplamı kontrol et.`,
    });
    needsConfirmation.push("total");
  }

  const charges: Charges = {
    subtotalCents: c.subtotalCents,
    taxCents: c.taxCents,
    serviceChargeCents: c.serviceChargeCents,
    discountCents: c.discountCents,
    tipCents: c.tipCents,
    totalCents: c.totalCents,
    taxIncludedInItems: c.taxIncludedInItems,
  };

  const receipt: Receipt = { lineItems, charges };

  return {
    receipt,
    meta: { ...data.meta, ...(currency ? { currency } : {}) },
    regional,
    itemConfidence,
    flags,
    needsConfirmation,
    arithmetic,
    warnings,
    cached: false,
  };
}

/* ------------------------------------------------------------------ */
/* Kalite notu: kademeli sağlayıcı (EscalatingProvider) için skorlama  */
/* ------------------------------------------------------------------ */

/**
 * Ham sağlayıcı çıktısının kalite notu. analyzeRaw'ı yeniden kullanır (tek doğruluk
 * kaynağı): şema geçerli mi, toplam dengeli mi, kaç alan onaya düşüyor / düşük güvende.
 * EscalatingProvider bununla "pro'ya yükselt" ve "iki sonuçtan iyisini seç" kararı verir.
 */
export interface RawGrade {
  /** Şema geçerli mi (analyzeRaw OrchestrationError fırlatmadı). */
  valid: boolean;
  /** Aritmetik mutabakat: beklenen toplam == beyan edilen toplam. */
  balanced: boolean;
  /** Onaya düşen kritik alan sayısı (currency/total). */
  needsConfirmation: number;
  /** Düşük güvenle okunan kalem sayısı. */
  lowConfidenceCount: number;
  /** Toplam işaret (flag) sayısı. */
  flagCount: number;
  /** Geçerliyse analiz sonucu (yeniden hesaplamayı önlemek için). */
  analyzed?: AnalyzedReceipt;
}

export function gradeRaw(
  raw: unknown,
  input: AnalyzeInput,
  options: OrchestrateOptions = {},
): RawGrade {
  let analyzed: AnalyzedReceipt;
  try {
    analyzed = analyzeRaw(raw, input, options);
  } catch (err) {
    if (err instanceof OrchestrationError) {
      return {
        valid: false,
        balanced: false,
        needsConfirmation: Number.POSITIVE_INFINITY,
        lowConfidenceCount: Number.POSITIVE_INFINITY,
        flagCount: Number.POSITIVE_INFINITY,
      };
    }
    throw err;
  }
  return {
    valid: true,
    balanced: analyzed.arithmetic.balanced,
    needsConfirmation: analyzed.needsConfirmation.length,
    lowConfidenceCount: analyzed.flags.filter((f) => f.reason === "low_confidence").length,
    flagCount: analyzed.flags.length,
    analyzed,
  };
}

/**
 * Yükseltme tetiği: şema bozuk, toplam tutmuyor ya da düşük güvenli kalem var →
 * daha güçlü model işe yarayabilir. Yalnız currency belirsizliği (kullanıcı kolayca
 * onaylar, güçlü model de yardımcı olmaz) tek başına yükseltmeyi tetiklemez.
 */
export function shouldEscalate(grade: RawGrade): boolean {
  return !grade.valid || !grade.balanced || grade.lowConfidenceCount > 0;
}

/**
 * İki nottan hangisinin daha iyi olduğunu söyler. Öncelik sırası:
 * geçerlilik → dengeli toplam → daha az onay → daha az düşük-güven → daha az flag.
 * `candidate`, `current`'tan kesinlikle daha iyiyse true.
 */
export function isBetterGrade(candidate: RawGrade, current: RawGrade): boolean {
  if (candidate.valid !== current.valid) return candidate.valid;
  if (candidate.balanced !== current.balanced) return candidate.balanced;
  if (candidate.needsConfirmation !== current.needsConfirmation) {
    return candidate.needsConfirmation < current.needsConfirmation;
  }
  if (candidate.lowConfidenceCount !== current.lowConfidenceCount) {
    return candidate.lowConfidenceCount < current.lowConfidenceCount;
  }
  return candidate.flagCount < current.flagCount;
}
