import { describe, it, expect } from "vitest";
import { analyzeRaw } from "../src/index.js";
import type { AnalyzeInput } from "../src/types.js";
import {
  failedCase,
  matchItems,
  normalizeName,
  scoreCase,
  summarize,
} from "../bench/metrics.js";
import type { GoldenExpected } from "../bench/types.js";

const input: AnalyzeInput = { imageBase64: "x", mimeType: "image/jpeg" };

describe("normalizeName", () => {
  it("Türkçe karakter + noktalama duyarsız anahtar üretir", () => {
    expect(normalizeName("(İkram) Turşu")).toBe("ikramtursu");
    expect(normalizeName("PAPAYA-TAVUK")).toBe("papayatavuk");
  });
});

describe("matchItems — fiyat çapalı eşleme", () => {
  it("tam eşleşmede hepsini ve isim doğruluğunu sayar", () => {
    const r = matchItems(
      [
        { name: "Steak", totalPriceCents: 2500 },
        { name: "Salata", totalPriceCents: 800 },
      ],
      [
        { name: "Steak", totalPriceCents: 2500 },
        { name: "Salata", totalPriceCents: 800 },
      ],
    );
    expect(r.matched).toBe(2);
    expect(r.nameCorrect).toBe(2);
  });

  it("fiyat doğru ama isim yanlışsa eşleşir, isim-doğru saymaz", () => {
    const r = matchItems(
      [{ name: "Kalem", totalPriceCents: 2500 }],
      [{ name: "Steak", totalPriceCents: 2500 }],
    );
    expect(r.matched).toBe(1);
    expect(r.nameCorrect).toBe(0);
  });

  it("fiyat tutmayan kalem eşleşmez", () => {
    const r = matchItems(
      [{ name: "Steak", totalPriceCents: 9999 }],
      [{ name: "Steak", totalPriceCents: 2500 }],
    );
    expect(r.matched).toBe(0);
  });
});

describe("scoreCase — uçtan uca skorlama", () => {
  const expected: GoldenExpected = {
    currency: "TRY",
    totalCents: 4300,
    items: [
      { name: "Steak", totalPriceCents: 2500 },
      { name: "Salata", totalPriceCents: 800 },
      { name: "Paylaşılan meze", totalPriceCents: 1000 },
    ],
  };

  it("mükemmel okuma → F1=1, toplam doğru, düzeltme yok", () => {
    const analyzed = analyzeRaw(
      {
        meta: { currency: "TRY", locale: "tr-TR", currencyConfidence: 0.98 },
        lineItems: [
          { name: "Steak", totalPriceCents: 2500, confidence: 0.97 },
          { name: "Salata", totalPriceCents: 800, confidence: 0.95 },
          { name: "Paylaşılan meze", totalPriceCents: 1000, confidence: 0.9 },
        ],
        charges: { subtotalCents: 4300, totalCents: 4300, taxIncludedInItems: true },
      },
      input,
    );
    const score = scoreCase("c1", "fixture", analyzed, expected, 1234);
    expect(score.itemF1).toBeCloseTo(1, 5);
    expect(score.nameAccuracy).toBeCloseTo(1, 5);
    expect(score.totalCorrect).toBe(true);
    expect(score.currencyCorrect).toBe(true);
    expect(score.balanced).toBe(true);
    expect(score.estimatedCorrections).toBe(0);
    expect(score.elapsedMs).toBe(1234);
  });

  it("eksik kalem → recall düşer, düzeltme artar", () => {
    const analyzed = analyzeRaw(
      {
        meta: { currency: "TRY", locale: "tr-TR", currencyConfidence: 0.98 },
        lineItems: [{ name: "Steak", totalPriceCents: 2500, confidence: 0.97 }],
        charges: { subtotalCents: 2500, totalCents: 2500, taxIncludedInItems: true },
      },
      input,
    );
    const score = scoreCase("c2", "fixture", analyzed, expected, 100);
    expect(score.itemRecall).toBeCloseTo(1 / 3, 5);
    expect(score.totalCorrect).toBe(false);
    expect(score.estimatedCorrections).toBeGreaterThan(0);
  });
});

describe("summarize — sağlayıcı özetleri", () => {
  it("ortalama ve yüzdelikleri hesaplar, başarısız vakayı dışlar", () => {
    const ok = scoreCase(
      "c1",
      "gemini-flash",
      analyzeRaw(
        {
          meta: { currency: "TRY", currencyConfidence: 0.98 },
          lineItems: [{ name: "X", totalPriceCents: 100, confidence: 0.9 }],
          charges: { subtotalCents: 100, totalCents: 100, taxIncludedInItems: true },
        },
        input,
      ),
      { currency: "TRY", totalCents: 100, items: [{ name: "X", totalPriceCents: 100 }] },
      200,
    );
    const bad = failedCase("c2", "gemini-flash", "şema hatası");
    const summary = summarize("gemini-flash", [ok, bad]);
    expect(summary.cases).toBe(2);
    expect(summary.okCases).toBe(1);
    expect(summary.meanItemF1).toBeCloseTo(1, 5); // sadece ok vaka ortalamaya girer
    expect(summary.totalCorrectRate).toBeCloseTo(0.5, 5); // 2 vakadan 1'i
    expect(summary.p50ElapsedMs).toBe(200);
  });
});
