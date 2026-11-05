import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

if (process.env.PRIVATE_CANONICAL_SYNTHETIC_CHILD !== "1") {
  test("SYNTHETIC trusted private canonical integration runs only in an empty-cwd minimal-env child", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-private-canonical-child-")), cwd = join(directory, "empty"); mkdirSync(cwd);
    try {
      const child = Bun.spawn([process.execPath, "--no-env-file", "test", new URL(import.meta.url).pathname], { cwd,
        env: { PRIVATE_CANONICAL_SYNTHETIC_CHILD: "1", MOONSHOT_WORLD_WRITES_HOLD: "0", NODE_ENV: "test", TZ: "UTC" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      process.stdout.write("SYNTHETIC private canonical child (separate denominator):\n" + stdout + stderr);
      expect(exit).toBe(0); expect(readdirSync(cwd)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
} else {
  if (readdirSync(process.cwd()).length || Object.keys(process.env).sort().join() !== "MOONSHOT_WORLD_WRITES_HOLD,NODE_ENV,PRIVATE_CANONICAL_SYNTHETIC_CHILD,TZ") throw Error("Private canonical tests require isolated cwd/env");
  globalThis.fetch = (async () => { throw Error("SYNTHETIC actual network forbidden"); }) as unknown as typeof fetch;
  const [{ GitHubClient, GitHubError, parseRepo, createCollectionObservation, takePrivateRepositoryObservation }, { WorldStore }, { createWorldService }, { createWorldResources }, { getConfig }, { Database }, { syntheticWorld }, { HistoryService }, { HistoryCursorCodec }] = await Promise.all([
    import("../src/server/github"), import("../src/server/store"), import("../src/server/service"), import("../src/server/world-resources"), import("../src/server/config"), import("bun:sqlite"), import("./fixtures/browser-world"), import("../src/server/history-service"), import("../src/server/history-cursor"),
  ]);
  const input = "synthetic/unknown-old-name", canonical = "openclaw/openclaw", known = "synthetic/cached-old-name", unrelated = "synthetic/unrelated", now = Date.parse("2026-11-05T00:00:00Z");
  function world(repo = canonical, head = "a".repeat(40)) {
    const original = syntheticWorld(), w: ReturnType<typeof syntheticWorld> = JSON.parse(JSON.stringify(original).replaceAll(original.repo.url, `https://github.com/${repo}`).replaceAll(original.headSha, head));
    const [owner, name] = repo.split("/"); w.repo = { ...w.repo, owner: owner!, name: name!, fullName: repo, url: `https://github.com/${repo}`, description: "SYNTHETIC unchanged 原始来源" }; w.source = "github"; return w;
  }
  const metadata = (patch: Record<string, unknown> = {}) => ({ private: true, visibility: "private", full_name: canonical, id: 123, description: "PRIVATE_PAYLOAD_CANARY_NEVER_LOG", license: null, ...patch });
  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "factory-private-canonical-")), path = join(directory, "worlds.sqlite"); let store = new WorldStore(path);
    const raw = new Database(path); store.put(world(), 120_000, now); store.alias(known, canonical); store.put(world(unrelated), 90_000, now);
    const dump = () => JSON.stringify(["worlds", "world_aliases", "world_public_state", "world_public_barriers"].map(table => raw.query(`SELECT * FROM ${table} ORDER BY rowid`).all()));
    return { directory, path, raw, dump, get store() { return store; }, reopen() { store.close(); store = new WorldStore(path); }, close() { store.close(); raw.close(); rmSync(directory, { recursive: true, force: true }); } };
  }
  function collector(options: { target?: string; value?: Record<string, unknown>; responseUrl?: string; error?: unknown } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher: import("../src/server/github").Fetcher = async (target, init = {}) => {
      const url = new URL(String(target)); if (url.origin !== "https://api.github.com") throw Error("SYNTHETIC unexpected host"); calls.push({ url: url.href, init });
      if (options.error) throw options.error;
      if (url.pathname === `/repos/${input}`) return new Response(null, { status: 301, headers: { location: options.target ?? `https://api.github.com/repos/${canonical}` } });
      const response = Response.json(options.value ?? metadata()); if (options.responseUrl) Object.defineProperty(response, "url", { value: options.responseUrl }); return response;
    };
    return { calls, fetcher, client: new GitHubClient("", fetcher) };
  }
  const begin = (store: InstanceType<typeof WorldStore>, key = input) => store.publicCaptures.begin(key, { explicitRevalidation: true });
  function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(r => { resolve = r; }), resolve: (value: T) => resolve(value) }; }
  async function proof(store: InstanceType<typeof WorldStore>, options: Parameters<typeof collector>[0] = {}) {
    const c = collector(options), generation = begin(store), context = createCollectionObservation(input, generation); let error: unknown;
    try { await c.client.collect(parseRepo(input), context); } catch (e) { error = e; }
    return { ...c, context, generation, error, capability: takePrivateRepositoryObservation(error, context, input, generation) };
  }

  test("CHILD actual301->canonical private service action durably denies canonical/input/known aliases/gallery/history after restart in one sequence", async () => {
    const f = fixture(), c = collector(), before = f.raw.query("SELECT * FROM worlds WHERE repo=?").get(unrelated);
    try {
      const service = createWorldService({ store: f.store, collector: c.client, now: () => now });
      let error: unknown; try { await service.loadWorld(input, { explicitRevalidation: true }); } catch (e) { error = e; }
      expect(error).toMatchObject({ code: "PUBLIC_ONLY", status: 403 }); expect(c.calls).toHaveLength(2); expect(c.calls.every(call => call.init.redirect === "manual")).toBe(true);
      expect(JSON.stringify(error)).not.toContain(canonical); expect(JSON.stringify(error)).not.toContain("PRIVATE_PAYLOAD_CANARY"); expect(c.calls.some(call => /\/git\/|\/contents\//.test(call.url))).toBe(false);
      const barriers = f.raw.query("SELECT repo,sequence,denied FROM world_public_barriers ORDER BY repo").all();
      expect(barriers).toEqual([canonical, known, input].sort().map(repo => ({ repo, sequence: 1, denied: 1 }))); expect(f.raw.query("SELECT * FROM worlds WHERE repo=?").get(unrelated)).toEqual(before);
      f.reopen(); for (const key of [input, canonical, known]) expect(f.store.get(key)).toBeNull(); expect(f.store.get(unrelated)).not.toBeNull();
      const cached = createWorldService({ store: f.store, collector: { async collect() { throw Error("FORBIDDEN"); } } });
      expect(await cached.getCachedWorld(known)).toBeNull(); expect((await cached.listFeatured()).find(row => row.fullName === canonical)?.ready).not.toBe(true);
      const cursor = new HistoryCursorCodec(await crypto.subtle.importKey("raw", new Uint8Array(32).fill(37), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
      const history = new HistoryService({ cache: f.store, store: { page() { throw Error("FORBIDDEN"); } } as unknown as import("../src/server/history-storage").HistoryStore, cursor, reader: { quota: { take() { throw Error("FORBIDDEN"); } }, fetcher: globalThis.fetch }, admitRequest() {}, admitCollection() { throw Error("FORBIDDEN"); } });
      await expect(history.read(canonical)).rejects.toMatchObject({ code: "HISTORY_CACHE_MISSING" });
    } finally { f.close(); }
  });

  test("CHILD real shared-resource collector forwards the per-call context and charges each of the two synthetic upstream GETs once", async () => {
    const f = fixture(), c = collector(); let quotaTakes = 0;
    try {
      const resources = createWorldResources(getConfig({}), { network: c.fetcher, makeQuota: () => ({ take() { quotaTakes++; } }), makeStore: () => f.store });
      const service = createWorldService({ store: resources.store, collector: resources.collector, now: () => now });
      await expect(service.loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); expect(quotaTakes).toBe(2); expect(c.calls).toHaveLength(2); expect(f.store.get(canonical)).toBeNull();
    } finally { f.close(); }
  });

  test("CHILD exact numeric repository-id binding and normal casefold are valid canonical evidence", async () => {
    for (const options of [{ target: "https://api.github.com/repositories/123" }, { target: "https://api.github.com/repos/OpenClaw/OpenClaw", value: metadata({ full_name: "OpenClaw/OpenClaw" }) }, { value: metadata({ visibility: "internal" }) }]) {
      const f = fixture(), c = collector(options);
      try { await expect(createWorldService({ store: f.store, collector: c.client }).loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); expect(f.store.get(canonical)).toBeNull(); expect(c.calls).toHaveLength(2); }
      finally { f.close(); }
    }
  });

  test("CHILD mismatched endpoint/full_name/id, unsafe/string ID and unknown/contradictory privacy never authorize extra cached targets", async () => {
    const options = [
      { value: metadata({ full_name: unrelated }) }, { value: metadata({ full_name: `https://github.com/${canonical}` }) }, { value: metadata({ full_name: "invalid" }) },
      { target: "https://api.github.com/repositories/124" }, { target: "https://api.github.com/repositories/123", value: metadata({ id: "123" }) }, { target: "https://api.github.com/repositories/9007199254740993", value: metadata({ id: 9007199254740992 }) },
      { value: metadata({ private: undefined, visibility: undefined }) }, { value: metadata({ private: undefined }) }, { value: metadata({ private: false }) }, { value: metadata({ visibility: "public" }) },
    ];
    for (const option of options) {
      const f = fixture(), c = collector(option);
      try { const before = f.raw.query("SELECT * FROM worlds WHERE repo=?").get(canonical); await expect(createWorldService({ store: f.store, collector: c.client }).loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); expect(f.store.get(input)).toBeNull(); expect(f.raw.query("SELECT * FROM worlds WHERE repo=?").get(canonical)).toEqual(before); expect(f.store.get(unrelated)).not.toBeNull(); expect(f.raw.query("SELECT repo FROM world_public_barriers").all()).toEqual([{ repo: input }]); }
      finally { f.close(); }
    }
  });

  test("CHILD response URL identity and offhost/port/query/encoding/dot redirects cannot mint canonical evidence", async () => {
    for (const target of ["https://evil.invalid/repos/openclaw/openclaw", "https://api.github.com:443/repos/openclaw/openclaw", "https://api.github.com/repos/openclaw/openclaw?x=1", "https://api.github.com/repos/openclaw/%6fpenclaw", "https://api.github.com/repos/openclaw/..", "https://api.github.com/repos/openclaw/openclaw#fragment"]) {
      const f = fixture(), c = collector({ target });
      try { await expect(createWorldService({ store: f.store, collector: c.client }).loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: target.endsWith("/..") ? "INVALID_REPO" : "GITHUB_REDIRECT" }); expect(c.calls).toHaveLength(1); expect(f.store.get(canonical)).not.toBeNull(); expect(f.raw.query("SELECT * FROM world_public_barriers").all()).toEqual([]); }
      finally { f.close(); }
    }
    const f = fixture(), c = collector({ responseUrl: "https://evil.invalid/repos/openclaw/openclaw" });
    try { await expect(createWorldService({ store: f.store, collector: c.client }).loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "GITHUB_REDIRECT" }); expect(f.store.get(canonical)).not.toBeNull(); }
    finally { f.close(); }
  });

  test("CHILD forged canonical fields/classes, Object.assign, wrappers and cause never become extra-target authority", async () => {
    for (const make of [() => Object.assign(new GitHubError("PUBLIC_ONLY", 403, "SYNTHETIC"), { canonical, privateCanonical: canonical, observed: { full_name: canonical } }), () => Object.assign(new GitHubError("PUBLIC_ONLY", 403, "SYNTHETIC"), JSON.parse(JSON.stringify({ canonical, visibility: "private" })))]) {
      const f = fixture();
      try { const service = createWorldService({ store: f.store, collector: { async collect() { throw make(); } } }); await expect(service.loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); expect(f.store.get(canonical)).not.toBeNull(); }
      finally { f.close(); }
    }
    const f = fixture(), c = collector();
    try { const service = createWorldService({ store: f.store, collector: { async collect(ref, context) { try { return await c.client.collect(ref, context); } catch (cause) { throw Object.assign(new GitHubError("PUBLIC_ONLY", 403, "SYNTHETIC wrapper"), { cause }); } } } }); await expect(service.loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); expect(f.store.get(canonical)).not.toBeNull(); }
    finally { f.close(); }
  });

  test("CHILD genuine unconsumed error replay on a different input or later invocation cannot authorize its old canonical target", async () => {
    for (const target of [input, "synthetic/other-input"]) {
      const f = fixture();
      try {
        const c = collector(), context = createCollectionObservation(input, begin(f.store)); let genuine: unknown; try { await c.client.collect(parseRepo(input), context); } catch (e) { genuine = e; }
        const service = createWorldService({ store: f.store, collector: { async collect() { throw genuine; } } }); await expect(service.loadWorld(target, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); expect(f.store.get(canonical)).not.toBeNull(); expect(f.store.get(target)).toBeNull();
      } finally { f.close(); }
    }
  });

  test("CHILD producer context is one invocation/input and opaque claim is one-use plus exact generation bound", async () => {
    const f = fixture();
    try {
      const p = await proof(f.store); expect(p.capability).toBeDefined(); expect(JSON.stringify(p.capability)).toBe("{}");
      expect(takePrivateRepositoryObservation(p.error, p.context, input, p.generation)).toBeUndefined();
      expect(takePrivateRepositoryObservation(p.error, createCollectionObservation(input), input, p.generation)).toBeUndefined();
      await expect(p.client.collect(parseRepo(input), p.context)).rejects.toMatchObject({ code: "INVALID_COLLECTION_CONTEXT" }); expect(p.calls).toHaveLength(2);
      const before = f.dump(), otherGeneration = begin(f.store); expect(() => f.store.publicCaptures.revoke(input, otherGeneration, p.capability)).toThrow(); expect(f.dump()).toBe(before);
      for (const forged of [{}, [canonical], canonical, null, { canonical, input, generation: p.generation }]) { expect(() => f.store.publicCaptures.revoke(input, p.generation, forged as any)).toThrow(); expect(f.dump()).toBe(before); }
      f.store.publicCaptures.revoke(input, p.generation, p.capability); expect(f.store.get(canonical)).toBeNull(); const denied = f.dump(); f.store.publicCaptures.revoke(input, p.generation, p.capability); expect(f.dump()).toBe(denied); expect(() => f.store.publicCaptures.revoke(input, p.generation)).toThrow();
    } finally { f.close(); }
  });

  test("CHILD genuine unconsumed observation cannot be rebound to a generation minted AFTER its metadata response", async () => {
    const f = fixture(), c = collector();
    try {
      const original = begin(f.store), context = createCollectionObservation(input, original); let error: unknown;
      try { await c.client.collect(parseRepo(input), context); } catch (e) { error = e; }
      expect(takePrivateRepositoryObservation(error, context, input, begin(f.store))).toBeUndefined();
      const capability = takePrivateRepositoryObservation(error, context, input, original); expect(capability).toBeDefined(); f.store.publicCaptures.revoke(input, original, capability); expect(f.store.get(canonical)).toBeNull();
    } finally { f.close(); }
  });

  test("CHILD mismatched/forged collection context rejects before any metadata request", async () => {
    const c = collector(); for (const context of [createCollectionObservation(unrelated), {} as import("../src/server/github").CollectionObservation]) await expect(c.client.collect(parseRepo(input), context)).rejects.toMatchObject({ code: "INVALID_COLLECTION_CONTEXT" }); expect(c.calls).toHaveLength(0);
  });

  test("CHILD grouped cleanup failure retains every deny across restart and old canonical/input writers cannot return", async () => {
    const f = fixture();
    try {
      const oldCanonical = begin(f.store, canonical), oldInput = begin(f.store), p = await proof(f.store);
      f.raw.exec("CREATE TRIGGER synthetic_cleanup BEFORE DELETE ON worlds BEGIN SELECT RAISE(ABORT,'SYNTHETIC cleanup failure'); END");
      let failure: unknown; try { f.store.publicCaptures.revoke(input, p.generation, p.capability); } catch (e) { failure = e; }
      expect(failure).toMatchObject({ barrier: "confirmed", cleanup: "unconfirmed" }); for (const key of [input, canonical, known]) expect(f.store.get(key)).toBeNull();
      expect(() => f.store.publicCaptures.commit(oldCanonical, world())).toThrow(); expect(() => f.store.publicCaptures.commit(oldInput, world(input))).toThrow(); expect(() => f.store.publicCaptures.revoke(input, p.generation, p.capability)).toThrow(failure as Error);
      expect(f.raw.query("SELECT DISTINCT sequence FROM world_public_barriers").all()).toEqual([{ sequence: 1 }]); f.reopen(); for (const key of [input, canonical, known]) expect(f.store.get(key)).toBeNull(); expect(f.store.get(unrelated)).not.toBeNull();
    } finally { f.close(); }
  });

  test("CHILD failed INITIAL grouped barrier transiently denies both known roots without claiming restart durability", async () => {
    const f = fixture();
    try {
      const p = await proof(f.store); f.raw.exec("CREATE TRIGGER synthetic_initial BEFORE INSERT ON world_public_barriers BEGIN SELECT RAISE(ABORT,'SYNTHETIC initial barrier failure'); END");
      let error: unknown; try { f.store.publicCaptures.revoke(input, p.generation, p.capability); } catch (e) { error = e; }
      expect(error).toMatchObject({ barrier: "unknown", cleanup: "not-started" }); for (const key of [input, canonical, known]) expect(() => f.store.get(key)).toThrow();
      f.reopen(); expect(f.store.get(canonical)).not.toBeNull(); // Honest LIMIT: initial transaction never durably committed.
    } finally { f.close(); }
  });

  test("CHILD private observation after an older canonical collector began rejects that late public commit", async () => {
    const f = fixture(), entered = deferred(), gate = deferred();
    const old = createWorldService({ store: f.store, now: () => now, collector: { async collect() { entered.resolve(); await gate.promise; const w = world(); return { repo: w.repo, headSha: w.headSha, collectedAt: w.collectedAt, tree: [], treeState: "full", files: [], issues: [], pulls: [], workflows: [], commits: [], languages: {}, notes: [], partial: false, rateLimitRemaining: null }; } } });
    const pending = old.loadWorld(canonical, { refresh: true });
    try { await entered.promise; const c = collector(); await expect(createWorldService({ store: f.store, collector: c.client }).loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); gate.resolve(); await expect(pending).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" }); expect(f.store.get(canonical)).toBeNull(); }
    finally { gate.resolve(); await pending.catch(() => {}); f.close(); }
  });

  test("CHILD actual fresh public metadata reopens verified canonical only; old PUBLIC_ONLY error replay cannot erase it", async () => {
    const f = fixture(), c = collector(); let oldError: unknown;
    try {
      const oldCanonical = begin(f.store, canonical), oldInput = begin(f.store);
      try { await createWorldService({ store: f.store, collector: c.client }).loadWorld(input, { explicitRevalidation: true }); } catch (e) { oldError = e; }
      const calls: string[] = [], publicClient = new GitHubClient("", async target => {
        const url = new URL(String(target)); if (url.origin !== "https://api.github.com") throw Error("SYNTHETIC unexpected host"); calls.push(url.href);
        if (url.pathname === `/repos/${canonical}`) return Response.json({ private: false, visibility: "public", full_name: canonical, default_branch: "main", license: null });
        if (url.pathname.includes("/git/ref/heads/")) return Response.json({ object: { type: "commit", sha: "b".repeat(40) } });
        if (url.pathname.includes("/git/commits/")) return Response.json({ sha: "b".repeat(40), tree: { sha: "c".repeat(40) } });
        if (url.pathname.includes("/git/trees/")) return Response.json({ tree: [{ path: "src/原始.ts", type: "blob", sha: "d".repeat(40) }], truncated: false });
        if (url.pathname.endsWith("/languages")) return Response.json({ TypeScript: 1 });
        if (url.pathname.includes("/actions/runs")) return Response.json({ workflow_runs: [] });
        if (/\/(issues|pulls|commits)$/.test(url.pathname)) return Response.json([]);
        return new Response("SYNTHETIC optional file absent", { status: 404 });
      });
      const fresh = await createWorldService({ store: f.store, collector: publicClient }).loadWorld(canonical, { refresh: true }); expect(fresh.headSha).toBe("b".repeat(40)); expect(calls.length).toBeGreaterThan(2); expect(f.store.get(input)).toBeNull(); expect(f.store.get(known)).toBeNull();
      for (const [token, w] of [[oldCanonical, world()], [oldInput, world(input)]] as const) expect(() => f.store.publicCaptures.commit(token, w)).toThrow();
      const replay = createWorldService({ store: f.store, collector: { async collect() { throw oldError; } } }); await expect(replay.loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); expect(f.store.get(canonical)?.world.headSha).toBe(fresh.headSha);
    } finally { f.close(); }
  });

  test("CHILD generic403/404/429+RetryAfter and redirect loops retain normal budgets and never revoke cached targets", async () => {
    for (const status of [403, 404, 429]) {
      const f = fixture(); let calls = 0;
      const client = new GitHubClient("", async () => { calls++; return new Response("SYNTHETIC response", { status, headers: status === 429 ? { "retry-after": "7" } : {} }); });
      try { const before = f.dump(); await expect(createWorldService({ store: f.store, collector: client }).loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: status === 403 ? "GITHUB_FORBIDDEN" : status === 404 ? "REPO_NOT_FOUND" : "GITHUB_RATE_LIMIT", ...(status === 429 ? { retryAfter: 7 } : {}) }); expect(f.dump()).toBe(before); expect(calls).toBe(1); }
      finally { f.close(); }
    }
    const f = fixture(); let calls = 0;
    try { const client = new GitHubClient("", async target => { calls++; return new Response(null, { status: 301, headers: { location: String(target) } }); }); await expect(createWorldService({ store: f.store, collector: client }).loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "GITHUB_REDIRECT" }); expect(calls).toBe(1); expect(f.raw.query("SELECT * FROM world_public_barriers").all()).toEqual([]); }
    finally { f.close(); }
  });
}
