import type { AnalyzedReceipt } from "@ahb/ai-orchestrator";
import type { SplitState } from "../logic";
import type { HistoryStore } from "./store";
import type { ReceiptStatus, ReceiptStep } from "./types";
import { AUTOSAVE_DEBOUNCE_MS } from "./types";
import {
  buildSavedReceipt,
  isPayloadTooLarge,
  newReceiptId,
  shouldPersistState,
  snapshotForDirtyCheck,
} from "./serialize";

export interface AutosaveParams {
  id: string | null;
  state: SplitState;
  lastStep: ReceiptStep;
  equalSplit: boolean;
  status: ReceiptStatus;
  analysis?: AnalyzedReceipt | null;
  imageHash?: string;
  shareText?: string;
  createdAt?: string;
  sharedAt?: string;
}

export interface ReceiptAutosaveOptions {
  debounceMs?: number;
  onError?: (error: Error) => void;
  onIdAssigned?: (id: string) => void;
}

/** Debounced autosave — React'ten bağımsız, test edilebilir. */
export class ReceiptAutosave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshot = "";
  private pending: AutosaveParams | null = null;
  private createdAtById = new Map<string, string>();

  constructor(
    private readonly store: HistoryStore,
    private readonly options: ReceiptAutosaveOptions = {},
  ) {}

  schedule(params: AutosaveParams): void {
    if (!shouldPersistState(params.state)) return;
    this.pending = params;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  /** Anında kaydet; yeni kayıt id'sini döner (kaydedilmediyse null). */
  async flush(): Promise<string | null> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const params = this.pending;
    if (!params || !shouldPersistState(params.state)) return null;

    const snapshot = snapshotForDirtyCheck(params);
    if (snapshot === this.lastSnapshot && params.id) return params.id;

    if (isPayloadTooLarge(params.state)) {
      this.options.onError?.(
        new Error("Fiş verisi çok büyük; geçmişe kaydedilemedi."),
      );
      return null;
    }

    const id = params.id ?? newReceiptId();
    const createdAt =
      params.createdAt ??
      (params.id ? this.createdAtById.get(params.id) : undefined) ??
      new Date().toISOString();
    this.createdAtById.set(id, createdAt);

    const receipt = buildSavedReceipt({
      ...params,
      id,
      createdAt,
      updatedAt: new Date().toISOString(),
      sharedAt:
        params.status === "shared"
          ? (params.sharedAt ?? new Date().toISOString())
          : params.sharedAt,
    });

    try {
      await this.store.upsert(receipt);
      this.lastSnapshot = snapshot;
      if (!params.id) this.options.onIdAssigned?.(id);
      this.pending = { ...params, id };
      return id;
    } catch (err) {
      this.options.onError?.(
        err instanceof Error ? err : new Error("Geçmiş kaydedilemedi"),
      );
      return null;
    }
  }

  resetSnapshot(): void {
    this.lastSnapshot = "";
    this.pending = null;
  }
}
