import { expect, test, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mode = process.env.WORLD_ASSEMBLY_CHILD;
if (!mode) {
  for (const name of ["normal", "singleton-enabled", "singleton-held", "singleton-failure", "singleton-import-failure", "singleton-disabled", "client-timeout"]) test(`SYNTHETIC original resource assembly ${name} in empty-cwd minimal-env child`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-assembly-child-")), cwd = join(directory, "empty"); mkdirSync(cwd);
    try {
      const child = Bun.spawn([process.execPath, "--no-env-file", "test", new URL(import.meta.url).pathname], { cwd, env: { WORLD_ASSEMBLY_CHILD: name, NODE_ENV: "test", TZ: "UTC", MOONSHOT_WORLD_WRITES_HOLD: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      process.stdout.write(`SYNTHETIC world assembly ${name} child (separate denominator):\n${out}${err}`); expect(exit).toBe(0); expect(readdirSync(cwd)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 25000);
} else {
  if (readdirSync(process.cwd()).length || Object.keys(process.env).sort().join() !== "MOONSHOT_WORLD_WRITES_HOLD,NODE_ENV,TZ,WORLD_ASSEMBLY_CHILD") throw Error("Empty cwd/minimal synthetic env required");
  globalThis.fetch = (async () => { throw Error("SYNTHETIC actual outbound forbidden"); }) as unknown as typeof fetch;
  const [{ getConfig, worldCaptureConfig }, { createWorldResources, initializeWorldResources, createWorldResourceInitializer, getWorldResources }, serviceModule, { D1CaptureWorldStore }, { WorldStore }, { D1WorldStore }, { PublicGitHubQuota }, { Database }, { activePublicAnalyses }, { assemblyEnv, assemblyFixture, deferred }, { captureWorld }] = await Promise.all([
    import("../src/server/config"), import("../src/server/world-resources"), import("../src/server/service"), import("../src/server/d1-capture-world-store"), import("../src/server/store"), import("../src/server/d1-store"), import("../src/server/public-quota"), import("bun:sqlite"), import("../src/server/runtime-activity"), import("./fixtures/world-assembly"), import("./fixtures/capture-client"),
  ]);
  const { createWorldService } = serviceModule, now = Date.parse("2026-11-05T00:00:00Z"), tick = () => Bun.sleep(5);
  const caught = async (p: unknown) => { try { await p; return null; } catch (error) { return error; } };
  const importRaw = (raw: Uint8Array) => crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

  if (mode.startsWith("singleton-")) {
    test(`CHILD ${mode} actual getWorldResources/service exports share one latched graph and retain Promise contracts`, async () => {
      const f = await assemblyFixture(), originalFetch = globalThis.fetch, release = deferred(), entered = deferred();
      const importOriginal = crypto.subtle.importKey.bind(crypto.subtle); let imports = 0;
      const spy = spyOn(crypto.subtle, "importKey").mockImplementation(((...args: Parameters<typeof crypto.subtle.importKey>) => {
        imports++; entered.resolve(); return release.promise.then(() => importOriginal(...args));
      }) as typeof crypto.subtle.importKey);
      try {
        if (mode !== "singleton-disabled") Object.assign(process.env, assemblyEnv(), { MOONSHOT_DATA_DIR: join(f.directory, "enabled") });
        else { process.env.MOONSHOT_DATA_DIR = join(f.directory, "disabled"); process.env.MOONSHOT_WORLD_CAPTURE_KEY_HEX = "ignored-disabled-key"; }
        if (mode === "singleton-failure") process.env.MOONSHOT_WORLD_CAPTURE_SCHEMA_VERSION = "3";
        globalThis.fetch = f.network as typeof fetch;
        const a = getWorldResources(), b = getWorldResources(), cached = serviceModule.getCachedWorld("synthetic/miss"), featured = serviceModule.listFeatured();
        if (mode === "singleton-enabled" || mode === "singleton-held") {
          process.env.MOONSHOT_D1_STORAGE_URL += "/history"; process.env.MOONSHOT_WORLD_CAPTURE_KEY_HEX = "ff".repeat(32); process.env.MOONSHOT_WORLD_CAPTURE_EPOCH = "f".repeat(32);
        }
        expect(a).toBe(b); for (const p of [a, cached, featured]) expect(p).toBeInstanceOf(Promise);
        if (mode === "singleton-import-failure") {
          await entered.promise; const failures = Promise.all([caught(a), caught(cached), caught(featured)]); release.reject(Error("SYNTHETIC secret error must remain private"));
          for (const error of await failures) { expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe("World capture initialization unavailable"); }
          expect(getWorldResources()).toBe(a); expect(await caught(serviceModule.getWorldStorageState())).toBeInstanceOf(Error); expect(imports).toBe(1); expect(f.calls).toHaveLength(0); expect(f.githubCalls).toHaveLength(0);
        } else if (mode === "singleton-failure") {
          expect(await caught(a)).toBeInstanceOf(Error); expect(await caught(cached)).toBeInstanceOf(Error); expect(await caught(featured)).toBeInstanceOf(Error);
          process.env.MOONSHOT_WORLD_CAPTURE_SCHEMA_VERSION = "4";
          expect(getWorldResources()).toBe(a); expect(await caught(serviceModule.getWorldStorageState())).toBeInstanceOf(Error); expect(imports).toBe(0); expect(f.calls).toHaveLength(0); expect(f.githubCalls).toHaveLength(0);
        } else {
          if (mode !== "singleton-disabled") {
            await entered.promise; expect(imports).toBe(1); expect(f.calls).toHaveLength(0);
            if (mode === "singleton-held") process.env.MOONSHOT_WORLD_WRITES_HOLD = "1";
          }
          release.resolve(); const resources = await a;
          expect(await cached).toBeNull(); expect((await featured).length).toBeGreaterThan(0);
          expect(await b).toBe(resources); expect(await getWorldResources()).toBe(resources);
          expect((await serviceModule.getWorldStorageState()).activeCollections).toBe(0); expect(activePublicAnalyses()).toBe(0); expect(f.githubCalls).toHaveLength(0);
          if (mode === "singleton-disabled") { expect(imports).toBe(0); expect(resources.store).toBeInstanceOf(WorldStore); (resources.store as InstanceType<typeof WorldStore>).close(); }
          else {
            expect(resources.store).toBeInstanceOf(D1CaptureWorldStore); expect(imports).toBe(1);
            if (mode === "singleton-held") {
              let admits = 0; await expect(serviceModule.loadWorld(f.input, { admit() { admits++; } })).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" });
              expect(admits).toBe(0); expect(f.calls.filter(c => c.op === "captureBegin")).toHaveLength(0); expect(f.githubCalls).toHaveLength(0);
            } else {
              const collected = await serviceModule.loadWorld(f.input, { explicitRevalidation: true });
              expect(collected.repo.fullName).toBe(f.source); expect(collected.repo.license).toBe("NOASSERTION"); expect(collected.headSha).toBe(f.head);
              const before = f.githubCalls.length;
              expect((await serviceModule.getCachedWorld(`https://github.com/${f.source}`))?.repo.fullName).toBe(f.source);
              expect((await serviceModule.loadWorld(f.input)).headSha).toBe(f.head); expect(f.githubCalls).toHaveLength(before);
              const path = join(f.directory, "enabled/public-quota.sqlite"), db = new Database(path, { readonly: true });
              try { expect((db.query("SELECT sum(used) AS n FROM github_quota").get() as { n: number }).n).toBe(before); } finally { db.close(); }
              expect((await serviceModule.getWorldStorageState()).activeCollections).toBe(0); expect(activePublicAnalyses()).toBe(0); expect(imports).toBe(1);
            }
          }
        }
      } finally { release.resolve(); spy.mockRestore(); globalThis.fetch = originalFetch; f.close(); }
    });
  } else if (mode === "client-timeout") {
    test("CHILD new-profile selected client timeout retains original global/slot until actual late transport and cancel settle", async () => {
      const f = await assemblyFixture(), entered = deferred(), late = deferred<Response>(), cancel = deferred(); let cancellations = 0;
      try {
        const network: typeof f.network = async (target, init) => {
          const response = await f.network(target, init), operation = JSON.parse(String(init?.body));
          if (operation.op !== "captureBegin") return response;
          await response.text(); entered.resolve(); return late.promise;
        };
        const graph = await initializeWorldResources(getConfig(assemblyEnv()), { network }), service = createWorldService({ store: graph.store, collector: graph.collector, maxConcurrent: 1, now: () => now });
        const pending = service.loadWorld(f.input, { explicitRevalidation: true }); await entered.promise;
        expect(service.activeCollections()).toBe(1); expect(activePublicAnalyses()).toBe(1);
        await expect(pending).rejects.toMatchObject({ writeOutcome: "unknown" });
        expect(service.activeCollections()).toBe(1); expect(activePublicAnalyses()).toBe(1);
        await expect(service.loadWorld("synthetic/other")).rejects.toMatchObject({ code: "WORLD_BUSY" }); expect(f.githubCalls).toHaveLength(0);
        late.resolve(new Response(new ReadableStream({ cancel() { cancellations++; return cancel.promise; } }), { headers: { "content-type": "application/json" } })); await tick();
        expect(cancellations).toBe(1); expect(service.activeCollections()).toBe(1); expect(activePublicAnalyses()).toBe(1);
        cancel.resolve(); await graph.store.observeSettlement!().settled; await tick(); expect(service.activeCollections()).toBe(0); expect(activePublicAnalyses()).toBe(0);
        expect(f.calls.filter(c => c.op === "captureBegin")).toHaveLength(1); expect(f.githubCalls).toHaveLength(0);
      } finally { cancel.resolve(); late.resolve(Response.json({})); f.close(); }
    }, 20000);
  } else {
    test("CHILD pure opt-in disabled profiles are inert and legacy factories remain lazy", async () => {
      for (const enabled of [undefined, "", "false"]) {
        const env = { ...assemblyEnv(), MOONSHOT_WORLD_CAPTURE_ENABLED: enabled, MOONSHOT_WORLD_CAPTURE_KEY_HEX: "ignored", MOONSHOT_WORLD_CAPTURE_EPOCH: "ignored" };
        expect(worldCaptureConfig(env as Record<string, string>)).toBeNull(); const config = getConfig(env as Record<string, string>); expect(config.worldCapture).toBeNull();
        let stores = 0, quotas = 0, imports = 0, networks = 0;
        const options = { makeStore() { stores++; return { get: () => null, put() {} }; }, makeQuota() { quotas++; return { take() {} }; }, importKey: async () => { imports++; throw Error("disabled"); }, network: async () => { networks++; return Response.json({}); } };
        const legacy = createWorldResources(config, options), initialize = createWorldResourceInitializer(config, options), one = initialize();
        expect(initialize()).toBe(one); const graph = await one; expect(stores + quotas + imports + networks).toBe(0);
        expect(await graph.store.get("synthetic/miss")).toBeNull(); expect(graph.store).toBe(graph.store); expect(stores).toBe(1);
        expect(await legacy.store.get("synthetic/miss")).toBeNull(); expect(stores).toBe(2); expect(quotas + imports + networks).toBe(0);
      }
    });

    test("CHILD pure config accepts only exact enable, schema, identity, URL and dedicated key fields, without side effects", () => {
      const valid = assemblyEnv(), parsed = worldCaptureConfig(valid)!; expect(parsed.schemaVersion).toBe(4); expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.identity)).toBe(true);
      for (const enabled of ["TRUE", "1", " true", "false ", "0"]) expect(() => worldCaptureConfig({ ...valid, MOONSHOT_WORLD_CAPTURE_ENABLED: enabled })).toThrow("Invalid world capture configuration");
      for (const field of Object.keys(valid).filter(k => k !== "MOONSHOT_WORLD_CAPTURE_ENABLED")) {
        const missing: Record<string, string> = { ...valid }; delete missing[field]; expect(() => getConfig(missing)).toThrow("Invalid world capture configuration");
        expect(() => getConfig({ ...valid, [field]: "" })).toThrow("Invalid world capture configuration");
      }
      for (const patch of [
        { MOONSHOT_WORLD_CAPTURE_SCHEMA_VERSION: "3" }, { MOONSHOT_WORLD_CAPTURE_SCHEMA_VERSION: "04" }, { MOONSHOT_WORLD_STORE: "sqlite" },
        { MOONSHOT_WORLD_CAPTURE_KEY_HEX: "AA".repeat(32) }, { MOONSHOT_WORLD_CAPTURE_KEY_HEX: "29".repeat(31) },
        { MOONSHOT_WORLD_CAPTURE_BINDING_NONCE: "Z".repeat(32) }, { MOONSHOT_WORLD_CAPTURE_EPOCH: "F".repeat(32) },
        { MOONSHOT_D1_DATABASE_ID: "unknown" }, { MOONSHOT_D1_STORAGE_URL: valid.MOONSHOT_D1_STORAGE_URL + "/history" },
        { MOONSHOT_D1_STORAGE_URL: valid.MOONSHOT_D1_STORAGE_URL + "?override=1" }, { MOONSHOT_D1_STORAGE_URL: valid.MOONSHOT_D1_STORAGE_URL + "/" },
        { MOONSHOT_D1_STORAGE_SECRET: "short" }, { MOONSHOT_D1_STORAGE_SECRET: "文".repeat(16) }, { MOONSHOT_D1_STORAGE_SECRET: "x".repeat(257) },
      ]) expect(() => getConfig({ ...valid, ...patch })).toThrow("Invalid world capture configuration");
      expect(readdirSync(process.cwd())).toEqual([]);
    });

    test("CHILD synchronous factory explicitly rejects enabled profile before store/network/quota", () => {
      let calls = 0; const hit = () => { calls++; throw Error("must stay inert"); };
      expect(() => createWorldResources(getConfig(assemblyEnv()), { makeStore: hit, makeQuota: hit, network: hit })).toThrow("asynchronous initialization"); expect(calls).toBe(0);
    });

    test("CHILD mixed/forged enabled configs, store override and invalid bootstrap limits latch rejection with zero side effects", async () => {
      const config = getConfig(assemblyEnv()); let calls = 0; const hit = () => { calls++; throw Error("must stay inert"); };
      for (const patch of [{ worldStore: "sqlite" }, { d1StorageUrl: config.d1StorageUrl + "/history" }, { d1DatabaseId: "55555555-5555-4555-8555-555555555555" }, { d1StorageSecret: "SYNTHETIC-wrong-storage-secret-at-least-32" }, { worldCapture: { ...config.worldCapture!, keyHex: "not-hex" } }]) {
        const initialize = createWorldResourceInitializer({ ...config, ...patch } as typeof config, { importKey: hit, makeQuota: hit, network: hit }), pending = initialize(); expect(initialize()).toBe(pending); expect(await caught(pending)).toBeInstanceOf(Error);
      }
      for (const options of [{ makeStore: hit }, { timeoutMs: 10001 }, { timeoutMs: 0 }, { timeoutMs: NaN }]) expect(await caught(initializeWorldResources(config, { ...options, importKey: hit, makeQuota: hit, network: hit }))).toBeInstanceOf(Error);
      expect(calls).toBe(0); expect(readdirSync(process.cwd())).toEqual([]);
    });

    test("CHILD one concurrent initialization imports one nonextractable sign+verify key and creates one lazy original graph", async () => {
      const f = await assemblyFixture(), gate = deferred(), entered = deferred(); let imports = 0, quotas = 0, takes = 0;
      try {
        const initialize = createWorldResourceInitializer(getConfig(assemblyEnv()), { network: f.network, makeQuota() { quotas++; return { take() { takes++; } }; }, async importKey(raw) { imports++; entered.resolve(); expect(raw).toEqual(new Uint8Array(32).fill(41)); await gate.promise; const key = await importRaw(raw); expect(key.extractable).toBe(false); expect(key.usages).toEqual(["sign", "verify"]); return key; } });
        const requests = Array.from({ length: 20 }, () => initialize()); for (const p of requests) expect(p).toBe(requests[0]); await entered.promise;
        expect(imports).toBe(1); expect(quotas + takes).toBe(0); expect(f.calls).toHaveLength(0); gate.resolve(); const graphs = await Promise.all(requests), graph = graphs[0]!;
        for (const g of graphs) { expect(g).toBe(graph); expect(g.quota).toBe(graph.quota); expect(g.store).toBe(graph.store); }
        expect(graph.store).toBeInstanceOf(D1CaptureWorldStore); expect(f.calls).toHaveLength(0); expect(quotas + takes).toBe(0);
        const service = createWorldService({ store: graph.store, collector: graph.collector, now: () => now }); expect(await service.getCachedWorld("synthetic/miss")).toBeNull();
        expect(f.calls.map(c => c.op)).toEqual(["getMany"]); expect(quotas + takes).toBe(0); expect(f.githubCalls).toHaveLength(0);
        graph.quota.take(); graph.quota.take(); expect(quotas).toBe(1); expect(takes).toBe(2);
      } finally { gate.resolve(); f.close(); }
    });

    test("CHILD mutable caller config/options cannot retarget key, transport, data directory, quota or store during import", async () => {
      const f = await assemblyFixture(), release = deferred(), entered = deferred(); let quotas = 0, wrong = 0;
      try {
        const parsed = getConfig({ ...assemblyEnv(), MOONSHOT_DATA_DIR: join(f.directory, "original") });
        const config = { ...parsed, worldCapture: { ...parsed.worldCapture!, identity: { ...parsed.worldCapture!.identity } } }, options = { network: f.network, makeQuota() { quotas++; return { take() {} }; }, async importKey(raw: Uint8Array) { entered.resolve(); await release.promise; return importRaw(raw); } };
        const initialize = createWorldResourceInitializer(config, options), pending = initialize(); await entered.promise;
        Object.assign(config.worldCapture.identity, { epoch: "f".repeat(32), bindingNonce: "e".repeat(32) }); Object.assign(config.worldCapture, { keyHex: "ff".repeat(32), secret: "wrong", endpoint: "https://wrong.invalid" });
        Object.assign(config, { worldStore: "sqlite", worldCapture: null, dataDir: join(f.directory, "wrong"), d1StorageUrl: "https://wrong.invalid", d1StorageSecret: "wrong" });
        Object.assign(options, { network: async () => { wrong++; throw Error("wrong"); }, makeQuota() { wrong++; throw Error("wrong"); }, makeStore() { wrong++; throw Error("wrong"); }, importKey() { wrong++; throw Error("wrong"); } });
        release.resolve(); const graph = await pending; expect(graph.store).toBeInstanceOf(D1CaptureWorldStore); expect(await graph.store.get("synthetic/miss")).toBeNull();
        graph.quota.take(); expect(quotas).toBe(1); expect(wrong).toBe(0); expect(f.calls).toHaveLength(1); expect(existsSync(join(f.directory, "wrong"))).toBe(false);
      } finally { release.resolve(); f.close(); }
    });

    for (const kind of ["reject", "invalid-key", "hung", "late", "final-deadline", "publication-deadline", "backward-clock"]) test(`CHILD ${kind} import/bootstrap failure latches with no late graph/network/quota/write`, async () => {
      const f = await assemblyFixture(), gate = deferred<CryptoKey>(), entered = deferred(); let imports = 0, effects = 0, clock = 0, samples = 0;
      try {
        const initialize = createWorldResourceInitializer(getConfig(assemblyEnv()), { network: async () => { effects++; throw Error("forbidden"); }, makeQuota() { effects++; throw Error("forbidden"); }, timeoutMs: 20,
          clock: () => kind === "publication-deadline" && samples++ >= 4 ? 21 : clock, async importKey() { imports++; entered.resolve(); if (kind === "reject") throw Error(assemblyEnv().MOONSHOT_WORLD_CAPTURE_KEY_HEX); if (kind === "invalid-key") return await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, true, ["sign"]); if (kind === "final-deadline") { clock = 21; return f.key; } if (kind === "publication-deadline") return f.key; if (kind === "backward-clock") { clock = -1; return f.key; } return gate.promise; } });
        const pending = initialize(); await entered.promise; const error = await caught(pending); expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe("World capture initialization unavailable"); expect(imports).toBe(1); expect(effects).toBe(0);
        expect(initialize()).toBe(pending); expect(await caught(initialize())).toBe(error); if (kind !== "hung") gate.resolve(f.key); await tick(); expect(imports).toBe(1); expect(effects).toBe(0); expect(f.calls).toHaveLength(0); expect(f.githubCalls).toHaveLength(0); expect(readdirSync(process.cwd())).toEqual([]);
      } finally { gate.resolve(f.key); f.close(); }
    });

    test("CHILD actual config/resources/service/accepted client/RPC/core/SQLite public301/private deny/reopen preserves source and original quota exactly", async () => {
      const f = await assemblyFixture(), quotaPath = join(f.directory, "public-quota.sqlite"); let quota: InstanceType<typeof PublicGitHubQuota> | undefined, quotaCreates = 0;
      try {
        const graph = await initializeWorldResources(getConfig({ ...assemblyEnv(), MOONSHOT_DATA_DIR: f.directory }), { network: f.network, makeQuota() { quotaCreates++; return quota = new PublicGitHubQuota(quotaPath, 1000, () => now); } });
        let current = Date.now(); const service = createWorldService({ store: graph.store, collector: graph.collector, now: () => current });
        expect(existsSync(quotaPath)).toBe(false); expect(await service.getCachedWorld(f.input)).toBeNull(); expect(existsSync(quotaPath)).toBe(false);
        const w = await service.loadWorld(f.input, { explicitRevalidation: true }); expect(w.repo.fullName).toBe(f.source); expect(w.repo.license).toBe("NOASSERTION"); expect(w.repo.description).toBe("SYNTHETIC 原始 source spelling"); expect(w.headSha).toBe(f.head);
        const used = () => { const read = new Database(quotaPath, { readonly: true }); try { return (read.query("SELECT sum(used) AS n FROM github_quota").get() as { n: number }).n; } finally { read.close(); } };
        expect(quotaCreates).toBe(1); expect(used()).toBe(f.githubCalls.length); expect(f.githubCalls.length).toBeGreaterThan(2);
        const before = f.githubCalls.length; expect((await service.getCachedWorld(f.input))?.headSha).toBe(f.head); expect((await service.loadWorld(f.input)).repo.fullName).toBe(f.source); expect(used()).toBe(before);
        f.privacy(true); current += 30000; await expect(service.loadWorld(f.input, { refresh: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" });
        expect(f.githubCalls.length - before).toBe(2); expect(used()).toBe(f.githubCalls.length); const revoke = f.calls.find(c => c.op === "captureRevoke")!; expect(revoke.body.claim).toStartWith("wcp1.");
        expect(await service.getCachedWorld(f.input)).toBeNull(); expect(await service.getCachedWorld(f.source)).toBeNull(); expect((await graph.store.status!()).worlds).toBe(0);
        f.privacy(false); current += 30000; const reopened = await service.loadWorld(f.input, { explicitRevalidation: true }); expect(reopened.repo.fullName).toBe(f.source); expect(reopened.repo.license).toBe("NOASSERTION"); expect(used()).toBe(f.githubCalls.length);
        expect(quotaCreates).toBe(1); expect(service.activeCollections()).toBe(0); expect(activePublicAnalyses()).toBe(0);
      } finally { quota?.close(); f.close(); }
    });

    test("CHILD HOLD during initialization and after selection blocks begin/admission/collector but permits cache-only evidence", async () => {
      const f = await assemblyFixture(), entered = deferred(), release = deferred(); let admits = 0;
      try {
        await f.client.put(captureWorld(), 90000, now - 240000);
        const pending = initializeWorldResources(getConfig(assemblyEnv()), { network: f.network, async importKey(raw) { entered.resolve(); await release.promise; return importRaw(raw); } }); await entered.promise; process.env.MOONSHOT_WORLD_WRITES_HOLD = "1";
        release.resolve(); const graph = await pending, service = createWorldService({ store: graph.store, collector: graph.collector, now: () => now });
        expect((await service.getCachedWorld(f.source))?.repo.fullName).toBe(f.source);
        await expect(service.loadWorld(f.input, { admit() { admits++; } })).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" });
        expect(admits).toBe(0); expect(f.calls.filter(c => c.op === "captureBegin")).toHaveLength(0); expect(f.githubCalls).toHaveLength(0); expect(activePublicAnalyses()).toBe(0); expect(service.activeCollections()).toBe(0);
        process.env.MOONSHOT_WORLD_WRITES_HOLD = "0";
        const observation = graph.store.observeSettlement; let reads = 0;
        Object.defineProperty(graph.store, "observeSettlement", { configurable: true, get() { if (reads++ === 1) process.env.MOONSHOT_WORLD_WRITES_HOLD = "1"; return observation; } });
        const raced = createWorldService({ store: graph.store, collector: graph.collector, now: () => now });
        await expect(raced.loadWorld(f.input, { admit() { admits++; } })).rejects.toMatchObject({ code: "STORAGE_MIGRATION_HOLD" });
        expect(admits).toBe(0); expect(f.calls.filter(c => c.op === "captureBegin")).toHaveLength(0); expect(f.githubCalls).toHaveLength(0); expect(activePublicAnalyses()).toBe(0); expect(raced.activeCollections()).toBe(0);
      } finally { release.resolve(); process.env.MOONSHOT_WORLD_WRITES_HOLD = "0"; f.close(); }
    });

    test("CHILD disabled original D1 selection stays distinct from the opt-in capture client and remains network-lazy", async () => {
      let calls = 0;
      const graph = await initializeWorldResources(getConfig({ ...assemblyEnv(), MOONSHOT_WORLD_CAPTURE_ENABLED: "false" }), { network: async () => { calls++; throw Error("forbidden"); }, importKey: async () => { calls++; throw Error("forbidden"); } });
      expect(graph.store).toBeInstanceOf(D1WorldStore); expect(calls).toBe(0); expect(readdirSync(process.cwd())).toEqual([]);
    });

    test("CHILD monotonic bootstrap control publishes one graph with the original five clock observations", async () => {
      const samples = [100, 110, 120, 130, 140]; let reads = 0, imports = 0, effects = 0;
      const initialize = createWorldResourceInitializer(getConfig(assemblyEnv()), {
        clock: () => samples[reads++]!, importKey: async raw => { imports++; return importRaw(raw); },
        network: async () => { effects++; throw Error("SYNTHETIC forbidden"); }, makeQuota: () => { effects++; throw Error("SYNTHETIC forbidden"); },
      });
      const pending = initialize(), graph = await pending; expect(graph.store).toBeInstanceOf(D1CaptureWorldStore); expect(initialize()).toBe(pending);
      expect(reads).toBe(5); expect(imports).toBe(1); expect(effects).toBe(0); expect(readdirSync(process.cwd())).toEqual([]);
    });

    for (const phase of [1, 2, 3, 4]) test(`CHILD backward clock at bootstrap observation ${phase} rejects every regression including steps above the origin`, async () => {
      const samples = [100, 110, 120, 130, 140]; samples[phase] = samples[phase - 1]! - 1;
      let reads = 0, imports = 0, effects = 0;
      const initialize = createWorldResourceInitializer(getConfig(assemblyEnv()), {
        clock: () => samples[Math.min(reads++, samples.length - 1)]!, importKey: async raw => { imports++; return importRaw(raw); },
        network: async () => { effects++; throw Error("SYNTHETIC forbidden"); }, makeQuota: () => { effects++; throw Error("SYNTHETIC forbidden"); },
      });
      const pending = initialize(), error = await caught(pending); expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe("World capture initialization unavailable");
      expect(initialize()).toBe(pending); expect(await caught(initialize())).toBe(error); expect(reads).toBe(phase + 1); expect(imports).toBe(phase < 3 ? 0 : 1);
      await tick(); expect(effects).toBe(0); expect(readdirSync(process.cwd())).toEqual([]);
    });

    for (const phase of [0, 1, 2, 3, 4]) test(`CHILD thrown clock at bootstrap observation ${phase} stays redacted and latched without delayed graph or IO`, async () => {
      let reads = 0, imports = 0, effects = 0;
      const initialize = createWorldResourceInitializer(getConfig(assemblyEnv()), {
        clock: () => { if (reads++ === phase) throw Error("SYNTHETIC sensitive clock-provider detail"); return 100; },
        importKey: async raw => { imports++; return importRaw(raw); }, network: async () => { effects++; throw Error("SYNTHETIC forbidden"); }, makeQuota: () => { effects++; throw Error("SYNTHETIC forbidden"); },
      });
      const pending = initialize(), error = await caught(pending); expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe("World capture initialization unavailable");
      expect(initialize()).toBe(pending); expect(await caught(initialize())).toBe(error); expect(reads).toBe(phase + 1); expect(imports).toBe(phase < 3 ? 0 : 1);
      await tick(); expect(effects).toBe(0); expect(readdirSync(process.cwd())).toEqual([]);
    });

    for (const value of [NaN, Infinity, -Infinity]) for (const phase of [0, 1, 2, 3, 4]) test(`CHILD nonfinite clock ${value} at bootstrap observation ${phase} fails closed before publication`, async () => {
      let reads = 0, imports = 0, effects = 0;
      const initialize = createWorldResourceInitializer(getConfig(assemblyEnv()), {
        clock: () => reads++ === phase ? value : 100, importKey: async raw => { imports++; return importRaw(raw); },
        network: async () => { effects++; throw Error("SYNTHETIC forbidden"); }, makeQuota: () => { effects++; throw Error("SYNTHETIC forbidden"); },
      });
      const pending = initialize(), error = await caught(pending); expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe("World capture initialization unavailable");
      expect(initialize()).toBe(pending); expect(await caught(initialize())).toBe(error); expect(reads).toBe(phase + 1); expect(imports).toBe(phase < 3 ? 0 : 1);
      await tick(); expect(effects).toBe(0); expect(readdirSync(process.cwd())).toEqual([]);
    });

    test("CHILD disabled profile never observes bootstrap clock or imports a key", async () => {
      let effects = 0;
      const graph = await initializeWorldResources(getConfig({}), {
        clock() { effects++; throw Error("SYNTHETIC disabled clock"); }, importKey: async () => { effects++; throw Error("SYNTHETIC disabled key"); },
        makeQuota() { effects++; throw Error("SYNTHETIC forbidden"); }, network: async () => { effects++; throw Error("SYNTHETIC forbidden"); },
      });
      expect(graph).toBeDefined(); expect(effects).toBe(0); expect(readdirSync(process.cwd())).toEqual([]);
    });
  }
}
