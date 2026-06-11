/**
 * Gerçek dünya fişi testi — kullanıcının yüklediği Perkins (Üsküdar) adisyonu.
 * AI kotası/billing nedeniyle canlı Gemini çağrısı yapılamadığında bile, bu fişin
 * GERÇEK verileri hattan ve motordan birebir geçmeli (indirim + KDV dahil senaryosu).
 *
 *   Adisyon Toplam 56,00 − İndirim 5,60 = Net Toplam 50,40 TL
 */
import { describe, it, expect } from "vitest";
import { computeSplit, sumCents } from "@ahb/split-engine";
import { analyzeRaw } from "../src/index.js";
import type { AnalyzeInput } from "../src/types.js";
import type { RawOcrResult } from "../src/schema.js";

const PERKINS: RawOcrResult = {
  meta: {
    merchant: "Perkins Family Restaurant — Üsküdar",
    date: "2011-07-29",
    currency: "TRY",
    locale: "tr-TR",
    language: "tr",
    currencyConfidence: 0.97,
  },
  lineItems: [
    { name: "NEW MEXICO OZEL", qty: 1, totalPriceCents: 1400, confidence: 0.95, flags: [] },
    { name: "PAPAYA-TAVUK", qty: 1, totalPriceCents: 900, confidence: 0.95, flags: [] },
    { name: "PAPAYA-BIFTEK", qty: 1, totalPriceCents: 1400, confidence: 0.95, flags: [] },
    { name: "BURITTOS-TAVUK", qty: 1, totalPriceCents: 900, confidence: 0.95, flags: [] },
    { name: "HARDTACO-TAVUK", qty: 1, totalPriceCents: 1000, confidence: 0.95, flags: [] },
  ],
  charges: {
    subtotalCents: 5600,
    taxCents: 0,
    serviceChargeCents: 0,
    discountCents: 560,
    tipCents: 0,
    totalCents: 5040,
    taxIncludedInItems: true,
  },
};

const input: AnalyzeInput = { imageBase64: "x", mimeType: "image/png", hints: { locale: "tr-TR" } };

describe("Gerçek fiş: Perkins (indirimli, KDV dahil)", () => {
  it("hat fişi dengeli analiz eder (Net 50,40)", () => {
    const a = analyzeRaw(PERKINS, input);
    expect(a.meta.currency).toBe("TRY");
    expect(a.regional.country).toBe("TR");
    expect(a.arithmetic.balanced).toBe(true);
    expect(a.arithmetic.discrepancyCents).toBe(0);
    expect(a.needsConfirmation).toHaveLength(0);
    expect(a.receipt.lineItems).toHaveLength(5);
  });

  it("motor indirimi oransal düşer ve toplam tam 50,40 olur", () => {
    const a = analyzeRaw(PERKINS, input);
    const split = computeSplit({
      receipt: a.receipt,
      people: [
        { id: "emir", name: "Emir" },
        { id: "arkadas", name: "Arkadaş" },
      ],
      // Emir: ilk üç kalem (37,00) · Arkadaş: son iki kalem (19,00)
      assignments: [
        { lineItemId: "li_0", personId: "emir" },
        { lineItemId: "li_1", personId: "emir" },
        { lineItemId: "li_2", personId: "emir" },
        { lineItemId: "li_3", personId: "arkadas" },
        { lineItemId: "li_4", personId: "arkadas" },
      ],
    });

    expect(split.totalCents).toBe(5040);
    expect(sumCents(split.perPerson.map((s) => s.totalCents))).toBe(5040);

    const byId = Object.fromEntries(split.perPerson.map((s) => [s.personId, s.totalCents]));
    // İndirim oransal: Emir 3700 − %10, Arkadaş 1900 − %10 → 3330 + 1710 = 5040
    expect(byId.emir).toBe(3330);
    expect(byId.arkadas).toBe(1710);
  });
});
