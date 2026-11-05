import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { D1RpcHistoryStore, type HistoryRpcStoreConfig } from "../src/server/d1-history-store";
import { HISTORY_RPC_URL, HISTORY_SCHEMA3_SQL_SHA256 } from "../src/server/history-rpc-contract";
import { historyStorageRpc, type HistoryRpcEnvironment } from "../deploy/history-rpc";
import type { HistoryD1Binding } from "../deploy/history-storage";
import { historyCursor, type HistoryAppendBatch, type HistoryCursor } from "../src/server/history-storage";
import { validateImmutableCommit, validateImmutableTreeFrame, topologyFrameKey } from "../src/history/topology";
import { HistoryService } from "../src/server/history-service";
import { HistoryCursorCodec } from "../src/server/history-cursor";
import { createHistoryHttp } from "../src/server/history-http";
import { syntheticWorld } from "./fixtures/browser-world";

// SYNTHETIC ONLY: actual client/dispatcher/store, fresh SQLite, fake raw fetch.
// No env/key/ledger/existing DB or actual network; every transport is injected.
const repo = "synthetic-moonshot/browser-fixture", sha = (n: number) => n.toString(16).padStart(40, "0"), secret = "SYNTHETIC-storage-client-secret-at-least-32";
const config: HistoryRpcStoreConfig = { endpoint: HISTORY_RPC_URL, secret, identity: { databaseId: "11111111-1111-4111-8111-111111111111", bindingNonce: "a".repeat(32), epoch: "b".repeat(32), sourceSha: "c".repeat(40), workerBundleSha256: "d".repeat(64) } };
const anchor = (n: number) => ({ repoKey: repo, sha: sha(n), generation: "SYNTHETIC_client" });
const commit = (n: number, parents: number[] = []) => { const r = validateImmutableCommit({ schemaVersion: 1, repoKey: repo, sha: sha(n), treeSha: sha(n + 1000), parents: parents.map(sha), authorAt: "原始 clock", committerAt: null, message: `SYNTHETIC 原始 ${n}`, provenance: [{ sourceUrl: `https://api.github.com/repos/${repo}/git/commits/${sha(n)}`, fetchedAt: "2026-11-04T18:00:00Z" }], omittedProvenance: 0 }); if (!r.ok) throw Error(r.code); return r.value; };
const batch = (n = 1, cursor: HistoryCursor = historyCursor(anchor(n), [], 0), id = "first"): HistoryAppendBatch => ({ anchor: anchor(n), batchId: id, actionId: id, expectedRevision: cursor.revision, expectedCursor: cursor, unit: { kind: "commits", complete: true, commits: [commit(n)] } });
function frame(c = commit(1)) { const r = validateImmutableTreeFrame({ schemaVersion: 1, repoKey: repo, commitSha: c.sha, treeSha: c.treeSha, scope: { prefix: "src", recursive: true }, completeness: "partial", sourceOmittedEntries: null, entries: [{ path: "src/原始🚀.ts", type: "blob", sha: sha(9000) }], provenance: [{ sourceUrl: `https://api.github.com/repos/${repo}/git/trees/${c.treeSha}?recursive=1`, fetchedAt: "2026-11-04T18:00:00Z" }], omittedProvenance: 0 }, c); if (!r.ok) throw Error(r.code); return r.value; }
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
function deferred<T = void>() { let resolve!: (v: T | PromiseLike<T>) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; }
function fixture(limits: ConstructorParameters<typeof D1RpcHistoryStore>[2] = {}, clock?: () => number) {
  const db = new Database(":memory:"); db.exec("PRAGMA foreign_keys=ON"); for (const name of ["0001-world-cache.sql", "0002-migration-identity.sql", "0003-history.sql"]) db.exec(readFileSync(new URL(`../deploy/d1/${name}`, import.meta.url), "utf8"));
  db.query("INSERT INTO storage_identity VALUES(1,?,?,?)").run(config.identity.databaseId, config.identity.bindingNonce, "SYNTHETIC"); db.query("INSERT INTO schema_migrations VALUES(3,'SYNTHETIC',?)").run(HISTORY_SCHEMA3_SQL_SHA256);
  const statement = (sql: string, values: unknown[] = []) => ({ bind(...v: unknown[]) { return statement(sql, v); }, async all<T>() { return { success: true, results: db.query(sql).all(...values as any[]) as T[] }; }, async first<T>() { return db.query(sql).get(...values as any[]) as T | null; }, execute() { db.query(sql).run(...values as any[]); return { success: true }; } });
  let batches = 0; const binding: HistoryD1Binding = { prepare: sql => statement(sql), async batch(rows) { batches++; return db.transaction(() => rows.map(s => (s as ReturnType<typeof statement>).execute()))(); } };
  const env: HistoryRpcEnvironment = { WORLDS_DB: binding, FACTORY_STORAGE_SECRET: secret, FACTORY_STORAGE_MODE: "worlds", FACTORY_STORAGE_DATABASE_ID: config.identity.databaseId, FACTORY_STORAGE_BINDING_NONCE: config.identity.bindingNonce, FACTORY_MIGRATION_EPOCH: config.identity.epoch, FACTORY_SOURCE_SHA: config.identity.sourceSha, FACTORY_WORKER_BUNDLE_SHA256: config.identity.workerBundleSha256, FACTORY_ADMISSION_FENCE: "" };
  const calls: { request: Request; body: any; init: RequestInit }[] = [];
  let intercept: ((request: Request, actual: () => Promise<Response>, op: any) => Response | Promise<Response>) | undefined;
  const network = async (input: string | URL | Request, init: RequestInit = {}) => { const r = new Request(input, init), op = JSON.parse(String(init.body)); calls.push({ request: r, body: op, init }); if (r.url !== HISTORY_RPC_URL) throw Error("SYNTHETIC NETWORK BLOCKED"); const actual = () => historyStorageRpc(r, env); return intercept ? intercept(r, actual, op) : actual(); };
  const store = new D1RpcHistoryStore(config, network, limits, clock);
  return { db, env, store, network, calls, get batches() { return batches; }, intercept(fn: typeof intercept) { intercept = fn; } };
}

test("SYNTHETIC actual client->dispatcher->SQLite page/append/idempotency/frame real proof and held readonly roundtrip", async () => {
  const f = fixture();
  try {
    expect(f.calls).toHaveLength(0); expect((await f.store.page(anchor(1))).status).toBe("missing-anchor");
    const input = batch(), saved = await f.store.append(input); expect(saved.currentCursor.reachedRoot).toBe(true); expect((await f.store.append(input)).idempotent).toBe(true); expect(f.batches).toBe(1);
    const p = await f.store.page(anchor(1)); expect(p.commits).toEqual([commit(1)]); expect(p.total).toBeNull(); expect(p.completeHistory).toBe(false);
    const tree = frame(), frames: HistoryAppendBatch = { ...batch(1, saved.currentCursor, "frame"), unit: { kind: "frames", complete: true, frames: [tree] } };
    await f.store.append(frames); expect(await f.store.frame(anchor(1), topologyFrameKey(tree))).toEqual({ status: "available", frame: tree });
    f.env.FACTORY_ADMISSION_FENCE = config.identity.epoch; expect((await f.store.page(anchor(1))).status).toBe("available");
    expect(await f.store.frame(anchor(1), topologyFrameKey(tree))).toEqual({ status: "available", frame: tree });
    for (const call of f.calls) { expect(call.request.url).toBe(HISTORY_RPC_URL); expect(call.init.redirect).toBe("error"); expect(call.request.headers.get("x-factory-storage-key")).toBe(secret); }
    expect(f.store.observeSettlement().idle).toBe(true);
  } finally { f.db.close(); }
});

test("SYNTHETIC local config/operation/request bound failures are definitely not-started with zero dispatch", async () => {
  const f = fixture();
  try {
    for (const endpoint of [HISTORY_RPC_URL + "?x=1", HISTORY_RPC_URL + "#x", HISTORY_RPC_URL.replace("chaorders.com", "evil.invalid"), HISTORY_RPC_URL.replace("chaorders.com", "chaorders.com:443")]) expect(() => new D1RpcHistoryStore({ ...config, endpoint }, f.network)).toThrow();
    expect(() => new D1RpcHistoryStore({ ...config, secret: "" }, f.network)).toThrow(); expect(() => new D1RpcHistoryStore(config, f.network, { timeoutMs: 10001 })).toThrow();
    for (const action of [() => f.store.page(anchor(1), 501), () => f.store.page(anchor(1), 0, 51), () => f.store.frame(anchor(1), "https://evil.invalid"), () => f.store.append({ ...batch(), prompt: "write code" } as any), () => new D1RpcHistoryStore(config, f.network, { requestBytes: 1 }).append(batch())]) await expect(action()).rejects.toMatchObject({ writeOutcome: "not-started", code: "HISTORY_RPC_INVALID_REQUEST" });
    expect(f.calls).toHaveLength(0); expect(f.store.observeSettlement().idle).toBe(true);
  } finally { f.db.close(); }
});

test("SYNTHETIC wrong identity/op/schema/fence/types/DTOs reject; no malformed normalized data becomes a success", async () => {
  const f = fixture();
  try {
    await f.store.append(batch());
    const mutations = [(w: any) => { w.backend = "sqlite"; }, (w: any) => { w.op = "historyFrame"; }, (w: any) => { w.schemaVersion = "3"; }, (w: any) => { w.identity.admissionFenced = "false"; }, (w: any) => { w.result.commits = [null]; }, (w: any) => { w.result.total = 1; }, (w: any) => { w.result.completeHistory = true; }, (w: any) => { w.result.cursor.reachedRoot = null; }, (w: any) => { w.result.retention.normalizedBytes = -1; }, (w: any) => { w.result.commits[0].provenance.push(w.result.commits[0].provenance[0]); }];
    for (const field of Object.keys(config.identity)) mutations.push((w: any) => { w.identity[field] = "mismatch"; });
    for (const mutate of mutations) { f.intercept(async (_r, actual) => { const w = await (await actual()).json(); mutate(w); return json(w); }); await expect(f.store.page(anchor(1))).rejects.toMatchObject({ code: "HISTORY_STORAGE_UNAVAILABLE", writeOutcome: "not-started" }); }
  } finally { f.db.close(); }
});

test("SYNTHETIC available frame requires real matching proof and original normalized coverage, never a fabricated commit", async () => {
  const f = fixture(), tree = frame();
  try {
    const saved = await f.store.append(batch()); await f.store.append({ ...batch(1, saved.currentCursor, "frame"), unit: { kind: "frames", complete: true, frames: [tree] } });
    for (const mutate of [(w: any) => { delete w.proofCommit; }, (w: any) => { w.proofCommit = null; }, (w: any) => { w.proofCommit.sha = sha(99); }, (w: any) => { w.proofCommit.treeSha = sha(99); }, (w: any) => { w.result.frame.entries.push(w.result.frame.entries[0]); w.result.frame.inputEntryCount++; }, (w: any) => { w.result.frame.sourceCompleteness = undefined; }]) {
      f.intercept(async (_r, actual) => { const w = await (await actual()).json(); mutate(w); return json(w); }); await expect(f.store.frame(anchor(1), topologyFrameKey(tree))).rejects.toMatchObject({ code: "HISTORY_STORAGE_UNAVAILABLE" });
    }
  } finally { f.db.close(); }
});

test("SYNTHETIC verified preflight conflict is not-started; unsigned/WAF/malformed/identity-mismatched append rejection is UNKNOWN", async () => {
  const f = fixture();
  try {
    const saved = await f.store.append(batch());
    await expect(f.store.append({ ...batch(1, saved.currentCursor, "conflict"), unit: { kind: "commits", complete: true, commits: [{ ...commit(1), message: "conflict" }] } })).rejects.toMatchObject({ code: "immutable-commit-conflict", writeOutcome: "not-started" });
    for (const r of [() => new Response("WAF403 secret", { status: 403 }), () => json({ ok: false, backend: "d1", code: "history-revision-conflict", error: secret, writeOutcome: "not-started" }, 409), () => json({ ok: false, backend: "d1", op: "historyAppend", identity: { ...config.identity, sourceSha: "f".repeat(40), admissionFenced: false }, schemaVersion: 3, code: "history-revision-conflict", error: secret, writeOutcome: "not-started" }, 409)]) {
      f.intercept(() => r()); await expect(f.store.append(batch())).rejects.toMatchObject({ code: "HISTORY_WRITE_OUTCOME_UNKNOWN", writeOutcome: "unknown" });
    }
    expect(f.batches).toBe(1);
  } finally { f.db.close(); }
});

test("SYNTHETIC commit followed by lost response remains UNKNOWN, no retry; explicit later read/replay can confirm", async () => {
  const f = fixture();
  try {
    f.intercept(async (_r, actual) => { await actual(); throw new Error(`SQL:${secret}`); });
    let error: any; try { await f.store.append(batch()); } catch (e) { error = e; }
    expect(error).toMatchObject({ code: "HISTORY_WRITE_OUTCOME_UNKNOWN", writeOutcome: "unknown" }); expect(error.message).not.toContain(secret); expect(f.calls).toHaveLength(1); expect(f.batches).toBe(1);
    f.intercept(undefined); expect((await f.store.page(anchor(1))).commits).toHaveLength(1); expect((await f.store.append(batch())).idempotent).toBe(true); expect(f.batches).toBe(1);
  } finally { f.db.close(); }
});

test("SYNTHETIC redirects/final URL/UTF8/duplicates/actual-byte bound and normalization publication deadline are failclosed", async () => {
  const f = fixture();
  try {
    for (const produce of [() => new Response("redirect", { status: 302, headers: { location: "https://evil.invalid" } }), () => { const r = json({}); Object.defineProperty(r, "url", { value: "https://evil.invalid" }); return r; }, () => new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }), () => new Response('{"ok":false,"ok":true}', { headers: { "content-type": "application/json" } }), () => new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json", "content-length": "1" } })]) { f.intercept(() => produce()); await expect(f.store.append(batch())).rejects.toMatchObject({ code: "HISTORY_WRITE_OUTCOME_UNKNOWN" }); }
    let ticks = 0; const g = fixture({ timeoutMs: 1000 }, () => ++ticks > 9 ? 2000 : 0);
    try { await expect(g.store.page(anchor(1))).rejects.toMatchObject({ code: "HISTORY_STORAGE_UNAVAILABLE" }); expect(ticks).toBeGreaterThan(9); expect(g.calls).toHaveLength(1); } finally { g.db.close(); }
  } finally { f.db.close(); }
});

test("SYNTHETIC raw late fetch transfers continuously to pending cancel; observers isolate stores and concurrent calls", async () => {
  for (const reject of [false, true]) {
    const f = fixture({ timeoutMs: 5 }), late = deferred<Response>(), cleanup = deferred<void>();
    try {
      f.intercept(() => late.promise); await expect(f.store.append(batch())).rejects.toMatchObject({ writeOutcome: "unknown" });
      const seen = f.store.observeSettlement(); expect(seen.idle).toBe(false); let settled = false; seen.settled.then(() => { settled = true; });
      late.resolve(new Response(new ReadableStream({ cancel() { return cleanup.promise; } }))); await Bun.sleep(0); expect(settled).toBe(false); expect(f.store.observeSettlement().idle).toBe(false);
      const other = fixture(); try { expect(other.store.observeSettlement().idle).toBe(true); } finally { other.db.close(); }
      if (reject) cleanup.reject(new Error("SYNTHETIC cancelled")); else cleanup.resolve(); await seen.settled; expect(settled).toBe(true); expect(f.store.observeSettlement().idle).toBe(true);
    } finally { cleanup.resolve(); f.db.close(); }
  }
});

test("SYNTHETIC concurrent RPC calls and shared waiters cannot release another pending call", async () => {
  const f = fixture({ timeoutMs: 5 }), first = deferred<Response>(), second = deferred<Response>(), a = deferred<void>(), b = deferred<void>(); let n = 0;
  try {
    f.intercept(() => ++n === 1 ? first.promise : second.promise);
    const results = await Promise.allSettled([f.store.page(anchor(1)), f.store.page(anchor(2))]); expect(results.every(r => r.status === "rejected")).toBe(true);
    const one = f.store.observeSettlement(), two = f.store.observeSettlement(); let done = 0; one.settled.then(() => done++); two.settled.then(() => done++);
    first.resolve(new Response(new ReadableStream({ cancel() { return a.promise; } }))); await Bun.sleep(0); a.resolve(); await Bun.sleep(0); expect(done).toBe(0); expect(f.store.observeSettlement().idle).toBe(false);
    second.resolve(new Response(new ReadableStream({ cancel() { return b.promise; } }))); await Bun.sleep(0); expect(done).toBe(0); b.resolve(); await Promise.all([one.settled, two.settled]); expect(done).toBe(2); expect(f.store.observeSettlement().idle).toBe(true);
  } finally { a.resolve(); b.resolve(); f.db.close(); }
});

test("SYNTHETIC append acknowledgements require genuine open fence, boolean idempotency, coherent cursors and retention", async () => {
  const f = fixture();
  try {
    for (const mutate of [(w: any) => { w.identity.admissionFenced = true; }, (w: any) => { w.result.idempotent = 1; }, (w: any) => { w.result.acceptedCursor.revision = 999; }, (w: any) => { w.result.currentCursor.retainedCommits = 0; }, (w: any) => { w.result.retention.receipts = 0; }]) {
      f.intercept(async (_r, actual) => { const w = await (await actual()).json(); mutate(w); return json(w); }); await expect(f.store.append(batch())).rejects.toMatchObject({ code: "HISTORY_WRITE_OUTCOME_UNKNOWN", writeOutcome: "unknown" });
    }
    expect(f.batches).toBe(1);
  } finally { f.db.close(); }
});

test("SYNTHETIC actual RPC-backed service/HTTP roundtrip and lost commit acknowledgement report confirmed and uncertain units separately", async () => {
  const f = fixture();
  try {
    const world = syntheticWorld(); world.source = "github"; world.headSha = sha(8); world.coverage.tree = "full"; world.health.github = "ok";
    const key = new HistoryCursorCodec(await crypto.subtle.importKey("raw", new Uint8Array(32).fill(9), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
    let requests = 0, collections = 0, github = 0;
    const quota = { take() {} };
    const handle = createHistoryHttp({ authenticate: () => ({ gatewayAuthenticated: true, requestAdmitted: true, identity: "a".repeat(64), admitCollection: () => { collections++; } }), lifecycle: { held: () => false, run: work => work(p => { void p.catch(() => {}); }) }, revokePublicCapture() {}, makeService: admission => new HistoryService({ ...admission, admitRequest: () => { requests++; admission.admitRequest(); }, cache: { get: async () => ({ world, fresh: false, expiresAt: 0 }) }, store: f.store, cursor: key, now: () => Date.parse("2026-11-05T00:00:00Z"), reader: { quota, wallNow: () => "2026-11-04T18:00:00Z", fetcher: async input => { github++; const p = new URL(String(input)).pathname; if (p.endsWith(`/repos/${repo}`)) return json({ private: false, visibility: "public", full_name: repo, license: null }); const n = parseInt(p.split("/").at(-1)!, 16); if (p.includes("/git/trees/")) return json({ sha: sha(n), truncated: false, tree: [{ path: "src/原始.ts", type: "blob", mode: "100644", sha: sha(9000) }] }); return json({ sha: sha(n), tree: { sha: sha(n + 1000) }, parents: n > 1 ? [{ sha: sha(n - 1) }] : [], author: { date: "原始 clock" }, committer: { date: null }, message: `SYNTHETIC ${n}` }); } } }) });
    const path = `/prefix/api/history/${repo}`, origin = "https://synthetic.invalid", ctx = { repo, path, publicOrigin: origin }, req = (body?: unknown) => new Request(origin + path, { method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const first = await (await handle(req(), ctx)).json(); expect(github).toBe(0); expect(f.calls).toHaveLength(2);
    let lose = true; f.intercept(async (_r, actual, op) => { const r = await actual(); if (op.op === "historyAppend" && lose) { lose = false; throw new Error(secret); } return r; });
    const failed = await handle(req({ action: "walk", cursor: first.token }), ctx), result = await failed.json();
    expect(failed.status).toBe(503); expect(result).toMatchObject({ status: "save-unconfirmed", token: null, error: { code: "HISTORY_WRITE_OUTCOME_UNKNOWN" }, persisted: { commits: 0, frames: 0, batches: 0 }, unconfirmed: { kind: "commits", commits: 4, frames: 0, writeOutcome: "unknown" } }); expect(result.observed.persistence).toBe("not-persisted"); expect(f.batches).toBe(1); expect(f.calls.filter(c => c.body.op === "historyAppend")).toHaveLength(1);
    const after = await (await handle(req(), ctx)).json(); expect(after.history.commits).toHaveLength(4); expect(after.history.cursor.revision).toBe(1); expect(github).toBe(5);
    const resumed = await (await handle(req({ action: "walk", cursor: after.token }), ctx)).json(); expect(resumed.status).toBe("saved"); expect(resumed.persisted.commits).toBe(4);
    const frames = await (await handle(req({ action: "frames", cursor: resumed.token, members: [sha(1)] }), ctx)).json(); expect(frames.status).toBe("saved"); expect(frames.persisted.frames).toBe(1);
    lose = true; const lostFrame = await (await handle(req({ action: "frames", cursor: frames.token, members: [sha(1)] }), ctx)).json();
    expect(lostFrame).toMatchObject({ status: "save-unconfirmed", token: null, persisted: { commits: 0, frames: 0, batches: 0, cursor: frames.persisted.cursor }, unconfirmed: { kind: "frames", commits: 0, frames: 1, writeOutcome: "unknown" } });
    expect(requests).toBe(6); expect(collections).toBe(4);
  } finally { f.db.close(); }
});
