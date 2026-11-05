import { assertIdentity, assertMigrationRows, sha256, validateExport, type MigrationData, type StorageIdentity } from "./migration-contract";
import { isRenderableWorld } from "../src/server/world-readiness";
import { parseRepo } from "../src/server/github";

interface Statement {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}
export interface WorldD1Binding {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ success: boolean; meta?: { changes?: number } }[]>;
  withSession?(constraint: "first-primary"): WorldD1Binding;
}
export interface StorageEnvironment {
  WORLDS_DB?: WorldD1Binding; FACTORY_STORAGE_SECRET?: string;
  FACTORY_STORAGE_DATABASE_ID?: string; FACTORY_MIGRATION_EPOCH?: string;
  FACTORY_SOURCE_SHA?: string; FACTORY_WORKER_BUNDLE_SHA256?: string;
  FACTORY_ADMISSION_FENCE?: string;
}
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const record = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const fields = (x: Record<string, unknown>, names: string[]) => Object.keys(x).every((name) => names.includes(name));
const key = (value: unknown) => {
  if (typeof value !== "string") throw new TypeError("invalid input");
  try { return parseRepo(value).fullName.toLowerCase(); } catch { throw new TypeError("invalid input"); }
};
async function equalSecret(actual: string, expected: string) {
  if (expected.length < 32 || actual.length < 32 || actual.length > 256) return false;
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const a = await digest(actual), b = await digest(expected); let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i]! ^ b[i]!;
  return different === 0;
}
async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 2 * 1024 * 1024) throw new Error("invalid input");
  const reader = request.body?.getReader(); if (!reader) throw new Error("invalid input");
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > 2 * 1024 * 1024) throw new Error("invalid input"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = JSON.parse(new TextDecoder().decode(bytes)); if (!record(body)) throw new Error("invalid input"); return body;
}

/** Private fixed-operation RPC. It accepts neither caller SQL nor URLs/prompts,
 * and this Worker has no model key, management token or paid ledger binding. */
export async function worldStorageRpc(request: Request, env: StorageEnvironment): Promise<Response> {
  if (!(await equalSecret(request.headers.get("x-factory-storage-key") || "", env.FACTORY_STORAGE_SECRET || "")))
    return reply({ error: "Storage authorization required" }, 403);
  if (request.method !== "POST" || request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    return reply({ error: "Storage operation rejected" }, 400);
  if (!env.WORLDS_DB) return reply({ error: "Authoritative storage unavailable" }, 503);
  let body: Record<string, unknown>;
  try { body = await boundedBody(request); } catch { return reply({ error: "Storage operation rejected" }, 400); }
  const db = env.WORLDS_DB.withSession?.("first-primary") ?? env.WORLDS_DB;
  let identity: StorageIdentity;
  const ok = (result: unknown) => reply({ ok: true, backend: "d1", op: body.op, identity, result });
  try {
    const stored = await db.prepare("SELECT database_uuid,binding_nonce FROM storage_identity WHERE singleton=1").first<{ database_uuid: string; binding_nonce: string }>();
    if (!stored || stored.database_uuid !== env.FACTORY_STORAGE_DATABASE_ID || !/^[a-f0-9]{32}$/.test(stored.binding_nonce) ||
      !/^[a-f0-9]{32}$/.test(env.FACTORY_MIGRATION_EPOCH || "") || !/^[a-f0-9]{40}$/.test(env.FACTORY_SOURCE_SHA || "") || !/^[a-f0-9]{64}$/.test(env.FACTORY_WORKER_BUNDLE_SHA256 || "")) throw new Error("D1 identity unavailable");
    identity = { databaseId: stored.database_uuid, bindingNonce: stored.binding_nonce, epoch: env.FACTORY_MIGRATION_EPOCH!, sourceSha: env.FACTORY_SOURCE_SHA!, workerBundleSha256: env.FACTORY_WORKER_BUNDLE_SHA256!, admissionFenced: env.FACTORY_ADMISSION_FENCE === env.FACTORY_MIGRATION_EPOCH };
    if (body.op === "migrationSnapshot") {
      if (!fields(body, ["op"])) throw new TypeError();
      return ok({ identity, ...(await migrationData(db)) });
    }
    if (body.op === "migrationImport") {
      if (!fields(body, ["op", "export", "identity"]) || !identity.admissionFenced) throw new TypeError();
      assertIdentity(body.identity as StorageIdentity, identity);
      const source = await validateExport(body.export);
      if (source.sourceHead !== identity.sourceSha) throw new TypeError();
      const existing = await migrationData(db);
      if (existing.provenance.length) { await assertMigrationRows(existing, source); return ok({ imported: true, idempotent: true }); }
      const rows = await Promise.all(source.worlds.map(async (row) => ({ ...row, snapshot_sha256: await sha256(row.snapshot) })));
      // D1Database.batch is the documented transactional Worker API: every
      // statement rolls back on any failure. No SQL REST-array assumption.
      const results = await db.batch([
        db.prepare(`INSERT INTO migration_guards(migration_id,source_sha256,accepted)
          SELECT ?,?,CASE WHEN (SELECT COUNT(*) FROM worlds)=0 AND (SELECT COUNT(*) FROM world_aliases)=0 AND (SELECT COUNT(*) FROM storage_provenance)=0 THEN 1 ELSE 0 END`).bind(source.migrationId, source.sourceSha256),
        db.prepare(`INSERT INTO worlds(repo,snapshot,expires_at,saved_at,snapshot_sha256,origin)
          SELECT json_extract(value,'$.repo'),json_extract(value,'$.snapshot'),json_extract(value,'$.expires_at'),json_extract(value,'$.saved_at'),json_extract(value,'$.snapshot_sha256'),? FROM json_each(?)`).bind(`migration:${source.migrationId}`, JSON.stringify(rows)),
        db.prepare(`INSERT INTO world_aliases(alias,canonical) SELECT json_extract(value,'$.alias'),json_extract(value,'$.canonical') FROM json_each(?)`).bind(JSON.stringify(source.aliases)),
        db.prepare("INSERT INTO storage_provenance VALUES(?,?,?,?,?,?,?)").bind(source.migrationId, "sqlite", source.sourceHead, source.worlds.length, source.aliases.length, source.sourceSha256, new Date().toISOString()),
      ]);
      if (results.some((row) => !row.success)) throw new Error("D1 transaction unavailable");
      await assertMigrationRows(await migrationData(db), source);
      return ok({ imported: true, idempotent: false });
    }
    if (body.op === "getMany" || body.op === "summaries") {
      if (!fields(body, ["op", "keys"]) || !Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 32) throw new TypeError();
      const keys = [...new Set(body.keys.map(key))];
      const rows = await db.prepare(`SELECT r.value AS key,w.repo,w.snapshot,w.expires_at,w.saved_at FROM json_each(?) r
        LEFT JOIN world_aliases a ON a.alias=r.value JOIN worlds w ON w.repo=COALESCE(a.canonical,r.value)`).bind(JSON.stringify(keys)).all<{ key: string; repo: string; snapshot: string; expires_at: number; saved_at: number }>();
      if (!rows.success) throw new Error("D1 unavailable");
      if (body.op === "getMany") return ok(rows.results);
      return ok(rows.results.map((row) => { const world = JSON.parse(row.snapshot); return { key: row.key, repo: world.repo, collectedAt: world.collectedAt, expiresAt: row.expires_at, ready: isRenderableWorld(world) }; }));
    }
    if (body.op === "put") {
      if (!fields(body, ["op", "snapshot", "savedAt", "expiresAt"]) || typeof body.snapshot !== "string" || body.snapshot.length > 512 * 1024 ||
          typeof body.savedAt !== "number" || !Number.isSafeInteger(body.savedAt) || typeof body.expiresAt !== "number" || !Number.isSafeInteger(body.expiresAt)) throw new TypeError();
      let world; try { world = JSON.parse(body.snapshot); } catch { throw new TypeError(); }
      if (!record(world) || !record(world.repo)) throw new TypeError();
      const repo = key(world.repo.fullName);
      if (world.schemaVersion !== 1 || world.source !== "github" || world.repo.url !== `https://github.com/${world.repo.fullName}` ||
          (typeof world.headSha !== "string" || !/^[a-f0-9]{40}$/i.test(world.headSha)) || (typeof world.collectedAt !== "string" || !Number.isFinite(Date.parse(world.collectedAt))) ||
          !Array.isArray(world.nodes) || world.nodes.length > 100 || !Array.isArray(world.edges) || world.edges.length > 256 || !world.blueprint || body.savedAt < 0 || body.expiresAt - body.savedAt < 60_000 || body.expiresAt - body.savedAt > 120_000) throw new TypeError();
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.snapshot)));
      const hash = [...digest].map((x) => x.toString(16).padStart(2, "0")).join("");
      const result = await db.batch([
        db.prepare(`INSERT INTO worlds(repo,snapshot,expires_at,saved_at,snapshot_sha256,origin) VALUES(?,?,?,?,?,'runtime')
          ON CONFLICT(repo) DO UPDATE SET snapshot=excluded.snapshot,expires_at=excluded.expires_at,saved_at=excluded.saved_at,snapshot_sha256=excluded.snapshot_sha256,origin='runtime'
          WHERE excluded.saved_at>=worlds.saved_at`).bind(repo, body.snapshot, body.expiresAt, body.savedAt, hash),
        db.prepare("DELETE FROM worlds WHERE repo NOT IN (SELECT repo FROM worlds ORDER BY saved_at DESC,repo LIMIT 100)"),
        db.prepare("DELETE FROM world_aliases WHERE alias=? OR canonical NOT IN (SELECT repo FROM worlds)").bind(repo),
      ]);
      if (result.some((row) => !row.success)) throw new Error("D1 unavailable");
      return ok({ saved: (result[0]?.meta?.changes ?? 0) > 0 });
    }
    if (body.op === "alias") {
      if (!fields(body, ["op", "alias", "canonical"])) throw new TypeError();
      const alias = key(body.alias), canonical = key(body.canonical); if (alias === canonical) return ok({ saved: true });
      const results = await db.batch([
        db.prepare("INSERT INTO world_aliases(alias,canonical) SELECT ?,? WHERE EXISTS (SELECT 1 FROM worlds WHERE repo=?) ON CONFLICT(alias) DO UPDATE SET canonical=excluded.canonical").bind(alias, canonical, canonical),
        db.prepare("DELETE FROM worlds WHERE repo=? AND EXISTS (SELECT 1 FROM world_aliases WHERE alias=? AND canonical=?)").bind(alias, alias, canonical),
        db.prepare("DELETE FROM world_aliases WHERE canonical=? AND EXISTS (SELECT 1 FROM world_aliases WHERE alias=? AND canonical=?)").bind(alias, alias, canonical),
        db.prepare("DELETE FROM world_aliases WHERE rowid NOT IN (SELECT rowid FROM world_aliases ORDER BY rowid DESC LIMIT 200)"),
      ]); if (results.some((row) => !row.success)) throw new Error("D1 unavailable"); return ok({ saved: (results[0]?.meta?.changes ?? 0) > 0 });
    }
    if (body.op === "delete") {
      if (!fields(body, ["op", "repo"])) throw new TypeError();
      const repo = key(body.repo), mapped = await db.prepare("SELECT canonical FROM world_aliases WHERE alias=?").bind(repo).first<{ canonical: string }>();
      const results = await db.batch([db.prepare("DELETE FROM worlds WHERE repo=?").bind(mapped?.canonical || repo),
        db.prepare("DELETE FROM world_aliases WHERE alias=? OR canonical=?").bind(repo, mapped?.canonical || repo)]);
      if (results.some((row) => !row.success)) throw new Error("D1 unavailable"); return ok({ deleted: true });
    }
    if (body.op === "status") {
      if (!fields(body, ["op"])) throw new TypeError();
      const version = await db.prepare("SELECT MAX(version) version FROM schema_migrations").first<{ version: number }>();
      const worlds = await db.prepare("SELECT COUNT(*) count FROM worlds").first<{ count: number }>();
      const aliases = await db.prepare("SELECT COUNT(*) count FROM world_aliases").first<{ count: number }>();
      if (version?.version !== 2 || !worlds || !aliases) throw new Error("D1 schema unavailable");
      return ok({ backend: "d1", authoritative: true, databaseId: identity.databaseId, schemaVersion: version.version, worlds: worlds.count, aliases: aliases.count });
    }
    if (body.op === "probe") {
      if (!fields(body, ["op", "action", "nonce"]) || typeof body.nonce !== "string" || !/^[a-f0-9]{32}$/.test(body.nonce)) throw new TypeError();
      const id = `storage-rpc-synthetic-${body.nonce}`;
      if (body.action === "rollback") {
        if (await db.prepare("SELECT id FROM migration_sentinels WHERE id=?").bind(id).first()) throw new TypeError();
        let rejected = false;
        try { await db.batch([
          db.prepare("INSERT INTO migration_sentinels(id,payload) VALUES(?,'SYNTHETIC ATOMIC ROLLBACK PROBE')").bind(id),
          db.prepare("INSERT INTO migration_sentinels(id,payload) VALUES(?,'EXPECTED DUPLICATE FAILURE')").bind(id),
        ]); } catch { rejected = true; }
        const absent = !(await db.prepare("SELECT id FROM migration_sentinels WHERE id=?").bind(id).first());
        if (!rejected || !absent) throw new Error("D1 rollback unverified");
        return ok({ batchRejected: true, rolledBack: true, syntheticRowAbsent: true });
      }
      if (body.action === "write") { const result = await db.prepare("INSERT INTO migration_sentinels(id,payload) VALUES(?,'SYNTHETIC PRIVATE STORAGE PROBE') ON CONFLICT(id) DO NOTHING").bind(id).run(); if (!result.success) throw new Error("D1 unavailable"); return ok({ written: true }); }
      if (body.action === "read") return ok(await db.prepare("SELECT id,payload FROM migration_sentinels WHERE id=?").bind(id).first());
      if (body.action === "delete") { const result = await db.prepare("DELETE FROM migration_sentinels WHERE id=?").bind(id).run(); if (!result.success) throw new Error("D1 unavailable"); return ok({ deleted: true }); }
      throw new TypeError();
    }
    throw new TypeError();
  } catch (error) { return reply({ error: error instanceof TypeError ? "Storage operation rejected" : "Authoritative storage unavailable" }, error instanceof TypeError ? 400 : 503); }
}

/** One SQL statement yields one consistent full snapshot for machine gates. */
async function migrationData(db: WorldD1Binding): Promise<MigrationData> {
  const row = await db.prepare(`SELECT
    (SELECT json_group_array(json_object('repo',repo,'snapshot',snapshot,'expires_at',expires_at,'saved_at',saved_at,'snapshot_sha256',snapshot_sha256,'origin',origin)) FROM (SELECT * FROM worlds ORDER BY repo)) AS worlds,
    (SELECT json_group_array(json_object('alias',alias,'canonical',canonical)) FROM (SELECT * FROM world_aliases ORDER BY alias)) AS aliases,
    (SELECT json_group_array(json_object('migration_id',migration_id,'source_backend',source_backend,'source_head',source_head,'source_rows',source_rows,'source_aliases',source_aliases,'source_sha256',source_sha256,'imported_at',imported_at)) FROM (SELECT * FROM storage_provenance ORDER BY migration_id)) AS provenance,
    (SELECT json_group_array(json_object('migration_id',migration_id,'source_sha256',source_sha256,'accepted',accepted)) FROM (SELECT * FROM migration_guards ORDER BY migration_id)) AS guards`).first<Record<string, string>>();
  if (!row) throw new Error("D1 snapshot unavailable");
  return { worlds: JSON.parse(row.worlds), aliases: JSON.parse(row.aliases), provenance: JSON.parse(row.provenance), guards: JSON.parse(row.guards) };
}
