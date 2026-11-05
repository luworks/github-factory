import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Only the isolated child imports/calls the original counter. projectEnv() must
// see a fresh empty cwd and a minimal env, never this checkout's .env or keys.
if (process.env.HISTORY_LIFECYCLE_SYNTHETIC_CHILD !== "1") {
  test("SYNTHETIC original-counter integration runs only in an empty-cwd minimal-env child Bun", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-lifecycle-synthetic-")), cwd = join(directory, "empty"); mkdirSync(cwd);
    try {
      expect(readdirSync(cwd)).toEqual([]);
      const child = Bun.spawn([process.execPath, "--no-env-file", "test", new URL(import.meta.url).pathname], { cwd, env: { HISTORY_LIFECYCLE_SYNTHETIC_CHILD: "1", MOONSHOT_WORLD_WRITES_HOLD: "0", NODE_ENV: "test", TZ: "UTC" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      process.stdout.write("SYNTHETIC isolated original-counter child evidence (separate test denominator):\n" + stdout + stderr);
      expect(exit).toBe(0); expect(readdirSync(cwd)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
} else {
  // A caller cannot bypass isolation by inheriting the synthetic-child flag:
  // reject before importing or invoking any original runtime/config module.
  if (readdirSync(process.cwd()).length || Object.keys(process.env).sort().join() !== "HISTORY_LIFECYCLE_SYNTHETIC_CHILD,MOONSHOT_WORLD_WRITES_HOLD,NODE_ENV,TZ") throw new Error("Original-counter tests require the isolated empty cwd and minimal synthetic environment.");
  const [{ createHistoryLifecycle }, { activePublicAnalyses, publicAnalysis }, { HistoryGitHubReader, observeHistoryReaderSettlement }, { createHistoryHttp }, { HistoryService }, { HistoryCursorCodec }, { D1HistoryStore }, { Database }, { readFileSync }, { syntheticWorld }, { D1RpcHistoryStore }, { historyStorageRpc }, { HISTORY_RPC_URL, HISTORY_SCHEMA3_SQL_SHA256 }] = await Promise.all([
    import("../src/server/history-lifecycle"), import("../src/server/runtime-activity"), import("../src/server/history-github"), import("../src/server/history-http"), import("../src/server/history-service"), import("../src/server/history-cursor"), import("../deploy/history-storage"), import("bun:sqlite"), import("node:fs"), import("./fixtures/browser-world"), import("../src/server/d1-history-store"), import("../deploy/history-rpc"), import("../src/server/history-rpc-contract"),
  ]);
  function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
  const repo = "synthetic-moonshot/browser-fixture", sha = (n: number) => n.toString(16).padStart(40, "0"), metadata = () => new Response(JSON.stringify({ private: false, visibility: "public", full_name: repo, license: null }));
  const readRequest = () => ({ repo, anchorSha: sha(1), generation: "SYNTHETIC_lifetime", action: "walk" as const });
  async function tick() { await Bun.sleep(0); }
  function readerFixture(stage: "request" | "collection" | "cursor" | "quota" | "fetch" | "read") {
    const late = deferred<any>(), cleanup = deferred<void>(); let calls = 0, collections = 0, cancelled = 0;
    const quota = { take: () => stage === "quota" ? late.promise : undefined };
    const reader = new HistoryGitHubReader({ quota, admitRequest: () => stage === "request" ? late.promise : undefined, admitCollection: () => { collections++; return stage === "collection" ? late.promise : undefined; }, resolveCursor: () => late.promise, limits: { requestMs: 5, actionMs: 12 }, fetcher: async () => { calls++; if (stage === "fetch") return late.promise; if (stage === "read") return new Response(new ReadableStream({ pull() { return late.promise; }, cancel() { cancelled++; return cleanup.promise; } })); return metadata(); } });
    return { quota, reader, late, cleanup, get calls() { return calls; }, get collections() { return collections; }, get cancelled() { return cancelled; }, next: () => reader.read({ ...readRequest(), ...(stage === "cursor" ? { cursor: { id: "trusted", repoKey: repo, anchorSha: sha(1), generation: "SYNTHETIC_lifetime" } } : {}) }) };
  }

  test("CHILD original publicAnalysis normal/error/missing-work/HOLD and retained work use one real counter", async () => {
    expect(readdirSync(process.cwd())).toEqual([]); expect(Object.keys(process.env).sort()).toEqual(["HISTORY_LIFECYCLE_SYNTHETIC_CHILD", "MOONSHOT_WORLD_WRITES_HOLD", "NODE_ENV", "TZ"]);
    expect(activePublicAnalyses()).toBe(0); const hook = createHistoryLifecycle({ take() {} });
    expect(await hook.run(async () => { expect(activePublicAnalyses()).toBe(1); return "normal"; })).toBe("normal"); expect(activePublicAnalyses()).toBe(0);
    await expect(hook.run(async () => { throw new Error("SYNTHETIC work failed"); })).rejects.toThrow("SYNTHETIC work failed"); expect(activePublicAnalyses()).toBe(0);
    await expect(hook.run(undefined as any)).rejects.toMatchObject({ code: "HISTORY_LIFECYCLE_UNAVAILABLE" }); expect(activePublicAnalyses()).toBe(0);
    process.env.MOONSHOT_WORLD_WRITES_HOLD = "1"; let called = false;
    expect(await hook.held()).toBe(true); await expect(hook.run(async () => { called = true; })).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" }); expect(called).toBe(false); expect(activePublicAnalyses()).toBe(0); process.env.MOONSHOT_WORLD_WRITES_HOLD = "0";
    expect(() => createHistoryLifecycle({})).toThrow();
  });

  test("CHILD prompt result/error retains original count through body cleanup resolve/reject and does not decrement neighbors", async () => {
    for (const failCleanup of [false, true]) {
      const other = deferred<void>(), neighbor = publicAnalysis(() => other.promise), pending = deferred<void>(), hook = createHistoryLifecycle({ take() {} });
      expect(activePublicAnalyses()).toBe(1);
      expect(await hook.run(async retain => { expect(activePublicAnalyses()).toBe(2); retain(pending.promise); return 408; })).toBe(408); expect(activePublicAnalyses()).toBe(2);
      if (failCleanup) pending.reject(new Error("SYNTHETIC body cancel rejected")); else pending.resolve(); await tick(); expect(activePublicAnalyses()).toBe(1); other.resolve(); await neighbor; expect(activePublicAnalyses()).toBe(0);
    }
    const pending = deferred<void>(), hook = createHistoryLifecycle({ take() {} });
    await expect(hook.run(async retain => { retain(pending.promise); throw new Error("SYNTHETIC timed out"); })).rejects.toThrow("SYNTHETIC timed out"); expect(activePublicAnalyses()).toBe(1); pending.resolve(); await tick(); expect(activePublicAnalyses()).toBe(0);
  });

  test("CHILD original lifetime covers late request/collection/cursor/quota/read work with no forced reader unlock", async () => {
    for (const stage of ["request", "collection", "cursor", "quota", "read"] as const) {
      const f = readerFixture(stage), hook = createHistoryLifecycle(f.quota), result = await hook.run(() => f.next());
      expect(result.coverage.errors.length).toBeGreaterThan(0); expect(activePublicAnalyses()).toBe(1); expect(observeHistoryReaderSettlement(f.quota).idle).toBe(false);
      if (stage === "read") { expect(f.cancelled).toBe(1); f.cleanup.reject(new Error("SYNTHETIC read cleanup rejected")); f.late.resolve(undefined); }
      else f.late.reject(new Error("SYNTHETIC late admission rejected"));
      await tick(); expect(activePublicAnalyses()).toBe(0); expect(observeHistoryReaderSettlement(f.quota).idle).toBe(true);
    }
  });

  test("CHILD late transport transfers continuously into cancellation and simultaneous timeout hooks release exactly their own counts", async () => {
    const f = readerFixture("fetch"), hook = createHistoryLifecycle(f.quota), result = await hook.run(() => f.next()); expect(result.coverage.stopReason).toBe("HISTORY_REQUEST_TIMEOUT"); expect(activePublicAnalyses()).toBe(1);
    const another = await hook.run(() => f.next()); expect(another.coverage.stopReason).toBe("HISTORY_BUSY"); expect(activePublicAnalyses()).toBe(2);
    let cancelled = 0; f.late.resolve(new Response(new ReadableStream({ cancel() { cancelled++; return f.cleanup.promise; } }))); await tick();
    expect(cancelled).toBe(1); expect(activePublicAnalyses()).toBe(2); expect(observeHistoryReaderSettlement(f.quota).idle).toBe(false);
    f.cleanup.resolve(); await tick(); expect(activePublicAnalyses()).toBe(0); expect(observeHistoryReaderSettlement(f.quota).idle).toBe(true);
  });

  test("CHILD invalid or expired retainers fail closed and cannot double-decrement original analyses", async () => {
    const hook = createHistoryLifecycle({ take() {} }), pending = deferred<void>(); let lateRetain!: (p: Promise<unknown>) => void;
    await expect(hook.run(async retain => { retain(pending.promise); try { retain(null as any); } catch {} return "caught invalid retain"; })).rejects.toMatchObject({ code: "HISTORY_LIFECYCLE_UNAVAILABLE" });
    expect(activePublicAnalyses()).toBe(1); pending.resolve(); await tick(); expect(activePublicAnalyses()).toBe(0);
    const broken = Object.defineProperty({}, "then", { get() { throw new Error("SYNTHETIC then getter failed"); } });
    await expect(hook.run(async retain => { try { retain(broken as any); } catch {} })).rejects.toMatchObject({ code: "HISTORY_LIFECYCLE_UNAVAILABLE" }); expect(activePublicAnalyses()).toBe(0);
    await hook.run(async retain => { lateRetain = retain; }); expect(activePublicAnalyses()).toBe(0); expect(() => lateRetain(Promise.resolve())).toThrow(); expect(activePublicAnalyses()).toBe(0);
    expect(() => lateRetain(Promise.reject(new Error("SYNTHETIC rejected expired registration")))).toThrow(); await tick(); expect(activePublicAnalyses()).toBe(0);
  });

  async function httpFixture() {
    const db = new Database(":memory:"); db.exec(readFileSync(new URL("../deploy/d1/0003-history.sql", import.meta.url), "utf8"));
    const statement = (sql: string, values: unknown[] = []) => ({ bind(...v: unknown[]) { return statement(sql, v); }, async all<T>() { return { success: true, results: db.query(sql).all(...values as any[]) as T[] }; }, async first<T>() { return db.query(sql).get(...values as any[]) as T | null; }, execute() { db.query(sql).run(...values as any[]); return { success: true }; } });
    const binding = { prepare: (sql: string) => statement(sql), async batch(rows: any[]) { return db.transaction(() => rows.map(s => s.execute()))(); } }, store = new D1HistoryStore(binding);
    const key = new HistoryCursorCodec(await crypto.subtle.importKey("raw", new Uint8Array(32).fill(27), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
    let world: ReturnType<typeof syntheticWorld> | null = syntheticWorld(); world.source = "github"; world.headSha = sha(1); world.coverage.tree = "full"; world.health.github = "ok";
    const quota = { take() {} }, lifecycle = createHistoryLifecycle(quota); let collections = 0, calls = 0, raceHold = false;
    const settings = { store, cursor: key, cache: { get: async () => world ? { world, fresh: true, expiresAt: 0 } : null }, now: () => Date.parse("2026-11-05T00:00:00Z"), reader: { quota, wallNow: () => "2026-11-04T18:00:00Z", fetcher: async (input: string | URL | Request) => { calls++; if (String(input).endsWith(`/repos/${repo}`)) return metadata(); return new Response(JSON.stringify({ sha: sha(1), tree: { sha: sha(1001) }, parents: [], author: { date: null }, committer: { date: null }, message: "SYNTHETIC" })); } } };
    const deps: import("../src/server/history-http").HistoryHttpDependencies = { authenticate: () => ({ gatewayAuthenticated: true, requestAdmitted: true, identity: "a".repeat(64), admitCollection: () => { collections++; } }), makeService: admission => new HistoryService({ ...settings, ...admission }), lifecycle: { held: () => { if (raceHold) { process.env.MOONSHOT_WORLD_WRITES_HOLD = "1"; return false; } return lifecycle.held(); }, run: work => lifecycle.run(work) }, revokePublicCapture: () => { world = null; }, bodyTimeoutMs: 5 };
    const path = `/prefix/api/history/${repo}`, origin = "https://synthetic.invalid", context = { repo, path, publicOrigin: origin };
    const request = (body?: BodyInit) => new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body, duplex: "half" } as RequestInit) });
    return { db, deps, settings, store, key, quota, context, request, handle: (r: Request) => createHistoryHttp(deps)(r, context), race: () => { raceHold = true; }, get calls() { return calls; }, get collections() { return collections; } };
  }

  test("CHILD actual HTTP GET leaves original counter0, POST uses1 and persistence/signing awaits retain it", async () => {
    const f = await httpFixture();
    try {
      const first = await (await f.handle(f.request())).json(); expect(activePublicAnalyses()).toBe(0);
      const entered = deferred<void>(), release = deferred<void>();
      const append = f.store.append.bind(f.store); f.store.append = async batch => { expect(activePublicAnalyses()).toBe(1); entered.resolve(); await release.promise; return append(batch); };
      const action = f.handle(f.request(JSON.stringify({ action: "walk", cursor: first.token }))); await entered.promise; expect(activePublicAnalyses()).toBe(1); release.resolve(); expect((await action).status).toBe(200); expect(activePublicAnalyses()).toBe(0);
      const read = await (await f.handle(f.request())).json(), signing = deferred<void>(), signed = deferred<void>();
      // A valid zero-new-commit STEP_CAP unit isolates the signing boundary.
      const otherFixture = await httpFixture(); otherFixture.settings.reader = { ...otherFixture.settings.reader, limits: { commitSteps: 0 } } as any;
      try { const initial = await (await otherFixture.handle(otherFixture.request())).json(), keyIssue = otherFixture.key.issue.bind(otherFixture.key); otherFixture.key.issue = async claim => { signed.resolve(); await signing.promise; return keyIssue(claim); }; const operation = otherFixture.handle(otherFixture.request(JSON.stringify({ action: "walk", cursor: initial.token }))); await signed.promise; expect(activePublicAnalyses()).toBe(1); signing.resolve(); expect((await operation).status).toBe(200); expect(activePublicAnalyses()).toBe(0); } finally { otherFixture.db.close(); }
      expect(read.history.cursor.retainedCommits).toBe(1);
    } finally { f.db.close(); }
  });

  test("CHILD actual HTTP privacy revocation holds the original count until original callback settlement", async () => {
    const f = await httpFixture(), entered = deferred<void>(), release = deferred<void>();
    try {
      const first = await (await f.handle(f.request())).json(), revoke = f.deps.revokePublicCapture;
      f.settings.reader.fetcher = async () => new Response(JSON.stringify({ private: true, visibility: "private", full_name: repo }));
      f.deps.revokePublicCapture = async input => { expect(activePublicAnalyses()).toBe(1); entered.resolve(); await release.promise; await revoke(input); };
      const action = f.handle(f.request(JSON.stringify({ action: "walk", cursor: first.token }))); await entered.promise; expect(activePublicAnalyses()).toBe(1);
      release.resolve(); expect((await action).status).toBe(403); expect(activePublicAnalyses()).toBe(0); expect((await f.handle(f.request())).status).toBe(404);
    } finally { release.resolve(); f.db.close(); }
  });

  test("CHILD actual HTTP504 retains original count through abort-ignoring late fetch then pending cancel, without saving", async () => {
    const f = await httpFixture(), late = deferred<Response>(), cleanup = deferred<void>();
    try {
      const first = await (await f.handle(f.request())).json();
      f.settings.reader = { ...f.settings.reader, limits: { requestMs: 5, actionMs: 50 }, fetcher: async () => late.promise } as any;
      const response = await f.handle(f.request(JSON.stringify({ action: "walk", cursor: first.token }))); expect(response.status).toBe(504); expect(activePublicAnalyses()).toBe(1); expect(f.db.query("SELECT * FROM history_commits").all()).toHaveLength(0);
      late.resolve(new Response(new ReadableStream({ cancel() { return cleanup.promise; } }))); await tick(); expect(activePublicAnalyses()).toBe(1);
      cleanup.reject(new Error("SYNTHETIC late transport cancellation rejected")); await tick(); expect(activePublicAnalyses()).toBe(0); expect(f.db.query("SELECT * FROM history_commits").all()).toHaveLength(0);
    } finally { cleanup.resolve(); f.db.close(); }
  });

  test("CHILD HTTP408 returns promptly while real original counter holds late body cancellation resolve/reject", async () => {
    for (const rejected of [false, true]) {
      const f = await httpFixture(), cleanup = deferred<void>();
      try { const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { return cleanup.promise; } }); const r = await f.handle(f.request(stream)); expect(r.status).toBe(408); expect(activePublicAnalyses()).toBe(1); expect(f.collections).toBe(0); if (rejected) cleanup.reject(new Error("SYNTHETIC bodycancel rejected")); else cleanup.resolve(); await tick(); expect(activePublicAnalyses()).toBe(0); }
      finally { f.db.close(); }
    }
  });

  test("CHILD original HOLD race rejects before work/collection/fetch/write while cache-only GET still works", async () => {
    const f = await httpFixture();
    try { const first = await (await f.handle(f.request())).json(); f.race(); const r = await f.handle(f.request(JSON.stringify({ action: "walk", cursor: first.token }))); expect(r.status).toBe(503); expect((await r.json()).code).toBe("STORAGE_MIGRATION_HOLD"); expect(activePublicAnalyses()).toBe(0); expect(f.collections).toBe(0); expect(f.calls).toBe(0); expect(f.db.query("SELECT * FROM history_commits").all()).toHaveLength(0); expect((await f.handle(f.request())).status).toBe(200); }
    finally { process.env.MOONSHOT_WORLD_WRITES_HOLD = "0"; f.db.close(); }
  });

  async function rpcHttpFixture() {
    const f = await httpFixture(); f.db.exec("PRAGMA foreign_keys=ON"); for (const file of ["0001-world-cache.sql", "0002-migration-identity.sql"]) f.db.exec(readFileSync(new URL(`../deploy/d1/${file}`, import.meta.url), "utf8"));
    const identity = { databaseId: "11111111-1111-4111-8111-111111111111", bindingNonce: "a".repeat(32), epoch: "b".repeat(32), sourceSha: "c".repeat(40), workerBundleSha256: "d".repeat(64) }, secret = "SYNTHETIC-isolated-child-storage-secret";
    f.db.query("INSERT INTO storage_identity VALUES(1,?,?,?)").run(identity.databaseId, identity.bindingNonce, "SYNTHETIC"); f.db.query("INSERT INTO schema_migrations VALUES(3,'SYNTHETIC',?)").run(HISTORY_SCHEMA3_SQL_SHA256);
    const stmt = (sql: string, values: unknown[] = []) => ({ bind(...v: unknown[]) { return stmt(sql, v); }, async all<T>() { return { success: true, results: f.db.query(sql).all(...values as any[]) as T[] }; }, async first<T>() { return f.db.query(sql).get(...values as any[]) as T | null; }, execute() { f.db.query(sql).run(...values as any[]); return { success: true }; } });
    const binding = { prepare: (sql: string) => stmt(sql), async batch(rows: any[]) { return f.db.transaction(() => rows.map(s => s.execute()))(); } };
    const env = { WORLDS_DB: binding, FACTORY_STORAGE_SECRET: secret, FACTORY_STORAGE_MODE: "worlds", FACTORY_STORAGE_DATABASE_ID: identity.databaseId, FACTORY_STORAGE_BINDING_NONCE: identity.bindingNonce, FACTORY_MIGRATION_EPOCH: identity.epoch, FACTORY_SOURCE_SHA: identity.sourceSha, FACTORY_WORKER_BUNDLE_SHA256: identity.workerBundleSha256, FACTORY_ADMISSION_FENCE: "" };
    let intercept: ((op: any, actual: () => Promise<Response>) => Promise<Response>) | undefined, writes = 0;
    const store = new D1RpcHistoryStore({ endpoint: HISTORY_RPC_URL, secret, identity }, async (input, init) => { const op = JSON.parse(String(init?.body)); if (op.op === "historyAppend") writes++; const actual = () => historyStorageRpc(new Request(input, init), env); return intercept ? intercept(op, actual) : actual(); }, { timeoutMs: 25 });
    f.deps.makeService = admission => new HistoryService({ ...f.settings, ...admission, store }); f.deps.lifecycle = createHistoryLifecycle(f.quota, store.observeSettlement);
    return { ...f, rpc: store, get writes() { return writes; }, intercept(fn: typeof intercept) { intercept = fn; } };
  }

  test("CHILD actual RPC commit with late headers/cancel returns unconfirmed while ORIGINAL count remains held", async () => {
    for (const reject of [false, true]) {
      const f = await rpcHttpFixture(), late = deferred<Response>(), cleanup = deferred<void>();
      try {
        const initial = await f.handle(f.request()); expect(initial.status).toBe(200); const first = await initial.json(); expect(activePublicAnalyses()).toBe(0);
        f.intercept(async (op, actual) => { const response = await actual(); return op.op === "historyAppend" ? late.promise : response; });
        const r = await f.handle(f.request(JSON.stringify({ action: "walk", cursor: first.token }))), result = await r.json();
        expect(r.status).toBe(503); expect(result.status).toBe("save-unconfirmed"); expect(result.persisted.commits).toBe(0); expect(result.unconfirmed.commits).toBe(1); expect(result.token).toBeNull(); expect(f.db.query("SELECT * FROM history_commits").all()).toHaveLength(1); expect(f.writes).toBe(1); expect(activePublicAnalyses()).toBe(1); expect(f.rpc.observeSettlement().idle).toBe(false);
        late.resolve(new Response(new ReadableStream({ cancel() { return cleanup.promise; } }))); await tick(); expect(activePublicAnalyses()).toBe(1);
        if (reject) cleanup.reject(new Error("SYNTHETIC RPC cancellation rejected")); else cleanup.resolve(); await tick(); expect(activePublicAnalyses()).toBe(0); expect(f.rpc.observeSettlement().idle).toBe(true);
      } finally { cleanup.resolve(); f.db.close(); }
    }
  });

  test("CHILD late RPC response body/cancel and unrelated analysis remain independently counted", async () => {
    const f = await rpcHttpFixture(), cleanup = deferred<void>(), body = deferred<void>(), neighborGate = deferred<void>();
    const neighbor = publicAnalysis(() => neighborGate.promise);
    try {
      const initial = await f.handle(f.request()); expect(initial.status).toBe(200); const first = await initial.json();
      f.intercept(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); }, pull() { return body.promise; }, cancel() { return cleanup.promise; } }), { headers: { "content-type": "application/json" } }));
      const r = await f.handle(f.request(JSON.stringify({ action: "walk", cursor: first.token }))); expect(r.status).toBe(503); expect(activePublicAnalyses()).toBe(2); expect(f.writes).toBe(0);
      cleanup.resolve(); body.resolve(); await tick(); expect(activePublicAnalyses()).toBe(1); neighborGate.resolve(); await neighbor; expect(activePublicAnalyses()).toBe(0);
    } finally { cleanup.resolve(); body.resolve(); neighborGate.resolve(); f.db.close(); }
  });

  test("CHILD invalid storage settlement is UNKNOWN, fails closed and never becomes a fabricated idle/drain receipt", async () => {
    const hook = createHistoryLifecycle({ take() {} }, (() => undefined) as any);
    await expect(hook.run(async () => "not a drain proof")).rejects.toMatchObject({ code: "HISTORY_LIFECYCLE_UNAVAILABLE" });
    // Intentional unresolved authority in THIS isolated child only: there is no
    // valid settlement to release it. No timer/poll/forced unlock or real runtime.
    expect(activePublicAnalyses()).toBe(1);
  });
}
