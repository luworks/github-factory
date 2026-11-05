import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const invalidModes = ["nonfunction", "undefined", "getter", "throws", "shape", "rejects", "settled-value", "idle-pending", "replaced", "thenable"] as const;
if (!process.env.WORLD_LIFECYCLE_CHILD) {
  for (const mode of ["normal", ...invalidModes]) test(`SYNTHETIC original world lifetime ${mode} runs in its own empty-cwd minimal-env child`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-world-lifetime-child-")), cwd = join(directory, "empty"); mkdirSync(cwd);
    try {
      const child = Bun.spawn([process.execPath, "--no-env-file", "test", new URL(import.meta.url).pathname], { cwd, env: { WORLD_LIFECYCLE_CHILD: mode, MOONSHOT_WORLD_WRITES_HOLD: "0", NODE_ENV: "test", TZ: "UTC" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); process.stdout.write(`SYNTHETIC world lifecycle ${mode} child (separate denominator):\n` + out + err); expect(exit).toBe(0); expect(readdirSync(cwd)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
} else {
  if (readdirSync(process.cwd()).length || Object.keys(process.env).sort().join() !== "MOONSHOT_WORLD_WRITES_HOLD,NODE_ENV,TZ,WORLD_LIFECYCLE_CHILD") throw Error("Empty cwd/minimal synthetic env required");
  globalThis.fetch = (async () => { throw Error("SYNTHETIC outbound forbidden"); }) as unknown as typeof fetch;
  const [{ captureClientFixture: fixture, captureWorld: world }, { D1CaptureWorldStore }, { createWorldService }, { GitHubClient }, { activePublicAnalyses, publicAnalysis }, { WorldStore }, { WorldStorageError }] = await Promise.all([
    import("./fixtures/capture-client"), import("../src/server/d1-capture-world-store"), import("../src/server/service"), import("../src/server/github"), import("../src/server/runtime-activity"), import("../src/server/store"), import("../src/server/world-storage"),
  ]);
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const input = "synthetic/unknown", source = "Synthetic/MiXeD", canonical = "synthetic/mixed", known = "synthetic/former", now = Date.parse("2026-11-05T00:00:00Z");
  const caught = async (promise: unknown) => { try { await promise; return null; } catch (e) { return e; } };
  function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(r => resolve = r), resolve: (value: T) => resolve(value) }; }
  const tick = () => Bun.sleep(5);
  function collector(privacy = false, gate?: { entered: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> }) {
    const calls: string[] = [], SHA = "a".repeat(40), TREE = "b".repeat(40);
    const client = new GitHubClient("", async target => {
      const url = new URL(String(target)); if (url.origin !== "https://api.github.com") throw Error("SYNTHETIC fixed GitHub API only"); calls.push(url.href);
      if (gate && calls.length === 1) { gate.entered.resolve(); await gate.release.promise; }
      if (url.pathname === `/repos/${input}`) return new Response(null, { status: 301, headers: { location: `https://api.github.com/repos/${source}` } });
      if (url.pathname.toLowerCase() === `/repos/${canonical}`) return Response.json({ private: privacy, visibility: privacy ? "private" : "public", full_name: source, id: 123, default_branch: "main", description: "SYNTHETIC retained 原始", license: { spdx_id: "NOASSERTION" } });
      if (url.pathname.endsWith("/git/ref/heads/main")) return Response.json({ object: { type: "commit", sha: SHA } });
      if (url.pathname.endsWith(`/git/commits/${SHA}`)) return Response.json({ sha: SHA, tree: { sha: TREE } });
      if (url.pathname.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ path: "package.json", type: "blob", sha: TREE }, { path: "src/index.ts", type: "blob", sha: TREE }] });
      if (url.pathname.endsWith("/languages")) return Response.json({ TypeScript: 20 });
      if (url.pathname.includes("/contents/")) return Response.json({ type: "file", encoding: "base64", size: 2, content: btoa("{}") });
      if (url.pathname.endsWith("/actions/runs")) return Response.json({ workflow_runs: [] }); return Response.json([]);
    }, () => now);
    return { client, calls };
  }
  const counts = (service: ReturnType<typeof createWorldService>, expected: number) => { expect(service.activeCollections()).toBe(expected); expect(activePublicAnalyses()).toBe(expected); };
  async function seed(f: Fixture) { await f.client.put(world(), 120000, now - 240000); await f.client.alias(known, canonical); }

  if (process.env.WORLD_LIFECYCLE_CHILD !== "normal") {
    test(`CHILD UNKNOWN observer ${process.env.WORLD_LIFECYCLE_CHILD} retains BOTH original authorities without reset`, async () => {
      const f = await fixture(), c = collector();
      try {
        await seed(f); const mode = process.env.WORLD_LIFECYCLE_CHILD!, real = f.client.observeSettlement;
        const replacement = mode === "nonfunction" ? 42 : mode === "undefined" ? undefined : mode === "shape" ? () => ({ idle: "yes", settled: Promise.resolve() }) : mode === "rejects" ? () => ({ idle: false, settled: Promise.reject(Error("SYNTHETIC rejected observation")) }) : mode === "settled-value" ? () => ({ idle: false, settled: Promise.resolve(123) }) : mode === "idle-pending" ? () => ({ idle: true, settled: new Promise(() => {}) }) : mode === "thenable" ? () => ({ idle: false, settled: { then(resolve: (value: undefined) => void) { resolve(undefined); } } }) : mode === "throws" ? () => { throw Error("SYNTHETIC observer failure"); } : real;
        if (mode === "getter") Object.defineProperty(f.client, "observeSettlement", { get() { throw Error("SYNTHETIC getter failure"); }, configurable: true });
        else Object.defineProperty(f.client, "observeSettlement", { value: replacement, configurable: true });
        const service = createWorldService({ store: f.client, collector: c.client, maxConcurrent: 1, now: () => now });
        if (mode === "replaced") Object.defineProperty(f.client, "observeSettlement", { value: () => ({ idle: true, settled: Promise.resolve() }), configurable: true });
        const error = await caught(service.loadWorld(input, { explicitRevalidation: true })); expect(error).toBeInstanceOf(WorldStorageError); expect(error).toMatchObject({ writeOutcome: "unknown", physicalSettlement: "unknown" }); counts(service, 1);
        const before = f.calls.filter(x => x.op === "captureBegin").length; await expect(service.loadWorld("synthetic/other")).rejects.toMatchObject({ code: "WORLD_BUSY" }); expect(f.calls.filter(x => x.op === "captureBegin")).toHaveLength(before); counts(service, 1);
        process.env.MOONSHOT_WORLD_WRITES_HOLD = "1"; expect((await service.getCachedWorld(source))?.repo.fullName).toBe(source); expect((await service.storageStatus()).backend).toBe("d1"); counts(service, 1);
        // Counter/slot intentionally retained in this dedicated child. No reset,
        // observer replacement recovery, forced decrement or poll is performed.
      } finally { f.close(); }
    });
  } else {
    test("CHILD actual observed service acquires original global/slot before begin, fast success/denial cleanup and source objects stay truthful", async () => {
      const f = await fixture(), c = collector();
      try {
        let service!: ReturnType<typeof createWorldService>; const client = new D1CaptureWorldStore(f.config, async (target, init) => { const op = JSON.parse(init?.body as string); if (op.op === "captureBegin" || op.op === "captureCommit") counts(service, 1); return f.network(target, init); }); service = createWorldService({ store: client, collector: c.client, now: () => now });
        const value = await service.loadWorld(input, { explicitRevalidation: true }); expect(value.repo.fullName).toBe(source); expect(value.repo.license).toBe("NOASSERTION"); counts(service, 0); const before = f.calls.length;
        expect((await service.loadWorld(input))?.headSha).toBe(value.headSha); expect(f.calls.slice(before).every(call => call.op === "getMany")).toBe(true); counts(service, 0);
        const privateCollector = collector(true), privateService = createWorldService({ store: client, collector: privateCollector.client, now: () => now + 30000 }); service = privateService; await expect(privateService.loadWorld(input, { refresh: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); counts(privateService, 0); expect(privateCollector.calls).toHaveLength(2); expect(await client.get(canonical)).toBeNull();
      } finally { f.close(); }
    });

    test("CHILD begin timeout retains original counters/singleflight/slot through late fetch->cancel, blocks new collector and releases once", async () => {
      const f = await fixture(), c = collector(), entered = deferred(), fetchGate = deferred<Response>(), cancelGate = deferred();
      try {
        let held = false, cancellations = 0; const client = new D1CaptureWorldStore(f.config, async (target, init) => { const op = JSON.parse(init?.body as string); const response = await f.network(target, init); if (op.op !== "captureBegin" || held) return response; held = true; await response.text(); entered.resolve(); return fetchGate.promise; }, { timeoutMs: 150 });
        const service = createWorldService({ store: client, collector: c.client, maxConcurrent: 1, now: () => now }), pending = service.loadWorld(input, { explicitRevalidation: true }); await entered.promise; counts(service, 1);
        await expect(pending).rejects.toMatchObject({ writeOutcome: "unknown" }); counts(service, 1); expect(c.calls).toHaveLength(0); await expect(service.loadWorld(input)).rejects.toMatchObject({ writeOutcome: "unknown" }); await expect(service.loadWorld("synthetic/other")).rejects.toMatchObject({ code: "WORLD_BUSY" }); expect(f.calls.filter(x => x.op === "captureBegin")).toHaveLength(1);
        fetchGate.resolve(new Response(new ReadableStream({ cancel() { cancellations++; return cancelGate.promise; } }), { headers: { "content-type": "application/json" } })); await tick(); expect(cancellations).toBe(1); counts(service, 1); cancelGate.resolve(); await client.observeSettlement().settled; await tick(); counts(service, 0);
        expect((await service.loadWorld(input, { explicitRevalidation: true })).repo.fullName).toBe(source); counts(service, 0);
      } finally { cancelGate.resolve(); fetchGate.resolve(Response.json({})); f.close(); }
    });

    test("CHILD two original slots remain held until same client is fully idle; another analysis cannot replace them", async () => {
      const f = await fixture(), c = collector(), both = deferred(), gates = [deferred<Response>(), deferred<Response>()], cancels = [deferred(), deferred()];
      try {
        let begins = 0; const client = new D1CaptureWorldStore(f.config, async (target, init) => { const op = JSON.parse(init?.body as string); const response = await f.network(target, init); if (op.op !== "captureBegin") return response; const i = begins++; await response.text(); if (begins === 2) both.resolve(); return gates[i]!.promise; }, { timeoutMs: 200 });
        const service = createWorldService({ store: client, collector: c.client, maxConcurrent: 2, now: () => now }), a = caught(service.loadWorld("synthetic/one")), b = caught(service.loadWorld("synthetic/two")); await both.promise; counts(service, 2); await Promise.all([a, b]); counts(service, 2); await expect(service.loadWorld("synthetic/three")).rejects.toMatchObject({ code: "WORLD_BUSY" }); expect(begins).toBe(2);
        for (const i of [1, 0]) { gates[i]!.resolve(new Response(new ReadableStream({ cancel: () => cancels[i]!.promise }), { headers: { "content-type": "application/json" } })); await tick(); cancels[i]!.resolve(); await tick(); if (i === 1) counts(service, 2); }
        await client.observeSettlement().settled; await tick(); counts(service, 0); expect(c.calls).toHaveLength(0);
      } finally { for (const gate of gates) gate.resolve(Response.json({})); for (const gate of cancels) gate.resolve(); f.close(); }
    });

    for (const readFirst of [true, false]) test(`CHILD commit read/cancel settlement ${readFirst ? "read-first" : "cancel-first"} retains counters; HOLD allows cached reads and blocks new generation`, async () => {
      const f = await fixture(), c = collector(), entered = deferred(), read = deferred<ReadableStreamReadResult<Uint8Array>>(), cancel = deferred();
      try {
        const client = new D1CaptureWorldStore(f.config, async (target, init) => { const op = JSON.parse(init?.body as string), response = await f.network(target, init); if (op.op !== "captureCommit") return response; await response.text(); const fake = new Response(null, { headers: { "content-type": "application/json" } }); Object.defineProperty(fake, "body", { value: { getReader: () => ({ read() { entered.resolve(); return read.promise; }, cancel: () => cancel.promise }) } }); return fake; }, { timeoutMs: 180 });
        const service = createWorldService({ store: client, collector: c.client, maxConcurrent: 1, now: () => now }), pending = service.loadWorld(input, { explicitRevalidation: true }); await entered.promise; await expect(pending).rejects.toMatchObject({ writeOutcome: "unknown" }); counts(service, 1);
        process.env.MOONSHOT_WORLD_WRITES_HOLD = "1"; const begins = f.calls.filter(x => x.op === "captureBegin").length; expect((await service.getCachedWorld(input))?.repo.fullName).toBe(source); expect((await service.storageStatus()).backend).toBe("d1"); expect((await service.listFeatured()).length).toBeGreaterThan(0); await expect(service.loadWorld("synthetic/new-held")).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" }); expect(f.calls.filter(x => x.op === "captureBegin")).toHaveLength(begins); counts(service, 1);
        if (readFirst) read.resolve({ done: true, value: undefined }); else cancel.resolve(); await tick(); counts(service, 1); if (readFirst) cancel.resolve(); else read.resolve({ done: true, value: undefined }); await client.observeSettlement().settled; await tick(); counts(service, 0);
      } finally { process.env.MOONSHOT_WORLD_WRITES_HOLD = "0"; read.resolve({ done: true, value: undefined }); cancel.resolve(); f.close(); }
    });

    test("CHILD logical success waits for valid pending cancel and returns after BOTH original counters are zero", async () => {
      const f = await fixture(), c = collector(), entered = deferred(), cancel = deferred();
      try {
        const client = new D1CaptureWorldStore(f.config, async (target, init) => { const response = await f.network(target, init), op = JSON.parse(init?.body as string); if (op.op !== "captureCommit") return response; const bytes = new TextEncoder().encode(await response.text()); let sent = false; const fake = new Response(null, { headers: { "content-type": "application/json" } }); Object.defineProperty(fake, "body", { value: { getReader: () => ({ read: async () => sent ? { done: true, value: undefined } : (sent = true, { done: false, value: bytes }), cancel() { entered.resolve(); return cancel.promise; } }) } }); return fake; });
        const service = createWorldService({ store: client, collector: c.client, now: () => now }); let published = false; const pending = service.loadWorld(input).then(w => { published = true; counts(service, 0); return w; }); await entered.promise; await tick(); expect(published).toBe(false); counts(service, 1); cancel.resolve(); expect((await pending).repo.fullName).toBe(source); expect(published).toBe(true); counts(service, 0);
      } finally { cancel.resolve(); f.close(); }
    });

    test("CHILD valid lost/typed transport ACK errors clean only after real local settlement; no stale fallback or double decrement", async () => {
      for (const typed of [false, true]) {
        const f = await fixture(), c = collector();
        try { f.transform((response, op) => { if (op.op === "captureCommit") throw typed ? Object.assign(new WorldStorageError(), { writeOutcome: "not-started" }) : Error("SYNTHETIC lost ACK"); return response; }); const service = createWorldService({ store: f.client, collector: c.client, now: () => now }); await expect(service.loadWorld(input)).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", writeOutcome: "unknown" }); counts(service, 0); expect(f.calls.filter(x => x.op === "captureCommit")).toHaveLength(1); }
        finally { f.close(); }
      }
    });

    test("CHILD original HOLD rejects entry/race before generation/admit/GitHub, admitted work settles during HOLD without reopening admission", async () => {
      const f = await fixture(), c = collector();
      try {
        let admitted = 0; const service = createWorldService({ store: f.client, collector: c.client, now: () => now }); process.env.MOONSHOT_WORLD_WRITES_HOLD = "1"; await expect(service.loadWorld(input, { admit() { admitted++; } })).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" }); counts(service, 0); expect(admitted).toBe(0); expect(c.calls).toHaveLength(0); expect(f.calls.filter(x => x.op === "captureBegin")).toHaveLength(0);
        process.env.MOONSHOT_WORLD_WRITES_HOLD = "0"; const original = f.client.observeSettlement; let reads = 0; Object.defineProperty(f.client, "observeSettlement", { configurable: true, get() { if (reads++ === 1) process.env.MOONSHOT_WORLD_WRITES_HOLD = "1"; return original; } });
        const race = createWorldService({ store: f.client, collector: c.client, now: () => now }); await expect(race.loadWorld(input, { admit() { admitted++; } })).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" }); counts(race, 0); expect(admitted).toBe(0); expect(f.calls.filter(x => x.op === "captureBegin")).toHaveLength(0);
        process.env.MOONSHOT_WORLD_WRITES_HOLD = "0"; Object.defineProperty(f.client, "observeSettlement", { value: original, configurable: true });
        const gate = { entered: deferred(), release: deferred() }, pendingCollector = collector(false, gate), settling = createWorldService({ store: f.client, collector: pendingCollector.client, now: () => now }); const work = settling.loadWorld(input); await gate.entered.promise; counts(settling, 1); process.env.MOONSHOT_WORLD_WRITES_HOLD = "1"; f.env.FACTORY_ADMISSION_FENCE = f.identity.epoch; gate.release.resolve(); expect((await work).repo.fullName).toBe(source); counts(settling, 0);
      } finally { process.env.MOONSHOT_WORLD_WRITES_HOLD = "0"; f.close(); }
    });

    test("CHILD actual grouped private denial and explicit reopen preserve lifetime/source and old alias denial", async () => {
      const f = await fixture();
      try { await seed(f); const c = collector(true), service = createWorldService({ store: f.client, collector: c.client, now: () => now }); await expect(service.loadWorld(input, { explicitRevalidation: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" }); counts(service, 0); expect(c.calls).toHaveLength(2); for (const key of [input, canonical, known]) expect(await f.client.get(key)).toBeNull(); const fresh = createWorldService({ store: f.client, collector: collector().client, now: () => now }); expect((await fresh.loadWorld(input, { explicitRevalidation: true })).repo.fullName).toBe(source); counts(fresh, 0); expect(await f.client.get(known)).toBeNull(); }
      finally { f.close(); }
    });

    test("CHILD unrelated ORIGINAL publicAnalysis count is not decremented by observed world cleanup; legacy SQLite/cache stay fast", async () => {
      const f = await fixture(), c = collector(), neighborGate = deferred(), neighbor = publicAnalysis(() => neighborGate.promise);
      try { const service = createWorldService({ store: f.client, collector: c.client, now: () => now }); expect((await service.loadWorld(input)).repo.fullName).toBe(source); expect(service.activeCollections()).toBe(0); expect(activePublicAnalyses()).toBe(1); neighborGate.resolve(); await neighbor; expect(activePublicAnalyses()).toBe(0);
        const legacy = new WorldStore(":memory:"); try { const old = createWorldService({ store: legacy, collector: collector().client, now: () => now }); expect((await old.loadWorld(input)).repo.fullName).toBe(source); counts(old, 0); process.env.MOONSHOT_WORLD_WRITES_HOLD = "1"; expect((await old.getCachedWorld(input))?.repo.fullName).toBe(source); counts(old, 0); } finally { legacy.close(); }
      } finally { process.env.MOONSHOT_WORLD_WRITES_HOLD = "0"; neighborGate.resolve(); await neighbor; f.close(); }
    });

    test("CHILD mutable factory options cannot retarget writes away from the EXACT observed original store", async () => {
      const f = await fixture(), other = await fixture(), c = collector();
      try {
        const options = { store: f.client, collector: c.client, now: () => now }, service = createWorldService(options); options.store = other.client;
        expect((await service.loadWorld(input)).repo.fullName).toBe(source); counts(service, 0); expect((await f.client.get(input))?.world.repo.fullName).toBe(source); expect(await other.client.get(input)).toBeNull(); expect(other.calls.filter(call => call.op === "captureBegin")).toHaveLength(0);
      } finally { f.close(); other.close(); }
    });

    for (const mode of ["call-shadow", "idle-getter", "signal-then-shadow"] as const) test(`CHILD ${mode} cannot replace actual same-store observation or throw outside the retained-authority guard`, async () => {
      const f = await fixture(), c = collector(), entered = deferred(), gate = deferred<Response>();
      try {
        const client = new D1CaptureWorldStore(f.config, async (target, init) => { const response = await f.network(target, init), op = JSON.parse(init?.body as string); if (op.op !== "captureBegin") return response; await response.text(); entered.resolve(); return gate.promise; }, { timeoutMs: 150 });
        const real = client.observeSettlement; let idleReads = 0;
        if (mode === "call-shadow") Object.assign(real, { call: () => ({ idle: true, settled: Promise.resolve() }) });
        else if (mode === "signal-then-shadow") Object.defineProperty(client, "observeSettlement", { configurable: true, value: () => { const observation = real(); Object.defineProperty(observation.settled, "then", { value: () => Promise.resolve(true) }); return observation; } });
        else Object.defineProperty(client, "observeSettlement", { configurable: true, value: () => { const observation = real(); let reads = 0; return { get idle() { idleReads++; if (++reads > 1) throw Error("SYNTHETIC repeated getter access"); return observation.idle; }, settled: observation.settled }; } });
        const service = createWorldService({ store: client, collector: c.client, now: () => now }), pending = service.loadWorld(input); await entered.promise; await expect(pending).rejects.toMatchObject({ writeOutcome: "unknown" }); counts(service, 1); if (mode === "idle-getter") expect(idleReads).toBe(1);
        gate.resolve(Response.json({})); await real().settled; await tick(); counts(service, 0);
      } finally { gate.resolve(Response.json({})); f.close(); }
    });

    test("CHILD actual private proof signing stays inside BOTH original authorities after timeout and cannot send late revoke", async () => {
      const f = await fixture(), gate = deferred(), entered = deferred(), original = crypto.subtle.sign;
      const client = new D1CaptureWorldStore(f.config, f.network, { timeoutMs: 150 });
      try {
        const github = new GitHubClient("", async target => { const url = new URL(String(target)); if (url.origin !== "https://api.github.com") throw Error("SYNTHETIC unexpected host"); if (url.pathname === `/repos/${input}`) return new Response(null, { status: 301, headers: { location: `https://api.github.com/repos/${source}` } }); crypto.subtle.sign = (...args) => { entered.resolve(); return gate.promise.then(() => original.apply(crypto.subtle, args)); }; return Response.json({ private: true, visibility: "private", full_name: source, id: 123 }); });
        const service = createWorldService({ store: client, collector: github, now: () => now }), pending = service.loadWorld(input, { explicitRevalidation: true }); await entered.promise; counts(service, 1); await expect(pending).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", writeOutcome: "not-started" }); counts(service, 1); expect(f.calls.filter(c => c.op === "captureRevoke")).toHaveLength(0);
        crypto.subtle.sign = original; gate.resolve(); await client.observeSettlement().settled; await tick(); counts(service, 0); expect(f.calls.filter(c => c.op === "captureRevoke")).toHaveLength(0);
      } finally { crypto.subtle.sign = original; gate.resolve(); await client.observeSettlement().settled; f.close(); }
    });
  }
}
