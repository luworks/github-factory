import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.WORLD_REVOCATION_SYNTHETIC_CHILD !== "1") {
  test("SYNTHETIC real SQLite/service revocation runs in an empty-cwd minimal-env child", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-world-revocation-child-")), cwd = join(directory, "empty"); mkdirSync(cwd);
    try {
      const child = Bun.spawn([process.execPath, "--no-env-file", "test", new URL(import.meta.url).pathname], { cwd,
        env: { WORLD_REVOCATION_SYNTHETIC_CHILD: "1", MOONSHOT_WORLD_WRITES_HOLD: "0", NODE_ENV: "test", TZ: "UTC" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      process.stdout.write("SYNTHETIC revocation child (separate denominator):\n" + stdout + stderr);
      expect(exit).toBe(0); expect(readdirSync(cwd)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
} else {
  if (readdirSync(process.cwd()).length || Object.keys(process.env).sort().join() !== "MOONSHOT_WORLD_WRITES_HOLD,NODE_ENV,TZ,WORLD_REVOCATION_SYNTHETIC_CHILD") throw Error("Revocation tests require isolated empty cwd/minimal env");
  globalThis.fetch = (async () => { throw Error("SYNTHETIC outbound blocked"); }) as unknown as typeof fetch;
  const [{ Database }, { WorldStore }, { createWorldService }, { GitHubError }, { syntheticWorld }, { HistoryService }, { HistoryCursorCodec }] = await Promise.all([
    import("bun:sqlite"), import("../src/server/store"), import("../src/server/service"), import("../src/server/github"), import("./fixtures/browser-world"), import("../src/server/history-service"), import("../src/server/history-cursor"),
  ]);
  const now = Date.parse("2026-11-05T00:00:00Z"), repo = "openclaw/openclaw", alias = "synthetic/previous-name";
  function world(key = repo, head = "a".repeat(40)) {
    const source = syntheticWorld(), w: ReturnType<typeof syntheticWorld> = JSON.parse(JSON.stringify(source).replaceAll(source.repo.url, `https://github.com/${key}`).replaceAll(source.headSha, head));
    const [owner, name] = key.split("/"); w.repo = { ...w.repo, owner: owner!, name: name!, fullName: key, url: `https://github.com/${key}`, description: "SYNTHETIC 原始来源" }; w.source = "github"; return w;
  }
  const collection = (w = world()): import("../src/server/github").RepoCollection => ({ repo: w.repo, headSha: w.headSha, collectedAt: w.collectedAt, tree: [{ path: "src/原始.ts", type: "blob", sha: "b".repeat(40) }], treeState: "full", files: [], issues: w.issues, pulls: w.pulls, workflows: w.workflows, commits: w.commits, languages: w.languages, notes: ["SYNTHETIC only"], partial: false, rateLimitRemaining: null });
  function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(r => { resolve = r; }), resolve: (value: T) => resolve(value) }; }
  function fixture(seed = true) {
    const directory = mkdtempSync(join(tmpdir(), "factory-world-revocation-")), path = join(directory, "worlds.sqlite"); let store = new WorldStore(path);
    const raw = new Database(path), w = world(); if (seed) { store.put(w, 90_000, now); store.alias(alias, repo); }
    const dump = () => JSON.stringify(["worlds", "world_aliases", "world_public_state", "world_public_barriers"].map(table => raw.query(`SELECT * FROM ${table} ORDER BY rowid`).all()));
    return { directory, path, raw, w, dump, get store() { return store; }, reopen() { store.close(); store = new WorldStore(path); }, close() { store.close(); raw.close(); rmSync(directory, { recursive: true, force: true }); } };
  }
  const begin = (store: InstanceType<typeof WorldStore>, key = repo, explicitRevalidation = false) => store.publicCaptures.begin(key, { explicitRevalidation });
  const sequence = (raw: InstanceType<typeof Database>) => (raw.query("SELECT sequence FROM world_public_state").get() as { sequence: number }).sequence;

  test("CHILD legacy bytes/head/TTL/raw source/aliases stay unchanged; denied and public reads never write or repair", () => {
    const f = fixture();
    try {
      const before = f.dump(); expect(JSON.stringify(f.store.get(alias, now)!.world)).toBe(JSON.stringify(f.w)); expect(f.store.get(repo, now)!.expiresAt).toBe(now + 90_000);
      expect(f.store.summaries([repo], now)[0]!.repo.description).toBe("SYNTHETIC 原始来源"); expect(f.dump()).toBe(before);
      expect(f.store.publicCaptures.revoke(repo)).toEqual({ barrier: "confirmed", cleanup: "confirmed" });
      const denied = f.dump(); expect(f.store.get(repo)).toBeNull(); expect(f.store.get(alias)).toBeNull(); expect(f.store.summaries([repo, alias])).toEqual([]); expect(f.dump()).toBe(denied);
    } finally { f.close(); }
  });

  test("CHILD real world cache/alias/gallery/history-cache deny across reopen after durable revoke", async () => {
    const f = fixture();
    try {
      f.store.publicCaptures.revoke(alias); f.reopen();
      const service = createWorldService({ store: f.store, now: () => now, collector: { async collect() { throw Error("FORBIDDEN"); } } });
      expect(await service.getCachedWorld(repo)).toBeNull(); expect(await service.getCachedWorld(alias)).toBeNull(); expect((await service.listFeatured()).find(row => row.fullName === repo)?.ready).not.toBe(true);
      const cursor = new HistoryCursorCodec(await crypto.subtle.importKey("raw", new Uint8Array(32).fill(31), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
      const history = new HistoryService({ cache: f.store, store: { page() { throw Error("History RPC forbidden on missing capture"); } } as unknown as import("../src/server/history-storage").HistoryStore, cursor, reader: { quota: { take() { throw Error("FORBIDDEN"); } }, fetcher: globalThis.fetch }, admitRequest() {}, admitCollection() { throw Error("FORBIDDEN"); } });
      await expect(history.read(repo)).rejects.toMatchObject({ code: "HISTORY_CACHE_MISSING", status: 404 });
    } finally { f.close(); }
  });

  test("CHILD actual service PUBLIC_ONLY revokes while an older collector is suspended; late real commit cannot resurrect", async () => {
    const f = fixture(), started = deferred(), release = deferred(); let deletes = 0;
    const evict = f.store.delete.bind(f.store); f.store.delete = key => { deletes++; evict(key); };
    const old = createWorldService({ store: f.store, now: () => now, collector: { async collect() { started.resolve(); await release.promise; return collection(); } } });
    const privacy = createWorldService({ store: f.store, now: () => now, collector: { async collect() { throw new GitHubError("PUBLIC_ONLY", 403, "SYNTHETIC metadata private"); } } });
    const pending = old.loadWorld(repo, { refresh: true });
    try {
      await started.promise; await expect(privacy.loadWorld(alias, { refresh: true })).rejects.toMatchObject({ code: "PUBLIC_ONLY" });
      expect(deletes).toBe(0); expect(f.store.get(repo)).toBeNull(); expect(() => f.store.put(f.w)).toThrow(); expect(() => f.store.alias(alias, repo)).toThrow();
      release.resolve(); await expect(pending).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" }); expect(old.activeCollections()).toBe(0);
      f.reopen(); expect(f.store.get(repo)).toBeNull(); expect(f.store.get(alias)).toBeNull();
    } finally { release.resolve(); await pending.catch(() => {}); f.close(); }
  });

  test("CHILD explicit new public generation reopens; pre-barrier, concurrent older and unversioned writes remain rejected", () => {
    const f = fixture();
    try {
      const old = begin(f.store); f.store.publicCaptures.revoke(repo);
      expect(() => begin(f.store)).toThrow(); const one = begin(f.store, repo, true), two = begin(f.store, repo, true), fresh = world(repo, "c".repeat(40));
      f.store.publicCaptures.commit(one, fresh, 90_000, now); expect(f.store.get(repo, now)?.world.headSha).toBe(fresh.headSha);
      for (const token of [old, two, one]) expect(() => f.store.publicCaptures.commit(token, f.w)).toThrow();
      expect(() => f.store.put(f.w)).toThrow(); expect(() => f.store.alias(alias, repo)).toThrow(); expect(f.store.get(alias)).toBeNull();
      f.reopen(); expect(f.store.get(repo, now)?.world.headSha).toBe(fresh.headSha); expect(() => f.store.put(f.w)).toThrow();
    } finally { f.close(); }
  });

  test("CHILD denied legacy GET does not admit/collect; explicit create or refresh revalidates using a NEW collector result", async () => {
    for (const mode of ["create", "refresh"] as const) {
      const f = fixture(); let collects = 0, admits = 0;
      try {
        f.store.publicCaptures.revoke(repo);
        const service = createWorldService({ store: f.store, now: () => now, collector: { async collect() { collects++; return collection(world(repo, "d".repeat(40))); } } });
        await expect(service.loadWorld(repo, { admit() { admits++; } })).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" }); expect(collects).toBe(0); expect(admits).toBe(0);
        const fresh = await service.loadWorld(repo, { ...(mode === "create" ? { explicitRevalidation: true } : { refresh: true }), admit() { admits++; } });
        expect(fresh.headSha).toBe("d".repeat(40)); expect(collects).toBe(1); expect(admits).toBe(1); expect(f.store.get(repo)?.world.headSha).toBe(fresh.headSha);
      } finally { f.close(); }
    }
  });

  for (const table of ["worlds", "world_aliases"]) test(`CHILD ${table} cleanup trigger failure preserves independently committed deny across reopen`, () => {
    const f = fixture();
    try {
      const observation = begin(f.store); f.raw.exec(`CREATE TRIGGER synthetic_cleanup BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'SYNTHETIC cleanup failure'); END`);
      let error: unknown; try { f.store.publicCaptures.revoke(repo, observation); } catch (e) { error = e; }
      expect(error).toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE", barrier: "confirmed", cleanup: "unconfirmed" }); expect(sequence(f.raw)).toBe(1);
      expect((f.raw.query("SELECT COUNT(*) n FROM worlds").get() as { n: number }).n).toBe(1); expect(f.store.get(repo)).toBeNull(); expect(f.store.get(alias)).toBeNull();
      expect(() => f.store.publicCaptures.revoke(repo, observation)).toThrow(error as Error); expect(sequence(f.raw)).toBe(1); f.reopen(); expect(f.store.get(repo)).toBeNull(); expect(f.store.get(alias)).toBeNull();
      // Trigger remains installed, physical rows remain, no manufactured cleanup.
      expect((f.raw.query("SELECT COUNT(*) n FROM worlds").get() as { n: number }).n).toBe(1);
    } finally { f.close(); }
  });

  test("CHILD failed INITIAL barrier reports UNKNOWN: current instance fails closed, restart durability is explicitly unavailable", () => {
    const f = fixture();
    try {
      const observation = begin(f.store); f.raw.exec("CREATE TRIGGER synthetic_initial BEFORE INSERT ON world_public_barriers BEGIN SELECT RAISE(ABORT,'SYNTHETIC barrier failure'); END");
      let error: unknown; try { f.store.publicCaptures.revoke(repo, observation); } catch (e) { error = e; }
      expect(error).toMatchObject({ barrier: "unknown", cleanup: "not-started", code: "WORLD_STORAGE_UNAVAILABLE" }); expect(sequence(f.raw)).toBe(0);
      expect(() => f.store.get(repo)).toThrow(); expect(() => f.store.get(alias)).toThrow(); expect(() => f.store.put(f.w)).toThrow();
      expect(() => f.store.publicCaptures.revoke(repo, observation)).toThrow(error as Error); expect(sequence(f.raw)).toBe(0);
      f.reopen(); expect(f.store.get(repo)).not.toBeNull(); // LIMIT: no successful durable write occurred. Never claim durable denial here.
    } finally { f.close(); }
  });

  test("CHILD initial barrier committed but local acknowledgement throws remains UNKNOWN and durable deny survives restart", () => {
    const f = fixture();
    try {
      const internal = (f.store as unknown as { db: InstanceType<typeof Database> }).db, original = internal.transaction.bind(internal);
      let first = true;
      internal.transaction = ((fn: (...args: any[]) => any) => {
        const transaction = original(fn), immediate = transaction.immediate.bind(transaction);
        return Object.assign((...args: any[]) => transaction(...args), { immediate: (...args: any[]) => { const value = immediate(...args); if (first) { first = false; throw Error("SYNTHETIC post-commit acknowledgement failure"); } return value; } });
      }) as typeof internal.transaction;
      expect(() => f.store.publicCaptures.revoke(repo)).toThrow(); expect(sequence(f.raw)).toBe(1); expect(() => f.store.get(repo)).toThrow();
      f.reopen(); expect(f.store.get(repo)).toBeNull(); expect(f.store.get(alias)).toBeNull(); expect((f.raw.query("SELECT COUNT(*) n FROM worlds").get() as { n: number }).n).toBe(1);
    } finally { f.close(); }
  });

  test("CHILD cleanup refuses a superseding public reopen between transactions instead of deleting its newly verified capture", () => {
    const f = fixture();
    try {
      const competing = new WorldStore(f.path), internal = (f.store as unknown as { db: InstanceType<typeof Database> }).db, original = internal.transaction.bind(internal);
      let first = true;
      internal.transaction = ((fn: (...args: any[]) => any) => {
        const transaction = original(fn), immediate = transaction.immediate.bind(transaction);
        return Object.assign((...args: any[]) => transaction(...args), { immediate: (...args: any[]) => {
          const value = immediate(...args);
          if (first) { first = false; competing.publicCaptures.commit(begin(competing, repo, true), world(repo, "c".repeat(40)), 90_000, now); }
          return value;
        } });
      }) as typeof internal.transaction;
      try {
        let error: unknown; try { f.store.publicCaptures.revoke(repo); } catch (e) { error = e; }
        expect(error).toMatchObject({ barrier: "confirmed", cleanup: "unconfirmed" }); expect(f.store.get(repo)?.world.headSha).toBe("c".repeat(40));
        f.reopen(); expect(f.store.get(repo)?.world.headSha).toBe("c".repeat(40));
      } finally { competing.close(); }
    } finally { f.close(); }
  });

  for (const point of ["control", "snapshot", "alias"]) test(`CHILD reopen interrupted at ${point} transaction stage leaves original deny and never a half-public snapshot`, () => {
    const f = fixture();
    try {
      f.store.publicCaptures.revoke(repo); const token = begin(f.store, alias, true), before = f.dump();
      const statement = point === "control" ? "BEFORE UPDATE ON world_public_state" : point === "snapshot" ? "AFTER INSERT ON worlds" : "BEFORE INSERT ON world_aliases";
      f.raw.exec(`CREATE TRIGGER synthetic_commit ${statement} BEGIN SELECT RAISE(ABORT,'SYNTHETIC commit failure'); END`);
      expect(() => f.store.publicCaptures.commit(token, world(), 90_000, now)).toThrow(); expect(f.dump()).toBe(before); expect(f.store.get(repo)).toBeNull(); expect(f.store.get(alias)).toBeNull();
      f.reopen(); expect(f.store.get(repo)).toBeNull(); expect(f.store.get(alias)).toBeNull();
    } finally { f.close(); }
  });

  test("CHILD silently ignored control/row/alias writes cannot report confirmed revoke/reopen/cleanup", () => {
    for (const point of ["barrier", "control", "cleanup", "snapshot", "alias"] as const) {
      const f = fixture();
      try {
        const reopen = point === "snapshot" || point === "alias";
        if (reopen) f.store.publicCaptures.revoke(repo);
        const before = f.dump(), statement = point === "barrier" ? "BEFORE INSERT ON world_public_barriers" : point === "control" ? "BEFORE UPDATE ON world_public_state" : point === "cleanup" ? "BEFORE DELETE ON worlds" : point === "snapshot" ? "BEFORE INSERT ON worlds" : "BEFORE INSERT ON world_aliases";
        f.raw.exec(`CREATE TRIGGER synthetic_ignore ${statement} BEGIN SELECT RAISE(IGNORE); END`);
        if (reopen) { expect(() => f.store.publicCaptures.commit(begin(f.store, alias, true), world(), 90_000, now)).toThrow(); expect(f.dump()).toBe(before); expect(f.store.get(repo)).toBeNull(); }
        else {
          let error: unknown; try { f.store.publicCaptures.revoke(repo); } catch (e) { error = e; }
          expect(error).toMatchObject({ barrier: point === "cleanup" ? "confirmed" : "unknown", cleanup: point === "cleanup" ? "unconfirmed" : "not-started" });
          if (point === "cleanup") { f.reopen(); expect(f.store.get(repo)).toBeNull(); }
          else { expect(sequence(f.raw)).toBe(0); expect(() => f.store.get(repo)).toThrow(); }
        }
      } finally { f.close(); }
    }
  });

  test("CHILD malformed persisted admission rows fail closed across reopen without repair", () => {
    for (const sql of ["DELETE FROM world_public_state", "UPDATE world_public_state SET schema_version=2", "UPDATE world_public_state SET sequence=-1", "UPDATE world_public_state SET sequence=9007199254740992", "INSERT INTO world_public_barriers VALUES('invalid key',1,1)", "INSERT INTO world_public_barriers VALUES('synthetic/repo',1,7)", "INSERT INTO world_public_barriers VALUES('synthetic/repo',5,0)"]) {
      const f = fixture();
      try {
        f.raw.exec("PRAGMA ignore_check_constraints=ON"); f.raw.exec(sql); const before = f.dump();
        expect(() => f.store.get(repo, now, { readOnly: true })).toThrow(); expect(() => begin(f.store)).toThrow(); expect(() => f.store.put(f.w)).toThrow();
        expect(() => new WorldStore(f.path)).toThrow(); expect(f.dump()).toBe(before);
      } finally { f.close(); }
    }
  });

  test("CHILD missing one barrier or changing a valid deny bit cannot silently become legacy-public", () => {
    for (const sql of ["DELETE FROM world_public_barriers WHERE repo='openclaw/openclaw'", "UPDATE world_public_barriers SET denied=0 WHERE repo='openclaw/openclaw'"]) {
      const f = fixture();
      try { f.store.publicCaptures.revoke(repo); f.raw.exec(sql); expect(() => f.store.get(repo)).toThrow(); expect(() => begin(f.store, repo, true)).toThrow(); expect(() => new WorldStore(f.path)).toThrow(); }
      finally { f.close(); }
    }
  });

  test("CHILD missing both control tables or an invalid protocol marker never reinitializes a previously protected database", () => {
    for (const sql of ["DROP TABLE world_public_state; DROP TABLE world_public_barriers", "DROP TABLE world_public_state", "PRAGMA user_version=0", "PRAGMA user_version=2"]) {
      const f = fixture();
      try { f.store.publicCaptures.revoke(repo); f.raw.exec(sql); expect(() => f.store.get(repo)).toThrow(); expect(() => new WorldStore(f.path)).toThrow(); }
      finally { f.close(); }
    }
  });

  test("CHILD generations are one-use store identities: forged fields, foreign objects and restarted tokens cannot write", () => {
    const f = fixture(), other = new WorldStore(f.path);
    try {
      const token = begin(f.store); for (const value of [{ ...token }, begin(other)]) expect(() => f.store.publicCaptures.commit(value, world())).toThrow();
      f.reopen(); expect(() => f.store.publicCaptures.commit(token, world())).toThrow(); expect(sequence(f.raw)).toBe(0);
    } finally { other.close(); f.close(); }
  });

  test("CHILD repeated SAME private observation is idempotent, NEW observations fence leases and superseded repeats do not erase reopened captures", () => {
    const f = fixture();
    try {
      const first = begin(f.store); f.store.publicCaptures.revoke(repo, first); const before = f.dump(); f.store.publicCaptures.revoke(repo, first); expect(f.dump()).toBe(before);
      const second = begin(f.store, repo, true), pending = begin(f.store, repo, true); f.store.publicCaptures.revoke(repo, second); expect(sequence(f.raw)).toBe(2);
      expect(() => f.store.publicCaptures.commit(pending, world())).toThrow(); expect(() => f.store.publicCaptures.revoke(repo, first)).toThrow();
      const fresh = begin(f.store, repo, true); f.store.publicCaptures.commit(fresh, world(), 90_000, now); const publicState = f.dump();
      expect(() => f.store.publicCaptures.revoke(repo, second)).toThrow(); expect(f.dump()).toBe(publicState);
      f.store.publicCaptures.revoke(repo); expect(sequence(f.raw)).toBe(4); expect(f.store.get(repo)).toBeNull();
    } finally { f.close(); }
  });

  test("CHILD canonical rename discovered late uses START sequence, not a fresh lease after canonical private observation", async () => {
    const f = fixture(), entered = deferred(), gate = deferred();
    const service = createWorldService({ store: f.store, now: () => now, collector: { async collect() { entered.resolve(); await gate.promise; return collection(); } } });
    const pending = service.loadWorld("synthetic/unknown-rename", { explicitRevalidation: true });
    try { await entered.promise; f.store.publicCaptures.revoke(repo); gate.resolve(); await expect(pending).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" }); expect(f.store.get(repo)).toBeNull(); expect(f.store.get("synthetic/unknown-rename")).toBeNull(); }
    finally { gate.resolve(); await pending.catch(() => {}); f.close(); }
  });

  test("CHILD unrelated revocation advances global sequence without invalidating another repository's collector or bytes", () => {
    const f = fixture();
    try {
      const unrelated = world("synthetic/unrelated", "e".repeat(40)); f.store.put(unrelated, 120_000, now); const original = f.raw.query("SELECT * FROM worlds WHERE repo=?").get(unrelated.repo.fullName);
      const token = begin(f.store, unrelated.repo.fullName); f.store.publicCaptures.revoke(repo); expect(f.raw.query("SELECT * FROM worlds WHERE repo=?").get(unrelated.repo.fullName)).toEqual(original);
      f.store.publicCaptures.commit(token, unrelated, 120_000, now); expect(f.store.get(unrelated.repo.fullName, now)?.expiresAt).toBe(now + 120_000); expect(f.store.get(repo)).toBeNull();
    } finally { f.close(); }
  });

  test("CHILD parse failures and ordinary forbidden/rate-limit responses never become private observations", async () => {
    for (const code of ["GITHUB_FORBIDDEN", "GITHUB_RATE_LIMIT"]) {
      const f = fixture(); let collects = 0;
      try {
        const service = createWorldService({ store: f.store, now: () => now, collector: { async collect() { collects++; throw new GitHubError(code, code === "GITHUB_FORBIDDEN" ? 403 : 429, "SYNTHETIC upstream rejection"); } } });
        await expect(service.loadWorld("https://evil.invalid/repo", { refresh: true })).rejects.toMatchObject({ code: "INVALID_REPO" }); expect(collects).toBe(0);
        expect((await service.loadWorld(repo, { refresh: true })).coverage.notes.some(note => note.includes("STALE"))).toBe(true); expect(sequence(f.raw)).toBe(0); expect(f.store.get(repo)).not.toBeNull();
      } finally { f.close(); }
    }
  });

  test("CHILD late network failure after revocation never falls back to its earlier cached public capture", async () => {
    const f = fixture(), entered = deferred(), gate = deferred();
    const service = createWorldService({ store: f.store, now: () => now, collector: { async collect() { entered.resolve(); await gate.promise; throw new GitHubError("GITHUB_FORBIDDEN", 403, "SYNTHETIC generic rejection"); } } });
    const pending = service.loadWorld(repo, { refresh: true });
    try { await entered.promise; f.store.publicCaptures.revoke(repo); gate.resolve(); await expect(pending).rejects.toMatchObject({ code: "WORLD_STORAGE_UNAVAILABLE" }); }
    finally { gate.resolve(); await pending.catch(() => {}); f.close(); }
  });

  test("CHILD ordinary corrupt-cache eviction is not a privacy decision and does not create a barrier", () => {
    const f = fixture();
    try { f.raw.query("UPDATE worlds SET snapshot='invalid JSON'").run(); expect(f.store.get(repo)).toBeNull(); expect(sequence(f.raw)).toBe(0); expect(f.raw.query("SELECT * FROM world_public_barriers").all()).toEqual([]); f.store.put(f.w); expect(f.store.get(repo)).not.toBeNull(); }
    finally { f.close(); }
  });

  test("CHILD safe-integer exhaustion cannot wrap a barrier or reopen denied state", () => {
    const f = fixture();
    try { f.store.publicCaptures.revoke(repo); (f.store as unknown as { saveControl(sequence: number): void }).saveControl(Number.MAX_SAFE_INTEGER); const token = begin(f.store, repo, true); expect(() => f.store.publicCaptures.commit(token, world())).toThrow(); expect(f.store.get(repo)).toBeNull(); expect(sequence(f.raw)).toBe(Number.MAX_SAFE_INTEGER); }
    finally { f.close(); }
  });

  test("CHILD async generation admission preserves singleflight and cache hits do not create collection generations", async () => {
    const f = fixture(false), entered = deferred(), gate = deferred(); let begins = 0, collects = 0, admissions = 0, commits = 0;
    const authority = f.store.publicCaptures;
    const service = createWorldService({ now: () => now, store: {
      get: f.store.get.bind(f.store), put() { throw Error("Unversioned put forbidden"); }, alias() { throw Error("Unversioned alias forbidden"); },
      publicCaptures: { ...authority, async begin(key, options) { begins++; const token = authority.begin(key, options); entered.resolve(); await gate.promise; return token; }, commit(token, world, ttl, now) { commits++; return authority.commit(token, world, ttl, now); } },
    }, collector: { async collect() { collects++; return collection(); } } });
    const one = service.loadWorld(repo, { admit() { admissions++; } }), two = service.loadWorld(repo, { admit() { admissions++; } });
    try {
      await entered.promise; expect(begins).toBe(1); expect(collects).toBe(0); expect(admissions).toBe(0); expect(service.activeCollections()).toBe(1);
      gate.resolve(); expect((await one).headSha).toBe((await two).headSha); expect(commits).toBe(1); expect(collects).toBe(1); expect(admissions).toBe(1);
      await service.loadWorld(repo); expect(begins).toBe(1); expect(admissions).toBe(1); expect(service.activeCollections()).toBe(0);
    } finally { gate.resolve(); await Promise.allSettled([one, two]); f.close(); }
  });

  test("CHILD original create HTTP action reopens only after the actual GitHubClient public metadata gate succeeds", async () => {
    const f = fixture(); const previousFetch = globalThis.fetch, originalNow = Date.now; let requests = 0, privateMetadata = true, clock = originalNow();
    Date.now = () => clock;
    try {
      f.store.publicCaptures.revoke(repo);
      Object.assign(process.env, { MOONSHOT_DATA_DIR: f.directory, MOONSHOT_BUDGET_USD: "0", MOONSHOT_GITHUB_REQUESTS_PER_HOUR: "100" });
      globalThis.fetch = (async input => {
        const url = new URL(String(input)); if (url.origin !== "https://api.github.com") throw Error("SYNTHETIC unexpected upstream"); requests++;
        if (url.pathname === `/repos/${repo}`) return Response.json({ private: privateMetadata, visibility: privateMetadata ? "private" : "public", full_name: repo, default_branch: "main", license: null });
        if (url.pathname.includes("/git/ref/heads/")) return Response.json({ object: { sha: "a".repeat(40), type: "commit" } });
        if (url.pathname.includes("/git/commits/")) return Response.json({ sha: "a".repeat(40), tree: { sha: "b".repeat(40) } });
        if (url.pathname.includes("/git/trees/")) return Response.json({ tree: [{ path: "src/原始.ts", type: "blob", sha: "c".repeat(40) }], truncated: false });
        if (url.pathname.endsWith("/languages")) return Response.json({ TypeScript: 1 });
        if (url.pathname.includes("/actions/runs")) return Response.json({ workflow_runs: [] });
        if (/\/(issues|pulls|commits)$/.test(url.pathname)) return Response.json([]);
        return new Response("SYNTHETIC absent optional file", { status: 404 });
      }) as typeof fetch;
      const { Route } = await import("../src/routes/api.worlds"), post = (Route.options as any).server.handlers.POST;
      const create = (body: unknown) => post({ request: new Request("http://127.0.0.1/github-factory/api/worlds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      const rejected = await create({ repo: `https://github.com/${repo}`, enrich: false }); expect(rejected.status).toBe(403); expect(requests).toBe(1); expect(f.store.get(repo)).toBeNull();
      // Advance the synthetic clock past the original cooldown. No sleep, retry
      // loop or production configuration is used to bypass the original limit.
      clock += 16_000; privateMetadata = false;
      const invalid = await create({ repo: `https://github.com/${repo}`, epoch: 99 }); expect(invalid.status).toBe(400); expect(requests).toBe(1);
      const accepted = await create({ repo: `https://github.com/${repo}`, enrich: false }); expect(accepted.status).toBe(200); expect((await accepted.json()).repo.license).toBeNull(); expect(requests).toBeGreaterThan(1); expect(f.store.get(repo)).not.toBeNull();
    } finally { Date.now = originalNow; globalThis.fetch = previousFetch; for (const name of ["MOONSHOT_DATA_DIR", "MOONSHOT_BUDGET_USD", "MOONSHOT_GITHUB_REQUESTS_PER_HOUR"]) delete process.env[name]; f.close(); }
  });
}
