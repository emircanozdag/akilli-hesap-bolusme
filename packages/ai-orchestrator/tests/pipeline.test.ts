import { describe, it, expect } from "vitest";
import { computeSplit } from "@ahb/split-engine";
import {
  orchestrate,
  analyzeRaw,
  OrchestrationError,
  MockProvider,
  SAMPLE_RECEIPT,
} from "../src/index.js";
import type { AnalyzeInput } from "../src/types.js";

const input: AnalyzeInput = { imageBase64: "x", mimeType: "image/jpeg" };

describe("orchestrate — MockProvider ile uçtan uca (anahtarsız)", () => {
  it("doğrulanmış örneği analiz edip motora besler → 47.30", async () => {
    const analyzed = await orchestrate(new MockProvider(), input);

    expect(analyzed.meta.currency).toBe("TRY");
    expect(analyzed.receipt.lineItems).toHaveLength(3);
    expect(analyzed.arithmetic.balanced).toBe(true);
    expect(analyzed.needsConfirmation).toHaveLength(0);

    // Çıktı doğrudan @ahb/split-engine'e verilebilir.
    const split = computeSplit({
      receipt: analyzed.receipt,
      people: [
        { id: "ali", name: "Ali" },
        { id: "ayse", name: "Ayşe" },
        { id: "mehmet", name: "Mehmet" },
      ],
      assignments: [
        { lineItemId: "li_0", personId: "ali" },
        { lineItemId: "li_1", personId: "ayse" },
        { lineItemId: "li_2", personId: "ali" },
        { lineItemId: "li_2", personId: "ayse" },
        { lineItemId: "li_2", personId: "mehmet" },
      ],
      tipOverrideCents: 430,
      tipMode: "proportional",
    });
    expect(split.totalCents).toBe(4730);
  });

  it("TR locale → bahşiş isteğe bağlı", async () => {
    const analyzed = await orchestrate(new MockProvider(), input);
    expect(analyzed.regional.country).toBe("TR");
    expect(analyzed.regional.tippingNorm).toBe("optional");
  });
});

describe("analyzeRaw — şema doğrulama", () => {
  it("geçersiz şemayı reddeder", () => {
    expect(() => analyzeRaw({ foo: "bar" }, input)).toThrowError(OrchestrationError);
  });

  it("float tutarı (kuruş-int değil) reddeder", () => {
    const bad = structuredClone(SAMPLE_RECEIPT) as Record<string, unknown>;
    (bad.lineItems as { totalPriceCents: number }[])[0]!.totalPriceCents = 25.5;
    expect(() => analyzeRaw(bad, input)).toThrowError(OrchestrationError);
  });
});

describe("analyzeRaw — aritmetik & confidence flag'leri (§7)", () => {
  it("dengesiz toplamı flag'ler ve onaya düşer", () => {
    const r = analyzeRaw(
      {
        meta: { currency: "USD", locale: "en-US", currencyConfidence: 0.99 },
        lineItems: [{ name: "Burger", totalPriceCents: 1000, confidence: 0.95 }],
        charges: { subtotalCents: 1000, totalCents: 1200, taxIncludedInItems: true },
      },
      input,
    );
    expect(r.arithmetic.balanced).toBe(false);
    expect(r.arithmetic.discrepancyCents).toBe(200);
    expect(r.needsConfirmation).toContain("total");
    expect(r.flags.some((f) => f.reason === "unbalanced_total")).toBe(true);
  });

  it("düşük confidence kalemi flag'ler", () => {
    const r = analyzeRaw(
      {
        meta: { currency: "EUR", locale: "de-DE", currencyConfidence: 0.99 },
        lineItems: [{ name: "?", totalPriceCents: 500, confidence: 0.3 }],
        charges: { subtotalCents: 500, totalCents: 500, taxIncludedInItems: true },
      },
      input,
    );
    expect(r.flags.some((f) => f.reason === "low_confidence")).toBe(true);
    expect(r.regional.tippingNorm).toBe("included"); // DE
  });

  it("para birimi belirsizse onaya düşer", () => {
    const r = analyzeRaw(
      {
        meta: { currency: "TRY", currencyConfidence: 0.2 },
        lineItems: [{ name: "X", totalPriceCents: 100, confidence: 0.9 }],
        charges: { subtotalCents: 100, totalCents: 100, taxIncludedInItems: true },
      },
      input,
    );
    expect(r.needsConfirmation).toContain("currency");
  });

  it("qty × birim ≠ toplam çapraz kontrolünü flag'ler", () => {
    const r = analyzeRaw(
      {
        meta: { currency: "USD", locale: "en-US", currencyConfidence: 0.99 },
        lineItems: [
          { name: "Kola", qty: 2, unitPriceCents: 300, totalPriceCents: 500, confidence: 0.9 },
        ],
        charges: { subtotalCents: 500, totalCents: 500, taxIncludedInItems: true },
      },
      input,
    );
    expect(r.flags.some((f) => f.reason === "qty_price_mismatch")).toBe(true);
  });

  it("KDV ayrı (dahil değil) toplamı doğru dengeler", () => {
    const r = analyzeRaw(
      {
        meta: { currency: "USD", locale: "en-US", currencyConfidence: 0.99 },
        lineItems: [{ name: "Steak", totalPriceCents: 1000, confidence: 0.95 }],
        charges: {
          subtotalCents: 1000,
          taxCents: 100,
          tipCents: 180,
          totalCents: 1280,
          taxIncludedInItems: false,
        },
      },
      input,
    );
    expect(r.arithmetic.balanced).toBe(true);
    expect(r.regional.suggestedTipPercentages).toEqual([15, 18, 20]); // US
  });

  it("indirim satırlarını kalemden ayırır — çift indirim olmaz (Gemini/QUICK CHINA)", () => {
    // Gemini tipik hata: Kampanya Indirim negatif kalem + charges.discountCents ikisi birden.
    const r = analyzeRaw(
      {
        meta: { currency: "TRY", locale: "tr-TR", currencyConfidence: 0.9 },
        lineItems: [
          { name: "260.CALIFORNIA ROLL", qty: 1, totalPriceCents: 65000, confidence: 0.9 },
          { name: "Kampanya Indirim", totalPriceCents: -16250, confidence: 0.9 },
          { name: "262.TRUFLU EBI TEN CRISPY ROLL", qty: 1, totalPriceCents: 70000, confidence: 0.9 },
          { name: "Kampanya Indirim", totalPriceCents: -17500, confidence: 0.9 },
          { name: "PIKACHU", qty: 1, totalPriceCents: 29000, confidence: 0.9 },
        ],
        charges: {
          subtotalCents: 164000,
          discountCents: 33750,
          totalCents: 130250,
          taxIncludedInItems: true,
        },
      },
      input,
    );

    const names = r.receipt.lineItems.map((it) => it.name);
    expect(names).not.toContain("Kampanya Indirim");
    expect(r.receipt.charges.discountCents).toBe(33750);
    expect(r.receipt.charges.subtotalCents).toBe(164000);
    expect(r.arithmetic.balanced).toBe(true);

    const split = computeSplit({
      receipt: r.receipt,
      people: [{ id: "p1", name: "Ben" }],
      assignments: r.receipt.lineItems.map((it) => ({ lineItemId: it.id, personId: "p1" })),
    });
    expect(split.totalCents).toBe(130250);
  });

  it("yalnız kalem indirimi (charges.discountCents=0) → discountCents türetilir", () => {
    const r = analyzeRaw(
      {
        meta: { currency: "TRY", currencyConfidence: 0.9 },
        lineItems: [
          { name: "CALIFORNIA ROLL", totalPriceCents: 65000, confidence: 0.9 },
          { name: "Kampanya Indirim", totalPriceCents: -16250, confidence: 0.9 },
          { name: "PIKACHU", totalPriceCents: 29000, confidence: 0.9 },
        ],
        charges: { subtotalCents: 94000, discountCents: 0, totalCents: 77750, taxIncludedInItems: true },
      },
      input,
    );
    expect(r.receipt.lineItems).toHaveLength(2);
    expect(r.receipt.charges.discountCents).toBe(16250);
    expect(r.arithmetic.balanced).toBe(true);
  });

  it("indirim KANITI yokken kalem/toplam farkı indirim sayılmaz (hayalet indirim önlenir)", () => {
    // Ada Balık deseni: fişte indirim satırı yok, kalemler 7650 ama toplam 7410 okunmuş.
    // Eski davranış aradaki 240'ı sessizce indirim sayıyordu → artık 0; dengesizlik onaya düşer.
    const r = analyzeRaw(
      {
        meta: { currency: "TRY", locale: "tr-TR", currencyConfidence: 0.9 },
        lineItems: [
          { name: "ANTİBİYOTİK", qty: 1, totalPriceCents: 30000, confidence: 0.9 },
          { name: "BEYAZ PEYNİR", qty: 2, totalPriceCents: 24000, confidence: 0.9 },
          { name: "DUBLE RAKI", qty: 1, totalPriceCents: 40000, confidence: 0.9 },
        ],
        charges: {
          subtotalCents: 94000,
          discountCents: 0,
          totalCents: 91600,
          taxIncludedInItems: true,
        },
      },
      input,
    );
    expect(r.receipt.charges.discountCents).toBe(0);
    expect(r.arithmetic.balanced).toBe(false);
    expect(r.needsConfirmation).toContain("total");
  });

  it("kalemler toplamı fiş toplamına eşitse indirim üretilmez (kanıt yok, denge tam)", () => {
    const r = analyzeRaw(
      {
        meta: { currency: "TRY", locale: "tr-TR", currencyConfidence: 0.9 },
        lineItems: [
          { name: "ATOM", qty: 1, totalPriceCents: 26000, confidence: 0.9 },
          { name: "ŞALGAM", qty: 1, totalPriceCents: 5000, confidence: 0.9 },
        ],
        charges: {
          subtotalCents: 31000,
          discountCents: 0,
          totalCents: 31000,
          taxIncludedInItems: true,
        },
      },
      input,
    );
    expect(r.receipt.charges.discountCents).toBe(0);
    expect(r.arithmetic.balanced).toBe(true);
  });

  it("Kampanya + SATIR IND çift kaydı → indirim bir kez sayılır (QUICK CHINA)", () => {
    // Gerçek fiş deseni: 3× Kampanya İndirim + altta SATIR IND (aynı toplamın özeti).
    const products = [
      65000, 70000, 78000, 29000, 23000, 16000, 66000, 55000, 39000, 66000,
    ];
    const lineItems = products.flatMap((p, i) => [
      { name: `URUN_${i}`, totalPriceCents: p, confidence: 0.9 },
    ]);
    lineItems.push(
      { name: "Kampanya Indirim", totalPriceCents: -16250, confidence: 0.9 },
      { name: "Kampanya Indirim", totalPriceCents: -17500, confidence: 0.9 },
      { name: "Kampanya Indirim", totalPriceCents: -19500, confidence: 0.9 },
      { name: "SATIR IND", totalPriceCents: -53250, confidence: 0.9 },
    );
    const productSum = products.reduce((a, b) => a + b, 0);
    const r = analyzeRaw(
      {
        meta: { currency: "TRY", currencyConfidence: 0.9 },
        lineItems,
        charges: {
          subtotalCents: productSum,
          discountCents: 106500,
          totalCents: productSum - 53250,
          taxIncludedInItems: true,
        },
      },
      input,
    );
    expect(r.receipt.charges.discountCents).toBe(53250);
    expect(r.arithmetic.balanced).toBe(true);
    expect(r.receipt.lineItems).toHaveLength(products.length);
  });
});
