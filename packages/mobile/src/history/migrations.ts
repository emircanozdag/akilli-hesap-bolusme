export const MIGRATION_V1 = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS receipt_summary (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  currency TEXT NOT NULL,
  currency_code TEXT,
  grand_total_cents INTEGER NOT NULL,
  person_count INTEGER NOT NULL,
  item_count INTEGER NOT NULL,
  last_step INTEGER NOT NULL,
  equal_split INTEGER NOT NULL DEFAULT 0,
  merchant TEXT,
  purchased_at TEXT,
  image_hash TEXT,
  balanced INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  shared_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_summary_updated ON receipt_summary(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_summary_image_hash ON receipt_summary(image_hash);

CREATE TABLE IF NOT EXISTS receipt_payload (
  id TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL,
  share_text TEXT,
  FOREIGN KEY(id) REFERENCES receipt_summary(id) ON DELETE CASCADE
);
`;
