import type { ReceiptSummary, SavedReceipt } from "./types";

export interface HistoryStore {
  listSummaries(): Promise<ReceiptSummary[]>;
  load(id: string): Promise<SavedReceipt | null>;
  upsert(receipt: SavedReceipt): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  findByImageHash(hash: string): Promise<ReceiptSummary | null>;
}
