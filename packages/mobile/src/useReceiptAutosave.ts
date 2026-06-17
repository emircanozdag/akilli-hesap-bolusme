import { useCallback, useEffect, useRef } from "react";
import type { AnalyzedReceipt } from "@ahb/ai-orchestrator";
import type { SplitState } from "./logic";
import type { HistoryStore } from "./history/store";
import type { ReceiptStatus, ReceiptStep } from "./history/types";
import { ReceiptAutosave } from "./history/autosave";

export interface UseReceiptAutosaveParams {
  store: HistoryStore | null;
  activeReceiptId: string | null;
  state: SplitState;
  step: ReceiptStep;
  equalSplit: boolean;
  status: ReceiptStatus;
  analysis: AnalyzedReceipt | null;
  imageHash?: string;
  shareText?: string;
  createdAt?: string;
  onIdAssigned: (id: string) => void;
}

export function useReceiptAutosave(params: UseReceiptAutosaveParams) {
  const autosaveRef = useRef<ReceiptAutosave | null>(null);

  useEffect(() => {
    if (!params.store) return;
    autosaveRef.current = new ReceiptAutosave(params.store, {
      onIdAssigned: params.onIdAssigned,
      onError: (err) => {
        if (typeof __DEV__ !== "undefined" && __DEV__) {
          console.warn("[ahb] history autosave", err.message);
        }
      },
    });
    return () => {
      autosaveRef.current?.cancel();
      autosaveRef.current = null;
    };
  }, [params.store, params.onIdAssigned]);

  const schedule = useCallback(() => {
    autosaveRef.current?.schedule({
      id: params.activeReceiptId,
      state: params.state,
      lastStep: params.step,
      equalSplit: params.equalSplit,
      status: params.status,
      analysis: params.analysis,
      imageHash: params.imageHash,
      shareText: params.shareText,
      createdAt: params.createdAt,
    });
  }, [
    params.activeReceiptId,
    params.state,
    params.step,
    params.equalSplit,
    params.status,
    params.analysis,
    params.imageHash,
    params.shareText,
    params.createdAt,
  ]);

  useEffect(() => {
    schedule();
  }, [schedule]);

  const flush = useCallback(async () => {
    return autosaveRef.current?.flush() ?? null;
  }, []);

  const resetSnapshot = useCallback(() => {
    autosaveRef.current?.resetSnapshot();
  }, []);

  return { flush, resetSnapshot };
}
