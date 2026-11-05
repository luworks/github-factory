import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runtime/lifecycle getters may read projectEnv(). Never let these tests see
// checkout .env, inherited secrets, real quota files or any actual upstream.
if (process.env.HISTORY_RUNTIME_SYNTHETIC_CHILD !== "1") {
  test("SYNTHETIC runtime assembly is tested only in an empty-cwd minimal-env child Bun", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-history-runtime-child-")), cwd = join(directory, "empty"); mkdirSync(cwd);
    try {
      expect(readdirSync(cwd)).toEqual([]);
      const child = Bun.spawn([process.execPath, "--no-env-file", "test", new URL(import.meta.url).pathname], {
        cwd, env: { HISTORY_RUNTIME_SYNTHETIC_CHILD: "1", MOONSHOT_WORLD_WRITES_HOLD: "0", NODE_ENV: "test", TZ: "UTC" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      process.stdout.write("SYNTHETIC runtime child evidence (separate test denominator):\n" + stdout + stderr);
      expect(exit).toBe(0); expect(readdirSync(cwd)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
} else {
  if (readdirSync(process.cwd()).length || Object.keys(process.env).sort().join() !== "HISTORY_RUNTIME_SYNTHETIC_CHILD,MOONSHOT_WORLD_WRITES_HOLD,NODE_ENV,TZ") throw new Error("History runtime tests require an empty cwd and minimal synthetic environment.");
  globalThis.fetch = (async () => { throw Error("SYNTHETIC actual network forbidden"); }) as unknown as typeof fetch;
  const [{ createHistoryRuntime, handleHistoryRequest, HISTORY_RUNTIME_GATES }, { historyConfig, getConfig }, { accessConfig, admitAccessRequest, ClientQuota }, { createWorldResources }, { PublicGitHubQuota }, { WorldStore }, { activePublicAnalyses }, { Database }, { historyStorageRpc }, { HISTORY_RPC_URL, HISTORY_SCHEMA3_SQL_SHA256 }, { syntheticWorld }, { parseRepo }] = await Promise.all([
    import("../src/server/history-runtime"), import("../src/server/config"), import("../src/server/access"), import("../src/server/world-resources"), import("../src/server/public-quota"), import("../src/server/store"), import("../src/server/runtime-activity"), import("bun:sqlite"), import("../deploy/history-rpc"), import("../src/server/history-rpc-contract"), import("./fixtures/browser-world"), import("../src/server/github"),
  ]);
  const repo = "synthetic-moonshot/browser-fixture", sha = (n: number) => n.toString(16).padStart(40, "0"), publicOrigin = "https://runtime.synthetic.invalid";
  const env = {
    MOONSHOT_HISTORY_ENABLED: "true", MOONSHOT_HISTORY_SCHEMA_VERSION: "3", MOONSHOT_WORLD_STORE: "d1", MOONSHOT_PUBLIC_ORIGIN: publicOrigin,
    MOONSHOT_GATEWAY_SECRET: "SYNTHETIC-gateway-secret-at-least-32-chars", MOONSHOT_D1_STORAGE_URL: HISTORY_RPC_URL,
    MOONSHOT_D1_STORAGE_SECRET: "SYNTHETIC-storage-secret-at-least-32-chars", MOONSHOT_D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111",
    MOONSHOT_HISTORY_BINDING_NONCE: "a".repeat(32), MOONSHOT_HISTORY_EPOCH: "b".repeat(32), MOONSHOT_HISTORY_SOURCE_SHA: "c".repeat(40),
    MOONSHOT_HISTORY_WORKER_BUNDLE_SHA256: "d".repeat(64), MOONSHOT_HISTORY_CURSOR_KEY_HEX: "1a".repeat(32),
  };
  const config = historyConfig(env)!;
  const headers = { "x-factory-gateway-key": env.MOONSHOT_GATEWAY_SECRET, "x-factory-client-ip": "192.0.2.42" }, path = `/github-factory/api/history/${repo}`, context = { repo, path };
  const request = (method = "GET", body?: BodyInit, extra: Record<string, string> = {}, query = "", origin = "http://127.0.0.1:49999") => new Request(`${origin}${path}${query}`, { method,
    headers: { ...headers, ...(method === "POST" ? { origin: publicOrigin, "content-type": "application/json", "sec-fetch-site": "same-origin" } : {}), ...extra },
    ...(body === undefined ? {} : { body, duplex: "half" } as RequestInit),
  });
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const metadata = () => ({ full_name: repo, private: false, visibility: "public", license: null });
  const commit = (n: number) => ({ sha: sha(n), tree: { sha: sha(n + 1000) }, parents: n > 1 ? [{ sha: sha(n - 1) }] : [], message: "SYNTHETIC 原始提交", author: { date: "original clock" }, committer: { date: null } });
  function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(r => { resolve = r; }), resolve: (value: T) => resolve(value) }; }
  async function fixture(options: { noPrivacy?: boolean; requests?: number; githubLimit?: number } = {}) {
    const directory = mkdtempSync(join(tmpdir(), "factory-history-runtime-fixture-")), db = new Database(join(directory, "history.sqlite"));
    db.exec("PRAGMA foreign_keys=ON");
    for (const name of ["0001-world-cache.sql", "0002-migration-identity.sql", "0003-history.sql"]) db.exec(readFileSync(new URL(`../deploy/d1/${name}`, import.meta.url), "utf8"));
    db.query("INSERT INTO storage_identity VALUES(1,?,?,?)").run(config.rpc.identity.databaseId, config.rpc.identity.bindingNonce, "SYNTHETIC");
    db.query("INSERT INTO schema_migrations VALUES(3,'SYNTHETIC',?)").run(HISTORY_SCHEMA3_SQL_SHA256);
    const statement = (sql: string, values: unknown[] = []) => ({ bind(...v: unknown[]) { return statement(sql, v); }, async all<T>() { return { success: true, results: db.query(sql).all(...values as any[]) as T[] }; }, async first<T>() { return db.query(sql).get(...values as any[]) as T | null; }, execute() { db.query(sql).run(...values as any[]); return { success: true }; } });
    let batches = 0, beforeBatch: (() => Promise<void>) | undefined;
    const binding: import("../deploy/history-storage").HistoryD1Binding = { prepare: sql => statement(sql), async batch(rows) { await beforeBatch?.(); batches++; return db.transaction(() => rows.map(s => (s as ReturnType<typeof statement>).execute()))(); } };
    const rpcEnv = { WORLDS_DB: binding, FACTORY_STORAGE_SECRET: config.rpc.secret, FACTORY_STORAGE_MODE: "worlds", FACTORY_STORAGE_DATABASE_ID: config.rpc.identity.databaseId, FACTORY_STORAGE_BINDING_NONCE: config.rpc.identity.bindingNonce, FACTORY_MIGRATION_EPOCH: config.rpc.identity.epoch, FACTORY_SOURCE_SHA: config.rpc.identity.sourceSha, FACTORY_WORKER_BUNDLE_SHA256: config.rpc.identity.workerBundleSha256, FACTORY_ADMISSION_FENCE: "" };
    const calls: string[] = [], rpcCalls: string[] = [], events: string[] = []; let quotaInitializations = 0, cacheInitializations = 0, resourceGets = 0, revokes = 0;
    let intercept: ((url: URL) => Response | undefined | Promise<Response | undefined>) | undefined;
    const network: import("../src/server/github").Fetcher = async (input, init) => {
      const r = new Request(input, init), url = new URL(r.url);
      if (r.url === HISTORY_RPC_URL) { rpcCalls.push(JSON.parse(String(init?.body)).op); events.push("rpc"); return historyStorageRpc(r, rpcEnv); }
      if (url.origin !== "https://api.github.com") throw Error("SYNTHETIC unexpected upstream");
      calls.push(r.url); events.push("github"); const override = await intercept?.(url); if (override) return override;
      if (url.pathname === `/repos/${repo}`) return json(metadata());
      const c = url.pathname.match(/\/git\/commits\/([a-f0-9]{40})$/); if (c) return json(commit(parseInt(c[1]!, 16)));
      const t = url.pathname.match(/\/git\/trees\/([a-f0-9]{40})$/); if (t) return json({ sha: t[1], truncated: false, tree: [{ path: "src/原始.ts", type: "blob", mode: "100644", sha: sha(9000) }] });
      return json({ message: "SYNTHETIC unsupported endpoint" }, 404);
    };
    let upstream: InstanceType<typeof PublicGitHubQuota> | undefined, cache: InstanceType<typeof WorldStore> | undefined;
    const resources = createWorldResources(getConfig({ MOONSHOT_DATA_DIR: directory }), { network,
      makeQuota() { quotaInitializations++; events.push("quota-init"); return upstream = new PublicGitHubQuota(join(directory, "public-quota.sqlite"), options.githubLimit ?? 100); },
      makeStore() { cacheInitializations++; return cache = new WorldStore(join(directory, "worlds.sqlite")); },
    });
    const world = syntheticWorld(); world.source = "github"; world.headSha = sha(4); world.coverage.tree = "full"; world.health.github = "ok";
    resources.store.put(world, 90_000, Date.parse(world.collectedAt)); resources.store.alias?.("synthetic/old-name", repo);
    const quota = new ClientQuota(join(directory, "public-access.sqlite"), { requestsPerMinute: options.requests ?? 100, collectionsPerHour: 50, aiPerHour: 0 });
    const access = accessConfig({ ...env, MOONSHOT_DATA_DIR: directory });
    let requestDebits = 0, collectionDebits = 0;
    const runtime = createHistoryRuntime({ config,
      authenticate(input) { const admitted = admitAccessRequest(input, access, quota, true); requestDebits++; events.push("request"); return { gatewayAuthenticated: true, requestAdmitted: true, identity: admitted.identity, admitCollection() { admitted.admitCollection(); collectionDebits++; events.push("collection"); } }; },
      resources() { resourceGets++; return { schemaVersion: 3, cache: resources.store, quota: resources.quota, network: resources.network,
        // SYNTHETIC callback ONLY. Real WorldStore.delete lacks a durable fence;
        // production resources stay null until that separate gate is resolved.
        ...(options.noPrivacy ? {} : { revokePublicCapture(input: string) { revokes++; resources.store.delete?.(input); } }),
      }; },
    });
    const dump = () => JSON.stringify(["history_repositories", "history_commits", "history_anchors", "history_frames", "history_frame_chunks", "history_batches"].map(t => db.query(`SELECT * FROM ${t} ORDER BY rowid`).all()));
    return { directory, db, resources, world, calls, rpcCalls, events, dump,
      handle: (req: Request, ctx = context) => runtime(req, ctx), intercept(fn: typeof intercept) { intercept = fn; }, beforeBatch(fn: () => Promise<void>) { beforeBatch = fn; },
      get quotaInitializations() { return quotaInitializations; }, get cacheInitializations() { return cacheInitializations; }, get resourceGets() { return resourceGets; }, get requestDebits() { return requestDebits; }, get collectionDebits() { return collectionDebits; }, get revokes() { return revokes; }, get batches() { return batches; },
      close() { cache?.close(); upstream?.close(); quota.close(); db.close(); rmSync(directory, { recursive: true, force: true }); },
    };
  }

  test("CHILD literal history configuration is default-off and rejects every missing/invalid pin/key without side effects", () => {
    expect(historyConfig({})).toBeNull(); expect(historyConfig(env)).toEqual(config);
    for (const key of Object.keys(env)) { const bad = { ...env }; delete (bad as Record<string, string>)[key]; expect(historyConfig(bad)).toBeNull(); }
    for (const patch of [{ MOONSHOT_HISTORY_ENABLED: "1" }, { MOONSHOT_HISTORY_ENABLED: "false" }, { MOONSHOT_HISTORY_SCHEMA_VERSION: "2" }, { MOONSHOT_WORLD_STORE: "sqlite" }, { MOONSHOT_PUBLIC_ORIGIN: publicOrigin + "/" }, { MOONSHOT_PUBLIC_ORIGIN: "http://localhost" }, { MOONSHOT_D1_STORAGE_URL: HISTORY_RPC_URL + "?x=1" }, { MOONSHOT_HISTORY_CURSOR_KEY_HEX: "dev-key" }, { MOONSHOT_HISTORY_BINDING_NONCE: "unknown" }, { MOONSHOT_D1_STORAGE_SECRET: "short" }, { MOONSHOT_GATEWAY_SECRET: "" }]) expect(historyConfig({ ...env, ...patch })).toBeNull();
    expect(readdirSync(process.cwd())).toEqual([]);
  });

  test("CHILD missing config creates no access/store/RPC/quota/key/network; missing real resources stays unavailable", async () => {
    let auth = 0, resources = 0;
    const disabled = createHistoryRuntime({ config: null, authenticate() { auth++; throw Error("FORBIDDEN"); }, resources() { resources++; throw Error("FORBIDDEN"); } });
    for (const req of [request(), request("POST", '{"prompt":"code"}')]) { const r = await disabled(req, context); expect(r.status).toBe(503); expect(await r.json()).toMatchObject({ code: "HISTORY_HTTP_UNAVAILABLE" }); }
    expect(auth).toBe(0); expect(resources).toBe(0);
    const unavailable = createHistoryRuntime({ config, authenticate() { auth++; return { gatewayAuthenticated: true, requestAdmitted: true, identity: "synthetic", admitCollection() { throw Error("FORBIDDEN"); } }; }, resources() { resources++; return null; } });
    expect((await unavailable(request(), context)).status).toBe(503); expect(auth).toBe(1); expect(resources).toBe(1); expect(readdirSync(process.cwd())).toEqual([]);
  });

  test("CHILD extracted world resources keep store and original quota lazy, stable and separate from wrapping", async () => {
    let stores = 0, quotas = 0, takes = 0, calls = 0;
    const fakeStore = { get() { return null; }, put() {}, delete() {} };
    const resources = createWorldResources(getConfig({}), { makeStore() { stores++; return fakeStore; }, makeQuota() { quotas++; return { take() { takes++; } }; }, network: async () => { calls++; return json({}); } });
    const handle = resources.quota, wrapped = handle.wrap(resources.network);
    expect(stores).toBe(0); expect(quotas).toBe(0); expect(calls).toBe(0);
    expect(resources.store).toBe(fakeStore); expect(resources.store).toBe(fakeStore); expect(stores).toBe(1); expect(quotas).toBe(0);
    await wrapped("https://synthetic.invalid"); resources.quota.take();
    expect(resources.quota).toBe(handle); expect(quotas).toBe(1); expect(takes).toBe(2); expect(calls).toBe(1); expect(readdirSync(process.cwd())).toEqual([]);
  });

  test("CHILD gateway/IP verification precedes cache/RPC/body; strict admission rejects loopback fallback and shares same-IP request quota", async () => {
    const f = await fixture({ requests: 2 });
    try {
      for (const extra of [{ "x-factory-gateway-key": "wrong" }, { "x-factory-client-ip": "invalid" }, { "x-factory-gateway-key": "", "x-forwarded-for": "192.0.2.42", "cf-connecting-ip": "192.0.2.42" }] as Record<string, string>[]) expect((await f.handle(request("POST", "not-json", extra, "?sql=DELETE"))).status).toBe(403);
      expect(f.resourceGets).toBe(0); expect(f.requestDebits).toBe(0); expect(f.rpcCalls).toHaveLength(0);
      for (let i = 0; i < 2; i++) expect((await f.handle(request())).status).toBe(200);
      expect((await f.handle(request("GET", undefined, { "x-factory-client-ip": "::ffff:192.0.2.42" }))).status).toBe(429);
      expect(f.requestDebits).toBe(2); expect(f.collectionDebits).toBe(0); expect(f.quotaInitializations).toBe(0);
      const quota = new ClientQuota(":memory:", { requestsPerMinute: 1, collectionsPerHour: 1, aiPerHour: 0 });
      try { expect(() => admitAccessRequest(request(), accessConfig({}), quota, true)).toThrow("gateway is not configured"); } finally { quota.close(); }
    } finally { f.close(); }
  });

  test("CHILD actual factory->HTTP->service->RPC->dispatcher->temporary SQLite GET/walk/frames preserves shared authority and no paid calls", async () => {
    const f = await fixture();
    try {
      const before = f.dump(), read = await f.handle(request()), first = await read.json();
      expect(read.status).toBe(200); expect(first.history.status).toBe("missing-anchor"); expect(first.capture.stale).toBe(true); expect(f.dump()).toBe(before);
      expect(f.calls).toHaveLength(0); expect(f.collectionDebits).toBe(0); expect(f.quotaInitializations).toBe(0); expect(f.cacheInitializations).toBe(1);
      const walked = await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token }))), saved = await walked.json();
      expect(walked.status).toBe(200); expect(saved.persisted).toMatchObject({ commits: 4, frames: 0, batches: 1 }); expect(saved.persisted.cursor.reachedRoot).toBe(true);
      const framed = await f.handle(request("POST", JSON.stringify({ action: "frames", cursor: saved.token, members: [sha(4), sha(1)] }))), trees = await framed.json();
      expect(framed.status).toBe(200); expect(trees.persisted).toMatchObject({ commits: 0, frames: 2, batches: 1 }); expect(f.batches).toBe(2);
      const checkpoint = f.dump(), count = f.calls.length, final = await (await f.handle(request("GET", undefined, {}, `?cursor=${trees.token}&member=${sha(4)}`))).json();
      expect(final.frames[0].status).toBe("available"); expect(f.dump()).toBe(checkpoint); expect(f.calls).toHaveLength(count);
      expect(f.requestDebits).toBe(4); expect(f.collectionDebits).toBe(2); expect(f.quotaInitializations).toBe(1); expect(f.resourceGets).toBe(1); expect(activePublicAnalyses()).toBe(0);
      const upstream = new Database(join(f.directory, "public-quota.sqlite"), { readonly: true }); try { expect((upstream.query("SELECT SUM(used) used FROM github_quota").get() as { used: number }).used).toBe(f.calls.length); } finally { upstream.close(); }
      expect(f.events.indexOf("request")).toBeLessThan(f.events.indexOf("rpc")); expect(f.events.indexOf("collection")).toBeLessThan(f.events.indexOf("quota-init"));
      expect(read.headers.get("cache-control")).toBe("no-store"); expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    } finally { f.close(); }
  });

  test("CHILD original world collector and history reader consume the SAME persisted lazy upstream allowance", async () => {
    const f = await fixture({ githubLimit: 2 });
    try {
      f.intercept(() => json({ private: true, visibility: "private", full_name: repo }));
      await expect(f.resources.collector.collect(parseRepo(repo))).rejects.toMatchObject({ code: "PUBLIC_ONLY" });
      expect(f.quotaInitializations).toBe(1); expect(f.calls).toHaveLength(1);
      const first = await (await f.handle(request())).json();
      const denied = await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token })));
      expect(denied.status).toBe(403); expect(f.calls).toHaveLength(2); expect(f.revokes).toBe(1);
      expect(() => f.resources.quota.take()).toThrow("Public GitHub collection allowance reached");
      expect(f.quotaInitializations).toBe(1); expect(f.batches).toBe(0); expect(f.resources.store.get(repo)).toBeNull(); expect(f.resources.store.get("synthetic/old-name")).toBeNull();
      expect((await f.handle(request())).status).toBe(404);
    } finally { f.close(); }
  });

  test("CHILD missing durable privacy authority refuses POST before body/collection/GitHub, GET remains read-only", async () => {
    const f = await fixture({ noPrivacy: true });
    try {
      const first = await f.handle(request()); expect(first.status).toBe(200); const before = f.dump();
      const r = await f.handle(request("POST", '{"action":"walk"}')); expect(r.status).toBe(503); expect((await r.json()).code).toBe("HISTORY_PRIVACY_UNAVAILABLE");
      expect(f.collectionDebits).toBe(0); expect(f.quotaInitializations).toBe(0); expect(f.calls).toHaveLength(0); expect(f.dump()).toBe(before); expect(activePublicAnalyses()).toBe(0);
    } finally { f.close(); }
  });

  test("CHILD original HOLD, strict origin/body/query and missing cache do not invoke collection", async () => {
    const f = await fixture();
    try {
      const first = await (await f.handle(request())).json();
      process.env.MOONSHOT_WORLD_WRITES_HOLD = "1";
      expect((await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token })))).status).toBe(503);
      process.env.MOONSHOT_WORLD_WRITES_HOLD = "0";
      for (const [req, status] of [[request("POST", "{}", { origin: "https://evil.invalid" }), 403], [request("POST", '{"prompt":"write code"}'), 400], [request("GET", undefined, {}, "?head=main"), 400]] as const) expect((await f.handle(req)).status).toBe(status);
      expect(f.collectionDebits).toBe(0); expect(f.calls).toHaveLength(0); expect(f.quotaInitializations).toBe(0); expect(activePublicAnalyses()).toBe(0);
      await f.resources.store.delete?.(repo); expect((await f.handle(request())).status).toBe(404);
    } finally { process.env.MOONSHOT_WORLD_WRITES_HOLD = "0"; f.close(); }
  });

  test("CHILD original activity lifetime remains held through delayed actual RPC write settlement", async () => {
    const f = await fixture();
    try {
      const first = await (await f.handle(request())).json(), gate = deferred(), entered = deferred();
      // Delay the real RPC dispatcher's D1 batch before the actual transaction.
      f.beforeBatch(async () => { entered.resolve(); await gate.promise; });
      const pending = f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token })));
      await entered.promise; expect(activePublicAnalyses()).toBe(1); expect(f.batches).toBe(0);
      gate.resolve(); const r = await pending; expect(r.status).toBe(200); expect(activePublicAnalyses()).toBe(0); expect(f.batches).toBe(1);
    } finally { f.close(); }
  });

  test("CHILD production getter with fully synthetic pins cannot bypass unresolved schema/privacy gates", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-history-production-disabled-"));
    try {
      Object.assign(process.env, env, { MOONSHOT_DATA_DIR: directory });
      const rejected = await handleHistoryRequest(request("GET", undefined, { "x-factory-gateway-key": "wrong" }), context); expect(rejected.status).toBe(403); expect(readdirSync(directory)).toEqual([]);
      const unavailable = await handleHistoryRequest(request(), context); expect(unavailable.status).toBe(503); expect((await unavailable.json()).code).toBe("HISTORY_HTTP_UNAVAILABLE");
      expect(HISTORY_RUNTIME_GATES).toEqual(["WORLD_SCHEMA3_COMPATIBILITY_NOT_WIRED", "DURABLE_PUBLIC_REVOCATION_NOT_WIRED"]);
      expect(readdirSync(directory).every(name => name.startsWith("public-access.sqlite"))).toBe(true); expect(readdirSync(directory)).toContain("public-access.sqlite");
      expect(readdirSync(process.cwd())).toEqual([]);
    } finally { for (const key of [...Object.keys(env), "MOONSHOT_DATA_DIR"]) delete process.env[key]; rmSync(directory, { recursive: true, force: true }); }
  });
}
