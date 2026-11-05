import type { HistoryD1Binding } from "./history-storage";
import { captureHash } from "../src/server/world-public-capture-contract";
import type { WorldCaptureIdentity } from "../src/server/world-public-capture-contract";

/** Preserve quoted literals and token boundaries; skip only actual SQL
 * comments outside strings. Marker hashes alone do not certify a schema. */
export function schema4SqlTokens(sql: string): string {
  const tokens: string[] = [];
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i]!)) { i++; continue; }
    if (sql.startsWith("--", i)) { const end = sql.indexOf("\n", i); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith("/*", i)) { const end = sql.indexOf("*/", i + 2); if (end < 0) throw Error(); i = end + 2; continue; }
    if (sql[i] === "'") { const at = i++; for (;;) { if (i >= sql.length) throw Error(); if (sql[i++] === "'") { if (sql[i] === "'") { i++; continue; } break; } } tokens.push(sql.slice(at, i)); continue; }
    const word = sql.slice(i).match(/^[A-Za-z0-9_]+/); if (word) { tokens.push(word[0].toLowerCase()); i += word[0].length; continue; }
    if (/[(),=<>.*-]/.test(sql[i]!)) { tokens.push(sql[i++]!); continue; }
    if (sql[i] === ";" && !sql.slice(i + 1).trim()) break;
    throw Error();
  }
  return JSON.stringify(tokens);
}

// Compiled reviewed migration/table/index pins follow below. No filesystem,
// caller-supplied schema, initializer, repair or SQL application at runtime.
export const WORLD_SCHEMA4_MIGRATIONS = [[1,"c3bdf6ab52a9466d4f6cd89d18c52d13f93c538c4f97a1df4b8e19e55a5229eb"],[2,"5005bea0d822f08c87455cd7b7938067d5973ad5719115c67b79c6970c26ba56"],[3,"6b0f837993b07fee15e7ebf45244b55fa7d9303dfb1ed6a0a885ae0979892994"],[4,"c011a5c579cb0c4555dce94ed14d95c7b7e5849741d3aa6a67058056ac93d965"]] as const;
const pins: Record<string, readonly [string,string,string|null]> = {
  "history_anchors": [
    "table",
    "history_anchors",
    "9d7025a49665d3247bc21b18b15fd8765349f3392206de0b4c0ac4c007c0f1e5"
  ],
  "history_append_guards": [
    "table",
    "history_append_guards",
    "3c96e3830b347484f00d166976ba5d8e8f079b0a45c3a4b8c781e6a5e1ba6b2e"
  ],
  "history_batches": [
    "table",
    "history_batches",
    "244658ba1466c585ca5022044556e090f9530be3c89c7c5fbc2be0e757e00f38"
  ],
  "history_commits": [
    "table",
    "history_commits",
    "10a6352bfbfa84b48653160ea00660ccddd15f09e237ff61eb44fa188c202e28"
  ],
  "history_frame_chunks": [
    "table",
    "history_frame_chunks",
    "ad4fc34c526339330414dc212305dca8014b101d579ba16006c91eb9b7f58c96"
  ],
  "history_frames": [
    "table",
    "history_frames",
    "975d117d8eb9cb057f06e3f7f1c9981ea783314ec7634d7c715d3dc2eac0dd2c"
  ],
  "history_repositories": [
    "table",
    "history_repositories",
    "4c57d50079b69ab93a8750fdbf69adb65a3d53f0ee77f6bfcd5e178905245c8b"
  ],
  "migration_guards": [
    "table",
    "migration_guards",
    "9f364985618adbe5784b8a1f52400a65d668ba811e4cb633b796ed76f5ed896b"
  ],
  "migration_sentinels": [
    "table",
    "migration_sentinels",
    "1c95f93d172e7e397b4093b2d2eae571be566deed3ba10afff6d532d5bfb9838"
  ],
  "schema_migrations": [
    "table",
    "schema_migrations",
    "d9795f3591d9ec60f051e5d9e549cec476c4af1f6c9398ab849e7185bbfd866f"
  ],
  "sqlite_autoindex_history_anchors_1": [
    "index",
    "history_anchors",
    null
  ],
  "sqlite_autoindex_history_anchors_2": [
    "index",
    "history_anchors",
    null
  ],
  "sqlite_autoindex_history_append_guards_1": [
    "index",
    "history_append_guards",
    null
  ],
  "sqlite_autoindex_history_batches_1": [
    "index",
    "history_batches",
    null
  ],
  "sqlite_autoindex_history_batches_2": [
    "index",
    "history_batches",
    null
  ],
  "sqlite_autoindex_history_commits_1": [
    "index",
    "history_commits",
    null
  ],
  "sqlite_autoindex_history_frame_chunks_1": [
    "index",
    "history_frame_chunks",
    null
  ],
  "sqlite_autoindex_history_frames_1": [
    "index",
    "history_frames",
    null
  ],
  "sqlite_autoindex_history_repositories_1": [
    "index",
    "history_repositories",
    null
  ],
  "sqlite_autoindex_migration_guards_1": [
    "index",
    "migration_guards",
    null
  ],
  "sqlite_autoindex_migration_sentinels_1": [
    "index",
    "migration_sentinels",
    null
  ],
  "sqlite_autoindex_storage_provenance_1": [
    "index",
    "storage_provenance",
    null
  ],
  "sqlite_autoindex_world_aliases_1": [
    "index",
    "world_aliases",
    null
  ],
  "sqlite_autoindex_world_capture_barriers_1": [
    "index",
    "world_capture_barriers",
    null
  ],
  "sqlite_autoindex_world_capture_generations_1": [
    "index",
    "world_capture_generations",
    null
  ],
  "sqlite_autoindex_worlds_1": [
    "index",
    "worlds",
    null
  ],
  "storage_identity": [
    "table",
    "storage_identity",
    "66e9d0e3b20ee7907d80d7a7d92c6d7653b0c837a01a68689ab203c09dd2629e"
  ],
  "storage_provenance": [
    "table",
    "storage_provenance",
    "bb799e063b398e29c455e9369f61ae2e9a223905274d6893fdc97a9f022bf481"
  ],
  "world_aliases": [
    "table",
    "world_aliases",
    "a58ada65481ba6fac4e6886c5bd2fa74414575abea2634b1e9bc8fd5644fd932"
  ],
  "world_capture_authority": [
    "table",
    "world_capture_authority",
    "26d4494c0c1ca5dce32958487c66edc108e8b589db2aba8f613db314ff0449fc"
  ],
  "world_capture_barriers": [
    "table",
    "world_capture_barriers",
    "7c192089920270e90fb29c1aa24792d90b825e62fa6579ba1f55f5fa73065bf6"
  ],
  "world_capture_generations": [
    "table",
    "world_capture_generations",
    "33ed083ca3324fc59266dff4afb76ceaf12dd2c45d198b820beac37607450b25"
  ],
  "world_capture_guard": [
    "table",
    "world_capture_guard",
    "8e6b5534797a362267306fbb4125e83fcf094ce3e269534320a3d0a18115fe4e"
  ],
  "worlds": [
    "table",
    "worlds",
    "ae042307311f880b93139a52b224f558040f17f6e5374a9d131025ebf80cfb08"
  ]
};
export class Schema4Unavailable extends Error { constructor() { super("Compatible world storage schema is unavailable."); } }
export async function assertStorageSchema4(db: HistoryD1Binding, identity: WorldCaptureIdentity) {
  try {
    const markers = await db.prepare("SELECT version,applied_at,sql_sha256 FROM schema_migrations ORDER BY version LIMIT 5").all<{ version: number; applied_at: string; sql_sha256: string }>();
    if (!markers.success || !Array.isArray(markers.results) || markers.results.length !== 4 || markers.results.some((m, i) => m.version !== WORLD_SCHEMA4_MIGRATIONS[i]![0] || m.sql_sha256 !== WORLD_SCHEMA4_MIGRATIONS[i]![1] || typeof m.applied_at !== "string" || m.applied_at.length > 64 || !Number.isFinite(Date.parse(m.applied_at)))) throw Error();
    const foreign = await db.prepare("PRAGMA foreign_keys").first<{ foreign_keys: number }>(); if (foreign?.foreign_keys !== 1) throw Error();
    const schema = await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' OR type='index' ORDER BY name LIMIT 35").all<{ type: string; name: string; tbl_name: string; sql: string | null }>();
    if (!schema.success || !Array.isArray(schema.results) || schema.results.length !== Object.keys(pins).length) throw Error();
    const seen = new Set<string>();
    for (const row of schema.results) { const pin = pins[row.name]; if (!pin || seen.has(row.name) || row.type !== pin[0] || row.tbl_name !== pin[1] || (pin[2] === null ? row.sql !== null : typeof row.sql !== "string" || await captureHash(schema4SqlTokens(row.sql)) !== pin[2])) throw Error(); seen.add(row.name); }
    if (Object.keys(pins).some(n => !seen.has(n))) throw Error();
    const stored = await db.prepare("SELECT singleton,database_uuid,binding_nonce FROM storage_identity ORDER BY singleton LIMIT 2").all<{ singleton: number; database_uuid: string; binding_nonce: string }>();
    if (!stored.success || !Array.isArray(stored.results) || stored.results.length !== 1 || stored.results[0]?.singleton !== 1 || stored.results[0]?.database_uuid !== identity.databaseId || stored.results[0]?.binding_nonce !== identity.bindingNonce) throw Error();
  } catch { throw new Schema4Unavailable(); }
}
