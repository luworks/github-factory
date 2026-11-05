import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { D1PublicCaptureCore } from "../deploy/world-public-captures";
import { WORLD_CAPTURE_TABLE_SQL, WorldCaptureError, captureChunks, captureHash, captureSqlTokens, signWorldPrivateObservation } from "../src/server/world-public-capture-contract";
import { createCollectionObservation, GitHubClient, parseRepo, takePrivateRepositoryObservation } from "../src/server/github";
import { syntheticWorldD1 } from "./fixtures/world-public-d1";
import { syntheticWorld } from "./fixtures/browser-world";

const input = "synthetic/unknown-name", canonical = "synthetic/canonical", known = "synthetic/known-name", unrelated = "synthetic/unrelated";
function write(repo = canonical, savedAt = 1000, extra = "") {
  const w = syntheticWorld(); w.source = "github"; w.repo = { ...w.repo, fullName: repo, owner: repo.split("/")[0]!, name: repo.split("/")[1]!, url: `https://github.com/${repo}`, description: `SYNTHETIC 原始字节 ${extra}` };
  return { snapshot: JSON.stringify(w, null, 2), savedAt, expiresAt: savedAt + 120000 };
}
type Fixture = Awaited<ReturnType<typeof syntheticWorldD1>>;
async function seed(f: Fixture) { await f.core.putLegacy(write()); await f.core.aliasLegacy(known, canonical); await f.core.putLegacy(write(unrelated)); }
async function claim(f: Fixture, generation: Awaited<ReturnType<Fixture["core"]["begin"]>>, target = canonical) {
  const context = createCollectionObservation(generation.repo, generation); let failure: unknown;
  const client = new GitHubClient("", async url => new URL(String(url)).pathname === `/repos/${generation.repo}` && generation.repo !== target ? new Response(null, { status: 301, headers: { location: `https://api.github.com/repos/${target}` } }) : Response.json({ private: true, visibility: "private", full_name: target, id: 123 }));
  try { await client.collect(parseRepo(generation.repo), context); } catch (error) { failure = error; }
  const proof = takePrivateRepositoryObservation(failure, context, generation.repo, generation); if (!proof) throw Error("Synthetic producer proof missing");
  return signWorldPrivateObservation(generation, proof, f.identity, f.key);
}
const explicit = { explicitRevalidation: true };
async function caught(action: Promise<unknown>) { try { await action; return null; } catch (e) { return e; } }

test("SYNTHETIC exact unapplied DDL and explicit authority; no migration marker4, UTF8 parameters bounded", async () => {
  const f = await syntheticWorldD1();
  try {
    expect(readFileSync(new URL("../deploy/d1/0004-world-public-captures.sql", import.meta.url), "utf8")).toContain("UNAPPLIED");
    for (const [table, ddl] of Object.entries(WORLD_CAPTURE_TABLE_SQL)) expect(captureSqlTokens((f.a.db.query("SELECT sql FROM sqlite_master WHERE name=?").get(table) as { sql: string }).sql)).toBe(captureSqlTokens(ddl));
    expect(f.a.db.query("SELECT * FROM schema_migrations").all()).toEqual([]);
    const raw = "原始🚀".repeat(20000), pieces = captureChunks(raw); expect(pieces.join("")).toBe(raw); expect(pieces.every(s => new TextEncoder().encode(s).length <= 60 * 1024)).toBe(true);
    expect(() => captureSqlTokens(WORLD_CAPTURE_TABLE_SQL.world_capture_guard + " -- pretend CHECK")).toThrow();
    expect(() => f.a.db.exec("INSERT INTO world_capture_generations VALUES('" + "a".repeat(64) + "','a/b','a/b',0,0,'denied',NULL,'[\"a/b\"]','[\"a/b\"]',0,1)")).toThrow();
  } finally { f.close(); }
});

test("SYNTHETIC cross-instance one-use generation, exact raw snapshots and one-hop aliases, cache eviction preserves authority", async () => {
  const f = await syntheticWorldD1();
  try {
    const token = await f.core.begin(input); expect(token.handle.split(".")).toHaveLength(3); expect(token.handle).not.toContain(input);
    await f.other.commit(JSON.parse(JSON.stringify(token)), write()); expect((await f.restart().get(input))?.snapshot).toBe(write().snapshot);
    expect(await f.core.inspect(token)).toMatchObject({ status: "committed", acceptedSequence: 0 });
    await expect(f.core.commit(token, write())).rejects.toMatchObject({ code: "WORLD_CAPTURE_CONFLICT" });
    await f.core.evict(input); expect(await f.other.get(canonical)).toBeNull(); expect(await f.other.get(input)).toBeNull();
    expect(f.a.db.query("SELECT * FROM world_capture_barriers").all()).toEqual([]); expect((await f.core.inspect(token)).status).toBe("committed");
  } finally { f.close(); }
});

test("SYNTHETIC genuine producer unknown canonical grouped revoke; one sequence, restart deny, unrelated bytes retained and idempotent receipt", async () => {
  const f = await syntheticWorldD1();
  try {
    await seed(f); const before = f.a.db.query("SELECT * FROM worlds WHERE repo=?").get(unrelated), g = await f.core.begin(input), proof = await claim(f, g);
    const out = await f.other.revoke(JSON.parse(JSON.stringify(g)), proof); expect(out).toEqual({ barrier: "confirmed", cleanup: "confirmed", idempotent: false });
    expect(f.a.db.query("SELECT repo,sequence,denied FROM world_capture_barriers ORDER BY repo").all()).toEqual([input, canonical, known].sort().map(repo => ({ repo, sequence: 1, denied: 1 })));
    for (const repo of [input, canonical, known]) expect(await f.restart().get(repo)).toBeNull();
    expect(f.a.db.query("SELECT * FROM worlds WHERE repo=?").get(unrelated)).toEqual(before);
    const dump = f.dump(); expect(await f.restart().revoke(g, proof)).toMatchObject({ idempotent: true }); expect(f.dump()).toBe(dump);
    await expect(f.core.revoke(g)).rejects.toMatchObject({ code: "WORLD_CAPTURE_CONFLICT" });
  } finally { f.close(); }
});

test("SYNTHETIC fresh explicit reopen fences stale unknown-canonical/public/private generations and legacy writes forever", async () => {
  const f = await syntheticWorldD1();
  try {
    await seed(f); const stale = await f.core.begin(input, explicit), staleCanonical = await f.other.begin(canonical, explicit), g = await f.core.begin(input), proof = await claim(f, g);
    await f.core.revoke(g, proof); await expect(f.other.begin(canonical)).rejects.toMatchObject({ code: "WORLD_CAPTURE_CONFLICT" });
    const fresh = await f.other.begin(input, explicit); await f.core.commit(fresh, write(canonical, 2000));
    expect((await f.other.get(input))?.savedAt).toBe(2000); expect(await f.other.get(known)).toBeNull();
    for (const token of [stale, staleCanonical]) await expect(f.other.commit(token, write(canonical, 3000))).rejects.toMatchObject({ code: "WORLD_CAPTURE_CONFLICT" });
    await expect(f.other.revoke(stale, await claim(f, stale))).rejects.toMatchObject({ code: "WORLD_CAPTURE_CONFLICT" });
    await expect(f.core.putLegacy(write(canonical, 4000))).rejects.toMatchObject({ code: "WORLD_CAPTURE_CONFLICT" });
    await expect(f.core.aliasLegacy("synthetic/new-alias", canonical)).rejects.toMatchObject({ code: "WORLD_CAPTURE_CONFLICT" });
    await expect(f.core.revoke(g, proof)).rejects.toMatchObject({ code: "WORLD_CAPTURE_CONFLICT" });
    expect(f.a.db.query("SELECT sequence,denied FROM world_capture_barriers WHERE repo=?").get(known)).toEqual({ sequence: 1, denied: 1 });
  } finally { f.close(); }
});

test("SYNTHETIC cleanup failure leaves all grouped barriers durable; restart does not retry or hide pending receipt", async () => {
  const f = await syntheticWorldD1();
  try {
    await seed(f); const g = await f.core.begin(input), proof = await claim(f, g);
    f.a.db.exec("CREATE TRIGGER synthetic_cleanup BEFORE DELETE ON worlds BEGIN SELECT RAISE(ABORT,'SYNTHETIC cleanup failure'); END");
    expect(await caught(f.core.revoke(g, proof))).toMatchObject({ writeOutcome: "unknown", barrier: "confirmed", cleanup: "unconfirmed" });
    for (const repo of [input, canonical, known]) expect(await f.restart().get(repo)).toBeNull();
    expect(f.a.db.query("SELECT repo FROM worlds WHERE repo=?").get(canonical)).not.toBeNull();
    const dump = f.dump(), count = f.b.calls.length; expect(await caught(f.restart().revoke(g, proof))).toMatchObject({ barrier: "confirmed", cleanup: "unconfirmed" });
    expect(f.dump()).toBe(dump); expect(f.b.calls.length).toBe(count); expect((await f.other.inspect(g)).status).toBe("deny-pending");
  } finally { f.close(); }
});

test("SYNTHETIC forged, replayed, tampered generations/claims/key/identity and malformed groups cannot mutate", async () => {
  const f = await syntheticWorldD1();
  try {
    await seed(f); const g = await f.core.begin(input), proof = await claim(f, g), dump = f.dump();
    for (const token of [{ ...g, repo: unrelated }, { ...g, sequence: g.sequence + 1 }, { ...g, explicitRevalidation: true }, { ...g, handle: g.handle.slice(0, -1) + (g.handle.endsWith("A") ? "B" : "A") }, { ...g, handle: "wc1." + "a".repeat(64) + "." + "a".repeat(43) }]) { expect(await caught(f.other.commit(token, write()))).toBeInstanceOf(WorldCaptureError); expect(f.dump()).toBe(dump); }
    for (const bad of [[canonical], canonical, { canonical }, null, proof.slice(0, -2) + "aa"]) { expect(await caught(f.other.revoke(g, bad as any))).toBeInstanceOf(WorldCaptureError); expect(f.dump()).toBe(dump); }
    const later = await f.core.begin(input), laterDump = f.dump(); expect(await caught(f.other.revoke(later, proof))).toBeInstanceOf(WorldCaptureError); expect(f.dump()).toBe(laterDump);
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(42), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    for (const core of [new D1PublicCaptureCore(f.b, f.identity, key), new D1PublicCaptureCore(f.b, { ...f.identity, epoch: "4".repeat(32) }, f.key), new D1PublicCaptureCore(f.b, { ...f.identity, databaseId: "55555555-5555-4555-8555-555555555555" }, f.key)]) await expect(core.get(input)).rejects.toMatchObject({ code: "WORLD_CAPTURE_UNAVAILABLE" });
    expect(f.dump()).toBe(laterDump);
  } finally { f.close(); }
});

test("SYNTHETIC full metadata CAS rejects legacy write between observation and batch inside transaction", async () => {
  const f = await syntheticWorldD1();
  try {
    await seed(f); const g = await f.core.begin(input); let once = false;
    f.a.beforeBatch = async () => { if (!once) { once = true; f.b.db.query("UPDATE worlds SET origin='legacy-unaccounted' WHERE repo=?").run(unrelated); } };
    const error = await caught(f.core.commit(g, write())); expect(error).toMatchObject({ writeOutcome: "unknown" });
    expect(f.a.db.query("SELECT status FROM world_capture_generations WHERE handle_hash=?").get(await captureHash(g.handle))).toEqual({ status: "active" }); expect(f.a.db.query("SELECT * FROM world_aliases WHERE alias=?").get(input)).toBeNull();
    await expect(f.other.get(unrelated)).rejects.toMatchObject({ code: "WORLD_CAPTURE_UNAVAILABLE" });
  } finally { f.close(); }
});

test("SYNTHETIC concurrent independent public commits serialize one winner and lost CAS is UNKNOWN with no partial alias", async () => {
  const f = await syntheticWorldD1();
  try {
    const ga = await f.core.begin(input), gb = await f.other.begin("synthetic/second-input"); let ready!: () => void, proceed!: () => void;
    const waiting = new Promise<void>(r => ready = r), release = new Promise<void>(r => proceed = r);
    f.a.beforeBatch = async () => { ready(); await release; };
    const first = f.core.commit(ga, write()); await waiting; await f.other.commit(gb, write(canonical, 2000)); proceed();
    expect(await caught(first)).toMatchObject({ writeOutcome: "unknown" }); expect((await f.restart().get(canonical))?.savedAt).toBe(2000); expect(await f.restart().get(input)).toBeNull();
    expect((await f.other.inspect(ga)).status).toBe("active"); expect((await f.other.inspect(gb)).status).toBe("committed");
  } finally { f.close(); }
});

for (const phase of ["begin", "commit", "barrier", "cleanup"] as const) test(`SYNTHETIC EVERY ${phase} statement interruption rolls back that batch; deny and ACK outcomes remain separate`, async () => {
  const probe = await syntheticWorldD1(); let count = 0;
  try { await seed(probe); if (phase === "begin") { await probe.core.begin(input); count = probe.a.calls.at(-1)!.length; } else { const g = await probe.core.begin(input); if (phase === "commit") { await probe.core.commit(g, write()); count = probe.a.calls.at(-1)!.length; } else { await probe.core.revoke(g, await claim(probe, g)); count = probe.a.calls.at(phase === "barrier" ? -2 : -1)!.length; } } } finally { probe.close(); }
  expect(count).toBeGreaterThan(2);
  for (let statement = 0; statement < count; statement++) {
    const f = await syntheticWorldD1();
    try {
      await seed(f); const g = phase === "begin" ? undefined : await f.core.begin(input), proof = phase === "barrier" || phase === "cleanup" ? await claim(f, g!) : undefined;
      const before = f.dump(), batch = f.a.calls.length + (phase === "cleanup" ? 1 : 0); f.a.interrupt = { batch, statement };
      const error = await caught(phase === "begin" ? f.core.begin(input) : phase === "commit" ? f.core.commit(g!, write()) : f.core.revoke(g!, proof));
      expect(error).toMatchObject({ writeOutcome: "unknown" });
      if (phase === "cleanup") { expect(error).toMatchObject({ barrier: "confirmed", cleanup: "unconfirmed" }); for (const repo of [input, canonical, known]) expect(await f.other.get(repo)).toBeNull(); expect((await f.other.inspect(g!)).status).toBe("deny-pending"); }
      else { expect(f.dump()).toBe(before); if (phase === "barrier") { expect(error).toMatchObject({ barrier: "unknown", cleanup: "not-started" }); expect(await caught(f.core.get(canonical))).toBeInstanceOf(WorldCaptureError); expect(await f.other.get(canonical)).not.toBeNull(); } }
    } finally { f.close(); }
  }
});

test("SYNTHETIC committed but lost ACK, false/short/forged-typed results are UNKNOWN; inspect confirms outcome without retry", async () => {
  for (const mode of ["lost", "false", "short", "typed"] as const) {
    const f = await syntheticWorldD1();
    try {
      const g = await f.core.begin(input); if (mode === "lost") f.a.afterCommit = async () => { throw Error("SYNTHETIC lost ACK"); }; else f.a.result = mode;
      expect(await caught(f.core.commit(g, write()))).toMatchObject({ code: "WORLD_CAPTURE_UNAVAILABLE", writeOutcome: "unknown" });
      expect((await f.other.get(input))?.snapshot).toBe(write().snapshot); expect((await f.other.inspect(g)).status).toBe("committed"); expect(f.a.calls.length).toBe(2);
    } finally { f.close(); }
  }
  for (const phase of ["barrier", "cleanup"] as const) {
    const f = await syntheticWorldD1();
    try {
      await seed(f); const g = await f.core.begin(input), proof = await claim(f, g), next = f.a.calls.length;
      f.a.afterCommit = async batch => { if (batch === next + (phase === "cleanup" ? 1 : 0)) throw Error("SYNTHETIC lost ACK"); };
      expect(await caught(f.core.revoke(g, proof))).toMatchObject({ writeOutcome: "unknown", barrier: phase === "barrier" ? "unknown" : "confirmed", cleanup: phase === "barrier" ? "not-started" : "unconfirmed" });
      for (const repo of [input, canonical, known]) expect(await f.restart().get(repo)).toBeNull(); expect((await f.other.inspect(g)).status).toBe(phase === "barrier" ? "deny-pending" : "denied"); expect(f.a.calls.length).toBe(next + (phase === "barrier" ? 1 : 2));
    } finally { f.close(); }
  }
});

test("SYNTHETIC corrupted/missing control and guard CHECK/schema/trigger failures are unavailable without read repair", async () => {
  for (const sql of ["DELETE FROM world_capture_authority", "DELETE FROM world_capture_guard", "DROP TABLE world_capture_barriers", "UPDATE world_capture_authority SET checksum='" + "f".repeat(64) + "'", "UPDATE storage_identity SET binding_nonce='" + "9".repeat(32) + "'", "DROP TABLE world_capture_guard; CREATE TABLE world_capture_guard(singleton INTEGER PRIMARY KEY,accepted INTEGER); INSERT INTO world_capture_guard VALUES(1,1)", "CREATE TRIGGER synthetic_ignore BEFORE INSERT ON world_capture_guard BEGIN SELECT RAISE(IGNORE); END"]) {
    const f = await syntheticWorldD1();
    try { await seed(f); f.a.db.exec(sql); const before = f.a.db.serialize(); await expect(f.core.get(canonical)).rejects.toMatchObject({ code: "WORLD_CAPTURE_UNAVAILABLE" }); expect(f.a.db.serialize()).toEqual(before); } finally { f.close(); }
  }
  const f = await syntheticWorldD1();
  try { await seed(f); f.a.db.query("UPDATE worlds SET snapshot=replace(snapshot,'SYNTHETIC','sYNTHETIC') WHERE repo=?").run(canonical); const before = f.dump(); await expect(f.other.get(canonical)).rejects.toMatchObject({ code: "WORLD_CAPTURE_UNAVAILABLE" }); expect(f.dump()).toBe(before); } finally { f.close(); }
});

test("SYNTHETIC ignored writes cannot ACK a save; imported/unrelated raw bytes, TTL, hash and origin stay exact", async () => {
  const f = await syntheticWorldD1();
  try {
    await seed(f); f.a.db.query("UPDATE worlds SET origin='migration:synthetic' WHERE repo=?").run(unrelated); await f.reseal(); const before = f.a.db.query("SELECT * FROM worlds WHERE repo=?").get(unrelated);
    f.a.db.exec("CREATE TRIGGER synthetic_ignore BEFORE INSERT ON worlds BEGIN SELECT RAISE(IGNORE); END"); const g = await f.core.begin(input), dump = f.dump();
    expect(await caught(f.core.commit(g, write(canonical, 2000)))).toMatchObject({ writeOutcome: "unknown" }); expect(f.dump()).toBe(dump);
    f.a.db.exec("DROP TRIGGER synthetic_ignore"); await f.other.commit(g, write(canonical, 2000)); expect(f.a.db.query("SELECT * FROM worlds WHERE repo=?").get(unrelated)).toEqual(before);
    const stale = await f.core.begin(input); expect(await caught(f.core.commit(stale, write(canonical, 1000)))).toMatchObject({ code: "WORLD_CAPTURE_CONFLICT" });
  } finally { f.close(); }
});

test("SYNTHETIC receipt capacity is bounded without dropping active tokens; safe-integer sequence exhaustion failclosed", async () => {
  const f = await syntheticWorldD1();
  try {
    const first = await f.core.begin(input);
    for (let n = 1; n < 256; n++) await f.core.begin(`synthetic/slot-${n}`);
    const dump = f.dump(); await expect(f.other.begin("synthetic/overflow")).rejects.toMatchObject({ code: "WORLD_CAPTURE_CAPACITY" }); expect(f.dump()).toBe(dump); expect((await f.other.inspect(first)).status).toBe("active");
    await f.core.commit(first, write()); await expect(f.other.begin(input)).rejects.toMatchObject({ code: "WORLD_CAPTURE_CAPACITY" });
  } finally { f.close(); }
  const g = await syntheticWorldD1();
  try { await seed(g); g.a.db.exec("UPDATE world_capture_authority SET sequence=9007199254740990,revision=9007199254740990; INSERT INTO world_capture_barriers VALUES('synthetic/old',9007199254740990,1)"); await g.reseal(); const token = await g.core.begin(input), before = g.dump(); await expect(g.core.revoke(token)).rejects.toMatchObject({ code: "WORLD_CAPTURE_UNAVAILABLE" }); expect(g.dump()).toBe(before); } finally { g.close(); }
});

test("SYNTHETIC false-success binding cannot fabricate begin/commit/barrier acknowledgement", async () => {
  for (const phase of ["begin", "commit", "barrier"] as const) {
    const f = await syntheticWorldD1();
    try {
      await seed(f); const token = phase === "begin" ? undefined : await f.core.begin(input), before = f.dump(); f.a.result = "fake-success";
      expect(await caught(phase === "begin" ? f.core.begin(input) : phase === "commit" ? f.core.commit(token!, write()) : f.core.revoke(token!, await claim(f, token!)))).toMatchObject({ writeOutcome: "unknown" });
      expect(f.dump()).toBe(before); expect(f.a.calls.length).toBe(phase === "begin" ? 4 : 5);
    } finally { f.close(); }
  }
});

test("SYNTHETIC concurrent explicit reopen between deny and cleanup cannot be deleted by stale cleanup", async () => {
  const f = await syntheticWorldD1();
  try {
    await seed(f); const token = await f.core.begin(input), proof = await claim(f, token), cleanupBatch = f.a.calls.length + 1;
    f.a.beforeBatch = async batch => { if (batch === cleanupBatch) { const fresh = await f.other.begin(input, explicit); await f.other.commit(fresh, write(canonical, 3000)); } };
    expect(await caught(f.core.revoke(token, proof))).toMatchObject({ barrier: "confirmed", cleanup: "unconfirmed", writeOutcome: "unknown" });
    expect((await f.restart().get(input))?.savedAt).toBe(3000); expect(await f.restart().get(known)).toBeNull(); expect((await f.other.inspect(token)).status).toBe("deny-pending");
  } finally { f.close(); }
});

test("SYNTHETIC every explicit reopen statement interruption rolls back snapshot, alias, reopen and receipt together", async () => {
  const probe = await syntheticWorldD1(); let count = 0;
  try { await seed(probe); const g = await probe.core.begin(input); await probe.core.revoke(g, await claim(probe, g)); const fresh = await probe.core.begin(input, explicit); await probe.core.commit(fresh, write(canonical, 2000)); count = probe.a.calls.at(-1)!.length; } finally { probe.close(); }
  expect(count).toBeGreaterThan(5);
  for (let statement = 0; statement < count; statement++) {
    const f = await syntheticWorldD1();
    try { await seed(f); const g = await f.core.begin(input); await f.core.revoke(g, await claim(f, g)); const fresh = await f.core.begin(input, explicit), before = f.dump(); f.a.interrupt = { batch: f.a.calls.length, statement }; expect(await caught(f.core.commit(fresh, write(canonical, 2000)))).toMatchObject({ writeOutcome: "unknown" }); expect(f.dump()).toBe(before); for (const repo of [input, canonical, known]) expect(await f.other.get(repo)).toBeNull(); } finally { f.close(); }
  }
});

test("SYNTHETIC malformed persisted controls remain unavailable even after an operator reseals checksum; no silent repair", async () => {
  for (const sql of ["INSERT INTO world_capture_barriers VALUES('invalid',1,1); UPDATE world_capture_authority SET sequence=1", "UPDATE world_capture_generations SET repo='invalid'", "UPDATE world_capture_generations SET start_canonical='bad key'", "UPDATE world_aliases SET canonical=alias", "UPDATE world_capture_authority SET sequence=1", "UPDATE world_capture_generations SET status='denied',operation_hash='" + "a".repeat(64) + "',roots='[1]',targets='[1]',accepted_sequence=0"]) {
    const f = await syntheticWorldD1();
    try { await seed(f); await f.core.begin(input); f.a.db.exec(sql); await f.reseal(); const before = f.dump(); await expect(f.other.get(canonical)).rejects.toMatchObject({ code: "WORLD_CAPTURE_UNAVAILABLE" }); expect(f.dump()).toBe(before); } finally { f.close(); }
  }
});

test("SYNTHETIC delayed begin cannot cross a concurrent durable revoke, and old canonical commit cannot race it", async () => {
  for (const kind of ["begin", "commit", "revoke"] as const) {
    const f = await syntheticWorldD1();
    try {
      await seed(f); const old = kind === "begin" ? undefined : await f.core.begin(input), newer = await f.other.begin(canonical); let ready!: () => void, proceed!: () => void;
      const waiting = new Promise<void>(r => ready = r), release = new Promise<void>(r => proceed = r); f.a.beforeBatch = async () => { ready(); await release; };
      const work = kind === "begin" ? f.core.begin(input) : kind === "commit" ? f.core.commit(old!, write()) : f.core.revoke(old!, await claim(f, old!));
      await waiting; await f.other.revoke(newer); proceed(); expect(await caught(work)).toMatchObject({ writeOutcome: "unknown" }); expect(await f.other.get(canonical)).toBeNull(); expect(await f.other.get(known)).toBeNull();
      if (old) expect((await f.other.inspect(old)).status).toBe("active");
    } finally { f.close(); }
  }
});

test("SYNTHETIC cache caps retain newest100 snapshots and newest200 aliases without evicting control authority", async () => {
  const f = await syntheticWorldD1();
  try {
    for (let i = 0; i < 100; i++) { const repo = `synthetic/world-${String(i).padStart(3, "0")}`, w = write(repo, 1000 + i); f.a.db.query("INSERT INTO worlds VALUES(?,?,?,?,?,?)").run(repo, w.snapshot, w.expiresAt, w.savedAt, await captureHash(w.snapshot), "migration:synthetic"); }
    for (let i = 0; i < 200; i++) f.a.db.query("INSERT INTO world_aliases VALUES(?,?)").run(`synthetic/alias-${i}`, "synthetic/world-099");
    await f.reseal(); const old = f.a.db.query("SELECT * FROM worlds WHERE repo='synthetic/world-099'").get(), g = await f.core.begin(input); await f.other.commit(g, write(canonical, 3000));
    expect(f.a.db.query("SELECT count(*) AS n FROM worlds").get()).toEqual({ n: 100 }); expect(f.a.db.query("SELECT * FROM worlds WHERE repo='synthetic/world-000'").get()).toBeNull(); expect(f.a.db.query("SELECT * FROM worlds WHERE repo='synthetic/world-099'").get()).toEqual(old);
    expect(f.a.db.query("SELECT count(*) AS n FROM world_aliases").get()).toEqual({ n: 200 }); expect(f.a.db.query("SELECT * FROM world_aliases WHERE alias='synthetic/alias-0'").get()).toBeNull(); expect((await f.core.inspect(g)).status).toBe("committed"); expect((await f.core.get(input))?.snapshot).toBe(write(canonical, 3000).snapshot);
  } finally { f.close(); }
});

test("SYNTHETIC malformed/oversized snapshots and rollback of ignored snapshot bytes never leak payload or claim success", async () => {
  const f = await syntheticWorldD1();
  try {
    const g = await f.core.begin(input), before = f.dump();
    for (const bad of [{ ...write(), snapshot: "PRIVATE_CANARY_NOT_JSON" }, { ...write(), snapshot: write(canonical, 1000, "x".repeat(512 * 1024)).snapshot }, { ...write(), savedAt: -1 }, { ...write(), expiresAt: 1 }, { ...write(), snapshot: write().snapshot.replace('"github"', '"fixture"') }]) {
      const error = await caught(f.core.commit(g, bad)); expect(error).toMatchObject({ writeOutcome: "not-started" }); expect(String(error)).not.toContain("PRIVATE_CANARY"); expect(f.dump()).toBe(before);
    }
    await f.core.commit(g, write()); f.a.db.query("UPDATE worlds SET snapshot=replace(snapshot,'SYNTHETIC','sYNTHETIC') WHERE repo=?").run(canonical);
    // Same-length wrong raw bytes retain the manifest. An ignored UPSERT must
    // fail the final in-transaction raw-byte guard even with equal manifests.
    const next = await f.core.begin(input), badDump = f.dump(); f.a.db.exec("CREATE TRIGGER synthetic_ignore BEFORE INSERT ON worlds BEGIN SELECT RAISE(IGNORE); END");
    expect(await caught(f.core.commit(next, write()))).toMatchObject({ writeOutcome: "unknown" }); expect(f.dump()).toBe(badDump);
  } finally { f.close(); }
});
