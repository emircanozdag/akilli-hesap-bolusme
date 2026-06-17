import type { AnalyzedReceipt } from "@ahb/ai-orchestrator";
import { computeFromState, type SplitState } from "../logic";
import type { ReceiptStatus, ReceiptStep, SavedReceipt } from "./types";
import { MAX_PAYLOAD_BYTES } from "./types";

export interface BuildSavedReceiptParams {
  id: string;
  state: SplitState;
  lastStep: ReceiptStep;
  equalSplit: boolean;
  status: ReceiptStatus;
  analysis?: AnalyzedReceipt | null;
  imageHash?: string;
  shareText?: string;
  createdAt?: string;
  updatedAt?: string;
  sharedAt?: string;
}

export function newReceiptId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rcpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveTitle(
  state: SplitState,
  analysis?: AnalyzedReceipt | null,
): string {
  const merchant = analysis?.meta.merchant?.trim();
  if (merchant) return merchant;
  const first = state.items.find((it) => it.name.trim())?.name.trim();
  if (first) return first;
  return "Fiş";
}

/** Autosave dirty-check için kararlı JSON snapshot. */
export function snapshotForDirtyCheck(input: {
  state: SplitState;
  lastStep: ReceiptStep;
  equalSplit: boolean;
  status: ReceiptStatus;
  shareText?: string;
  imageHash?: string;
}): string {
  return JSON.stringify({
    state: input.state,
    lastStep: input.lastStep,
    equalSplit: input.equalSplit,
    status: input.status,
    shareText: input.shareText ?? "",
    imageHash: input.imageHash ?? "",
  });
}

export function stateJsonByteLength(state: SplitState): number {
  return new TextEncoder().encode(JSON.stringify(state)).byteLength;
}

export function isPayloadTooLarge(state: SplitState): boolean {
  return stateJsonByteLength(state) > MAX_PAYLOAD_BYTES;
}

export function buildSavedReceipt(params: BuildSavedReceiptParams): SavedReceipt {
  const now = new Date().toISOString();
  const computed = computeFromState(params.state);
  const createdAt = params.createdAt ?? now;
  const updatedAt = params.updatedAt ?? now;

  return {
    id: params.id,
    status: params.status,
    title: resolveTitle(params.state, params.analysis),
    currency: params.state.currency,
    currencyCode: params.analysis?.meta.currency,
    grandTotalCents: computed?.grandTotalCents ?? 0,
    personCount: params.state.people.length,
    itemCount: params.state.items.length,
    lastStep: params.lastStep,
    equalSplit: params.equalSplit,
    merchant: params.analysis?.meta.merchant,
    purchasedAt: params.analysis?.meta.date,
    imageHash: params.imageHash,
    balanced: params.analysis?.arithmetic.balanced,
    createdAt,
    updatedAt,
    sharedAt: params.sharedAt,
    state: params.state,
    shareText: params.shareText,
  };
}

/** Kayda değer oturum: en az bir kalem var. */
export function shouldPersistState(state: SplitState): boolean {
  return state.items.length > 0;
}
