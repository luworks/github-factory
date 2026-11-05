import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { worldStorageRpc, type StorageEnvironment, type WorldD1Binding } from "../deploy/d1-storage";
import gateway from "../deploy/gateway";
import { D1WorldStore } from "../src/server/d1-store";
import { createWorldService } from "../src/server/service";
import { WorldStore } from "../src/server/store";
import { activePublicAnalyses, publicAnalysis } from "../src/server/runtime-activity";
import type { Fetcher, RepoCollection } from "../src/server/github";
import { syntheticWorld } from "./fixtures/browser-world";
import { exportDigest, type WorldExport } from "../deploy/migration-contract";
import { requireFreshMigrationReceipt, verifyMigrationGate, type MigrationGateInput } from "../scripts/d1-migration-gate";

// SYNTHETIC ONLY: real SQLite executes the same statements through a D1-shaped
// interface. These are offline protocol/SQL tests, not Cloudflare acceptance.
const secret = "synthetic-storage-secret-32-characters-long";
const endpoint = "https://chaorders.com/github-factory/_storage";
const databaseId = "11111111-1111-4111-8111-111111111111";
const expectedIdentity = { databaseId, bindingNonce: "a".repeat(32), epoch: "b".repeat(32), sourceSha: "c".repeat(40), workerBundleSha256: "d".repeat(64), admissionFenced: true };
const actualWorkerSettings = () => ({ bindings: [
 { name: "WORLDS_DB", type: "d1", id: databaseId }, { name: "FACTORY_GATEWAY_SECRET", type: "secret_text" }, { name: "FACTORY_STORAGE_SECRET", type: "secret_text" },
 ...Object.entries({ FACTORY_STORAGE_MODE: "worlds", FACTORY_ADMISSION_FENCE: expectedIdentity.epoch, FACTORY_ORIGIN: "https://github-factory-origin.chaorders.com", FACTORY_SOURCE_SHA: expectedIdentity.sourceSha, FACTORY_MIGRATION_EPOCH: expectedIdentity.epoch, FACTORY_WORKER_BUNDLE_SHA256: expectedIdentity.workerBundleSha256 }).map(([name,text]) => ({ name, type: "plain_text", text })),
 { name: "COMPANY_SITE", type: "service", service: "chaorders-site" },
] });
const fixtureEnv = { FACTORY_STORAGE_MODE: "worlds", FACTORY_STORAGE_SECRET: secret, FACTORY_STORAGE_DATABASE_ID: databaseId, FACTORY_MIGRATION_EPOCH: expectedIdentity.epoch, FACTORY_SOURCE_SHA: expectedIdentity.sourceSha, FACTORY_WORKER_BUNDLE_SHA256: expectedIdentity.workerBundleSha256, FACTORY_ADMISSION_FENCE: expectedIdentity.epoch };
const now = Date.parse("2026-11-04T18:00:00Z");
function fixture(name = "browser-fixture") {
  const world = syntheticWorld(); world.source = "github";
  world.repo = { ...world.repo, name, fullName: `synthetic-moonshot/${name}`, url: `https://github.com/synthetic-moonshot/${name}` };
  world.refreshAfter = now + 90_000;
  return world;
}
function binding(options: { interruptBatchAt?: number } = {}) {
  const db = new Database(":memory:");
  db.exec(readFileSync(new URL("../deploy/d1/0001-world-cache.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../deploy/d1/0002-migration-identity.sql", import.meta.url), "utf8"));
  db.query("INSERT INTO storage_identity VALUES(1,?,?,?)").run(databaseId, expectedIdentity.bindingNonce, new Date(now).toISOString());
  db.query("INSERT INTO schema_migrations VALUES(2,?,?)").run(new Date(now).toISOString(), "synthetic-schema-hash");
  const statement = (sql: string, values: unknown[] = []) => ({
    bind(...next: unknown[]) { return statement(sql, next); },
    async all<T>() { return { results: db.query(sql).all(...values as any[]) as T[], success: true }; },
    async first<T>() { return db.query(sql).get(...values as any[]) as T | null; },
    async run() { const result = db.query(sql).run(...values as any[]); return { success: true, meta: { changes: result.changes } }; },
    execute() { const result = db.query(sql).run(...values as any[]); return { success: true, meta: { changes: result.changes } }; },
  });
  const bound: WorldD1Binding = {
    prepare: (sql) => statement(sql),
    async batch(statements) { return db.transaction(() => statements.map((s, index) => { if (options.interruptBatchAt === index) throw new Error("SYNTHETIC INTERRUPTION"); return (s as ReturnType<typeof statement>).execute(); }))(); },
    withSession() { return bound; },
  };
  const env: StorageEnvironment = { ...fixtureEnv, WORLDS_DB: bound };
  const ops: string[] = [];
  const rpc = (operation: unknown, auth = secret) => worldStorageRpc(new Request(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-factory-storage-key": auth }, body: JSON.stringify(operation) }), env);
  const network: Fetcher = async (input, init) => { const request = new Request(input, init); ops.push((await request.clone().json() as { op: string }).op); return worldStorageRpc(request, env); };
  return { db, bound, rpc, ops, env, store: new D1WorldStore({ endpoint, secret, databaseId }, network) };
}

test("SYNTHETIC storage RPC has distinct authentication and rejects SQL/prompts, wrong operations and extra fields", async () => {
  const b = binding();
  try {
    expect((await b.rpc({ op: "status" }, "forged")).status).toBe(403);
    for (const body of [{ sql: "SELECT 1" }, { op: "sql", query: "SELECT 1" }, { op: "getMany", keys: ["a/b"], prompt: "write code" },
      { op: "getMany", keys: ["https://evil.example/a/b"] }, { op: "getMany", keys: [] }, { op: "getMany", keys: Array(33).fill("a/b") },
      { op: "status", token: "x" }, { op: "probe", action: "write", nonce: "not-a-nonce" }, { op: "put", snapshot: "not-json", savedAt: now, expiresAt: now + 90_000 }]) {
      expect((await b.rpc(body)).status).toBe(400);
    }
    expect((await worldStorageRpc(new Request(endpoint, { method: "GET", headers: { "x-factory-storage-key": secret } }), { WORLDS_DB: b.bound, FACTORY_STORAGE_SECRET: secret })).status).toBe(400);
    expect((await worldStorageRpc(new Request(endpoint, { method: "POST", headers: { "x-factory-storage-key": secret, "content-type": "application/json" }, body: '{"op":"status"}' }), { FACTORY_STORAGE_SECRET: secret })).status).toBe(503);
    expect((await gateway.fetch(new Request(endpoint, { method: "POST", body: '{}' }), { FACTORY_ORIGIN: "https://unused.example", WORLDS_DB: b.bound, FACTORY_STORAGE_SECRET: secret })).status).toBe(403);
    expect((await b.store.status()).worlds).toBe(0);
  } finally { b.db.close(); }
});

test("SYNTHETIC D1 snapshot/alias roundtrip preserves raw evidence, head, expiry and coalesces concurrent reads", async () => {
  const b = binding(), world = fixture();
  try {
    await b.store.put(world, 90_000, now);
    await b.store.alias("previous/name", world.repo.fullName);
    const [one, alias, duplicate, miss] = await Promise.all([b.store.get(world.repo.fullName, now), b.store.get("previous/name", now + 90_000), b.store.get(world.repo.fullName, now), b.store.get("missing/repo", now)]);
    expect(b.ops.filter((op) => op === "getMany")).toHaveLength(1);
    expect(one?.world).toEqual(world); expect(duplicate).toEqual(one);
    expect(alias?.world.headSha).toBe(world.headSha); expect(alias?.world.collectedAt).toBe(world.collectedAt);
    expect(alias?.expiresAt).toBe(now + 90_000); expect(alias?.fresh).toBe(false); expect(miss).toBeNull();
    const summaries = await b.store.summaries([world.repo.fullName, "previous/name", "missing/repo"]);
    expect(summaries).toHaveLength(2); expect(summaries[1]?.repo).toEqual(world.repo);
    expect(summaries[0]).not.toHaveProperty("snapshot");
    expect(await b.store.status()).toEqual({ backend: "d1", authoritative: true, schemaVersion: 2, databaseId, worlds: 1, aliases: 1 });
    await expect(b.store.alias("invalid/alias", "missing/target")).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" });
    const stored = b.db.query("SELECT snapshot,snapshot_sha256 FROM worlds").get() as { snapshot: string; snapshot_sha256: string };
    expect(stored.snapshot).toBe(JSON.stringify(world)); expect(stored.snapshot_sha256).toBe(new Bun.CryptoHasher("sha256").update(stored.snapshot).digest("hex"));
    await b.store.delete("previous/name"); expect(await b.store.get(world.repo.fullName)).toBeNull();
    expect(await b.store.status()).toMatchObject({ worlds: 0, aliases: 0 });
  } finally { b.db.close(); }
});

test("SYNTHETIC D1 rejects demo/invalid TTL while admitting unknown license and preserving newer evidence", async () => {
  const b = binding(), world = fixture();
  try {
    for (const mutate of [(w: typeof world) => { w.source = "demo"; }, (w: typeof world) => { w.headSha = "forged"; }]) {
      const invalid = structuredClone(world); mutate(invalid);
      expect((await b.rpc({ op: "put", snapshot: JSON.stringify(invalid), savedAt: now, expiresAt: now + 90_000 })).status).toBe(400);
    }
    expect((await b.rpc({ op: "put", snapshot: JSON.stringify(world), savedAt: now, expiresAt: now + 1 })).status).toBe(400);
    world.repo.license = null;
    await b.store.put(world, 90_000, now + 10);
    expect((await b.store.get(world.repo.fullName))?.world.repo.license).toBeNull();
    const older = structuredClone(world); older.headSha = "a".repeat(40);
    await expect(b.store.put(older, 90_000, now)).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" });
    expect((await b.store.get(world.repo.fullName))?.world.headSha).toBe(world.headSha);
  } finally { b.db.close(); }
});

test("SYNTHETIC D1 retains at most 100 worlds and removes aliases for evicted evidence", async () => {
  const b = binding();
  try {
    for (let i = 0; i < 101; i++) {
      const world = fixture(`repo-${i}`); await b.store.put(world, 90_000, now + i);
      if (i === 0) await b.store.alias("old/alias", world.repo.fullName);
    }
    expect(await b.store.get("synthetic-moonshot/repo-0")).toBeNull(); expect(await b.store.get("old/alias")).toBeNull();
    expect(await b.store.status()).toMatchObject({ worlds: 100, aliases: 0 });
    expect((await Promise.all(Array.from({ length: 40 }, (_, i) => b.store.get(`synthetic-moonshot/repo-${i + 1}`)))).every(Boolean)).toBe(true);
    expect(b.ops.filter((op) => op === "getMany")).toHaveLength(4); // two prior singles + 32/8 batches
  } finally { b.db.close(); }
});

test("SYNTHETIC storage probe can touch only its synthetic sentinel and leaves world counts unchanged", async () => {
  const b = binding(), nonce = "a".repeat(32);
  try {
    expect((await b.rpc({ op: "probe", action: "write", nonce })).status).toBe(200);
    expect(await (await b.rpc({ op: "probe", action: "read", nonce })).json()).toMatchObject({ result: { id: `storage-rpc-synthetic-${nonce}`, payload: "SYNTHETIC PRIVATE STORAGE PROBE" } });
    expect((await b.rpc({ op: "probe", action: "delete", nonce })).status).toBe(200);
    expect((b.db.query("SELECT COUNT(*) count FROM migration_sentinels").get() as { count: number }).count).toBe(0);
    expect(await b.store.status()).toMatchObject({ worlds: 0, aliases: 0 });
  } finally { b.db.close(); }
});

test("SYNTHETIC authoritative D1 failures never fall back to local data or start collection", async () => {
  let collected = 0;
  const failure: Fetcher = async () => { throw new Error("private transport details"); };
  const store = new D1WorldStore({ endpoint, secret, databaseId }, failure);
  const service = createWorldService({ store, collector: { async collect(): Promise<RepoCollection> { collected++; throw new Error("not allowed"); } } });
  for (const read of [() => service.getCachedWorld("a/b"), () => service.loadWorld("a/b"), () => service.listFeatured(), () => service.storageStatus()]) {
    await expect(read()).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", status: 503 });
  }
  expect(collected).toBe(0);
  const malformed: Fetcher = async () => Response.json({ ok: true, backend: "sqlite", op: "getMany", result: [] });
  await expect(new D1WorldStore({ endpoint, secret, databaseId }, malformed).get("a/b")).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" });
  expect(() => new D1WorldStore({ endpoint: "https://evil.example/_storage", secret, databaseId })).toThrow();
});

test("SYNTHETIC migration HOLD permits cache reads, blocks new collection/paid actions and counts only public in-flight AI", async () => {
  const previous = process.env.MOONSHOT_WORLD_WRITES_HOLD;
  const store = new WorldStore(":memory:"), world = fixture(); store.put(world, 90_000, now);
  let collections = 0, admissions = 0, paidActions = 0, release!: () => void;
  const service = createWorldService({ store, now: () => now + 100_000, collector: { async collect(): Promise<RepoCollection> { collections++; throw new Error("not allowed"); } } });
  try {
    process.env.MOONSHOT_WORLD_WRITES_HOLD = "0";
    const pending = publicAnalysis(() => new Promise<void>((resolve) => { paidActions++; release = resolve; }));
    expect(activePublicAnalyses()).toBe(1);
    process.env.MOONSHOT_WORLD_WRITES_HOLD = "1";
    expect((await service.loadWorld(world.repo.fullName)).headSha).toBe(world.headSha);
    expect((await service.getCachedWorld(world.repo.fullName))?.coverage.notes.join(" ")).toContain("STALE");
    await expect(service.loadWorld(world.repo.fullName, { refresh: true, admit: () => { admissions++; } })).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" });
    await expect(service.loadWorld("missing/repo")).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" });
    await expect(publicAnalysis(async () => { paidActions++; })).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" });
    expect(collections).toBe(0); expect(admissions).toBe(0); expect(paidActions).toBe(1);
    release(); await pending; expect(activePublicAnalyses()).toBe(0); expect(service.activeCollections()).toBe(0);
  } finally { release?.(); store.close(); if (previous === undefined) delete process.env.MOONSHOT_WORLD_WRITES_HOLD; else process.env.MOONSHOT_WORLD_WRITES_HOLD = previous; }
});

test("SYNTHETIC async store preserves collection singleflight and drains only after durable put finishes", async () => {
  const world = fixture();
  let calls = 0, releaseWrite!: () => void, writeStarted!: () => void;
  const writing = new Promise<void>((resolve) => { writeStarted = resolve; });
  const persisted = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const service = createWorldService({
    now: () => now,
    store: { async get() { return null; }, async put() { writeStarted(); await persisted; } },
    collector: { async collect() {
      calls++;
      return { repo: world.repo, headSha: world.headSha, collectedAt: world.collectedAt, tree: [], treeState: "unavailable", files: [], issues: [], pulls: [], workflows: [], commits: [], languages: {}, notes: ["SYNTHETIC offline collection"], partial: true, rateLimitRemaining: null };
    } },
  });
  const a = service.loadWorld(world.repo.fullName), b = service.loadWorld(world.repo.fullName);
  try {
    await writing;
    expect(calls).toBe(1); expect(service.activeCollections()).toBe(1);
    releaseWrite(); expect((await a).headSha).toBe((await b).headSha);
    expect(service.activeCollections()).toBe(0);
  } finally { releaseWrite(); }
});

test("SYNTHETIC successful collection cannot be reported as saved when authoritative D1 put fails", async () => {
  const world = fixture(); let collects = 0;
  const store = new D1WorldStore({ endpoint, secret, databaseId }, async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    return body.op === "getMany" ? Response.json({ ok: true, backend: "d1", op: "getMany", identity: { databaseId }, result: [] }) : new Response("unavailable", { status: 503 });
  });
  const service = createWorldService({ store, collector: { async collect() { collects++; return { repo: world.repo, headSha: world.headSha, collectedAt: world.collectedAt, tree: [], treeState: "unavailable", files: [], issues: [], pulls: [], workflows: [], commits: [], languages: {}, notes: ["SYNTHETIC offline collection"], partial: true, rateLimitRemaining: null }; } } });
  await expect(service.loadWorld(world.repo.fullName)).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", status: 503 });
  expect(collects).toBe(1); expect(service.activeCollections()).toBe(0);
});

async function migrationExport(): Promise<WorldExport> {
  const worlds = [fixture("atomic-a"), fixture("atomic-b")].map((world) => ({ repo: world.repo.fullName, snapshot: JSON.stringify(world), expires_at: now - 999, saved_at: now - 99_000 }));
  const aliases = [{ alias: "previous/atomic", canonical: worlds[0].repo }];
  return { migrationId: `worlds-${"e".repeat(32)}`, sourceHead: expectedIdentity.sourceSha, sourceSha256: await exportDigest({ worlds, aliases }), worlds, aliases };
}
test("SYNTHETIC atomic migration rolls back worlds, aliases, guard and provenance on interruption", async () => {
  const b = binding({ interruptBatchAt: 2 }), source = await migrationExport();
  try {
    expect((await b.rpc({ op: "migrationImport", export: source, identity: expectedIdentity })).status).toBe(503);
    for (const table of ["worlds", "world_aliases", "storage_provenance", "migration_guards"]) expect((b.db.query(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n).toBe(0);
  } finally { b.db.close(); }
});
test("SYNTHETIC atomic migration is complete/idempotent, preserves expired TTL and never overwrites unrelated rows", async () => {
  const b = binding(), source = await migrationExport();
  try {
    const request = { op: "migrationImport", export: source, identity: expectedIdentity };
    expect(await (await b.rpc(request)).json()).toMatchObject({ result: { imported: true, idempotent: false } });
    expect(await (await b.rpc(request)).json()).toMatchObject({ result: { imported: true, idempotent: true } });
    expect((await b.store.get(source.worlds[0].repo, now))?.expiresAt).toBe(now - 999);
    const wrong = structuredClone(source); wrong.worlds[0].snapshot += " "; wrong.sourceSha256 = await exportDigest(wrong);
    expect((await b.rpc({ ...request, export: wrong })).status).toBe(503);
    expect((await b.store.status()).worlds).toBe(2);
  } finally { b.db.close(); }
  const other = binding();
  try {
    await other.store.put(fixture("unrelated"), 90_000, now);
    expect((await other.rpc({ op: "migrationImport", export: source, identity: expectedIdentity })).status).toBe(503);
    expect((await other.store.get("synthetic-moonshot/unrelated"))?.world.repo.name).toBe("unrelated");
    expect((await other.store.status()).worlds).toBe(1);
  } finally { other.db.close(); }
});
test("SYNTHETIC fixed rollback probe proves duplicate-statement failure leaves no sentinel", async () => {
  const b = binding();
  try {
    expect(await (await b.rpc({ op: "probe", action: "rollback", nonce: "f".repeat(32) })).json()).toMatchObject({ result: { batchRejected: true, rolledBack: true, syntheticRowAbsent: true } });
    expect((b.db.query("SELECT COUNT(*) n FROM migration_sentinels").get() as { n: number }).n).toBe(0);
  } finally { b.db.close(); }
});
test("SYNTHETIC full management/RPC gate rejects wrong empty binding, tampered rows/aliases/config/head/epoch and missing evidence", async () => {
  const b = binding(), source = await migrationExport();
  try {
    await b.rpc({ op: "migrationImport", export: source, identity: expectedIdentity });
    const response = await (await b.rpc({ op: "migrationSnapshot" })).json();
    const rpc = response.result;
    const input: MigrationGateInput = { source, workerSettings: actualWorkerSettings(), expectedIdentity, admin: { ...structuredClone(rpc), databaseId, apiDatabaseId: databaseId, bindingNonce: expectedIdentity.bindingNonce }, rpc,
      workerDeploymentId: "11111111-1111-4111-8111-111111111111", workerVersionId: "22222222-2222-4222-8222-222222222222", candidateSha: expectedIdentity.sourceSha, actualWorkerBundleSha256: expectedIdentity.workerBundleSha256, activeEnvSha256: "a".repeat(64), targetConfigSha256: "b".repeat(64), epoch: expectedIdentity.epoch };
    expect(await verifyMigrationGate(input, now)).toMatchObject({ adminAndFullRpcVerified: true, worldCount: 2, aliasCount: 1, expiresAtMs: now + 30_000 });
    const receipt = await verifyMigrationGate(input, now), expectedReceipt = { workerDeploymentId: input.workerDeploymentId, workerVersionId: input.workerVersionId, actualWorkerBundleSha256: input.actualWorkerBundleSha256, candidateSha: input.candidateSha, activeEnvSha256: input.activeEnvSha256, targetConfigSha256: input.targetConfigSha256, expectedIdentity, workerSettings: actualWorkerSettings(), exportSha256: source.sourceSha256 };
    expect(() => requireFreshMigrationReceipt(receipt, expectedReceipt, now + 1)).not.toThrow();
    expect(() => requireFreshMigrationReceipt(receipt, expectedReceipt, now + 30_000)).toThrow("Stale");
    expect(() => requireFreshMigrationReceipt(receipt, { ...expectedReceipt, activeEnvSha256: "f".repeat(64) }, now + 1)).toThrow("Stale");
    for (const key of ["workerDeploymentId", "workerVersionId", "actualWorkerBundleSha256"] as const) {
      expect(() => requireFreshMigrationReceipt(receipt, { ...expectedReceipt, [key]: key === "actualWorkerBundleSha256" ? "f".repeat(64) : "33333333-3333-4333-8333-333333333333" }, now + 1)).toThrow("Worker");
    }
    const mutations: ((x: MigrationGateInput) => void)[] = [
      (x) => { x.workerDeploymentId = ""; }, (x) => { x.workerVersionId = "unknown"; },
      (x) => { x.rpc.worlds = []; x.rpc.aliases = []; }, (x) => { x.rpc.worlds[0].snapshot += " "; }, (x) => { x.rpc.aliases[0].canonical = "wrong/repo"; },
      (x) => { x.rpc.identity.databaseId = "22222222-2222-4222-8222-222222222222"; }, (x) => { x.rpc.identity.epoch = "f".repeat(32); },
      (x) => { x.rpc.identity.admissionFenced = false; }, (x) => { x.actualWorkerBundleSha256 = "e".repeat(64); }, (x) => { x.candidateSha = "e".repeat(40); },
      (x) => { (x.workerSettings as any).bindings[0].id = "22222222-2222-4222-8222-222222222222"; },
      (x) => { (x.workerSettings as any).bindings.find((b: any) => b.name === "FACTORY_STORAGE_MODE").text = "probe-only"; },
      (x) => { (x.workerSettings as any).bindings.find((b: any) => b.name === "FACTORY_ADMISSION_FENCE").text = "false"; },
      (x) => { x.admin.worlds[0].expires_at++; }, (x) => { x.admin.provenance = []; }, (x) => { x.admin.apiDatabaseId = "wrong"; }, (x) => { x.targetConfigSha256 = ""; },
    ];
    for (const mutate of mutations) { const changed = structuredClone(input); mutate(changed); await expect(verifyMigrationGate(changed)).rejects.toThrow(); }
    b.db.query("UPDATE storage_identity SET database_uuid=?").run("22222222-2222-4222-8222-222222222222");
    await expect(b.store.get(source.worlds[0].repo)).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" });
  } finally { b.db.close(); }
});

test("SYNTHETIC whole-export request larger than one MiB imports atomically under the explicit two MiB bound", async () => {
  const b = binding();
  try {
    const worlds = Array.from({ length: 16 }, (_, i) => { const w = fixture(`large-${String(i).padStart(2, "0")}`); w.repo.description = "SYNTHETIC ".repeat(7000); return { repo: w.repo.fullName, snapshot: JSON.stringify(w), expires_at: now - 1, saved_at: now - 99_000 }; });
    const aliases = [{ alias: "previous/large", canonical: worlds[0].repo }];
    const source = { migrationId: `worlds-${"9".repeat(32)}`, sourceHead: expectedIdentity.sourceSha, sourceSha256: await exportDigest({ worlds, aliases }), worlds, aliases };
    const body = { op: "migrationImport", export: source, identity: expectedIdentity };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(1024 * 1024); expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(2 * 1024 * 1024);
    expect((await b.rpc(body)).status).toBe(200); expect((await b.store.status()).worlds).toBe(16);
  } finally { b.db.close(); }
});

test("SYNTHETIC atomic import roundtrips NOASSERTION/null/custom license without changing snapshot hashes or stale TTL", async () => {
  const b = binding();
  try {
    const worlds = [null, "NOASSERTION", "LicenseRef-Custom"].map((license, i) => { const w = fixture(`license-${i}`); w.repo.license = license; return { repo: w.repo.fullName, snapshot: JSON.stringify(w), expires_at: now - 1000, saved_at: now - 100_000 }; });
    const aliases: { alias: string; canonical: string }[] = [];
    const source = { migrationId: `worlds-${"7".repeat(32)}`, sourceHead: expectedIdentity.sourceSha, sourceSha256: await exportDigest({ worlds, aliases }), worlds, aliases };
    expect((await b.rpc({ op: "migrationImport", export: source, identity: expectedIdentity })).status).toBe(200);
    for (const row of worlds) { const stored = await b.store.get(row.repo, now); expect(JSON.stringify(stored?.world)).toBe(row.snapshot); expect(stored?.expiresAt).toBe(row.expires_at); expect(stored?.fresh).toBe(false); }
  } finally { b.db.close(); }
});


test("SYNTHETIC rollback proof cannot turn a pre-execution/transport batch exception into PASS", async () => {
  const b = binding({ interruptBatchAt: 0 });
  try { expect((await b.rpc({ op: "probe", action: "rollback", nonce: "6".repeat(32) })).status).toBe(503); expect((b.db.query("SELECT COUNT(*) n FROM migration_sentinels").get() as { n: number }).n).toBe(0); }
  finally { b.db.close(); }
});
test("SYNTHETIC bridge probe-only mode denies every world read/write/import even with the correct storage key", async () => {
  const b = binding(); b.env.FACTORY_STORAGE_MODE = "probe-only";
  try {
    for (const op of ["getMany", "summaries", "put", "alias", "delete", "migrationSnapshot", "migrationImport"]) expect((await b.rpc({ op })).status).toBe(403);
    expect((await b.rpc({ op: "status" })).status).toBe(200);
    expect((await b.rpc({ op: "probe", action: "rollback", nonce: "5".repeat(32) })).status).toBe(200);
  } finally { b.db.close(); }
});

test("SYNTHETIC an unrelated existing migration guard prevents every business/provenance import write", async () => {
  const b = binding(), source = await migrationExport();
  try {
    b.db.query("INSERT INTO migration_guards VALUES(?,?,1)").run("unrelated-guard", "f".repeat(64));
    expect((await b.rpc({ op: "migrationImport", export: source, identity: expectedIdentity })).status).toBe(503);
    for (const table of ["worlds", "world_aliases", "storage_provenance"]) expect((b.db.query(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n).toBe(0);
    expect((b.db.query("SELECT migration_id FROM migration_guards").get() as { migration_id: string }).migration_id).toBe("unrelated-guard");
  } finally { b.db.close(); }
});
