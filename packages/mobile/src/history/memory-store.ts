import type { ReceiptSummary, SavedReceipt } from "./types";
import { MAX_RECEIPTS } from "./types";
import type { HistoryStore } from "./store";

/** Vitest ve saf-TS testleri için bellek içi HistoryStore. */
export class MemoryHistoryStore implements HistoryStore {
  private readonly summaries = new Map<string, ReceiptSummary>();
  private readonly payloads = new Map<string, { state: SavedReceipt["state"]; shareText?: string }>();

  async listSummaries(): Promise<ReceiptSummary[]> {
    return [...this.summaries.values()].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  }

  async load(id: string): Promise<SavedReceipt | null> {
    const summary = this.summaries.get(id);
    const payload = this.payloads.get(id);
    if (!summary || !payload) return null;
    return { ...summary, state: payload.state, shareText: payload.shareText };
  }

  async upsert(receipt: SavedReceipt): Promise<void> {
    const { state, shareText, ...summary } = receipt;
    this.summaries.set(receipt.id, { ...summary });
    this.payloads.set(receipt.id, { state, shareText });
    await this.trimLru();
  }

  async remove(id: string): Promise<void> {
    this.summaries.delete(id);
    this.payloads.delete(id);
  }

  async clear(): Promise<void> {
    this.summaries.clear();
    this.payloads.clear();
  }

  async findByImageHash(hash: string): Promise<ReceiptSummary | null> {
    if (!hash) return null;
    for (const s of this.summaries.values()) {
      if (s.imageHash === hash) return s;
    }
    return null;
  }

  private async trimLru(): Promise<void> {
    if (this.summaries.size <= MAX_RECEIPTS) return;
    const ordered = await this.listSummaries();
    for (const row of ordered.slice(MAX_RECEIPTS)) {
      await this.remove(row.id);
    }
  }
}
