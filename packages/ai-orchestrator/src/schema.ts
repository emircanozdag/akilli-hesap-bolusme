/**
 * Vision-LLM'in döndürmesi gereken HAM OCR şeması — DESIGN.md §5/§7.
 *
 * Sözleşme: tüm tutarlar KURUŞ (integer); model uydurma yapmaz, hesap yapmaz,
 * her kaleme confidence verir, yalnızca bu şemaya uyan JSON üretir.
 * zod ile doğrulanır → şema dışına çıkış orkestrasyonda reddedilir.
 */
import { z } from "zod";

const centsInt = z
  .number()
  .int("Tutarlar kuruş (tam sayı) olmalı")
  .describe("Kuruş cinsinden tam sayı tutar (ör. 1999 = 19,99)");

const confidence = z.number().min(0).max(1);

export const rawLineItemSchema = z.object({
  name: z.string().min(1),
  qty: z.number().positive().default(1),
  unitPriceCents: centsInt.optional(),
  totalPriceCents: centsInt,
  category: z.string().optional(),
  confidence: confidence.default(1),
  rawText: z.string().optional(),
  flags: z.array(z.string()).default([]),
});

export const rawChargesSchema = z.object({
  subtotalCents: centsInt,
  taxCents: centsInt.default(0),
  serviceChargeCents: centsInt.default(0),
  discountCents: centsInt.default(0),
  tipCents: centsInt.default(0),
  totalCents: centsInt,
  /** KDV kalem fiyatlarına dahil mi? Model fiş üzerinden tespit eder. */
  taxIncludedInItems: z.boolean().default(false),
});

export const rawMetaSchema = z.object({
  merchant: z.string().optional(),
  /** ISO tarih (YYYY-MM-DD) ya da fişteki ham tarih. */
  date: z.string().optional(),
  /** ISO 4217 (ör. TRY, USD, EUR). */
  currency: z.string().optional(),
  /** BCP-47 (ör. tr-TR, en-US). */
  locale: z.string().optional(),
  language: z.string().optional(),
  currencyConfidence: confidence.default(1),
});

export const rawOcrResultSchema = z.object({
  meta: rawMetaSchema,
  lineItems: z.array(rawLineItemSchema).min(1, "En az bir kalem olmalı"),
  charges: rawChargesSchema,
});

export type RawLineItem = z.infer<typeof rawLineItemSchema>;
export type RawCharges = z.infer<typeof rawChargesSchema>;
export type RawMeta = z.infer<typeof rawMetaSchema>;
export type RawOcrResult = z.infer<typeof rawOcrResultSchema>;

/**
 * Gemini `responseSchema` (JSON mode) için sade şema tanımı.
 * SDK'ya bağımlı kalmamak için düz nesne olarak veriyoruz.
 */
export const geminiResponseSchema = {
  type: "object",
  properties: {
    meta: {
      type: "object",
      properties: {
        merchant: { type: "string" },
        date: { type: "string" },
        currency: { type: "string", description: "ISO 4217, ör. TRY/USD/EUR" },
        locale: { type: "string", description: "BCP-47, ör. tr-TR" },
        language: { type: "string" },
        currencyConfidence: { type: "number" },
      },
      required: ["currency"],
    },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: "number" },
          unitPriceCents: { type: "integer" },
          totalPriceCents: { type: "integer" },
          category: { type: "string" },
          confidence: { type: "number" },
          rawText: { type: "string" },
          flags: { type: "array", items: { type: "string" } },
        },
        required: ["name", "totalPriceCents", "confidence"],
      },
    },
    charges: {
      type: "object",
      properties: {
        subtotalCents: { type: "integer" },
        taxCents: { type: "integer" },
        serviceChargeCents: { type: "integer" },
        discountCents: { type: "integer" },
        tipCents: { type: "integer" },
        totalCents: { type: "integer" },
        taxIncludedInItems: { type: "boolean" },
      },
      required: ["subtotalCents", "totalCents"],
    },
  },
  required: ["meta", "lineItems", "charges"],
} as const;
