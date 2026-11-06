import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

if (process.env.CAPTURE_WORLD_CLIENT_CHILD !== "1") {
  test("SYNTHETIC D1 capture world service/client/RPC/core composition runs in an empty-cwd minimal-env child", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-world-client-child-")), cwd = join(directory, "empty"); mkdirSync(cwd);
    try {
      const child = Bun.spawn([process.execPath, "--no-env-file", "test", new URL(import.meta.url).pathname], { cwd, env: { CAPTURE_WORLD_CLIENT_CHILD: "1", NODE_ENV: "test", TZ: "UTC", MOONSHOT_WORLD_WRITES_HOLD: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); process.stdout.write("SYNTHETIC capture client child (separate denominator):\n" + out + err); expect(exit).toBe(0); expect(readdirSync(cwd)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
} else {
  if (readdirSync(process.cwd()).length || Object.keys(process.env).sort().join() !== "CAPTURE_WORLD_CLIENT_CHILD,MOONSHOT_WORLD_WRITES_HOLD,NODE_ENV,TZ") throw Error("Empty cwd/minimal synthetic env required");
  globalThis.fetch = (async () => { throw Error("SYNTHETIC outbound forbidden"); }) as unknown as typeof fetch;
  const [{ captureClientFixture: fixture, captureWorld: world }, { D1CaptureWorldStore, D1CaptureWorldStoreError }, { createWorldService }, { GitHubClient, GitHubError, parseRepo, createCollectionObservation, takePrivateRepositoryObservation }, { PublicGitHubQuota }, { Database }, { WorldStorageError }, { WORLD_CAPTURE_RPC_URL }] = await Promise.all([
    import("./fixtures/capture-client"), import("../src/server/d1-capture-world-store"), import("../src/server/service"), import("../src/server/github"), import("../src/server/public-quota"), import("bun:sqlite"), import("../src/server/world-storage"), import("../src/server/world-capture-rpc-contract"),
  ]);
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const input = "synthetic/unknown", canonical = "synthetic/mixed", source = "Synthetic/MiXeD", known = "synthetic/former", unrelated = "synthetic/unrelated", now = Date.parse("2026-11-05T00:00:00Z"), explicit = { explicitRevalidation: true };
  const caught = async (promise: unknown) => { try { await promise; return null; } catch (e) { return e; } };
  function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(r => resolve = r), resolve: (value: T) => resolve(value) }; }
  const tick = () => Bun.sleep(5);
  async function seed(f: Fixture) { await f.client.put(world(), 120000, now - 240000); await f.client.alias(known, canonical); await f.client.put(world(unrelated), 120000, now - 240000); }
  function collector(f: Fixture, privacy = false) {
    const path = join(f.directory, "synthetic-github-quota.sqlite"), quota = new PublicGitHubQuota(path, 1000, () => now), calls: string[] = [], SHA = "a".repeat(40), TREE = "b".repeat(40);
    const fetcher: import("../src/server/github").Fetcher = async target => {
      const url = new URL(String(target)); if (url.origin !== "https://api.github.com") throw Error("SYNTHETIC fixed GitHub API only"); calls.push(url.href);
      if (url.pathname === `/repos/${input}`) return new Response(null, { status: 301, headers: { location: `https://api.github.com/repos/${source}` } });
      if (url.pathname.toLowerCase() === `/repos/${canonical}`) return Response.json({ private: privacy, visibility: privacy ? "private" : "public", full_name: source, id: 123, default_branch: "main", description: "SYNTHETIC source 原始", license: { spdx_id: "NOASSERTION" } });
      if (url.pathname.endsWith("/git/ref/heads/main")) return Response.json({ object: { type: "commit", sha: SHA } });
      if (url.pathname.endsWith(`/git/commits/${SHA}`)) return Response.json({ sha: SHA, tree: { sha: TREE } });
      if (url.pathname.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ path: "package.json", type: "blob", sha: TREE }, { path: "src/index.ts", type: "blob", sha: TREE }] });
      if (url.pathname.endsWith("/languages")) return Response.json({ TypeScript: 12 });
      if (url.pathname.includes("/contents/")) { const text = url.pathname.endsWith("package.json") ? '{"name":"synthetic","scripts":{"test":"bun test"}}' : "SYNTHETIC readonly text"; return Response.json({ type: "file", encoding: "base64", content: btoa(text), size: text.length }); }
      if (url.pathname.endsWith("/actions/runs")) return Response.json({ workflow_runs: [] });
      return Response.json([]);
    };
    const client = new GitHubClient("", quota.wrap(fetcher), () => now), count = () => { const db = new Database(path, { readonly: true }); try { return (db.query("SELECT COALESCE(SUM(used),0) AS n FROM github_quota").get() as { n: number }).n; } finally { db.close(); } };
    return { client, calls, count, close() { quota.close(); } };
  }
  async function proof(f: Fixture, g: import("../src/server/world-storage").PublicCaptureGeneration, take = true) {
    const c = collector(f, true), context = createCollectionObservation(input, g); let error: unknown;
    try { await c.client.collect(parseRepo(input), context); } catch (e) { error = e; }
    return { ...c, error, context, capability: take ? takePrivateRepositoryObservation(error, context, input, g) : undefined };
  }

  test("CHILD constructor requires exact injected authority, copies config and cannot select history/default network/key or raised limits", async () => {
    const f = await fixture();
    try {
      for (const config of [{ ...f.config, endpoint: WORLD_CAPTURE_RPC_URL + "/history" }, { ...f.config, endpoint: WORLD_CAPTURE_RPC_URL + "?override=x" }, { ...f.config, key: undefined }, { ...f.config, secret: "short" }, { ...f.config, identity: { ...f.identity, epoch: "bad" } }]) expect(() => new D1CaptureWorldStore(config as any, f.network)).toThrow(WorldStorageError);
      expect(() => new D1CaptureWorldStore(f.config, undefined as any)).toThrow(WorldStorageError); expect(() => new D1CaptureWorldStore(f.config, f.network, { timeoutMs: 10001 })).toThrow(WorldStorageError);
      f.config.endpoint = "https://evil.invalid/"; f.config.secret = "changed"; f.config.identity.databaseId = "changed";
      expect((await f.client.status()).schemaVersion).toBe(4); expect(f.calls[0]!.url).toBe(WORLD_CAPTURE_RPC_URL); expect(f.client.observeSettlement().idle).toBe(true);
    } finally { f.close(); }
  });

  test("CHILD actual service->client->RPC->SQLite public collection preserves source casing, head/hash/CJK; navigation/miss/stale/summary spends no GitHub allowance", async () => {
    const f = await fixture(), c = collector(f);
    try {
      const service = createWorldService({ store: f.client, collector: c.client, now: () => now });
      expect(await service.getCachedWorld(input)).toBeNull(); expect(c.count()).toBe(0); const snapshot = await service.loadWorld(input, { explicitRevalidation: true });
      expect(snapshot.repo.fullName).toBe(source); expect(snapshot.repo.url).toBe(`https://github.com/${source}`); expect(snapshot.repo.description).toContain("原始"); expect(snapshot.headSha).toBe("a".repeat(40)); expect(c.count()).toBe(c.calls.length); expect(c.count()).toBeGreaterThan(2);
      const quota = c.count(), before = f.dump(); expect((await service.getCachedWorld(input))?.repo.fullName).toBe(source); expect((await f.client.get(source, now + 180000))?.fresh).toBe(false);
      expect((await f.client.summaries([input, canonical, unrelated], now)).map(r => r.key)).toEqual([input, canonical]); expect(c.count()).toBe(quota); expect(f.dump()).toBe(before);
      const operations = f.calls.map(call => call.op); expect(operations).toContain("captureBegin"); expect(operations).toContain("captureCommit"); expect(operations).not.toContain("put"); expect(operations).not.toContain("alias");
      expect(JSON.stringify(snapshot)).not.toContain(f.calls.find(call => call.op === "captureCommit")!.body.generation.handle); expect(JSON.stringify(snapshot)).not.toContain("wcp1."); expect(JSON.stringify(snapshot)).not.toContain(f.config.secret);
    } finally { c.close(); f.close(); }
  });

  test("CHILD stale/partial cached source is retained without collection or repair; malformed cache is unavailable", async () => {
    const f = await fixture();
    try {
      const w = world(); w.coverage.tree = "unavailable"; w.health.github = "partial"; await f.client.put(w, 60000, now - 120000);
      const service = createWorldService({ store: f.client, collector: { async collect() { throw Error("CACHE MUST NOT COLLECT"); } }, now: () => now }), before = f.dump();
      const cached = await service.getCachedWorld(source); expect(cached?.coverage.notes.join(" ")).toContain("STALE"); expect(cached?.coverage.tree).toBe("unavailable"); expect(f.dump()).toBe(before);
      f.a.db.query("UPDATE worlds SET snapshot=replace(snapshot,'SYNTHETIC','sYNTHETIC') WHERE repo=?").run(canonical); const corrupt = f.dump(); await expect(service.getCachedWorld(source)).rejects.toBeInstanceOf(WorldStorageError); expect(f.dump()).toBe(corrupt);
    } finally { f.close(); }
  });

  test("CHILD actual301 private rename revokes input/canonical/known aliases in one sequence, exactly2original quota GETs, no stale fallback", async () => {
    const f = await fixture(), c = collector(f, true);
    try {
      await seed(f); const unrelatedBefore = f.a.db.query("SELECT * FROM worlds WHERE repo=?").get(unrelated), service = createWorldService({ store: f.client, collector: c.client, now: () => now });
      await expect(service.loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY", status: 403 }); expect(c.calls).toHaveLength(2); expect(c.count()).toBe(2);
      expect(f.a.db.query("SELECT repo,sequence,denied FROM world_capture_barriers ORDER BY repo").all()).toEqual([input, canonical, known].sort().map(repo => ({ repo, sequence: 1, denied: 1 })));
      for (const key of [input, canonical, known]) expect(await f.client.get(key)).toBeNull(); expect(f.a.db.query("SELECT * FROM worlds WHERE repo=?").get(unrelated)).toEqual(unrelatedBefore); expect(f.calls.filter(x => x.op === "captureRevoke")).toHaveLength(1); expect(f.calls.find(x => x.op === "captureRevoke")?.body.claim).toStartWith("wcp1.");
    } finally { c.close(); f.close(); }
  });

  test("CHILD exact pre-collector generation object owns signed private proof; copied/foreign/wrong-input/missing tokens fail0network", async () => {
    const f = await fixture(); let p: Awaited<ReturnType<typeof proof>> | undefined;
    try {
      await seed(f); const g = await f.client.publicCaptures.begin(input, explicit); expect(Object.isFrozen(g)).toBe(true); p = await proof(f, g); expect(p.capability).toBeDefined(); const before = f.calls.length;
      for (const token of [undefined, { ...g }, JSON.parse(JSON.stringify(g)), {}]) { await expect(f.client.publicCaptures.revoke(input, token as any, p.capability)).rejects.toBeInstanceOf(WorldStorageError); await expect(f.client.publicCaptures.commit(token as any, world(), 90000, now)).rejects.toBeInstanceOf(WorldStorageError); await expect(f.client.publicCaptures.assert(token as any)).rejects.toBeInstanceOf(WorldStorageError); }
      await expect(f.client.publicCaptures.revoke(unrelated, g, p.capability)).rejects.toBeInstanceOf(WorldStorageError); expect(f.calls.length).toBe(before);
      const later = await f.client.publicCaptures.begin(input, explicit), count = f.calls.length; await expect(f.client.publicCaptures.revoke(input, later, p.capability)).rejects.toBeInstanceOf(WorldStorageError); expect(f.calls.length).toBe(count);
      await f.client.publicCaptures.revoke(input, g, p.capability); const first = f.calls.length; await f.client.publicCaptures.revoke(input, g, p.capability); expect(f.calls.length).toBe(first + 1); expect((await f.client.inspect(g)).status).toBe("denied");
    } finally { p?.close(); f.close(); }
  });

  test("CHILD replayed/forged GitHub errors cannot expand canonical group in a later actual service collection", async () => {
    for (const genuine of [false, true]) {
      const f = await fixture(); let p: Awaited<ReturnType<typeof proof>> | undefined;
      try { await seed(f); const old = await f.client.publicCaptures.begin(input, explicit); p = await proof(f, old, false); const error = genuine ? p.error : Object.assign(new GitHubError("PUBLIC_ONLY", 403, "SYNTHETIC"), { canonical, privateCanonical: canonical }); const service = createWorldService({ store: f.client, collector: { async collect() { throw error; } }, now: () => now });
        await expect(service.loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); expect(await f.client.get(input)).toBeNull(); expect((await f.client.get(canonical))?.world.repo.fullName).toBe(source); expect(f.a.db.query("SELECT repo FROM world_capture_barriers").all()).toEqual([{ repo: input }]); expect(f.calls.findLast(x => x.op === "captureRevoke")?.body.claim).toBeUndefined();
      } finally { p?.close(); f.close(); }
    }
  });

  test("CHILD grouped cleanup uncertainty is storage failclosed in service; old writer fails, explicit fresh public reopen leaves former alias denied", async () => {
    const f = await fixture(), c = collector(f, true);
    try {
      await seed(f); const old = await f.client.publicCaptures.begin(canonical, explicit), before = f.a.calls.length;
      f.a.beforeBatch = async n => { if (n === before + 2) f.a.interrupt = { batch: n, statement: 1 }; };
      const service = createWorldService({ store: f.client, collector: c.client, now: () => now }); const error = await caught(service.loadWorld(input, { explicitRevalidation: true }));
      expect(error).toBeInstanceOf(WorldStorageError); expect(error).toMatchObject({ writeOutcome: "unknown", barrier: "confirmed", cleanup: "unconfirmed" }); for (const key of [input, canonical, known]) expect(await f.client.get(key)).toBeNull();
      await expect(f.client.publicCaptures.commit(old, world(), 90000, now)).rejects.toMatchObject({ writeOutcome: "not-started" }); f.a.beforeBatch = undefined; f.a.interrupt = undefined;
      const fresh = await f.client.publicCaptures.begin(input, explicit); await f.client.publicCaptures.commit(fresh, world(), 90000, now); expect((await f.client.get(input))?.world.repo.fullName).toBe(source); expect(await f.client.get(known)).toBeNull(); await expect(f.client.put(world(), 90000, now)).rejects.toBeInstanceOf(WorldStorageError);
    } finally { c.close(); f.close(); }
  });

  test("CHILD legacy alias rename/reuse/missing and delete-as-evict preserve source and authority", async () => {
    const f = await fixture();
    try {
      await seed(f); await f.client.alias(input, canonical); const g = await f.client.publicCaptures.begin(input, explicit); await f.client.publicCaptures.commit(g, world("Synthetic/Unknown"), 90000, now); expect((await f.client.get(input))?.world.repo.fullName).toBe("Synthetic/Unknown"); expect((await f.client.get(known))?.world.repo.fullName).toBe(source);
      const next = await f.client.publicCaptures.begin(canonical, explicit); await f.client.publicCaptures.commit(next, world("Synthetic/Moved"), 90000, now); expect(await f.client.get(known)).toBeNull(); expect((await f.client.get(canonical))?.world.repo.fullName).toBe("Synthetic/Moved");
      const dump = f.dump(); await f.client.alias(unrelated, "synthetic/missing"); expect(f.dump()).toBe(dump); const receipts = f.a.db.query("SELECT * FROM world_capture_generations ORDER BY rowid").all(); await f.client.delete(canonical); expect(await f.client.get(canonical)).toBeNull(); expect(f.a.db.query("SELECT * FROM world_capture_generations ORDER BY rowid").all()).toEqual(receipts); expect(f.calls.at(-2)?.op).toBe("evict");
    } finally { f.close(); }
  });

  test("CHILD valid sparse miss differs from empty/mismatched/malformed envelopes and rows; raw hash/source identity/counters never repaired", async () => {
    const f = await fixture();
    try {
      expect(await f.client.get(input)).toBeNull(); await f.client.put(world(), 90000, now);
      const mutations = [(w: any) => [], (w: any) => ({ ...w, op: "status" }), (w: any) => ({ ...w, schemaVersion: 3 }), (w: any) => ({ ...w, protocol: 2 }), (w: any) => ({ ...w, identity: { ...w.identity, epoch: "f".repeat(32) } }), (w: any) => ({ ...w, result: [...w.result, ...w.result] }), (w: any) => ({ ...w, result: [{ ...w.result[0], key: unrelated }] }), (w: any) => ({ ...w, result: [{ ...w.result[0], hash: "0".repeat(64) }] }), (w: any) => ({ ...w, result: [{ ...w.result[0], expiresAt: -1 }] }), (w: any) => ({ ...w, result: [{ ...w.result[0], repo: "wrong/repo" }] })];
      const before = f.dump(); for (const mutate of mutations) { f.transform(async response => Response.json(mutate(await response.json()))); await expect(f.client.get(canonical)).rejects.toBeInstanceOf(WorldStorageError); expect(f.dump()).toBe(before); }
      f.transform(undefined); expect((await f.client.get(source))?.world.repo.fullName).toBe(source);
    } finally { f.close(); }
  });

  test("CHILD summaries split into bounded single-key requests, reject invalid partial rows and share whole-operation settlement/deadline", async () => {
    const f = await fixture();
    try {
      await seed(f); const before = f.calls.length; expect((await f.client.summaries([canonical, unrelated, input])).map(r => r.key)).toEqual([canonical, unrelated]); expect(f.calls.slice(before).every(c => c.body.keys.length === 1)).toBe(true);
      f.transform(async response => { expect(f.client.observeSettlement().idle).toBe(false); const w = await response.json() as any; if (w.result.length) w.result[0].repo.fullName = unrelated; return Response.json(w); }); await expect(f.client.summaries([canonical])).rejects.toBeInstanceOf(WorldStorageError); f.transform(undefined);
      const count = f.calls.length; await expect(f.client.summaries([source, canonical])).rejects.toBeInstanceOf(WorldStorageError); expect(f.calls.length).toBe(count);
      let clock = 0; const limited = new D1CaptureWorldStore(f.config, async (...args) => { clock += 50; return f.network(...args); }, { timeoutMs: 80 }, () => clock); const calls = f.calls.length; await expect(limited.summaries([canonical, unrelated, input])).rejects.toBeInstanceOf(WorldStorageError); expect(f.calls.length - calls).toBe(2); await limited.observeSettlement().settled; expect(limited.observeSettlement().idle).toBe(true);
    } finally { f.close(); }
  });

  test("CHILD current validated error provenance is required; same-class/old actual errors/cause cannot claim not-started or confirmed privacy", async () => {
    const f = await fixture();
    try {
      const g = await f.client.publicCaptures.begin(input, explicit); await f.client.publicCaptures.commit(g, world(), 90000, now); const genuine = await caught(f.client.publicCaptures.commit(g, world(), 90000, now)); expect(genuine).toMatchObject({ writeOutcome: "not-started" });
      for (const error of [genuine, new D1CaptureWorldStoreError("not-started", "confirmed", "confirmed"), Object.assign(new Error("PRIVATE_CANARY"), { cause: genuine, barrier: "confirmed", writeOutcome: "not-started" })]) { const bad = new D1CaptureWorldStore(f.config, async () => { throw error; }); const result = await caught(bad.put(world(), 90000, now)); expect(result).toMatchObject({ writeOutcome: "unknown", barrier: null, cleanup: null }); expect(String(result)).not.toContain("PRIVATE_CANARY"); }
    } finally { f.close(); }
  });

  for (const kind of ["begin", "commit", "revoke", "put", "alias", "evict"] as const) test(`CHILD dispatched ${kind} lost/typed/invalid responses remain UNKNOWN with no retry`, async () => {
    for (const mode of ["lost", "typed", "invalid"] as const) {
      const f = await fixture();
      try {
        await seed(f); const g = await f.client.publicCaptures.begin(input, explicit), before = f.calls.length;
        f.transform(async response => { if (mode === "lost") throw Error("PRIVATE_CANARY " + f.config.secret); if (mode === "typed") throw new D1CaptureWorldStoreError("not-started", "confirmed", "confirmed"); return Response.json({ ok: true, result: [] }); });
        const operation = kind === "begin" ? f.client.publicCaptures.begin("synthetic/second", explicit) : kind === "commit" ? f.client.publicCaptures.commit(g, world(), 90000, now) : kind === "revoke" ? f.client.publicCaptures.revoke(input, g) : kind === "put" ? f.client.put(world(canonical), 90000, now) : kind === "alias" ? f.client.alias(input, canonical) : f.client.delete(canonical);
        const error = await caught(operation); expect(error).toMatchObject({ writeOutcome: "unknown", barrier: null }); expect(error).toBeInstanceOf(WorldStorageError); expect(f.calls.length).toBe(before + 1); expect(String(error)).not.toContain(f.config.secret);
      } finally { f.close(); }
    }
  });

  test("CHILD duplicate begin handle replay cannot mint a second store-owned producer object", async () => {
    const f = await fixture();
    try { const old = await f.client.publicCaptures.begin(input, explicit); f.transform(async response => { const body = await response.json() as any; body.result = old; return Response.json(body); }); await expect(f.client.publicCaptures.begin(input, explicit)).rejects.toMatchObject({ writeOutcome: "unknown" }); } finally { f.close(); }
  });

  test("CHILD invalid UTF8/BOM/duplicate JSON/content headers/status/actual byte caps are safe errors, never cache misses", async () => {
    const f = await fixture();
    try {
      for (const make of [() => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }), () => new Response('\ufeff{}', { headers: { "content-type": "application/json" } }), () => new Response('{"ok":true,"ok":false}', { headers: { "content-type": "application/json" } }), () => new Response('{}', { status: 302, headers: { location: "https://evil.invalid/", "content-type": "application/json" } }), () => new Response('{}', { headers: { "content-type": "text/html" } }), () => new Response('{}', { headers: { "content-type": "application/json", "content-length": "9999" } }), () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json", "content-length": "1" } })]) { const client = new D1CaptureWorldStore(f.config, async () => make()); await expect(client.get(input)).rejects.toBeInstanceOf(WorldStorageError); await client.observeSettlement().settled; }
      const small = new D1CaptureWorldStore(f.config, f.network, { requestBytes: 10 }); const count = f.calls.length; await expect(small.put(world(), 90000, now)).rejects.toMatchObject({ writeOutcome: "not-started" }); expect(f.calls.length).toBe(count);
    } finally { f.close(); }
  });

  test("CHILD late fetch to pending cancel handoff and concurrent calls remain physically busy until every local promise settles", async () => {
    const f = await fixture();
    try {
      const fetches = [deferred<Response>(), deferred<Response>()], cancels = [deferred(), deferred()]; let sent = 0, cancelled = 0;
      const client = new D1CaptureWorldStore(f.config, async () => fetches[sent++]!.promise, { timeoutMs: 20 });
      await Promise.all([caught(client.get(input)), caught(client.get(canonical))]); const observed = client.observeSettlement(); expect(observed.idle).toBe(false); let settled = false; void observed.settled.then(() => settled = true);
      for (let i = 0; i < 2; i++) { fetches[i]!.resolve(new Response(new ReadableStream({ cancel() { cancelled++; return cancels[i]!.promise; } }), { headers: { "content-type": "application/json" } })); await tick(); expect(cancelled).toBe(i + 1); expect(client.observeSettlement().idle).toBe(false); cancels[i]!.resolve(); await tick(); if (i === 0) expect(settled).toBe(false); }
      await observed.settled; expect(settled).toBe(true); expect(client.observeSettlement().idle).toBe(true); expect(sent).toBe(2);
    } finally { f.close(); }
  });

  test("CHILD pending read and cancel remain observed after timeout in either settlement order; no remote cancellation/rollback claim", async () => {
    for (const readFirst of [true, false]) {
      const f = await fixture();
      try {
        const read = deferred<ReadableStreamReadResult<Uint8Array>>(), cancel = deferred();
        const response = new Response(null, { headers: { "content-type": "application/json" } }); Object.defineProperty(response, "body", { value: { getReader: () => ({ read: () => read.promise, cancel: () => cancel.promise }) } });
        const client = new D1CaptureWorldStore(f.config, async () => response, { timeoutMs: 20 }); expect(await caught(client.put(world(), 90000, now))).toMatchObject({ writeOutcome: "unknown" }); const observation = client.observeSettlement(); expect(observation.idle).toBe(false);
        if (readFirst) read.resolve({ done: true, value: undefined }); else cancel.resolve(); await tick(); expect(client.observeSettlement().idle).toBe(false);
        if (readFirst) cancel.resolve(); else read.resolve({ done: true, value: undefined }); await observation.settled; expect(client.observeSettlement().idle).toBe(true);
      } finally { f.close(); }
    }
  });

  test("CHILD partial/hung stream and monotonic clock failures are bounded, retain physical work and never dispatch a retry", async () => {
    const f = await fixture();
    try {
      const cancel = deferred(); let calls = 0;
      const client = new D1CaptureWorldStore(f.config, async () => { calls++; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { return cancel.promise; } }), { headers: { "content-type": "application/json" } }); }, { timeoutMs: 20 });
      await expect(client.get(input)).rejects.toBeInstanceOf(WorldStorageError); expect(client.observeSettlement().idle).toBe(false); cancel.resolve(); await client.observeSettlement().settled; expect(calls).toBe(1);
      let n = 0; const backward = new D1CaptureWorldStore(f.config, f.network, {}, () => n--); const count = f.calls.length; await expect(backward.put(world(), 90000, now)).rejects.toMatchObject({ writeOutcome: "not-started" }); expect(f.calls.length).toBe(count);
    } finally { f.close(); }
  });

  test("CHILD real101st client save evicts old target and aliases together without removing generation receipts", async () => {
    const f = await fixture();
    try {
      for (let i = 0; i < 100; i++) { const w = world(`synthetic/eviction-${String(i).padStart(3, "0")}`); await f.core.putLegacy({ snapshot: JSON.stringify(w), savedAt: 1000 + i, expiresAt: 121000 + i }); }
      await f.client.alias(known, "synthetic/eviction-000"); const generation = await f.client.publicCaptures.begin(unrelated, explicit), receipts = f.a.db.query("SELECT * FROM world_capture_generations").all();
      await f.client.put(world(), 90000, now); expect(await f.client.get(known)).toBeNull(); expect(f.a.db.query("SELECT * FROM world_aliases WHERE alias=?").get(known)).toBeNull(); expect((await f.client.status()).worlds).toBe(100); expect(f.a.db.query("SELECT * FROM world_capture_generations").all()).toEqual(receipts); expect((await f.client.inspect(generation)).status).toBe("active");
    } finally { f.close(); }
  });

  test("CHILD service refresh cannot turn a committed-but-lost client write into stale cached success", async () => {
    const f = await fixture(), c = collector(f);
    try {
      await seed(f); await f.client.alias(input, canonical); f.transform((response, op) => { if (op.op === "captureCommit") throw Error("SYNTHETIC lost commit ACK"); return response; });
      const service = createWorldService({ store: f.client, collector: c.client, now: () => now }); await expect(service.loadWorld(input, { refresh: true })).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", writeOutcome: "unknown" });
      f.transform(undefined); expect((await f.client.get(input, now))?.world.collectedAt).toBe(new Date(now).toISOString()); expect(f.calls.filter(call => call.op === "captureCommit")).toHaveLength(1);
    } finally { c.close(); f.close(); }
  });

  test("CHILD replay of an actual confirmed-deny error through transport/read cannot certify a later write", async () => {
    const f = await fixture(); let p: Awaited<ReturnType<typeof proof>> | undefined;
    try {
      await seed(f); const g = await f.client.publicCaptures.begin(input, explicit); p = await proof(f, g); f.a.interrupt = { batch: f.a.calls.length + 1, statement: 1 };
      const genuine = await caught(f.client.publicCaptures.revoke(input, g, p.capability)); expect(genuine).toMatchObject({ writeOutcome: "unknown", barrier: "confirmed", cleanup: "unconfirmed" });
      for (const stream of [false, true]) {
        const network: import("../src/server/github").Fetcher = async () => { if (!stream) throw genuine; const response = new Response(null, { headers: { "content-type": "application/json" } }); Object.defineProperty(response, "body", { value: { getReader: () => ({ read: () => Promise.reject(genuine), cancel: () => Promise.resolve() }) } }); return response; };
        const client = new D1CaptureWorldStore(f.config, network); expect(await caught(client.put(world(unrelated), 90000, now))).toMatchObject({ writeOutcome: "unknown", barrier: null, cleanup: null }); await client.observeSettlement().settled;
      }
    } finally { p?.close(); f.close(); }
  });

  test("CHILD operation-specific status/summary/result counters and identity are strict, original activity counter remains untouched", async () => {
    const f = await fixture();
    try {
      await seed(f); const { activePublicAnalyses } = await import("../src/server/runtime-activity"); expect(activePublicAnalyses()).toBe(0);
      for (const mutate of [(w: any) => { w.result.generations = 257; }, (w: any) => { w.result.worlds = -1; }, (w: any) => { w.result.sequence = w.result.revision + 1; }, (w: any) => { w.result.retirementQuiet = true; }, (w: any) => { w.result.identity.epoch = "f".repeat(32); }]) { f.transform(async response => { const w = await response.json(); mutate(w); return Response.json(w); }); await expect(f.client.status()).rejects.toBeInstanceOf(WorldStorageError); }
      f.transform(async response => { const w = await response.json() as any; w.result[0].ready = "yes"; return Response.json(w); }); await expect(f.client.summaries([canonical])).rejects.toBeInstanceOf(WorldStorageError); f.transform(undefined);
      const pause = deferred<Response>(), client = new D1CaptureWorldStore(f.config, async () => pause.promise, { timeoutMs: 20 }); await caught(client.get(input)); expect(client.observeSettlement().idle).toBe(false); expect(activePublicAnalyses()).toBe(0); pause.resolve(Response.json({})); await client.observeSettlement().settled; expect(activePublicAnalyses()).toBe(0);
    } finally { f.close(); }
  });

  test("CHILD local proof-signing timeout remains observed and cannot dispatch a later revoke after response deadline", async () => {
    const f = await fixture(), client = new D1CaptureWorldStore(f.config, f.network, { timeoutMs: 50 }), gate = deferred(); let p: Awaited<ReturnType<typeof proof>> | undefined;
    const original = crypto.subtle.sign;
    try {
      const g = await client.publicCaptures.begin(input, explicit); p = await proof(f, g); const before = f.calls.length;
      crypto.subtle.sign = (...args) => gate.promise.then(() => original.apply(crypto.subtle, args));
      await expect(client.publicCaptures.revoke(input, g, p.capability)).rejects.toMatchObject({ writeOutcome: "not-started" }); expect(client.observeSettlement().idle).toBe(false); expect(f.calls.length).toBe(before);
      crypto.subtle.sign = original; gate.resolve(); await client.observeSettlement().settled; expect(client.observeSettlement().idle).toBe(true); expect(f.calls.length).toBe(before);
    } finally { crypto.subtle.sign = original; gate.resolve(); p?.close(); await client.observeSettlement().settled; f.close(); }
  });

  test("CHILD final local get projection rechecks normal/deadline/backwards/nonfinite clocks before publication", async () => {
    const f = await fixture();
    try {
      await f.client.put(world(), 90000, now); const response = await f.network(WORLD_CAPTURE_RPC_URL, { method: "POST", redirect: "error", headers: { "content-type": "application/json", "x-factory-storage-key": f.config.secret }, body: JSON.stringify({ op: "getMany", keys: [canonical] }) }); const text = await response.text(), raw = JSON.parse(text).result[0].snapshot;
      for (const mode of ["normal", "deadline", "backwards", "nonfinite"] as const) {
        let clock = 100, parses = 0; const original = JSON.parse, client = new D1CaptureWorldStore(f.config, async () => new Response(text, { headers: { "content-type": "application/json" } }), {}, () => clock);
        try {
          JSON.parse = ((...args: Parameters<typeof JSON.parse>) => { const result = original(...args); if (args[0] === raw && ++parses === 2) clock = mode === "deadline" ? 10100 : mode === "backwards" ? 99 : mode === "nonfinite" ? NaN : 100; return result; }) as typeof JSON.parse;
          if (mode === "normal") expect((await client.get(canonical, now))?.world.repo.fullName).toBe(source);
          else await expect(client.get(canonical, now)).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", writeOutcome: "not-started" });
          expect(parses).toBe(2);
        } finally { JSON.parse = original; await client.observeSettlement().settled; expect(client.observeSettlement().idle).toBe(true); }
      }
    } finally { f.close(); }
  });

  test("CHILD final token projection deadline after a dispatched begin remains UNKNOWN and physically settled", async () => {
    const f = await fixture(); let clock = 100;
    const original = Object.freeze;
    try {
      const response = await f.network(WORLD_CAPTURE_RPC_URL, { method: "POST", redirect: "error", headers: { "content-type": "application/json", "x-factory-storage-key": f.config.secret }, body: JSON.stringify({ op: "captureBegin", repo: input, explicitRevalidation: true }) }); const text = await response.text(), handle = JSON.parse(text).result.handle;
      const client = new D1CaptureWorldStore(f.config, async () => new Response(text, { headers: { "content-type": "application/json" } }), {}, () => clock);
      try { Object.freeze = ((value: any) => { const result = original(value); if (value?.handle === handle) clock = 10100; return result; }) as typeof Object.freeze; await expect(client.publicCaptures.begin(input, explicit)).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", writeOutcome: "unknown", barrier: null }); }
      finally { Object.freeze = original; await client.observeSettlement().settled; expect(client.observeSettlement().idle).toBe(true); }
      expect(f.a.db.query("SELECT count(*) n FROM world_capture_generations WHERE status='active'").get()).toEqual({ n: 1 });
    } finally { Object.freeze = original; f.close(); }
  });
}
