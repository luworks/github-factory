import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { D1HistoryStore, type HistoryD1Binding } from "../deploy/history-storage";
import { HistoryService, type HistoryServiceDependencies } from "../src/server/history-service";
import { HistoryCursorCodec, type HistoryCursorClaim } from "../src/server/history-cursor";
import { GitHubError } from "../src/server/github";
import { validateImmutableCommit } from "../src/history/topology";
import { syntheticWorld } from "./fixtures/browser-world";

// SYNTHETIC ONLY: isolated nonextractable signing key, fresh in-memory SQL and
// raw fake fetch; no real key/env/database/ledger or outgoing network access.
const repo = "synthetic-moonshot/browser-fixture", sha = (n: number) => n.toString(16).padStart(40, "0"), wall = "2026-11-04T18:00:00Z";
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
const metadata = () => ({ private: false, visibility: "public", full_name: repo, license: { spdx_id: "NOASSERTION" } });
const commit = (n: number) => ({ sha: sha(n), tree: { sha: sha(n + 1000) }, parents: n > 1 ? [{ sha: sha(n - 1) }] : [], author: { date: "original clock" }, committer: { date: null }, message: `SYNTHETIC 原始提交 ${n}` });
const tree = (n: number) => ({ sha: sha(n), truncated: false, tree: [{ path: "src", type: "tree", mode: "040000", sha: sha(9000) }, { path: "src/原始.ts", type: "blob", mode: "100644", sha: sha(9001) }] });
async function codec(fill = 7) { return new HistoryCursorCodec(await crypto.subtle.importKey("raw", new Uint8Array(32).fill(fill), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])); }
async function fixture(options: { head?: number; requestMs?: number } = {}) {
  const db = new Database(":memory:"); db.exec(readFileSync(new URL("../deploy/d1/0003-history.sql", import.meta.url), "utf8"));
  const statements = (sql: string, values: unknown[] = []) => ({ bind(...next: unknown[]) { return statements(sql, next); }, async all<T>() { return { success: true, results: db.query(sql).all(...values as any[]) as T[] }; }, async first<T>() { return db.query(sql).get(...values as any[]) as T | null; }, execute() { db.query(sql).run(...values as any[]); return { success: true }; } });
  const binding: HistoryD1Binding = { prepare: sql => statements(sql), async batch(rows) { return db.transaction(() => rows.map(s => (s as ReturnType<typeof statements>).execute()))(); } };
  const store = new D1HistoryStore(binding), key = await codec();
  let world: ReturnType<typeof syntheticWorld> | null = syntheticWorld();
  world.source = "github"; world.headSha = sha(options.head ?? 8); world.coverage.tree = "full"; world.health.github = "ok";
  let request = 0, collection = 0, taken = 0, cacheReads = 0, cacheFailure = false, requestFailure = false, collectionFailure = false;
  const calls: string[] = [], events: string[] = [];
  let intercept: ((url: URL) => Response | undefined | Promise<Response | undefined>) | undefined;
  const deps: HistoryServiceDependencies = {
    cache: { get: async (key, _now, settings) => { events.push("cache"); cacheReads++; expect(key).toBe(repo); expect(settings).toEqual({ readOnly: true }); if (cacheFailure) throw new Error("SYNTHETIC cache unavailable"); return world ? { world, fresh: false, expiresAt: 0 } : null; } },
    store, cursor: key, now: () => Date.parse("2026-11-05T00:00:00Z"),
    admitRequest: () => { events.push("request"); request++; if (requestFailure) throw new GitHubError("IP_RATE_LIMIT", 429, "Synthetic request admission.", 5); },
    admitCollection: () => { events.push("collection"); collection++; if (collectionFailure) throw new GitHubError("IP_RATE_LIMIT", 429, "Synthetic collection admission.", 9); },
    reader: { quota: { take() { events.push("quota"); taken++; } }, wallNow: () => wall, ...(options.requestMs ? { limits: { requestMs: options.requestMs, actionMs: 100 } } : {}), fetcher: async (input) => {
      events.push("fetch"); calls.push(String(input)); const url = new URL(String(input));
      if (url.origin !== "https://api.github.com") throw new Error("SYNTHETIC NETWORK BLOCKED");
      const response = await intercept?.(url); if (response) return response;
      if (url.pathname === `/repos/${repo}`) return json(metadata());
      const c = url.pathname.match(/\/git\/commits\/([a-f0-9]{40})$/); if (c) return json(commit(parseInt(c[1]!, 16)));
      const t = url.pathname.match(/\/git\/trees\/([a-f0-9]{40})$/); if (t) return json(tree(parseInt(t[1]!, 16)));
      throw new Error("SYNTHETIC UNEXPECTED URL");
    } },
  };
  return { db, binding, store, deps, service: new HistoryService(deps), calls, events, get request() { return request; }, get collection() { return collection; }, get taken() { return taken; }, get cacheReads() { return cacheReads; }, get world() { return world; }, set world(v) { world = v; }, intercept(fn: typeof intercept) { intercept = fn; }, denyRequest() { requestFailure = true; }, denyCollection() { collectionFailure = true; }, failCache() { cacheFailure = true; }, dump: () => JSON.stringify(["history_repositories", "history_commits", "history_anchors", "history_frames", "history_frame_chunks", "history_batches"].map(t => db.query(`SELECT * FROM ${t} ORDER BY rowid`).all())) };
}

test("SYNTHETIC actual reader/store first walk->persist->cache-only read->resume->selected frame roundtrip", async () => {
  const f = await fixture();
  try {
    const before = f.dump(), initial = await f.service.read(repo);
    expect(initial.history.status).toBe("missing-anchor"); expect(initial.capture.stale).toBe(true); expect(initial.capture.partial).toBe(false);
    expect(f.dump()).toBe(before); expect(f.calls).toHaveLength(0); expect(f.request).toBe(1); expect(f.collection).toBe(0);
    const first = await f.service.act(repo, { action: "walk", cursor: initial.token });
    expect(first.status).toBe("saved"); expect(first.error).toBeNull(); expect(first.observed?.persistence).toBe("not-persisted");
    expect(first.observed?.coverage).toMatchObject({ newCommits: 4, stopReason: "STEP_CAP", errors: [] });
    expect(first.persisted).toMatchObject({ commits: 4, frames: 0, batches: 1, cursor: { retainedCommits: 4, nextParentSha: sha(4), revision: 1 } });
    expect(f.request).toBe(2); expect(f.collection).toBe(1); expect(f.taken).toBe(5); expect(f.calls).toHaveLength(5);
    const frozen = f.dump(), calls = f.calls.length, page = await f.service.read(repo);
    expect(f.dump()).toBe(frozen); expect(f.calls).toHaveLength(calls); expect(page.history.commits.map(c => c.sha)).toEqual([8, 7, 6, 5].map(sha));
    const resumed = await f.service.act(repo, { action: "walk", cursor: page.token });
    expect(resumed.persisted.commits).toBe(4); expect(resumed.observed?.commits).toHaveLength(8); expect(resumed.persisted.cursor?.reachedRoot).toBe(true);
    const loaded = await f.service.act(repo, { action: "frames", cursor: resumed.token, members: [sha(8), sha(1)] });
    expect(loaded.error).toBeNull(); expect(loaded.persisted).toMatchObject({ commits: 0, frames: 2, batches: 1 });
    const finalCalls = f.calls.length, finalDump = f.dump(), read = await f.service.read(repo, { cursor: loaded.token, members: [sha(1), sha(8)] });
    expect(read.frames.map(v => v.status)).toEqual(["available", "available"]); expect(f.calls).toHaveLength(finalCalls); expect(f.dump()).toBe(finalDump);
    expect(f.request).toBe(6); expect(f.collection).toBe(3); expect(f.taken).toBe(13); expect(f.events[0]).toBe("request");
  } finally { f.db.close(); }
});

test("SYNTHETIC signed cursors reject stale, malformed, crossrepo, crosscapture and wrong key before collection/network", async () => {
  const f = await fixture();
  try {
    const initial = await f.service.read(repo), first = await f.service.act(repo, { action: "walk", cursor: initial.token });
    const before = f.dump(), calls = f.calls.length, admitted = f.collection;
    for (const token of [initial.token, "", "x.y", "a".repeat(2049), first.token!.replace(/.$/, first.token!.endsWith("A") ? "B" : "A"), await (await codec(8)).issue({ identity: initial.capture.identity, generation: initial.capture.anchor.generation, revision: 1 }), await f.deps.cursor.issue({ identity: { ...initial.capture.identity, repoKey: "other/repo" }, generation: initial.capture.anchor.generation, revision: 1 })]) {
      expect((await f.service.act(repo, { action: "walk", cursor: token })).error?.code).toBe("HISTORY_CURSOR_STALE");
    }
    f.world = { ...f.world!, collectedAt: "2026-11-04T17:00:00Z" };
    expect((await f.service.act(repo, { action: "walk", cursor: first.token })).error?.code).toBe("HISTORY_CURSOR_STALE");
    const newCapture = await f.service.read(repo); expect(newCapture.capture.anchor.generation).not.toBe(initial.capture.anchor.generation); expect(newCapture.history.status).toBe("missing-anchor");
    expect(f.dump()).toBe(before); expect(f.calls).toHaveLength(calls); expect(f.collection).toBe(admitted);
  } finally { f.db.close(); }
});

test("SYNTHETIC cache miss/error/invalid/demo and partial stale captures retain distinct cache-only outcomes", async () => {
  for (const variant of ["miss", "error", "invalid", "demo", "partial"] as const) {
    const f = await fixture();
    try {
      if (variant === "miss") f.world = null;
      if (variant === "error") f.failCache();
      if (variant === "invalid") f.world!.headSha = "main";
      if (variant === "demo") f.world!.source = "demo";
      if (variant === "partial") { f.world!.coverage.tree = "unavailable"; f.world!.health.github = "partial"; }
      if (variant === "partial") expect((await f.service.read(repo)).capture).toMatchObject({ stale: true, partial: true });
      else await expect(f.service.read(repo)).rejects.toMatchObject({ code: variant === "miss" ? "HISTORY_CACHE_MISSING" : variant === "error" ? "HISTORY_CACHE_UNAVAILABLE" : "HISTORY_CAPTURE_INVALID", status: variant === "miss" ? 404 : 503 });
      expect(f.calls).toHaveLength(0); expect(f.collection).toBe(0); expect(f.request).toBe(1); expect(f.db.query("SELECT * FROM history_anchors").all()).toHaveLength(0);
    } finally { f.db.close(); }
  }
});

test("SYNTHETIC exact action schema and retained-member selection reject every client override without collection", async () => {
  const f = await fixture();
  try {
    const initial = await f.service.read(repo), valid = { action: "walk", cursor: initial.token }, before = f.dump();
    for (const field of ["anchor", "anchorSha", "head", "headSha", "tree", "treeSha", "generation", "ref", "repo", "url", "sql", "prompt", "provider", "model", "limits", "nextParentSha", "expectedRevision"]) expect((await f.service.act(repo, { ...valid, [field]: "untrusted" })).error?.code).toBe("HISTORY_INVALID_REQUEST");
    for (const body of [{ action: "walk" }, { ...valid, members: [] }, { ...valid, action: "refresh" }, { ...valid, action: "frames", members: [] }, { ...valid, action: "frames", members: [sha(1), sha(1)] }, { ...valid, action: "frames", members: [sha(1), sha(2), sha(3)] }]) expect((await f.service.act(repo, body)).error?.code).toBe("HISTORY_INVALID_REQUEST");
    expect((await f.service.act(repo, { action: "frames", cursor: initial.token, members: [sha(99)] })).error?.code).toBe("HISTORY_MEMBER_UNKNOWN");
    expect(f.collection).toBe(0); expect(f.calls).toHaveLength(0); expect(f.dump()).toBe(before);
  } finally { f.db.close(); }
});

test("SYNTHETIC source-truncated valid frame persists explicit partial coverage; known root/frame capacity makes no extra upstream request", async () => {
  const f = await fixture({ head: 1 });
  try {
    const initial = await f.service.read(repo), saved = await f.service.act(repo, { action: "walk", cursor: initial.token });
    expect(saved.persisted.cursor?.reachedRoot).toBe(true); expect(saved.observed?.commits[0]?.message).toBe("SYNTHETIC 原始提交 1");
    const calls = f.calls.length, collections = f.collection;
    expect((await f.service.act(repo, { action: "walk", cursor: saved.token })).error?.code).toBe("HISTORY_WALK_STOPPED"); expect(f.calls).toHaveLength(calls); expect(f.collection).toBe(collections);
    const original = f.deps.store;
    f.deps.store = { page: async (...a) => { const p = await original.page(...a); return { ...p, retention: { ...p.retention, frames: 8 } }; }, frame: (...a) => original.frame(...a), append: batch => original.append(batch) };
    expect((await f.service.act(repo, { action: "frames", cursor: saved.token, members: [sha(1)] })).error?.code).toBe("HISTORY_CAPACITY"); expect(f.calls).toHaveLength(calls); expect(f.collection).toBe(collections);
    f.deps.store = original; f.intercept(url => url.pathname.includes("/git/trees/") ? json({ ...tree(1001), truncated: true }) : undefined);
    const loaded = await f.service.act(repo, { action: "frames", cursor: saved.token, members: [sha(1)] });
    expect(loaded.status).toBe("saved"); expect(loaded.error).toBeNull(); expect(loaded.observed?.frames[0]).toMatchObject({ completeness: "partial", sourceOmittedEntries: null });
    const read = await f.service.read(repo, { members: [sha(1)] }); expect(read.frames[0]?.status).toBe("available");
    if (read.frames[0]?.status === "available") expect(read.frames[0].frame.completeness).toBe("partial");
    for (const input of [{ url: "https://evil.test" }, { offset: 501 }, { offset: -1 }, { members: [sha(1), sha(2), sha(3)] }, { cursor: {} }]) await expect(f.service.read(repo, input)).rejects.toMatchObject({ code: "HISTORY_INVALID_REQUEST" });
  } finally { f.db.close(); }
});

test("SYNTHETIC errors/private/403/429/invalid JSON and partial observations never persist or advance", async () => {
  for (const variant of ["private", "403", "429", "json", "partial", "tree"] as const) {
    const f = await fixture({ head: 4 });
    try {
      let initial = await f.service.read(repo);
      if (variant === "tree") { const saved = await f.service.act(repo, { action: "walk", cursor: initial.token }); initial = await f.service.read(repo, { cursor: saved.token }); }
      f.intercept(url => variant === "private" && url.pathname === `/repos/${repo}` ? json({ ...metadata(), private: true }) : url.pathname.endsWith(`/commits/${sha(3)}`) && variant !== "tree" ? variant === "403" ? json({}, 403) : variant === "429" ? json({}, 429, { "retry-after": "7" }) : variant === "json" ? new Response("not json") : variant === "partial" ? json({ ...commit(3), parents: null }) : undefined : variant === "tree" && url.pathname.includes("/git/trees/") ? json({ ...tree(1004), tree: [...tree(1004).tree, { path: "bad", type: "blob", mode: "INVALID", sha: sha(20) }] }) : undefined);
      const before = f.dump(), result = await f.service.act(repo, { action: variant === "tree" ? "frames" : "walk", cursor: initial.token, ...(variant === "tree" ? { members: [sha(4)] } : {}) });
      expect(result.status).toBe("not-saved"); expect(result.error).not.toBeNull(); expect(result.persisted.batches).toBe(0); expect(f.dump()).toBe(before);
      if (variant === "429") expect(result.error).toMatchObject({ status: 429, retryAfter: 7 });
      if (["403", "429", "json", "partial"].includes(variant)) expect(result.observed!.commits.length).toBeGreaterThan(0);
    } finally { f.db.close(); }
  }
});

test("SYNTHETIC admission exactly once before cache; original collection and raw per-request quota are reused", async () => {
  const f = await fixture();
  try {
    const initial = await f.service.read(repo); f.denyCollection();
    const result = await f.service.act(repo, { action: "walk", cursor: initial.token });
    expect(result.error?.code).toBe("IP_RATE_LIMIT"); expect(f.request).toBe(2); expect(f.collection).toBe(1); expect(f.taken).toBe(0); expect(f.calls).toHaveLength(0);
    const cacheReads = f.cacheReads; f.denyRequest();
    expect((await f.service.act(repo, { action: "walk", cursor: initial.token })).error?.code).toBe("IP_RATE_LIMIT"); expect(f.cacheReads).toBe(cacheReads); expect(f.request).toBe(3);
    await expect(f.service.read(repo)).rejects.toMatchObject({ code: "IP_RATE_LIMIT" }); expect(f.cacheReads).toBe(cacheReads); expect(f.request).toBe(4);
  } finally { f.db.close(); }
});

test("SYNTHETIC service authority remains busy through persistence and does not share admission promises", async () => {
  const f = await fixture(); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), waiting = new Promise<void>(r => { entered = r; });
  try {
    const initial = await f.service.read(repo), original = f.deps.store;
    f.deps.store = { ...original, page: (...a) => original.page(...a), frame: (...a) => original.frame(...a), append: async batch => { entered(); await gate; return original.append(batch); } };
    const action = f.service.act(repo, { action: "walk", cursor: initial.token }); await waiting;
    const calls = f.calls.length, second = await new HistoryService(f.deps).act(repo, { action: "walk", cursor: initial.token });
    expect(second.error?.code).toBe("HISTORY_BUSY"); expect(f.request).toBe(3); expect(f.collection).toBe(1); expect(f.calls).toHaveLength(calls);
    release(); expect((await action).status).toBe("saved");
  } finally { release(); f.db.close(); }
});

test("SYNTHETIC timeout and late callback cannot save, and reader pending cancellation authority stays intact", async () => {
  const f = await fixture({ requestMs: 5 }); let release!: (v: Response) => void;
  try {
    const initial = await f.service.read(repo), before = f.dump();
    f.intercept(() => new Promise<Response>(r => { release = r; }));
    const result = await f.service.act(repo, { action: "walk", cursor: initial.token });
    expect(result.error?.code).toBe("HISTORY_REQUEST_TIMEOUT"); expect(f.dump()).toBe(before);
    expect((await f.service.act(repo, { action: "walk", cursor: initial.token })).error?.code).toBe("HISTORY_BUSY");
    release(json(metadata())); await Bun.sleep(0); expect(f.dump()).toBe(before); expect(result.persisted.batches).toBe(0);
  } finally { f.db.close(); }
});

test("SYNTHETIC changed capture after fetch rejects stale callback before any persistence", async () => {
  const f = await fixture({ head: 4 });
  try {
    const initial = await f.service.read(repo), before = f.dump();
    f.intercept(url => { if (url.pathname.endsWith(`/commits/${sha(1)}`)) f.world = { ...f.world!, collectedAt: "2026-11-04T17:00:00Z" }; return undefined; });
    const result = await f.service.act(repo, { action: "walk", cursor: initial.token });
    expect(result.error?.code).toBe("HISTORY_CAPTURE_CHANGED"); expect(result.observed?.commits).toHaveLength(4); expect(result.persisted.commits).toBe(0); expect(f.dump()).toBe(before);
  } finally { f.db.close(); }
});

test("SYNTHETIC store capacity/CAS/unavailable propagate honestly without retry/fallback and known cap stops before collection", async () => {
  for (const code of ["history-byte-cap", "history-revision-conflict", "history-storage-unavailable"]) {
    const f = await fixture();
    try {
      const initial = await f.service.read(repo), original = f.deps.store, before = f.dump(); let appends = 0;
      f.deps.store = { page: (...a) => original.page(...a), frame: (...a) => original.frame(...a), append: async () => { appends++; throw Object.assign(new Error("SYNTHETIC"), { code }); } };
      const result = await f.service.act(repo, { action: "walk", cursor: initial.token });
      expect(result.error?.code).toBe(code); expect(result.observed?.coverage.newCommits).toBe(4); expect(result.persisted.commits).toBe(0); expect(appends).toBe(1); expect(f.calls).toHaveLength(5); expect(f.dump()).toBe(before);
      f.deps.store = { ...f.deps.store, page: async (...a) => { const p = await original.page(...a); return { ...p, retention: { ...p.retention, receipts: 512 } }; } };
      const calls = f.calls.length; expect((await f.service.act(repo, { action: "walk", cursor: initial.token })).error?.code).toBe("HISTORY_CAPACITY"); expect(f.calls).toHaveLength(calls); expect(f.collection).toBe(1);
    } finally { f.db.close(); }
  }
});

test("SYNTHETIC stateless cursor restart/reissue binds same capture and actual revision", async () => {
  const f = await fixture();
  try {
    const initial = await f.service.read(repo), restarted = new HistoryService({ ...f.deps, cursor: await codec() });
    const saved = await restarted.act(repo, { action: "walk", cursor: initial.token }); expect(saved.status).toBe("saved");
    const reissued = await restarted.read(repo); expect(await f.deps.cursor.verify(reissued.token)).toMatchObject({ identity: initial.capture.identity, revision: 1 });
    expect((await f.service.act(repo, { action: "walk", cursor: saved.token })).status).toBe("saved");
  } finally { f.db.close(); }
});

test("SYNTHETIC 500-fact proof uses bounded pages, does not replay context into append, and page drift/invalid continuation rejects", async () => {
  const f = await fixture({ head: 500 });
  try {
    const initial = await f.service.read(repo); let cursor = initial.history.cursor;
    for (let n = 500; n >= 1; n -= 4) {
      const commits = Array.from({ length: Math.min(4, n) }, (_, i) => { const raw = commit(n - i), result = validateImmutableCommit({ schemaVersion: 1, repoKey: repo, sha: raw.sha, treeSha: raw.tree.sha, parents: raw.parents.map(p => p.sha), authorAt: raw.author.date, committerAt: null, message: raw.message, provenance: [{ sourceUrl: `https://api.github.com/repos/${repo}/git/commits/${raw.sha}`, fetchedAt: wall }], omittedProvenance: 0 }); if (!result.ok) throw new Error(result.code); return result.value; });
      cursor = (await f.store.append({ anchor: initial.capture.anchor, batchId: `seed_${n}`, actionId: `seed_${n}`, expectedRevision: cursor.revision, expectedCursor: cursor, unit: { kind: "commits", complete: true, commits } })).currentCursor;
    }
    const read = await f.service.read(repo), original = f.deps.store, offsets: number[] = [], batchSizes: number[] = [];
    f.deps.store = { page: async (...a) => { offsets.push(a[1] ?? 0); return original.page(...a); }, frame: (...a) => original.frame(...a), append: async batch => { batchSizes.push(batch.unit.kind === "commits" ? batch.unit.commits.length : batch.unit.frames.length); return original.append(batch); } };
    const loaded = await f.service.act(repo, { action: "frames", cursor: read.token, members: [sha(1)] });
    expect(loaded.status).toBe("saved"); expect(loaded.observed?.commits).toHaveLength(500); expect(loaded.persisted.commits).toBe(0); expect(batchSizes).toEqual([1]); expect(new Set(offsets.filter(n => n < 500)).size).toBe(10); expect(Math.max(...offsets.filter(n => n < 500))).toBe(450); expect(offsets.filter(n => n === 500)).toHaveLength(1);
    f.deps.store = { ...f.deps.store, page: async (...a) => { const p = await original.page(...a); return (a[1] ?? 0) === 50 ? { ...p, cursor: { ...p.cursor, revision: p.cursor.revision + 1 } } : p; } };
    const calls = f.calls.length; expect((await f.service.act(repo, { action: "frames", cursor: loaded.token, members: [sha(2)] })).error?.code).toBe("HISTORY_CONTEXT_DRIFT"); expect(f.calls).toHaveLength(calls);
    f.deps.store = { ...f.deps.store, page: async (...a) => { const p = await original.page(...a); return { ...p, nextOffset: 7 }; } };
    expect((await f.service.act(repo, { action: "frames", cursor: loaded.token, members: [sha(2)] })).error?.code).toBe("HISTORY_CONTEXT_INVALID");
  } finally { f.db.close(); }
});

function deferred() {
  let enter!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  return { enter, release, waiting, gate };
}

test("SYNTHETIC capture changes/miss/cache error during append or signing preserve accepted old-anchor counts and suppress publication", async () => {
  for (const boundary of ["append", "signing"] as const) for (const change of ["capture", "miss", "error"] as const) {
    const f = await fixture({ head: 4 }), pending = deferred();
    try {
      const initial = await f.service.read(repo), oldIdentity = structuredClone(initial.capture.identity), original = f.deps.store, signer = f.deps.cursor;
      if (boundary === "append") f.deps.store = { page: (...a) => original.page(...a), frame: (...a) => original.frame(...a), append: async batch => { pending.enter(); await pending.gate; return original.append(batch); } };
      else f.deps.cursor = { verify: (token: unknown) => signer.verify(token), issue: async (claim: HistoryCursorClaim) => { pending.enter(); await pending.gate; return signer.issue(claim); } } as unknown as HistoryCursorCodec;
      const action = f.service.act(repo, { action: "walk", cursor: initial.token }); await pending.waiting;
      const calls = f.calls.length;
      expect((await new HistoryService(f.deps).act(repo, { action: "walk", cursor: initial.token })).error?.code).toBe("HISTORY_BUSY"); expect(f.calls).toHaveLength(calls);
      if (change === "capture") f.world = { ...f.world!, collectedAt: "2026-11-04T17:00:00Z" };
      if (change === "miss") f.world = null;
      if (change === "error") f.failCache();
      pending.release(); const result = await action;
      expect(result).toMatchObject({ status: "partially-saved", token: null, capture: { identity: oldIdentity }, persisted: { commits: 4, frames: 0, batches: 1, cursor: { revision: 1, retainedCommits: 4, reachedRoot: true } }, error: { code: change === "capture" ? "HISTORY_CAPTURE_CHANGED" : change === "miss" ? "HISTORY_CACHE_MISSING" : "HISTORY_CACHE_UNAVAILABLE" } });
      expect(result.observed?.commits).toHaveLength(4); expect(result.observed?.persistence).toBe("not-persisted");
      const old = await f.store.page(initial.capture.anchor); expect(old.commits).toHaveLength(4); expect(old.cursor).toEqual(result.persisted.cursor!);
      expect(f.db.query("SELECT generation FROM history_anchors").all()).toEqual([{ generation: initial.capture.anchor.generation }]);
      const receipt = JSON.parse((f.db.query("SELECT payload FROM history_batches").get() as { payload: string }).payload);
      expect(receipt.acceptedCursor).toEqual(old.cursor); expect(receipt.anchorKey).toBe(JSON.stringify([initial.capture.anchor.sha, initial.capture.anchor.generation]));
      expect(f.request).toBe(3); expect(f.collection).toBe(1); expect(f.calls).toHaveLength(5);
    } finally { pending.release(); f.db.close(); }
  }
});

test("SYNTHETIC read signing publication guard rejects late capture/miss/error without collection or writes", async () => {
  for (const change of ["capture", "miss", "error"] as const) {
    const f = await fixture({ head: 4 }), pending = deferred();
    try {
      const signer = f.deps.cursor, before = f.dump();
      f.deps.cursor = { verify: (token: unknown) => signer.verify(token), issue: async (claim: HistoryCursorClaim) => { pending.enter(); await pending.gate; return signer.issue(claim); } } as unknown as HistoryCursorCodec;
      const read = f.service.read(repo), outcome = read.then(value => ({ value, error: null }), error => ({ value: null, error }));
      await pending.waiting;
      if (change === "capture") f.world = { ...f.world!, collectedAt: "2026-11-04T17:00:00Z" };
      if (change === "miss") f.world = null;
      if (change === "error") f.failCache();
      pending.release(); const result = await outcome;
      expect(result.value).toBeNull(); expect(result.error).toMatchObject({ code: change === "capture" ? "HISTORY_CAPTURE_CHANGED" : change === "miss" ? "HISTORY_CACHE_MISSING" : "HISTORY_CACHE_UNAVAILABLE" });
      expect(f.dump()).toBe(before); expect(f.request).toBe(1); expect(f.collection).toBe(0); expect(f.taken).toBe(0); expect(f.calls).toHaveLength(0);
    } finally { pending.release(); f.db.close(); }
  }
});

test("SYNTHETIC signing failure or superseded zero-unit action reports confirmed acceptance accurately", async () => {
  for (const accepted of [true, false]) for (const failure of ["signature", "capture"] as const) {
    const f = await fixture({ head: 4 }), pending = deferred();
    try {
      const initial = await f.service.read(repo), signer = f.deps.cursor, before = f.dump();
      if (!accepted) f.deps.reader.limits = { commitSteps: 0 };
      f.deps.cursor = { verify: (token: unknown) => signer.verify(token), issue: async (claim: HistoryCursorClaim) => { pending.enter(); await pending.gate; if (failure === "signature") throw new Error("SYNTHETIC signing failure"); return signer.issue(claim); } } as unknown as HistoryCursorCodec;
      const action = f.service.act(repo, { action: "walk", cursor: initial.token }); await pending.waiting;
      if (failure === "capture") f.world = { ...f.world!, collectedAt: "2026-11-04T17:00:00Z" };
      pending.release(); const result = await action;
      expect(result.status).toBe(accepted ? "partially-saved" : "not-saved"); expect(result.persisted).toMatchObject({ commits: accepted ? 4 : 0, frames: 0, batches: accepted ? 1 : 0 }); expect(result.token).toBeNull();
      expect(result.error?.code).toBe(failure === "capture" ? "HISTORY_CAPTURE_CHANGED" : "HISTORY_UNAVAILABLE");
      if (!accepted) expect(f.dump()).toBe(before);
      else expect((await f.store.page(initial.capture.anchor)).cursor).toEqual(result.persisted.cursor!);
    } finally { pending.release(); f.db.close(); }
  }
});

test("SYNTHETIC authority remains held through post-append validation and final signing settlement", async () => {
  const f = await fixture({ head: 4 }), pending = deferred();
  try {
    const initial = await f.service.read(repo), original = f.deps.store, cache = f.deps.cache; let committed = false, once = true;
    f.deps.store = { page: (...a) => original.page(...a), frame: (...a) => original.frame(...a), append: async batch => { const saved = await original.append(batch); committed = true; return saved; } };
    f.deps.cache = { get: async (...a) => { if (committed && once) { once = false; pending.enter(); await pending.gate; } return cache.get(...a); } };
    const action = f.service.act(repo, { action: "walk", cursor: initial.token }); await pending.waiting;
    expect((await f.store.page(initial.capture.anchor)).commits).toHaveLength(4);
    expect((await f.service.act(repo, { action: "walk", cursor: initial.token })).error?.code).toBe("HISTORY_BUSY");
    pending.release(); expect((await action).status).toBe("saved"); expect(f.request).toBe(3); expect(f.collection).toBe(1);
  } finally { pending.release(); f.db.close(); }
});

test("SYNTHETIC superseded accepted frame reports frame counts independently and preserves the prior commit receipt", async () => {
  const f = await fixture({ head: 1 }), pending = deferred();
  try {
    const initial = await f.service.read(repo), saved = await f.service.act(repo, { action: "walk", cursor: initial.token }), original = f.deps.store;
    const commitReceipt = f.db.query("SELECT payload FROM history_batches").get();
    f.deps.store = { page: (...a) => original.page(...a), frame: (...a) => original.frame(...a), append: async batch => { pending.enter(); await pending.gate; return original.append(batch); } };
    const action = f.service.act(repo, { action: "frames", cursor: saved.token, members: [sha(1)] }); await pending.waiting;
    f.world = { ...f.world!, collectedAt: "2026-11-04T17:00:00Z" }; pending.release(); const result = await action;
    expect(result).toMatchObject({ status: "partially-saved", token: null, capture: initial.capture, persisted: { commits: 0, frames: 1, batches: 1, cursor: { revision: 2, retainedCommits: 1 } }, error: { code: "HISTORY_CAPTURE_CHANGED" } });
    expect(f.db.query("SELECT payload FROM history_batches ORDER BY rowid LIMIT 1").get()).toEqual(commitReceipt);
    const retained = await f.store.page(initial.capture.anchor); expect(retained.retention).toMatchObject({ commits: 1, frames: 1, receipts: 2 }); expect(retained.cursor).toEqual(result.persisted.cursor!);
    expect(f.request).toBe(3); expect(f.collection).toBe(2);
  } finally { pending.release(); f.db.close(); }
});

test("SYNTHETIC cache-only signing failure returns no response/token and performs no mutation or collection", async () => {
  const f = await fixture();
  try {
    const signer = f.deps.cursor, before = f.dump();
    f.deps.cursor = { verify: (token: unknown) => signer.verify(token), issue: async () => { throw new Error("SYNTHETIC signing unavailable"); } } as unknown as HistoryCursorCodec;
    await expect(f.service.read(repo)).rejects.toMatchObject({ code: "HISTORY_UNAVAILABLE", status: 503 });
    expect(f.dump()).toBe(before); expect(f.request).toBe(1); expect(f.collection).toBe(0); expect(f.calls).toHaveLength(0);
  } finally { f.db.close(); }
});
