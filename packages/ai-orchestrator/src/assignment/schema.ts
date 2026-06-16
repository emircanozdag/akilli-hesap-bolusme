import { z } from "zod";

export const suggestItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  qty: z.number().int().positive(),
});

export const suggestPersonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const suggestInputSchema = z.object({
  items: z.array(suggestItemSchema).min(1),
  people: z.array(suggestPersonSchema).min(1),
  hint: z.string().optional(),
  locale: z.string().optional(),
});

export const rawAssignmentRowSchema = z.object({
  lineItemId: z.string().min(1),
  personNames: z.array(z.string().min(1)).min(1),
  weights: z.array(z.number().positive()).optional(),
});

export const rawSuggestionSchema = z.object({
  assignments: z.array(rawAssignmentRowSchema),
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
});

export type SuggestInputParsed = z.infer<typeof suggestInputSchema>;
export type RawSuggestionParsed = z.infer<typeof rawSuggestionSchema>;

/** Gemini responseSchema — rawSuggestionSchema ile uyumlu. */
export const geminiAssignmentResponseSchema = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lineItemId: { type: "string", description: "Kalem id (girdideki id alanı)" },
          personNames: {
            type: "array",
            items: { type: "string" },
            description: "Bu kalemi alan kişilerin tam isimleri",
          },
          weights: {
            type: "array",
            items: { type: "number" },
            description: "Opsiyonel pay/adet; personNames ile aynı sırada",
          },
        },
        required: ["lineItemId", "personNames"],
      },
    },
    confidence: { type: "number", description: "0-1 genel güven" },
    notes: { type: "string" },
  },
  required: ["assignments", "confidence"],
} as const;
