import * as SQLite from "expo-sqlite";
import { parseSplitState } from "./schema";
import { MIGRATION_V1 } from "./migrations";
import type { HistoryStore } from "./store";
import type { ReceiptSummary, SavedReceipt } from "./types";
import { MAX_RECEIPTS } from "./types";

const DB_NAME = "ahb-receipt-history.db";

type SummaryRow = {
  id: string;
  status: string;
  title: string;
  currency: string;
  currency_code: string | null;
  grand_total_cents: number;
  person_count: number;
  item_count: number;
  last_step: number;
  equal_split: number;
  merchant: string | null;
  purchased_at: string | null;
  image_hash: string | null;
  balanced: number | null;
  created_at: string;
  updated_at: string;
  shared_at: string | null;
};

type PayloadRow = {
  state_json: string;
  share_text: string | null;
};

function rowToSummary(row: SummaryRow): ReceiptSummary {
  return {
    id: row.id,
    status: row.status as ReceiptSummary["status"],
    title: row.title,
    currency: row.currency,
    currencyCode: row.currency_code ?? undefined,
    grandTotalCents: row.grand_total_cents,
    personCount: row.person_count,
    itemCount: row.item_count,
    lastStep: row.last_step as ReceiptSummary["lastStep"],
    equalSplit: row.equal_split === 1,
    merchant: row.merchant ?? undefined,
    purchasedAt: row.purchased_at ?? undefined,
    imageHash: row.image_hash ?? undefined,
    balanced: row.balanced == null ? undefined : row.balanced === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sharedAt: row.shared_at ?? undefined,
  };
}

export class SqliteHistoryStore implements HistoryStore {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async open(): Promise<SqliteHistoryStore> {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync(MIGRATION_V1);
    await db.execAsync("PRAGMA foreign_keys = ON;");
    return new SqliteHistoryStore(db);
  }

  async listSummaries(): Promise<ReceiptSummary[]> {
    const rows = await this.db.getAllAsync<SummaryRow>(
      `SELECT * FROM receipt_summary ORDER BY updated_at DESC LIMIT ?`,
      MAX_RECEIPTS,
    );
    return rows.map(rowToSummary);
  }

  async load(id: string): Promise<SavedReceipt | null> {
    const summaryRow = await this.db.getFirstAsync<SummaryRow>(
      `SELECT * FROM receipt_summary WHERE id = ?`,
      id,
    );
    if (!summaryRow) return null;

    const payloadRow = await this.db.getFirstAsync<PayloadRow>(
      `SELECT state_json, share_text FROM receipt_payload WHERE id = ?`,
      id,
    );
    if (!payloadRow) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadRow.state_json);
    } catch {
      return null;
    }
    const state = parseSplitState(parsed);
    if (!state) return null;

    const summary = rowToSummary(summaryRow);
    return {
      ...summary,
      state,
      shareText: payloadRow.share_text ?? undefined,
    };
  }

  async upsert(receipt: SavedReceipt): Promise<void> {
    const stateJson = JSON.stringify(receipt.state);
    await this.db.runAsync("BEGIN IMMEDIATE;");
    try {
      await this.db.runAsync(
        `INSERT INTO receipt_summary (
          id, status, title, currency, currency_code,
          grand_total_cents, person_count, item_count, last_step, equal_split,
          merchant, purchased_at, image_hash, balanced,
          created_at, updated_at, shared_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          title = excluded.title,
          currency = excluded.currency,
          currency_code = excluded.currency_code,
          grand_total_cents = excluded.grand_total_cents,
          person_count = excluded.person_count,
          item_count = excluded.item_count,
          last_step = excluded.last_step,
          equal_split = excluded.equal_split,
          merchant = excluded.merchant,
          purchased_at = excluded.purchased_at,
          image_hash = excluded.image_hash,
          balanced = excluded.balanced,
          updated_at = excluded.updated_at,
          shared_at = excluded.shared_at`,
        [
          receipt.id,
          receipt.status,
          receipt.title,
          receipt.currency,
          receipt.currencyCode ?? null,
          receipt.grandTotalCents,
          receipt.personCount,
          receipt.itemCount,
          receipt.lastStep,
          receipt.equalSplit ? 1 : 0,
          receipt.merchant ?? null,
          receipt.purchasedAt ?? null,
          receipt.imageHash ?? null,
          receipt.balanced == null ? null : receipt.balanced ? 1 : 0,
          receipt.createdAt,
          receipt.updatedAt,
          receipt.sharedAt ?? null,
        ],
      );

      await this.db.runAsync(
        `INSERT INTO receipt_payload (id, state_json, share_text)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json,
           share_text = excluded.share_text`,
        [receipt.id, stateJson, receipt.shareText ?? null],
      );

      await this.db.runAsync(
        `DELETE FROM receipt_summary WHERE id NOT IN (
           SELECT id FROM receipt_summary ORDER BY updated_at DESC LIMIT ?
         )`,
        MAX_RECEIPTS,
      );

      await this.db.runAsync("COMMIT;");
    } catch (err) {
      await this.db.runAsync("ROLLBACK;");
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM receipt_summary WHERE id = ?`, id);
  }

  async clear(): Promise<void> {
    await this.db.runAsync(`DELETE FROM receipt_payload`);
    await this.db.runAsync(`DELETE FROM receipt_summary`);
  }

  async findByImageHash(hash: string): Promise<ReceiptSummary | null> {
    if (!hash) return null;
    const row = await this.db.getFirstAsync<SummaryRow>(
      `SELECT * FROM receipt_summary WHERE image_hash = ? ORDER BY updated_at DESC LIMIT 1`,
      hash,
    );
    return row ? rowToSummary(row) : null;
  }
}

let storePromise: Promise<HistoryStore> | null = null;

/** Lazy singleton — uygulama yaşam döngüsünde bir kez açılır. */
export function getHistoryStore(): Promise<HistoryStore> {
  if (!storePromise) {
    storePromise = SqliteHistoryStore.open();
  }
  return storePromise;
}

/** Testlerde bellek store'a geçmek için. */
export function setHistoryStoreForTests(store: HistoryStore | null): void {
  storePromise = store ? Promise.resolve(store) : null;
}
