import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { historyStorageRpc, HISTORY_RPC_URL, HISTORY_SCHEMA3_SQL_SHA256, type HistoryRpcEnvironment } from "../deploy/history-rpc";
import type { HistoryD1Binding } from "../deploy/history-storage";
import { historyCursor, type HistoryAppendBatch, type HistoryCursor } from "../src/server/history-storage";
import { topologyFrameKey, validateImmutableCommit, validateImmutableTreeFrame } from "../src/history/topology";
import type { ImmutableCommit, ImmutableTreeFrame } from "../src/history/topology-contracts";

// SYNTHETIC ONLY. This dispatcher is not imported by any Worker entrypoint.
// All bindings are newly created SQLite fixtures; no env/key/ledger or network.
const repo = "synthetic-history/rpc", sha = (n: number) => n.toString(16).padStart(40, "0");
const storageSecret = "SYNTHETIC-only-history-storage-secret-32-chars", uuid = "11111111-1111-4111-8111-111111111111", nonce = "b".repeat(32), epoch = "c".repeat(32), sourceSha = "d".repeat(40), moduleSha = "e".repeat(64);
const sql1 = readFileSync(new URL("../deploy/d1/0001-world-cache.sql", import.meta.url), "utf8"), sql2 = readFileSync(new URL("../deploy/d1/0002-migration-identity.sql", import.meta.url), "utf8"), sql3 = readFileSync(new URL("../deploy/d1/0003-history.sql", import.meta.url), "utf8");
const anchor = (n: number, generation = "SYNTHETIC_generation") => ({ repoKey: repo, sha: sha(n), generation });
const commit = (n: number, parents: number[] | null = []): ImmutableCommit => { const r = validateImmutableCommit({ schemaVersion: 1, repoKey: repo, sha: sha(n), treeSha: sha(n + 1000), parents: parents?.map(sha) ?? null, authorAt: "原始作者 clock", committerAt: null, message: `SYNTHETIC 原始提交 ${n}`, provenance: [{ sourceUrl: `https://api.github.com/repos/${repo}/git/commits/${sha(n)}`, fetchedAt: "2026-11-04T18:00:00Z" }], omittedProvenance: 0 }); if (!r.ok) throw new Error(r.code); return r.value; };
const frame = (c: ImmutableCommit, count = 1, partial = false): ImmutableTreeFrame => { const r = validateImmutableTreeFrame({ schemaVersion: 1, repoKey: repo, commitSha: c.sha, treeSha: c.treeSha, scope: { prefix: partial ? "src" : "", recursive: true }, completeness: partial ? "partial" : "full", sourceOmittedEntries: partial ? null : 0, entries: Array.from({ length: count }, (_, i) => ({ path: `src/${i.toString().padStart(5, "0")}-原始🚀.ts`, type: "blob", sha: sha(i + 9000) })), provenance: [{ sourceUrl: `https://api.github.com/repos/${repo}/git/trees/${c.treeSha}?recursive=1`, fetchedAt: "2026-11-04T18:00:00Z" }], omittedProvenance: 0 }, c); if (!r.ok) throw new Error(r.code); return r.value; };
const append = (a: ReturnType<typeof anchor>, commits: ImmutableCommit[], cursor: HistoryCursor = historyCursor(a, [], 0), name = "batch_1"): HistoryAppendBatch => ({ anchor: a, batchId: name, actionId: `action_${name}`, expectedRevision: cursor.revision, expectedCursor: cursor, unit: { kind: "commits", complete: true, commits } });
const frameBatch = (a: ReturnType<typeof anchor>, frames: ImmutableTreeFrame[], cursor: HistoryCursor, name = "frames"): HistoryAppendBatch => ({ ...append(a, [], cursor, name), unit: { kind: "frames", complete: true, frames } });
const page = (a: ReturnType<typeof anchor>) => ({ op: "historyPage", anchor: a, offset: 0, limit: 50 });
const business = (s: string) => /(?:FROM|INTO|UPDATE|JOIN)\s+history_/i.test(s);
interface Options { path?: string; reopen?: boolean; historySql?: string; postCommitThrow?: boolean; beforeBatch?: () => void | Promise<void>; failRead?: boolean; falseRead?: boolean }
function fixture(options: Options = {}) {
  const db = new Database(options.path ?? ":memory:"); db.exec("PRAGMA foreign_keys=ON");
  if (!options.reopen) { db.exec(sql1); db.exec(sql2); db.exec(options.historySql ?? sql3); db.query("INSERT INTO storage_identity VALUES(1,?,?,?)").run(uuid, nonce, "2026-11-04T00:00:00Z"); db.query("INSERT INTO schema_migrations VALUES(3,?,?)").run("2026-11-04T00:00:00Z", HISTORY_SCHEMA3_SQL_SHA256); }
  const queries: string[] = []; let batches = 0, sessions = 0;
  const stmt = (sql: string, values: unknown[] = []) => ({ bind(...v: unknown[]) { return stmt(sql, v); }, async all<T>() { queries.push(sql); if (options.failRead) throw new Error(`SQL:${storageSecret}`); return { success: !options.falseRead, results: db.query(sql).all(...values as any[]) as T[] }; }, async first<T>() { queries.push(sql); if (options.failRead) throw new Error(`SQL:${storageSecret}`); return db.query(sql).get(...values as any[]) as T | null; }, execute() { queries.push(sql); db.query(sql).run(...values as any[]); return { success: true }; } });
  const binding: HistoryD1Binding = { prepare: sql => stmt(sql), async batch(statements) { batches++; await options.beforeBatch?.(); const result = db.transaction(() => statements.map(s => (s as ReturnType<typeof stmt>).execute()))(); if (options.postCommitThrow) throw new Error(`POST_COMMIT_TRANSPORT:${storageSecret}`); return result; }, withSession() { sessions++; return binding; } };
  const env: HistoryRpcEnvironment = { WORLDS_DB: binding, FACTORY_STORAGE_SECRET: storageSecret, FACTORY_STORAGE_MODE: "worlds", FACTORY_STORAGE_DATABASE_ID: uuid, FACTORY_STORAGE_BINDING_NONCE: nonce, FACTORY_MIGRATION_EPOCH: epoch, FACTORY_SOURCE_SHA: sourceSha, FACTORY_WORKER_BUNDLE_SHA256: moduleSha, FACTORY_ADMISSION_FENCE: "" };
  const request = (body: unknown, extra: { url?: string; method?: string; headers?: Record<string, string>; raw?: BodyInit } = {}) => new Request(extra.url ?? HISTORY_RPC_URL, { method: extra.method ?? "POST", headers: { "content-type": "application/json", "x-factory-storage-key": storageSecret, ...extra.headers }, ...((extra.method ?? "POST") === "GET" ? {} : { body: extra.raw ?? JSON.stringify(body), duplex: "half" } as RequestInit) });
  const rpc = (body: unknown, timeout?: number) => historyStorageRpc(request(body), env, timeout ? { bodyTimeoutMs: timeout } : {});
  const dump = () => JSON.stringify(["history_repositories", "history_commits", "history_anchors", "history_frames", "history_frame_chunks", "history_batches", "history_append_guards"].map(t => db.query(`SELECT * FROM ${t} ORDER BY rowid`).all()));
  return { db, binding, env, options, queries, request, rpc, dump, get batches() { return batches; }, get sessions() { return sessions; }, get business() { return queries.filter(business); } };
}

test("SYNTHETIC Request->authenticated RPC->actual store append/page/frame survives temporary file reopen with source/partial provenance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-history-rpc-synthetic-")), path = join(directory, "new.sqlite"), a = anchor(2); let f = fixture({ path });
  try {
    expect(new Bun.CryptoHasher("sha256").update(sql3).digest("hex")).toBe(HISTORY_SCHEMA3_SQL_SHA256);
    const empty = await (await f.rpc(page(a))).json(); expect(empty).toMatchObject({ ok: true, backend: "d1", op: "historyPage", schemaVersion: 3, identity: { databaseId: uuid, bindingNonce: nonce, epoch, sourceSha, workerBundleSha256: moduleSha, admissionFenced: false }, result: { status: "missing-anchor" } });
    const saved = await (await f.rpc({ op: "historyAppend", batch: append(a, [commit(2, [1]), commit(1)]) })).json(); expect(saved.result.currentCursor).toMatchObject({ retainedCommits: 2, reachedRoot: true });
    const partial = frame(commit(2, [1]), 2500, true), frames = await (await f.rpc({ op: "historyAppend", batch: frameBatch(a, [partial], saved.result.currentCursor) })).json(); expect(frames.ok).toBe(true);
    const before = f.dump(); f.db.close(); f = fixture({ path, reopen: true }); expect(f.dump()).toBe(before);
    const read = await (await f.rpc(page(a))).json(); expect(read.result.commits).toEqual([commit(2, [1]), commit(1)]); expect(read.result.commits[0].authorAt).toBe("原始作者 clock"); expect(read.result.commits[0].committerAt).toBeNull(); expect(read.result.total).toBeNull(); expect(read.result.completeHistory).toBe(false);
    const response = await f.rpc({ op: "historyFrame", anchor: a, frameKey: topologyFrameKey(partial) }); expect(response.status).toBe(200); expect((await response.json()).result).toEqual({ status: "available", frame: partial });
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(f.db.query("SELECT * FROM worlds").all()).toHaveLength(0); expect(f.db.query("SELECT * FROM world_aliases").all()).toHaveLength(0); expect(f.sessions).toBe(2);
  } finally { f.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("SYNTHETIC authentication precedes body and every D1 access; rejected/probe/unknown mode has zero business SQL", async () => {
  const f = fixture();
  try {
    for (const supplied of ["", "wrong", "x".repeat(257)]) { const req = f.request(page(anchor(1)), { headers: { "x-factory-storage-key": supplied } }); let bodyReads = 0; Object.defineProperty(req, "body", { get() { bodyReads++; throw new Error("BODY MUST NOT BE READ"); } }); const r = await historyStorageRpc(req, f.env); expect(r.status).toBe(403); expect(bodyReads).toBe(0); expect(f.queries).toHaveLength(0); expect(f.sessions).toBe(0); }
    for (const mode of [undefined, "", "probe-only", "history", "unknown"]) { f.env.FACTORY_STORAGE_MODE = mode; const req = f.request(page(anchor(1))); let reads = 0; Object.defineProperty(req, "body", { get() { reads++; throw new Error(); } }); expect((await historyStorageRpc(req, f.env)).status).toBe(503); expect(reads).toBe(0); }
    expect(f.business).toHaveLength(0); expect(f.queries).toHaveLength(0); expect(f.batches).toBe(0);
  } finally { f.db.close(); }
});

test("SYNTHETIC fixed endpoint/method/type and exact operations reject all SQL/URL/model/profile/import/delete overrides before database work", async () => {
  const f = fixture(), a = anchor(1), valid = page(a);
  try {
    for (const url of [HISTORY_RPC_URL + "?x=1", HISTORY_RPC_URL + "#fragment", HISTORY_RPC_URL + "/", HISTORY_RPC_URL.replace("chaorders.com", "evil.invalid"), HISTORY_RPC_URL.replace("https:", "http:"), HISTORY_RPC_URL.replace("chaorders.com", "chaorders.com:8443"), HISTORY_RPC_URL.replace("/_storage/history", "/_storage")]) expect((await historyStorageRpc(f.request(valid, { url }), f.env)).status).toBe(400);
    expect((await historyStorageRpc(f.request(valid, { method: "GET" }), f.env)).status).toBe(400); expect((await historyStorageRpc(f.request(valid, { headers: { "content-type": "text/plain" } }), f.env)).status).toBe(400);
    for (const op of ["status", "probe", "migrationImport", "delete", "sql", "reset", "getMany"]) expect((await f.rpc({ ...valid, op })).status).toBe(400);
    for (const field of ["sql", "url", "prompt", "code", "provider", "model", "budget", "profile", "identity", "backend", "binding", "epoch", "fence", "import", "delete", "limits"]) expect((await f.rpc({ ...valid, [field]: "untrusted" })).status).toBe(400);
    for (const patch of [{ offset: -1 }, { offset: 501 }, { offset: 1.5 }, { limit: 0 }, { limit: 51 }, { limit: "1" }, { anchor: { ...a, sha: "main" } }]) expect((await f.rpc({ ...valid, ...patch })).status).toBe(400);
    const b = append(a, [commit(1)]);
    for (const batch of [{ ...b, sql: "DELETE" }, { ...b, unit: { ...b.unit, complete: false } }, { ...b, unit: { ...b.unit, prompt: "code" } }, { ...b, unit: { kind: "commits", complete: true, commits: Array(5).fill(commit(1)) } }, { ...b, unit: { kind: "frames", complete: true, frames: Array(3).fill(frame(commit(1))) } }]) expect((await f.rpc({ op: "historyAppend", batch })).status).toBe(400);
    expect((await f.rpc({ op: "historyFrame", anchor: a, frameKey: "https://evil.invalid" })).status).toBe(400); expect(f.queries).toHaveLength(0); expect(f.batches).toBe(0);
  } finally { f.db.close(); }
});

test("SYNTHETIC actual2MiB body bound/fatalUTF8/deadline never waits for hung cancellation and never reaches business SQL", async () => {
  const f = fixture();
  try {
    for (const raw of ["not json", "[]", '{"op":"sql","op":"historyPage"}', '{"op":"historyPage","anchor":{"repoKey":"a/b","repoKey":"c/d"}}', "[".repeat(17) + "0" + "]".repeat(17), new Uint8Array([123, 34, 255, 34, 58, 49, 125])]) expect((await historyStorageRpc(f.request(null, { raw }), f.env)).status).toBe(400);
    expect((await historyStorageRpc(f.request(null, { raw: "x".repeat(2 * 1024 * 1024 + 1), headers: { "content-length": "1" } }), f.env)).status).toBe(413);
    expect((await historyStorageRpc(f.request(null, { raw: "{}", headers: { "content-length": String(2 * 1024 * 1024 + 1) } }), f.env)).status).toBe(413);
    let cancel = 0; const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { cancel++; return new Promise(() => {}); } });
    const timed = await historyStorageRpc(f.request(null, { raw: stream }), f.env, { bodyTimeoutMs: 5 }); expect(timed.status).toBe(408); expect((await timed.json()).code).toBe("HISTORY_RPC_BODY_TIMEOUT"); expect(cancel).toBe(1); expect(f.queries).toHaveLength(0); expect(f.batches).toBe(0);
  } finally { f.db.close(); }
});

test("SYNTHETIC exact2MiB valid body is accepted independently of smaller advertised length", async () => {
  const f = fixture();
  try {
    const text = JSON.stringify(page(anchor(1))), raw = text + " ".repeat(2 * 1024 * 1024 - text.length);
    const response = await historyStorageRpc(f.request(null, { raw, headers: { "content-length": "1" } }), f.env);
    expect(response.status).toBe(200); expect((await response.json()).result.status).toBe("missing-anchor"); expect(f.batches).toBe(0);
  } finally { f.db.close(); }
});

test("SYNTHETIC exact empty fence opens, exact epoch fence permits readonly but rejects append before all history SQL", async () => {
  const f = fixture(), a = anchor(1);
  try {
    const saved = await (await f.rpc({ op: "historyAppend", batch: append(a, [commit(1)]) })).json(), before = f.dump(); f.env.FACTORY_ADMISSION_FENCE = epoch;
    f.queries.length = 0; const held = await f.rpc({ op: "historyAppend", batch: append(a, [commit(1)], saved.result.currentCursor, "held") }); expect(held.status).toBe(503); expect(await held.json()).toMatchObject({ code: "STORAGE_MIGRATION_HOLD", writeOutcome: "not-started" }); expect(f.queries).toHaveLength(0); expect(f.dump()).toBe(before);
    const read = await (await f.rpc(page(a))).json(); expect(read.identity.admissionFenced).toBe(true); expect(typeof read.identity.admissionFenced).toBe("boolean"); expect(read.result.commits).toHaveLength(1);
    for (const fence of [undefined, " ", "false", "0", "open", epoch + " ", "f".repeat(32)]) { f.env.FACTORY_ADMISSION_FENCE = fence; f.queries.length = 0; expect((await f.rpc(page(a))).status).toBe(503); expect(f.queries).toHaveLength(0); }
  } finally { f.db.close(); }
});

test("SYNTHETIC logical UUID/nonce/source/module/epoch identity rejects missing or mismatched controls without history reads/writes", async () => {
  const f = fixture(), a = anchor(1);
  try {
    for (const [field, value] of [["FACTORY_STORAGE_DATABASE_ID", "22222222-2222-4222-8222-222222222222"], ["FACTORY_STORAGE_BINDING_NONCE", "a".repeat(32)], ["FACTORY_SOURCE_SHA", "main"], ["FACTORY_WORKER_BUNDLE_SHA256", "bad"], ["FACTORY_MIGRATION_EPOCH", ""], ["FACTORY_STORAGE_DATABASE_ID", "not-a-uuid"]] as const) { const old = f.env[field]; f.env[field] = value; expect((await f.rpc(page(a))).status).toBe(503); expect(f.business).toHaveLength(0); f.env[field] = old; }
    const binding = f.env.WORLDS_DB; f.env.WORLDS_DB = undefined; expect((await f.rpc(page(a))).status).toBe(503); expect(f.business).toHaveLength(0); f.env.WORLDS_DB = binding;
    f.db.query("DELETE FROM storage_identity").run(); expect((await f.rpc(page(a))).status).toBe(503); expect(f.business).toHaveLength(0);
  } finally { f.db.close(); }
});

test("SYNTHETIC schema3 claimed marker/hash alone never authorizes altered PK/UNIQUE/FK/CHECK/column/table contracts", async () => {
  const mutations = [
    sql3.replace("CHECK(accepted = 1)", "CHECK(accepted >= 0)"),
    sql3.replace(",\n  PRIMARY KEY(repo,sha)", ""),
    sql3.replace(",\n  UNIQUE(repo,generation)", ""),
    sql3.replace(",\n  UNIQUE(repo,anchor_key,action_id)", ""),
    sql3.replaceAll(" REFERENCES history_repositories(repo)", ""),
    sql3.replace(",\n  FOREIGN KEY(repo,frame_key) REFERENCES history_frames(repo,frame_key)", ""),
    sql3.replace("CHECK(chunk_count BETWEEN 1 AND 9)", "CHECK(chunk_count BETWEEN 1 AND 10)"),
    sql3.replace("payload_hash TEXT NOT NULL", "payload_hash TEXT"),
    sql3.replace("  payload TEXT NOT NULL,\n  PRIMARY KEY(repo,frame_key,ordinal)", "  payloadTEXTNOTNULL,\n  PRIMARY KEY(repo,frame_key,ordinal)"),
  ];
  for (const modified of mutations) {
    expect(modified).not.toBe(sql3); const f = fixture({ historySql: modified });
    try {
      if (modified.includes("payloadTEXTNOTNULL")) { const weak = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, "").toLowerCase(); expect(weak(modified)).toBe(weak(sql3)); }
      const r = await f.rpc(page(anchor(1))); expect(r.status).toBe(503); expect((await r.json()).code).toBe("HISTORY_STORAGE_SCHEMA_UNAVAILABLE"); expect(f.business).toHaveLength(0); expect(f.batches).toBe(0);
    }
    finally { f.db.close(); }
  }
  for (const alter of ["DROP TABLE history_frame_chunks", "CREATE TRIGGER history_unreviewed AFTER INSERT ON history_commits BEGIN DELETE FROM history_batches; END", "CREATE UNIQUE INDEX unreviewed_unique ON history_commits(repo,sha,payload)", "ALTER TABLE storage_identity ADD COLUMN unreviewed TEXT", "PRAGMA foreign_keys=OFF", "UPDATE schema_migrations SET sql_sha256='forged'", "INSERT INTO schema_migrations VALUES(4,'synthetic','future')"]) {
    const f = fixture();
    try { f.db.exec(alter); expect((await f.rpc({ op: "historyAppend", batch: append(anchor(1), [commit(1)]) })).status).toBe(503); expect(f.business).toHaveLength(0); expect(f.batches).toBe(0); }
    finally { f.db.close(); }
  }
});

test("SYNTHETIC actual store idempotency, immutable conflict, stale CAS and normalized frame semantic rejection are not-started and unchanged", async () => {
  const f = fixture(), a = anchor(2), first = append(a, [commit(2, [1])]);
  try {
    const saved = await (await f.rpc({ op: "historyAppend", batch: first })).json(), before = f.dump();
    const retry = await (await f.rpc({ op: "historyAppend", batch: first })).json(); expect(retry.result.idempotent).toBe(true); expect(f.dump()).toBe(before); expect(f.batches).toBe(1);
    const conflict = await f.rpc({ op: "historyAppend", batch: append(a, [{ ...commit(2, [1]), message: "immutable conflict" }], saved.result.currentCursor, "conflict") }); expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "immutable-commit-conflict", writeOutcome: "not-started" }); expect(f.dump()).toBe(before);
    const next = await (await f.rpc({ op: "historyAppend", batch: append(a, [commit(1)], saved.result.currentCursor, "next") })).json();
    const stale = await f.rpc({ op: "historyAppend", batch: append(a, [commit(1)], saved.result.currentCursor, "stale") }); expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: "history-revision-conflict", writeOutcome: "not-started" }); expect(f.batches).toBe(2);
    const valid = frame(commit(1)), bad = { ...valid, entries: [valid.entries[0], valid.entries[0]], inputEntryCount: 2 }, after = f.dump();
    const malformed = await f.rpc({ op: "historyAppend", batch: frameBatch(a, [bad as ImmutableTreeFrame], next.result.currentCursor) }); expect(malformed.status).toBe(400); expect(await malformed.json()).toMatchObject({ code: "normalized-duplicate-path", writeOutcome: "not-started" }); expect(f.dump()).toBe(after); expect(f.batches).toBe(2);
  } finally { f.db.close(); }
});

test("SYNTHETIC same-revision contenders retain one winner; initiated failing CAS stays unknown while definite stale preflight is distinct", async () => {
  const f = fixture(), a = anchor(2);
  try {
    const saved = await (await f.rpc({ op: "historyAppend", batch: append(a, [commit(2, [1])]) })).json();
    let arrivals = 0, release!: () => void; const gate = new Promise<void>(r => { release = r; }); f.options.beforeBatch = async () => { if (++arrivals === 2) release(); await gate; };
    const responses = await Promise.all([f.rpc({ op: "historyAppend", batch: append(a, [commit(1)], saved.result.currentCursor, "a") }), f.rpc({ op: "historyAppend", batch: append(a, [commit(1)], saved.result.currentCursor, "b") })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 503]); const results = await Promise.all(responses.map(r => r.json())); expect(results.find(r => !r.ok)).toMatchObject({ code: "HISTORY_WRITE_OUTCOME_UNKNOWN", writeOutcome: "unknown" });
    expect((await (await f.rpc(page(a))).json()).result.cursor).toMatchObject({ revision: 2, retainedCommits: 2 }); expect(f.db.query("SELECT * FROM history_batches").all()).toHaveLength(2); expect(f.batches).toBe(3);
  } finally { f.db.close(); }
});

test("SYNTHETIC real retention cap rejects new frame before mutation without resetting or evicting facts", async () => {
  const f = fixture(), a = anchor(9); let cursor = historyCursor(a, [], 0); const facts = Array.from({ length: 9 }, (_, i) => commit(9 - i, i < 8 ? [8 - i] : []));
  try {
    for (let i = 0; i < facts.length; i += 4) cursor = (await (await f.rpc({ op: "historyAppend", batch: append(a, facts.slice(i, i + 4), cursor, `seed_${i}`) })).json()).result.currentCursor;
    for (let i = 0; i < 8; i += 2) cursor = (await (await f.rpc({ op: "historyAppend", batch: frameBatch(a, facts.slice(i, i + 2).map(c => frame(c)), cursor, `frames_${i}`) })).json()).result.currentCursor;
    const before = f.dump(), batches = f.batches, rejected = await f.rpc({ op: "historyAppend", batch: frameBatch(a, [frame(facts[8]!)], cursor, "over_cap") });
    expect(rejected.status).toBe(429); expect(await rejected.json()).toMatchObject({ code: "history-frame-cap", writeOutcome: "not-started" }); expect(f.dump()).toBe(before); expect(f.batches).toBe(batches);
  } finally { f.db.close(); }
});

test("SYNTHETIC post-commit binding exception is explicitly unknown, has no retry, and never leaks SQL/secret/cause", async () => {
  const f = fixture({ postCommitThrow: true }), a = anchor(1), batch = append(a, [commit(1)]);
  try {
    const response = await f.rpc({ op: "historyAppend", batch }), text = await response.text(); expect(response.status).toBe(503); expect(JSON.parse(text)).toMatchObject({ code: "HISTORY_WRITE_OUTCOME_UNKNOWN", writeOutcome: "unknown" }); expect(text).not.toContain(storageSecret); expect(text).not.toContain("POST_COMMIT"); expect(f.batches).toBe(1);
    f.options.postCommitThrow = false; const observed = await (await f.rpc(page(a))).json(); expect(observed.result.commits).toHaveLength(1); expect(observed.result.cursor.revision).toBe(1);
    const explicitRetry = await (await f.rpc({ op: "historyAppend", batch })).json(); expect(explicitRetry.result.idempotent).toBe(true); expect(f.batches).toBe(1);
    f.options.failRead = true; const unavailable = await f.rpc(page(a)), error = await unavailable.text(); expect(unavailable.status).toBe(503); expect(error).not.toContain(storageSecret); expect(error).not.toContain("SQL:"); expect(JSON.parse(error).writeOutcome).toBe("not-started");
  } finally { f.db.close(); }
});
