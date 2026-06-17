import type { SplitState } from "../logic";

export type ReceiptStatus = "draft" | "confirmed" | "shared";
export type ReceiptStep = 0 | 1 | 2 | 3 | 4;

/** Liste ekranı — hafif özet (payload yok). */
export interface ReceiptSummary {
  id: string;
  status: ReceiptStatus;
  title: string;
  currency: string;
  currencyCode?: string;
  grandTotalCents: number;
  personCount: number;
  itemCount: number;
  lastStep: ReceiptStep;
  equalSplit: boolean;
  merchant?: string;
  purchasedAt?: string;
  imageHash?: string;
  balanced?: boolean;
  createdAt: string;
  updatedAt: string;
  sharedAt?: string;
}

/** Tam kayıt — payload dahil. */
export interface SavedReceipt extends ReceiptSummary {
  state: SplitState;
  shareText?: string;
}

export const MAX_RECEIPTS = 50;
export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const AUTOSAVE_DEBOUNCE_MS = 800;
