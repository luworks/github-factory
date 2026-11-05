import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { worldStorageRpc, type WorldD1Binding } from "../deploy/d1-storage";
import gateway from "../deploy/gateway";
import { D1WorldStore } from "../src/server/d1-store";
import { createWorldService } from "../src/server/service";
import { WorldStore } from "../src/server/store";
import { activePublicAnalyses, publicAnalysis } from "../src/server/runtime-activity";
import type { Fetcher, RepoCollection } from "../src/server/github";
import { syntheticWorld } from "./fixtures/browser-world";

// SYNTHETIC ONLY: real SQLite executes the same statements through a D1-shaped
// interface. These are offline protocol/SQL tests, not Cloudflare acceptance.
const secret = "synthetic-storage-secret-32-characters-long";
const endpoint = "https://chaorders.com/github-factory/_storage";
const now = Date.parse("2026-11-04T18:00:00Z");
function fixture(name = "browser-fixture") {
  const world = syntheticWorld(); world.source = "github";
  world.repo = { ...world.repo, name, fullName: `synthetic-moonshot/${name}`, url: `https://github.com/synthetic-moonshot/${name}` };
  world.refreshAfter = now + 90_000;
  return world;
}
function binding() {
  const db = new Database(":memory:");
  db.exec(readFileSync(new URL("../deploy/d1/0001-world-cache.sql", import.meta.url), "utf8"));
  db.query("INSERT INTO schema_migrations VALUES(1,?,?)").run(new Date(now).toISOString(), "synthetic-schema-hash");
  const statement = (sql: string, values: unknown[] = []) => ({
    bind(...next: unknown[]) { return statement(sql, next); },
    async all<T>() { return { results: db.query(sql).all(...values as any[]) as T[], success: true }; },
    async first<T>() { return db.query(sql).get(...values as any[]) as T | null; },
    async run() { const result = db.query(sql).run(...values as any[]); return { success: true, meta: { changes: result.changes } }; },
    execute() { const result = db.query(sql).run(...values as any[]); return { success: true, meta: { changes: result.changes } }; },
  });
  const bound: WorldD1Binding = {
    prepare: (sql) => statement(sql),
    async batch(statements) { return db.transaction(() => statements.map((s) => (s as ReturnType<typeof statement>).execute()))(); },
    withSession() { return bound; },
  };
  const ops: string[] = [];
  const rpc = (operation: unknown, auth = secret) => worldStorageRpc(new Request(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-factory-storage-key": auth }, body: JSON.stringify(operation) }), { WORLDS_DB: bound, FACTORY_STORAGE_SECRET: secret });
  const network: Fetcher = async (input, init) => { const request = new Request(input, init); ops.push((await request.clone().json() as { op: string }).op); return worldStorageRpc(request, { WORLDS_DB: bound, FACTORY_STORAGE_SECRET: secret }); };
  return { db, bound, rpc, ops, store: new D1WorldStore({ endpoint, secret }, network) };
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
    expect(await b.store.status()).toEqual({ backend: "d1", authoritative: true, schemaVersion: 1, worlds: 1, aliases: 1 });
    await expect(b.store.alias("invalid/alias", "missing/target")).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" });
    const stored = b.db.query("SELECT snapshot,snapshot_sha256 FROM worlds").get() as { snapshot: string; snapshot_sha256: string };
    expect(stored.snapshot).toBe(JSON.stringify(world)); expect(stored.snapshot_sha256).toBe(new Bun.CryptoHasher("sha256").update(stored.snapshot).digest("hex"));
    await b.store.delete("previous/name"); expect(await b.store.get(world.repo.fullName)).toBeNull();
    expect(await b.store.status()).toMatchObject({ worlds: 0, aliases: 0 });
  } finally { b.db.close(); }
});

test("SYNTHETIC D1 rejects demo/unknown license/invalid TTL, and an older writer cannot replace newer evidence", async () => {
  const b = binding(), world = fixture();
  try {
    for (const mutate of [(w: typeof world) => { w.source = "demo"; }, (w: typeof world) => { w.repo.license = null; }, (w: typeof world) => { w.headSha = "forged"; }]) {
      const invalid = structuredClone(world); mutate(invalid);
      expect((await b.rpc({ op: "put", snapshot: JSON.stringify(invalid), savedAt: now, expiresAt: now + 90_000 })).status).toBe(400);
    }
    expect((await b.rpc({ op: "put", snapshot: JSON.stringify(world), savedAt: now, expiresAt: now + 1 })).status).toBe(400);
    await b.store.put(world, 90_000, now + 10);
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
  const store = new D1WorldStore({ endpoint, secret }, failure);
  const service = createWorldService({ store, collector: { async collect(): Promise<RepoCollection> { collected++; throw new Error("not allowed"); } } });
  for (const read of [() => service.getCachedWorld("a/b"), () => service.loadWorld("a/b"), () => service.listFeatured(), () => service.storageStatus()]) {
    await expect(read()).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", status: 503 });
  }
  expect(collected).toBe(0);
  const malformed: Fetcher = async () => Response.json({ ok: true, backend: "sqlite", op: "getMany", result: [] });
  await expect(new D1WorldStore({ endpoint, secret }, malformed).get("a/b")).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" });
  expect(() => new D1WorldStore({ endpoint: "https://evil.example/_storage", secret })).toThrow();
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
  const store = new D1WorldStore({ endpoint, secret }, async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    return body.op === "getMany" ? Response.json({ ok: true, backend: "d1", op: "getMany", result: [] }) : new Response("unavailable", { status: 503 });
  });
  const service = createWorldService({ store, collector: { async collect() { collects++; return { repo: world.repo, headSha: world.headSha, collectedAt: world.collectedAt, tree: [], treeState: "unavailable", files: [], issues: [], pulls: [], workflows: [], commits: [], languages: {}, notes: ["SYNTHETIC offline collection"], partial: true, rateLimitRemaining: null }; } } });
  await expect(service.loadWorld(world.repo.fullName)).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", status: 503 });
  expect(collects).toBe(1); expect(service.activeCollections()).toBe(0);
});
