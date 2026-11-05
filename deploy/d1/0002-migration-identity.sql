-- Dedicated world-store identity and atomic first-import guard, never a paid ledger.
CREATE TABLE IF NOT EXISTS storage_identity (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), database_uuid TEXT NOT NULL,
  binding_nonce TEXT NOT NULL, installed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_guards (
  migration_id TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK(accepted=1)
);
