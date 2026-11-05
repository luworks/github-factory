-- Public world snapshots only. Paid ledgers and admission quotas never enter D1.
CREATE TABLE IF NOT EXISTS worlds (
  repo TEXT PRIMARY KEY,
  snapshot TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'runtime'
);
CREATE TABLE IF NOT EXISTS world_aliases (alias TEXT PRIMARY KEY, canonical TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, sql_sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS storage_provenance (
  migration_id TEXT PRIMARY KEY, source_backend TEXT NOT NULL, source_head TEXT NOT NULL,
  source_rows INTEGER NOT NULL, source_aliases INTEGER NOT NULL, source_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_sentinels (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
