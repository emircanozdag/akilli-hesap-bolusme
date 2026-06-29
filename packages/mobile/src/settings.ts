/**
 * Uygulama tercihleri — expo-sqlite ile kalıcı anahtar-değer deposu.
 * Gizlilik onayı, rıza tarihi vb. saklar.
 */
import * as SQLite from "expo-sqlite";

const DB_NAME = "ahb-settings.db";

let _db: SQLite.SQLiteDatabase | null = null;

async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  );
  _db = db;
  return db;
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await openDb();
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
}

// ---------------------------------------------------------------------------
// Gizlilik rızası yardımcıları
// ---------------------------------------------------------------------------

const PRIVACY_KEY = "privacy_consent_v1";

export async function hasPrivacyConsent(): Promise<boolean> {
  const val = await getSetting(PRIVACY_KEY);
  return val === "1";
}

export async function acceptPrivacyConsent(): Promise<void> {
  await setSetting(PRIVACY_KEY, "1");
}
