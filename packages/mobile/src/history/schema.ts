import { z } from "zod";
import type { SplitState } from "../logic";
import type { ReceiptSummary } from "./types";

const itemRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.string(),
  qty: z.number(),
});

const personRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

const taxStateSchema = z.object({
  included: z.boolean(),
  value: z.string(),
});

const tipStateSchema = z.object({
  mode: z.enum(["proportional", "equal"]),
  isPercent: z.boolean(),
  value: z.string(),
});

export const splitStateSchema = z.object({
  currency: z.string(),
  items: z.array(itemRowSchema),
  people: z.array(personRowSchema),
  assignments: z.record(z.record(z.number())),
  tax: taxStateSchema,
  tip: tipStateSchema,
  discountCents: z.number().int(),
});

export const receiptStatusSchema = z.enum(["draft", "confirmed", "shared"]);
export const receiptStepSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const receiptSummarySchema = z.object({
  id: z.string().min(1),
  status: receiptStatusSchema,
  title: z.string(),
  currency: z.string(),
  currencyCode: z.string().optional(),
  grandTotalCents: z.number().int(),
  personCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  lastStep: receiptStepSchema,
  equalSplit: z.boolean(),
  merchant: z.string().optional(),
  purchasedAt: z.string().optional(),
  imageHash: z.string().optional(),
  balanced: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sharedAt: z.string().optional(),
});

export function parseSplitState(raw: unknown): SplitState | null {
  const parsed = splitStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseReceiptSummary(raw: unknown): ReceiptSummary | null {
  const parsed = receiptSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
