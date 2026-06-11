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
});
