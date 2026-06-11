/**
 * MockProvider — anahtar/ağ gerektirmeden tüm orkestrasyon hattını test etmek için.
 * Varsayılan olarak DESIGN.md §4 doğrulanmış örneğini (KDV dahil, 43,00) döndürür.
 */
import type { VisionProvider } from "../provider.js";
import type { AnalyzeInput } from "../types.js";
import type { RawOcrResult } from "../schema.js";

export const SAMPLE_RECEIPT: RawOcrResult = {
  meta: {
    merchant: "Örnek Restoran",
    date: "2026-06-09",
    currency: "TRY",
    locale: "tr-TR",
    language: "tr",
    currencyConfidence: 0.98,
  },
  lineItems: [
    { name: "Steak", qty: 1, totalPriceCents: 2500, confidence: 0.97, flags: [] },
    { name: "Salata", qty: 1, totalPriceCents: 800, confidence: 0.95, flags: [] },
    { name: "Paylaşılan meze", qty: 1, totalPriceCents: 1000, confidence: 0.9, flags: [] },
  ],
  charges: {
    subtotalCents: 4300,
    taxCents: 0,
    serviceChargeCents: 0,
    discountCents: 0,
    tipCents: 0,
    totalCents: 4300,
    taxIncludedInItems: true,
  },
};

export class MockProvider implements VisionProvider {
  readonly name = "mock";
  constructor(private readonly result: unknown = SAMPLE_RECEIPT) {}

  async analyze(_input: AnalyzeInput): Promise<unknown> {
    return this.result;
  }
}
