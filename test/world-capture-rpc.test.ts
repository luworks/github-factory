import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { worldCaptureRpc, type WorldCaptureRpcEnvironment, type WorldCaptureRpcOptions } from "../deploy/world-capture-rpc";
import { WORLD_SCHEMA4_MIGRATIONS, assertStorageSchema4, schema4SqlTokens } from "../deploy/storage-schema4";
import { WORLD_CAPTURE_RPC_URL as url, parseWorldCaptureJson } from "../src/server/world-capture-rpc-contract";
import { captureHash, signWorldPrivateObservation, type RemoteWorldGeneration } from "../src/server/world-public-capture-contract";
import { createCollectionObservation, GitHubClient, parseRepo, takePrivateRepositoryObservation } from "../src/server/github";
import type { HistoryD1Binding } from "../deploy/history-storage";
import { syntheticWorldD1 } from "./fixtures/world-public-d1";
import { syntheticWorld } from "./fixtures/browser-world";

const secret = "SYNTHETIC-server-storage-credential-at-least-32", canonical = "synthetic/canonical", input = "synthetic/unknown", known = "synthetic/former", unrelated = "synthetic/unrelated";
function write(repo = canonical, savedAt = 1000, pad = "") { const w = syntheticWorld(); w.source = "github"; w.repo = { ...w.repo, fullName: repo, owner: repo.split("/")[0]!, name: repo.split("/")[1]!, url: `https://github.com/${repo}`, description: `SYNTHETIC 原始 ${pad}` }; return { snapshot: JSON.stringify(w), savedAt, expiresAt: savedAt + 120000 }; }
async function fixture() {
  const f = await syntheticWorldD1(); f.a.db.exec(readFileSync(new URL("../deploy/d1/0003-history.sql", import.meta.url), "utf8"));
  for (const b of [f.a, f.b]) b.db.exec("PRAGMA foreign_keys=ON");
  for (const [version, hash] of WORLD_SCHEMA4_MIGRATIONS) f.a.db.query("INSERT INTO schema_migrations VALUES(?,?,?)").run(version, "2026-11-05T00:00:00Z", hash);
  let reads = 0;
  const binding: HistoryD1Binding = { prepare(sql) { reads++; return f.a.prepare(sql); }, batch(s) { return f.a.batch(s); }, withSession() { return this; } };
  const env: WorldCaptureRpcEnvironment = { WORLDS_DB: binding, FACTORY_STORAGE_SECRET: secret, FACTORY_STORAGE_MODE: "worlds", FACTORY_STORAGE_DATABASE_ID: f.identity.databaseId, FACTORY_STORAGE_BINDING_NONCE: f.identity.bindingNonce, FACTORY_MIGRATION_EPOCH: f.identity.epoch, FACTORY_ADMISSION_FENCE: "" };
  const options: WorldCaptureRpcOptions = { identity: f.identity, key: f.key };
  const request = (value: unknown, patch: RequestInit = {}, endpoint = url) => new Request(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-factory-storage-key": secret }, body: JSON.stringify(value), ...patch });
  const rpc = async (value: unknown, patch: RequestInit = {}, endpoint = url) => { const response = await worldCaptureRpc(request(value, patch, endpoint), env, options); return { status: response.status, body: await response.json() as any }; };
  const begin = async (repo = input) => { const r = await rpc({ op: "captureBegin", repo, explicitRevalidation: true }); expect(r.status).toBe(200); return r.body.result as RemoteWorldGeneration; };
  return { ...f, env, options, request, rpc, begin, reads: () => reads };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function seed(f: Fixture) { expect((await f.rpc({ op: "put", write: write() })).status).toBe(200); expect((await f.rpc({ op: "alias", alias: known, canonical })).status).toBe(200); expect((await f.rpc({ op: "put", write: write(unrelated) })).status).toBe(200); }
async function claim(f: Fixture, g: RemoteWorldGeneration) {
  const context = createCollectionObservation(g.repo, g); let error: unknown;
  const client = new GitHubClient("", async target => new URL(String(target)).pathname === `/repos/${g.repo}` && g.repo !== canonical ? new Response(null, { status: 301, headers: { location: `https://api.github.com/repos/${canonical}` } }) : Response.json({ private: true, visibility: "private", full_name: canonical, id: 123 }));
  try { await client.collect(parseRepo(g.repo), context); } catch (e) { error = e; }
  const proof = takePrivateRepositoryObservation(error, context, g.repo, g); if (!proof) throw Error("SYNTHETIC proof missing"); return signWorldPrivateObservation(g, proof, f.identity, f.key);
}

test("SYNTHETIC RPC authentication precedes ANY body access/SQL; exact URL/method/headers and fixed inputs reject", async () => {
  const f = await fixture();
  try {
    const request = { headers: new Headers({ "x-factory-storage-key": "wrong" }), get body() { throw Error("BODY MUST NOT READ"); } } as unknown as Request;
    expect((await worldCaptureRpc(request, f.env, f.options)).status).toBe(403); expect(f.reads()).toBe(0);
    for (const endpoint of [url + "/", url + "?op=status", url.replace("https:", "http:"), url + "/history", "https://evil.invalid/github-factory/_storage"]) expect((await f.rpc({ op: "status" }, {}, endpoint)).status).toBe(400);
    for (const patch of [{ method: "PUT" }, { headers: { "content-type": "text/plain", "x-factory-storage-key": secret } }, { headers: { "content-type": "application/json", "content-encoding": "gzip", "x-factory-storage-key": secret } }] as RequestInit[]) expect((await f.rpc({ op: "status" }, patch)).status).toBe(400);
    for (const value of [{ op: "status", sql: "DELETE" }, { op: "status", identity: f.identity }, { op: "prompt", prompt: "code" }, { op: "getMany", keys: [canonical, canonical] }, { op: "getMany", keys: ["https://github.com/a/b"] }, { op: "captureBegin", repo: input, explicitRevalidation: "true" }, { op: "getMany", keys: Array(33).fill(canonical) }, { op: "put", write: { ...write(), savedAt: Number.MAX_SAFE_INTEGER + 1 } }]) expect((await f.rpc(value)).status).toBe(400);
    expect(f.a.calls).toHaveLength(0);
  } finally { f.close(); }
});

test("SYNTHETIC invalid UTF8, BOM, duplicate/escaped keys/nonfinite values and streamed/advised byte caps reject", async () => {
  const f = await fixture();
  try {
    for (const raw of ['{"op":"status","op":"put"}', '{"op":"status","\\u006fp":"put"}', '{"op":"status","counter":1e999}', '\ufeff{"op":"status"}', new Uint8Array([123, 34, 0xff, 34, 125])]) expect((await f.rpc(null, { body: raw })).status).toBe(400);
    for (const body of ["x".repeat(2 * 1024 * 1024 + 1), new Uint8Array(2 * 1024 * 1024 + 1)]) expect((await f.rpc(null, { body, headers: { "content-type": "application/json", "x-factory-storage-key": secret, "content-length": "1" } })).status).toBe(413);
    expect((await f.rpc(null, { headers: { "content-type": "application/json", "x-factory-storage-key": secret, "content-length": "9007199254740993" } })).status).toBe(413);
    expect(() => parseWorldCaptureJson('{"x":1,"x":2}')).toThrow(); expect(f.reads()).toBe(0); expect(f.a.calls).toHaveLength(0);
  } finally { f.close(); }
});

test("SYNTHETIC hung/partial streams and total SQL wall deadline terminate safely with no later write dispatch", async () => {
  const f = await fixture();
  try {
    f.options.bodyTimeoutMs = 15;
    for (const partial of [false, true]) {
      const stream = new ReadableStream<Uint8Array>({ start(c) { if (partial) c.enqueue(new TextEncoder().encode('{"op":')); }, cancel() { return new Promise(() => {}); } });
      const start = performance.now(), response = await worldCaptureRpc(f.request(null, { body: stream, duplex: "half" } as RequestInit), f.env, f.options);
      expect(response.status).toBe(408); expect(performance.now() - start).toBeLessThan(500);
    }
    expect(f.reads()).toBe(0);
    let release!: () => void; const wait = new Promise<void>(r => release = r), source = f.env.WORLDS_DB!;
    f.env.WORLDS_DB = { prepare(sql) { const s = source.prepare(sql); return { bind(...v) { s.bind(...v); return this; }, first: () => s.first(), async all<T>() { await wait; return s.all<T>(); } }; }, batch(s) { return source.batch(s); } };
    f.options.timeoutMs = 20; const result = await f.rpc({ op: "captureBegin", repo: input, explicitRevalidation: true }); expect(result.body.writeOutcome).toBe("not-started"); expect(result.status).toBe(503); release(); await Bun.sleep(30); expect(f.a.calls).toHaveLength(0);
  } finally { f.close(); }
});

test("SYNTHETIC complete schema4 markers/table/constraints/index/literals/history/identity/foreign-key checks fail before business writes", async () => {
  const mutations = ["DELETE FROM schema_migrations WHERE version=1", "UPDATE schema_migrations SET sql_sha256='" + "f".repeat(64) + "' WHERE version=3", "INSERT INTO schema_migrations VALUES(5,'2026-11-05','" + "a".repeat(64) + "')", "DROP TABLE history_frames", "ALTER TABLE worlds RENAME COLUMN snapshot TO snapshotTEXTNOTNULL", "CREATE INDEX unreviewed_worlds_index ON worlds(saved_at)", "CREATE TRIGGER unreviewed_guard BEFORE INSERT ON world_capture_guard BEGIN SELECT RAISE(IGNORE); END", "PRAGMA foreign_keys=OFF", "UPDATE storage_identity SET binding_nonce='" + "e".repeat(32) + "'", "DROP TABLE world_capture_authority"];
  for (const mutation of mutations) { const f = await fixture(); try { f.a.db.exec(mutation); const before = f.a.db.serialize(); const response = await f.rpc({ op: "captureBegin", repo: input, explicitRevalidation: true }); expect(response.status).toBe(503); expect(response.body.writeOutcome).toBe("not-started"); expect(f.a.calls).toHaveLength(0); expect(f.a.db.serialize()).toEqual(before); } finally { f.close(); } }
  expect(schema4SqlTokens("CHECK(v='a-- b')")).not.toBe(schema4SqlTokens("CHECK(v='a--b')")); expect(schema4SqlTokens("CHECK(v='active')")).not.toBe(schema4SqlTokens("CHECK(v='ACTIVE')")); expect(schema4SqlTokens("CREATE /* ignored */ TABLE t ( v TEXT )")).toBe(schema4SqlTokens("create table t(v text)"));
  const f = await fixture(); try { await assertStorageSchema4(f.a, f.identity); for (const [version, hash] of WORLD_SCHEMA4_MIGRATIONS) expect(await captureHash(readFileSync(new URL(`../deploy/d1/${["0001-world-cache.sql", "0002-migration-identity.sql", "0003-history.sql", "0004-world-public-captures.sql"][version - 1]}`, import.meta.url), "utf8"))).toBe(hash); } finally { f.close(); }
});

test("SYNTHETIC mode/key/identity/malformed fence reject; valid fence blocks new work but admits authenticated completion and private settle", async () => {
  for (const patch of [{ FACTORY_STORAGE_MODE: "probe-only" }, { FACTORY_ADMISSION_FENCE: "true" }, { FACTORY_ADMISSION_FENCE: 1 }, { FACTORY_ADMISSION_FENCE: "f".repeat(32) }, { FACTORY_STORAGE_DATABASE_ID: "wrong" }]) { const f = await fixture(); try { Object.assign(f.env, patch); expect((await f.rpc({ op: "status" })).status).toBe(503); expect(f.a.calls).toHaveLength(0); } finally { f.close(); } }
  const f = await fixture();
  try {
    await seed(f); const g = await f.begin(), privateGeneration = await f.begin(canonical); f.env.FACTORY_ADMISSION_FENCE = f.identity.epoch; const before = f.dump();
    for (const op of [{ op: "captureBegin", repo: input, explicitRevalidation: true }, { op: "put", write: write() }, { op: "alias", alias: input, canonical }, { op: "evict", repo: canonical }]) { const r = await f.rpc(op); expect(r.body.code).toBe("STORAGE_MIGRATION_HOLD"); expect(r.body.writeOutcome).toBe("not-started"); }
    expect(f.dump()).toBe(before); expect((await f.rpc({ op: "captureAssert", generation: g })).status).toBe(200); expect((await f.rpc({ op: "captureCommit", generation: g, write: write() })).status).toBe(200);
    const revoked = await f.rpc({ op: "captureRevoke", generation: privateGeneration }); expect(revoked.status).toBe(200); expect(revoked.body.result.barrier).toBe("confirmed");
    const status = await f.rpc({ op: "status" }); expect(status.body.identity).toEqual(f.identity); expect(status.body.schemaVersion).toBe(4); expect(status.body.protocol).toBe(1); expect(status.body.result.retirementQuiet).toBe("unknown"); expect((await f.rpc({ op: "captureInspect", generation: g })).body.result.status).toBe("committed");
  } finally { f.close(); }
});

test("SYNTHETIC wrapper->core raw reads/summaries are bounded/non-mutating and denied/corrupt cache never deletes data", async () => {
  const f = await fixture();
  try {
    await seed(f); const before = f.dump(); const rows = await f.rpc({ op: "getMany", keys: [known, unrelated, "synthetic/missing"] }); expect(rows.status).toBe(200); expect(rows.body.result).toHaveLength(2); expect(rows.body.result[0].snapshot).toBe(write().snapshot); expect(rows.body.op).toBe("getMany");
    const summary = await f.rpc({ op: "summaries", keys: [known] }); expect(summary.body.result[0].key).toBe(known); expect(summary.body.result[0].repo.fullName).toBe(canonical); expect(f.dump()).toBe(before);
    const g = await f.begin(); expect((await f.rpc({ op: "captureRevoke", generation: g, claim: await claim(f, g) })).status).toBe(200); const denied = f.dump(); expect((await f.rpc({ op: "getMany", keys: [input, canonical, known] })).body.result).toEqual([]); expect((await f.rpc({ op: "summaries", keys: [canonical, known] })).body.result).toEqual([]); expect(f.dump()).toBe(denied);
    f.a.db.query("UPDATE worlds SET snapshot=replace(snapshot,'SYNTHETIC','sYNTHETIC') WHERE repo=?").run(unrelated); const corrupt = f.dump(); expect((await f.rpc({ op: "getMany", keys: [unrelated] })).status).toBe(503); expect(f.dump()).toBe(corrupt);
  } finally { f.close(); }
});

test("SYNTHETIC actual wrapper multi-read response cap fails honestly without dropping rows or mutating", async () => {
  const f = await fixture();
  try { for (let i = 0; i < 5; i++) await f.core.putLegacy(write(`synthetic/large-${i}`, 1000, "x".repeat(450000))); const before = f.dump(); const response = await f.rpc({ op: "getMany", keys: Array.from({ length: 5 }, (_, i) => `synthetic/large-${i}`) }); expect(response.status).toBe(503); expect(response.body.code).toBe("WORLD_RPC_RESPONSE_TOO_LARGE"); expect(response.body.result).toBeUndefined(); expect(f.dump()).toBe(before); } finally { f.close(); }
});

test("SYNTHETIC actual RPC cross-instance generation one-use, tampering, signed canonical privacy group and cleanup uncertainty", async () => {
  const f = await fixture();
  try {
    await seed(f); const g = await f.begin(), proof = await claim(f, g), before = f.dump();
    expect((await f.rpc({ op: "captureCommit", generation: { ...g, repo: unrelated }, write: write() })).status).toBe(409); expect(f.dump()).toBe(before);
    const first = f.a.calls.length; f.a.interrupt = { batch: first + 1, statement: 1 }; const result = await f.rpc({ op: "captureRevoke", generation: JSON.parse(JSON.stringify(g)), claim: proof });
    expect(result.status).toBe(503); expect(result.body.writeOutcome).toBe("unknown"); expect(result.body.privacy).toEqual({ barrier: "confirmed", cleanup: "unconfirmed" });
    for (const key of [input, canonical, known]) expect(await f.restart().get(key)).toBeNull(); const pending = f.dump(); expect((await f.rpc({ op: "captureRevoke", generation: g, claim: proof })).status).toBe(503); expect(f.dump()).toBe(pending); expect((await f.rpc({ op: "captureInspect", generation: g })).body.result.status).toBe("deny-pending");
    const fresh = await f.begin(); expect((await f.rpc({ op: "captureCommit", generation: fresh, write: write(canonical, 3000) })).status).toBe(200); expect((await f.rpc({ op: "captureCommit", generation: fresh, write: write(canonical, 3000) })).status).toBe(409); expect((await f.rpc({ op: "captureAssert", generation: g })).status).toBe(409); expect(await f.core.get(known)).toBeNull();
  } finally { f.close(); }
});

for (const kind of ["replacement", "rename", "missing", "eviction"] as const) test(`SYNTHETIC wrapper preserves ROOT alias requirement: ${kind}`, async () => {
  const f = await fixture();
  try {
    if (kind === "eviction") { for (let i = 0; i < 100; i++) await f.core.putLegacy(write(`synthetic/row-${String(i).padStart(3, "0")}`, 1000 + i)); await f.core.aliasLegacy(input, "synthetic/row-000"); expect((await f.rpc({ op: "put", write: write(canonical, 4000) })).status).toBe(200); expect(f.a.db.query("SELECT * FROM world_aliases WHERE alias=?").get(input)).toBeNull(); }
    else { await seed(f); if (kind === "replacement") { await f.core.aliasLegacy(input, canonical); const g = await f.begin(); expect((await f.rpc({ op: "captureCommit", generation: g, write: write(input) })).status).toBe(200); expect((await f.core.get(input))?.repo).toBe(input); expect((await f.core.get(known))?.repo).toBe(canonical); }
      else if (kind === "rename") { const g = await f.begin(canonical); expect((await f.rpc({ op: "captureCommit", generation: g, write: write(input) })).status).toBe(200); expect((await f.core.get(canonical))?.repo).toBe(input); expect(await f.core.get(known)).toBeNull(); }
      else { const before = f.dump(); expect((await f.rpc({ op: "alias", alias: canonical, canonical: "synthetic/missing" })).status).toBe(200); expect(f.dump()).toBe(before); }
    }
  } finally { f.close(); }
});

for (const kind of ["begin", "commit", "barrier", "cleanup", "put", "alias", "evict"] as const) test(`SYNTHETIC actual ${kind} batch failures/ACK ambiguity never trust typed errors or fabricate rollback`, async () => {
  for (const mode of ["interrupt", "lost", "false", "short", "typed", "fake-success"] as const) {
    const f = await fixture();
    try {
      await seed(f); const g = await f.begin(), proof = await claim(f, g), batch = f.a.calls.length + (kind === "cleanup" ? 1 : 0);
      if (mode === "interrupt") f.a.interrupt = { batch, statement: 0 };
      else if (mode === "lost") f.a.afterCommit = async n => { if (n === batch) throw Error("PRIVATE_EXCEPTION_CANARY " + secret); };
      else if (kind === "cleanup") { f.a.beforeBatch = async n => { if (n === batch) f.a.result = mode; }; } else f.a.result = mode;
      const op = kind === "begin" ? { op: "captureBegin", repo: "synthetic/second", explicitRevalidation: false } : kind === "commit" ? { op: "captureCommit", generation: g, write: write() } : kind === "barrier" || kind === "cleanup" ? { op: "captureRevoke", generation: g, claim: proof } : kind === "put" ? { op: "put", write: write(canonical, 3000) } : kind === "alias" ? { op: "alias", alias: input, canonical } : { op: "evict", repo: canonical };
      const response = await f.rpc(op); expect(response.status).toBe(503); expect(response.body.writeOutcome).toBe("unknown"); expect(response.body.code).toBe("WORLD_WRITE_OUTCOME_UNKNOWN"); expect(JSON.stringify(response.body)).not.toContain(secret); expect(JSON.stringify(response.body)).not.toContain("PRIVATE_EXCEPTION_CANARY");
      if (kind === "cleanup") { expect(response.body.privacy.barrier).toBe("confirmed"); for (const key of [input, canonical, known]) expect(await f.other.get(key)).toBeNull(); }
    } finally { f.close(); }
  }
});

test("SYNTHETIC fence is checked again at actual dispatch; schema corruption after preflight cannot admit a write", async () => {
  for (const action of ["fence", "malformed-fence", "schema"] as const) {
    const f = await fixture();
    try {
      const original = f.env.WORLDS_DB!, prepare = original.prepare.bind(original); let metadataReads = 0;
      original.prepare = sql => { if (sql.includes("AS view")) { metadataReads++; if (metadataReads === 2) { if (action === "schema") f.a.db.query("UPDATE schema_migrations SET sql_sha256=? WHERE version=2").run("f".repeat(64)); else f.env.FACTORY_ADMISSION_FENCE = action === "fence" ? f.identity.epoch : "true"; } } return prepare(sql); };
      const response = await f.rpc({ op: "captureBegin", repo: input, explicitRevalidation: true }); expect(response.status).toBe(503); expect(response.body.writeOutcome).toBe("not-started"); expect(f.a.calls).toHaveLength(0); expect(f.a.db.query("SELECT * FROM world_capture_generations").all()).toEqual([]);
    } finally { f.close(); }
  }
});

test("SYNTHETIC actual post-dispatch timeout remains UNKNOWN; late first commit cannot trigger a second cleanup write", async () => {
  const f = await fixture();
  try {
    await seed(f); const g = await f.begin(), proof = await claim(f, g), first = f.a.calls.length;
    let entered!: () => void, release!: () => void; const arrived = new Promise<void>(r => entered = r), wait = new Promise<void>(r => release = r);
    f.a.beforeBatch = async n => { if (n === first) { entered(); await wait; } }; f.options.timeoutMs = 200;
    const pending = f.rpc({ op: "captureRevoke", generation: g, claim: proof }); await Promise.race([arrived, pending.then(() => { throw Error("SYNTHETIC deadline must reach real batch dispatch"); })]); const response = await pending;
    expect(response.status).toBe(503); expect(response.body.writeOutcome).toBe("unknown"); release(); await Bun.sleep(80); expect(f.a.calls.length).toBe(first + 1); expect((await f.other.inspect(g)).status).toBe("deny-pending");
    for (const repo of [input, canonical, known]) expect(await f.other.get(repo)).toBeNull(); expect(f.a.db.query("SELECT repo FROM worlds WHERE repo=?").get(canonical)).not.toBeNull();
  } finally { f.close(); }
});

test("SYNTHETIC quoted-literal DDL alterations, missing key and mismatched authority cannot be certified", async () => {
  const f = await fixture();
  try {
    const sql = (f.a.db.query("SELECT sql FROM sqlite_master WHERE name='world_capture_generations'").get() as { sql: string }).sql;
    f.a.db.exec("DROP TABLE world_capture_generations"); f.a.db.exec(sql.replace("'active'", "'ACTIVE'"));
    expect((await f.rpc({ op: "status" })).status).toBe(503); expect(f.a.calls).toHaveLength(0);
  } finally { f.close(); }
  for (const mode of ["missing", "wrong-key", "epoch"] as const) {
    const f = await fixture();
    try {
      if (mode === "missing") f.options.key = undefined as unknown as CryptoKey;
      if (mode === "wrong-key") f.options.key = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(66), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
      if (mode === "epoch") { f.options.identity = { ...f.identity, epoch: "e".repeat(32) }; f.env.FACTORY_MIGRATION_EPOCH = "e".repeat(32); }
      expect((await f.rpc({ op: "status" })).status).toBe(503); expect(f.a.calls).toHaveLength(0);
    } finally { f.close(); }
  }
});
