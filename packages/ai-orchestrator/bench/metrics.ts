/**
 * Saf skorlama fonksiyonları — benchmark harness'ın matematik çekirdeği.
 * Hiç I/O yok → vitest ile birebir test edilebilir (tests/bench-metrics.test.ts).
 */
import type { AnalyzedReceipt } from "../src/types.js";
import type { CaseScore, GoldenExpected, GoldenItem, ProviderSummary } from "./types.js";

/** Aksan/noktalama duyarsız ad anahtarı ("(İkram) Turşu" → "ikramtursu"). */
export function normalizeName(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .replace(/Ş/g, "s")
    .replace(/ş/g, "s")
    .replace(/Ğ/g, "g")
    .replace(/ğ/g, "g")
    .replace(/Ü/g, "u")
    .replace(/ü/g, "u")
    .replace(/Ö/g, "o")
    .replace(/ö/g, "o")
    .replace(/Ç/g, "c")
    .replace(/ç/g, "c")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

interface PredictedItem {
  name: string;
  totalPriceCents: number;
}

/**
 * Tahmin edilen kalemleri beklenen kalemlere açgözlü eşler.
 * Önce fiyat (kuruş) birebir eşleşmesi aranır; aynı fiyatta birden çok aday varsa
 * isim benzerliği en yüksek olan seçilir. Para integer olduğundan fiyat sağlam bir çapadır.
 * Döner: eşleşme sayısı + eşleşenlerde isim-doğru sayısı.
 */
export function matchItems(
  predicted: readonly PredictedItem[],
  expected: readonly GoldenItem[],
): { matched: number; nameCorrect: number } {
  const used = new Array(predicted.length).fill(false) as boolean[];
  let matched = 0;
  let nameCorrect = 0;

  for (const exp of expected) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < predicted.length; i++) {
      if (used[i]) continue;
      const p = predicted[i]!;
      if (p.totalPriceCents !== exp.totalPriceCents) continue;
      const score = nameSimilarity(p.name, exp.name);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used[bestIdx] = true;
      matched++;
      if (normalizeName(predicted[bestIdx]!.name) === normalizeName(exp.name)) nameCorrect++;
    }
  }
  return { matched, nameCorrect };
}

/** 0-1 arası kaba ad benzerliği (normalize edilmiş ortak karakter oranı). */
function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  let hits = 0;
  for (const ch of new Set(shorter)) {
    if (longer.includes(ch)) hits++;
  }
  return hits / new Set(longer).size;
}

/** Bir analiz sonucunu beklenen değerlere göre skorlar (saf). */
export function scoreCase(
  caseId: string,
  provider: string,
  analyzed: AnalyzedReceipt,
  expected: GoldenExpected,
  elapsedMs: number,
): CaseScore {
  const predicted: PredictedItem[] = analyzed.receipt.lineItems.map((li) => ({
    name: li.name,
    totalPriceCents: li.totalPriceCents,
  }));

  const { matched, nameCorrect } = matchItems(predicted, expected.items);
  const itemPrecision = predicted.length > 0 ? matched / predicted.length : 0;
  const itemRecall = expected.items.length > 0 ? matched / expected.items.length : 0;
  const itemF1 =
    itemPrecision + itemRecall > 0
      ? (2 * itemPrecision * itemRecall) / (itemPrecision + itemRecall)
      : 0;
  const nameAccuracy = matched > 0 ? nameCorrect / matched : 0;

  const totalCorrect = analyzed.receipt.charges.totalCents === expected.totalCents;
  const currencyCorrect =
    (analyzed.meta.currency ?? "").toUpperCase() === expected.currency.toUpperCase();

  // Düzeltme proxy'si: onaya düşen alanlar + işaretli kalemler + isim-yanlış kalemler.
  const estimatedCorrections =
    analyzed.needsConfirmation.length +
    analyzed.flags.filter((f) => f.reason === "low_confidence").length +
    (matched - nameCorrect) +
    Math.abs(expected.items.length - matched);

  return {
    caseId,
    provider,
    ok: true,
    itemPrecision,
    itemRecall,
    itemF1,
    nameAccuracy,
    totalCorrect,
    currencyCorrect,
    balanced: analyzed.arithmetic.balanced,
    estimatedCorrections,
    elapsedMs,
  };
}

/** Başarısız (hata fırlatan) vaka için sıfır skor. */
export function failedCase(caseId: string, provider: string, error: string): CaseScore {
  return {
    caseId,
    provider,
    ok: false,
    error,
    itemPrecision: 0,
    itemRecall: 0,
    itemF1: 0,
    nameAccuracy: 0,
    totalCorrect: false,
    currencyCorrect: false,
    balanced: false,
    estimatedCorrections: Number.POSITIVE_INFINITY,
    elapsedMs: 0,
  };
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Bir sağlayıcının tüm vaka skorlarını özetler. */
export function summarize(provider: string, scores: readonly CaseScore[]): ProviderSummary {
  const ok = scores.filter((s) => s.ok);
  const elapsed = ok.map((s) => s.elapsedMs);
  return {
    provider,
    cases: scores.length,
    okCases: ok.length,
    meanItemF1: mean(ok.map((s) => s.itemF1)),
    totalCorrectRate: scores.length > 0 ? scores.filter((s) => s.totalCorrect).length / scores.length : 0,
    currencyCorrectRate:
      scores.length > 0 ? scores.filter((s) => s.currencyCorrect).length / scores.length : 0,
    meanEstimatedCorrections: mean(ok.map((s) => s.estimatedCorrections)),
    p50ElapsedMs: percentile(elapsed, 50),
    p95ElapsedMs: percentile(elapsed, 95),
  };
}
