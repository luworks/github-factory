import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { D1HistoryStore, type HistoryD1Binding } from "../deploy/history-storage";
import { clientIdentity, ClientQuota } from "../src/server/access";
import { HistoryService } from "../src/server/history-service";
import { HistoryCursorCodec, type HistoryCursorClaim } from "../src/server/history-cursor";
import { createHistoryHttp, HISTORY_HTTP_RUNTIME_LIFECYCLE, type HistoryHttpContext, type HistoryHttpDependencies } from "../src/server/history-http";
import { syntheticWorld } from "./fixtures/browser-world";

// SYNTHETIC ONLY: fake gateway and signing keys, isolated new SQLite stores,
// in-memory original ClientQuota, raw fake GitHub fetch; no actual network/env.
const repo = "synthetic-moonshot/browser-fixture", sha = (n: number) => n.toString(16).padStart(40, "0");
const publicOrigin = "https://history.synthetic.invalid", gatewayKey = "SYNTHETIC-only-gateway-key-32-characters", path = `/company/github-factory/api/history/${repo}`;
const context: HistoryHttpContext = { repo, path, publicOrigin };
const headers = { "x-factory-gateway-key": gatewayKey, "x-factory-client-ip": "192.0.2.44" };
const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: extra });
const metadata = () => ({ private: false, visibility: "public", full_name: repo, license: { spdx_id: "NOASSERTION" } });
const commit = (n: number) => ({ sha: sha(n), tree: { sha: sha(n + 1000) }, parents: n > 1 ? [{ sha: sha(n - 1) }] : [], author: { date: "original clock" }, committer: { date: null }, message: `SYNTHETIC source ${n}` });
function request(method = "GET", body?: BodyInit, extras: Record<string, string> = {}, query = "", target = publicOrigin) {
  return new Request(`${target}${path}${query}`, { method, headers: { ...headers, ...(method === "POST" ? { origin: publicOrigin, "content-type": "application/json", "sec-fetch-site": "same-origin" } : {}), ...extras }, ...(body === undefined ? {} : { body, duplex: "half" } as RequestInit) });
}
function deferred() { let release!: () => void, enter!: () => void; const waiting = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; }); return { release, enter, waiting, gate }; }
async function fixture(options: { head?: number; requests?: number; bodyTimeoutMs?: number } = {}) {
  const db = new Database(":memory:"); db.exec(readFileSync(new URL("../deploy/d1/0003-history.sql", import.meta.url), "utf8"));
  const statement = (sql: string, values: unknown[] = []) => ({ bind(...v: unknown[]) { return statement(sql, v); }, async all<T>() { return { success: true, results: db.query(sql).all(...values as any[]) as T[] }; }, async first<T>() { return db.query(sql).get(...values as any[]) as T | null; }, execute() { db.query(sql).run(...values as any[]); return { success: true }; } });
  const binding: HistoryD1Binding = { prepare: sql => statement(sql), async batch(rows) { return db.transaction(() => rows.map(s => (s as ReturnType<typeof statement>).execute()))(); } };
  const store = new D1HistoryStore(binding), key = new HistoryCursorCodec(await crypto.subtle.importKey("raw", new Uint8Array(32).fill(19), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
  const originalQuota = new ClientQuota(":memory:", { requestsPerMinute: options.requests ?? 1000, collectionsPerHour: 100, aiPerHour: 0, aiGlobalPerHour: 0 }, () => Date.parse("2026-11-05T00:00:00Z"));
  let world: ReturnType<typeof syntheticWorld> | null = syntheticWorld(); world.source = "github"; world.headSha = sha(options.head ?? 8); world.coverage.tree = "full"; world.health.github = "ok";
  let holds = false, made = 0, requestCharges = 0, collections = 0, quotaTakes = 0, guards = 0, cacheReads = 0, revokes = 0, revokeFailure = false, runs = 0, finishes = 0;
  const calls: string[] = [], events: string[] = [], aliases = new Map([["synthetic-moonshot/old-name", repo]]), retained = new Set<Promise<unknown>>();
  let intercept: ((url: URL) => Response | undefined | Promise<Response | undefined>) | undefined;
  const rawQuota = { take() { quotaTakes++; events.push("quota"); } };
  const deps: HistoryHttpDependencies = {
    authenticate(req) { events.push("authenticate"); const identity = clientIdentity(req, { secret: gatewayKey, publicOrigin }); originalQuota.take(identity, "request"); requestCharges++; events.push("request-charge"); return { gatewayAuthenticated: true, requestAdmitted: true, identity, admitCollection: () => { originalQuota.take(identity, "collection"); collections++; events.push("collection"); } }; },
    makeService(admission) {
      made++; events.push("service");
      return new HistoryService({ store, cursor: key, now: () => Date.parse("2026-11-05T00:00:00Z"),
        cache: { get: async (input, _now, settings) => { cacheReads++; expect(input).toBe(repo); expect(settings).toEqual({ readOnly: true }); return world ? { world, fresh: false, expiresAt: 0 } : null; } },
        admitRequest: () => { guards++; admission.admitRequest(); }, admitCollection: admission.admitCollection,
        reader: { quota: rawQuota, wallNow: () => "2026-11-04T18:00:00Z", fetcher: async input => { const url = new URL(String(input)); if (url.origin !== "https://api.github.com") throw new Error("SYNTHETIC NETWORK BLOCKED"); calls.push(String(input)); events.push("fetch"); const r = await intercept?.(url); if (r) return r; if (url.pathname === `/repos/${repo}`) return json(metadata()); const c = url.pathname.match(/\/git\/commits\/([a-f0-9]{40})$/); if (c) return json(commit(parseInt(c[1]!, 16))); const t = url.pathname.match(/\/git\/trees\/([a-f0-9]{40})$/); if (t) return json({ sha: t[1], truncated: false, tree: [{ path: "src/原始.ts", type: "blob", mode: "100644", sha: sha(9000) }] }); throw new Error("SYNTHETIC UNKNOWN URL"); } },
      });
    },
    lifecycle: { held: () => holds, async run(work) { runs++; events.push("lifecycle-start"); try { return await work(p => { retained.add(p); p.then(() => retained.delete(p), () => retained.delete(p)); }); } finally { finishes++; events.push("lifecycle-work-finally"); } } },
    async revokePublicCapture(input) { expect(input).toBe(repo); revokes++; if (revokeFailure) throw new Error("SYNTHETIC privacy revoke failed"); world = null; aliases.clear(); },
    bodyTimeoutMs: options.bodyTimeoutMs,
  };
  return { db, store, key, deps, context, aliases, retained, events, calls, get world() { return world; }, set world(v) { world = v; }, hold: () => { holds = true; }, failRevoke: () => { revokeFailure = true; }, intercept(fn: typeof intercept) { intercept = fn; }, get requestCharges() { return requestCharges; }, get collections() { return collections; }, get quotaTakes() { return quotaTakes; }, get made() { return made; }, get guards() { return guards; }, get cacheReads() { return cacheReads; }, get revokes() { return revokes; }, get runs() { return runs; }, get finishes() { return finishes; }, handle: (req: Request, ctx = context) => createHistoryHttp(deps)(req, ctx), dump: () => JSON.stringify(["history_repositories", "history_commits", "history_anchors", "history_frames", "history_frame_chunks", "history_batches"].map(t => db.query(`SELECT * FROM ${t} ORDER BY rowid`).all())), close: () => { db.close(); originalQuota.close(); } };
}

test("SYNTHETIC real Request->HTTP->service->reader->store GET/walk/GET/resume/frames roundtrip with original once-only admission", async () => {
  const f = await fixture();
  try {
    const before = f.dump(), firstResponse = await f.handle(request()), first = await firstResponse.json();
    expect(firstResponse.status).toBe(200); expect(first.history.status).toBe("missing-anchor"); expect(f.dump()).toBe(before); expect(f.calls).toHaveLength(0); expect(f.collections).toBe(0);
    const one = await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token }))), saved = await one.json();
    expect(one.status).toBe(200); expect(saved.persisted).toMatchObject({ commits: 4, batches: 1 }); expect(saved.observed.persistence).toBe("not-persisted");
    const checkpoint = f.dump(), calls = f.calls.length, read = await (await f.handle(request())).json(); expect(f.dump()).toBe(checkpoint); expect(f.calls).toHaveLength(calls);
    const resumed = await (await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: read.token })))).json(); expect(resumed.persisted.cursor.reachedRoot).toBe(true);
    const frames = await (await f.handle(request("POST", JSON.stringify({ action: "frames", cursor: resumed.token, members: [sha(8), sha(1)] })))).json(); expect(frames.persisted).toMatchObject({ commits: 0, frames: 2 });
    const frameReads = await (await f.handle(request("GET", undefined, {}, `?cursor=${frames.token}&offset=0&member=${sha(1)}&member=${sha(8)}`))).json(); expect(frameReads.frames.map((v: any) => v.status)).toEqual(["available", "available"]);
    expect(f.requestCharges).toBe(6); expect(f.guards).toBe(6); expect(f.collections).toBe(3); expect(f.quotaTakes).toBe(13); expect(f.calls).toHaveLength(13); expect(f.made).toBe(6); expect(f.runs).toBe(3); expect(f.finishes).toBe(3); expect(f.revokes).toBe(0);
    expect(f.events.slice(0, 3)).toEqual(["authenticate", "request-charge", "service"]);
    for (const name of ["cache-control", "x-content-type-options"]) expect(firstResponse.headers.get(name)).toBe(name === "cache-control" ? "no-store" : "nosniff");
    expect(HISTORY_HTTP_RUNTIME_LIFECYCLE).toBe("NOT_WIRED");
  } finally { f.close(); }
});

test("SYNTHETIC gateway/IP authentication precedes body/query/service; no forwarded-header or localhost downgrade; original zero allowance blocks", async () => {
  const f = await fixture();
  try {
    for (const extras of [{ "x-factory-gateway-key": "wrong", "cf-connecting-ip": "192.0.2.44", "x-forwarded-for": "192.0.2.44" }, { "x-factory-gateway-key": "", "x-factory-client-ip": "192.0.2.44" }, { "x-factory-client-ip": "not an IP" }] as Record<string, string>[]) {
      let reads = 0; const stream = new ReadableStream({ pull() { reads++; return new Promise(() => {}); } });
      const r = await f.handle(request("POST", stream, extras, "?sql=secret", "http://127.0.0.1:4199")); expect(r.status).toBe(403); expect(f.made).toBe(0); expect(f.cacheReads).toBe(0); expect(f.requestCharges).toBe(0); expect(reads).toBeLessThanOrEqual(1);
    }
    const a = clientIdentity(request(), { secret: gatewayKey, publicOrigin }), b = clientIdentity(request("GET", undefined, { "x-factory-client-ip": "::ffff:192.0.2.44" }), { secret: gatewayKey, publicOrigin }); expect(a).toBe(b); expect(a).toMatch(/^[a-f0-9]{64}$/); expect(a).not.toContain("192.0.2.44");
  } finally { f.close(); }
  const denied = await fixture({ requests: 0 });
  try { const r = await denied.handle(request()); expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBe("60"); expect(denied.made).toBe(0); expect(denied.calls).toHaveLength(0); }
  finally { denied.close(); }
});

test("SYNTHETIC strict query, canonical context, methods and unavailable configuration charge request once without constructing a service", async () => {
  const f = await fixture();
  try {
    const queries = ["?cursor=a.b&cursor=c.d", "?offset=0&offset=1", "?offset=01", "?offset=-1", "?offset=501", "?offset=1e2", "?member=main", `?member=${sha(1)}&member=${sha(1)}`, `?member=${sha(1)}&member=${sha(2)}&member=${sha(3)}`, "?sql=SELECT", "?action=walk", "?cursor=%FF", "?%ZZ=x", "?offset=0&&", "#fragment"];
    for (const q of queries) expect((await f.handle(request("GET", undefined, {}, q))).status).toBe(400);
    expect((await f.handle(request(), { ...context, repo: "../escape" })).status).toBe(400);
    const method = await f.handle(request("DELETE")); expect(method.status).toBe(405); expect(method.headers.get("allow")).toBe("GET, POST");
    expect(f.requestCharges).toBe(queries.length + 2); expect(f.made).toBe(0); expect(f.calls).toHaveLength(0);
    f.deps.makeService = undefined; const unavailable = await f.handle(request()); expect(unavailable.status).toBe(503); expect((await unavailable.json()).code).toBe("HISTORY_HTTP_UNAVAILABLE");
    expect((await f.handle(request(), { ...context, publicOrigin: "" })).status).toBe(503); expect(f.made).toBe(0);
  } finally { f.close(); }
});

test("SYNTHETIC strict JSON/CSRF rejects overrides, duplicate keys and invalid types before service construction", async () => {
  const f = await fixture();
  try {
    const token = (await (await f.handle(request())).json()).token, made = f.made;
    for (const field of ["repo", "head", "headSha", "anchor", "anchorSha", "treeSha", "ref", "url", "sql", "prompt", "code", "provider", "model", "budget", "limits"]) expect((await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: token, [field]: "untrusted" })))).status).toBe(400);
    for (const text of ["{}", "[]", "null", "not-json", '{"action":"walk","action":"frames","cursor":"a.b"}', '{"action":"walk","\\u0061ction":"walk","cursor":"a.b"}', JSON.stringify({ action: "frames", cursor: token, members: [] }), JSON.stringify({ action: "walk", cursor: token, members: [] })]) expect((await f.handle(request("POST", text))).status).toBe(400);
    for (const extras of [{ origin: "https://evil.invalid" }, { origin: "" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) expect((await f.handle(request("POST", "{}", extras))).status).toBe(403);
    expect((await f.handle(request("POST", "{}", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await f.handle(request("POST", "{}", {}, "?action=walk"))).status).toBe(400);
    expect(f.made).toBe(made); expect(f.collections).toBe(0); expect(f.calls).toHaveLength(0);
  } finally { f.close(); }
});

test("SYNTHETIC body actual-byte bound, fatal UTF8, lifetime timeout and nonblocking retained cancellation", async () => {
  const f = await fixture({ bodyTimeoutMs: 5 });
  try {
    expect((await f.handle(request("POST", "x".repeat(2049), { "content-length": "1" }))).status).toBe(413);
    expect((await f.handle(request("POST", "{}", { "content-length": "2049" }))).status).toBe(413);
    expect((await f.handle(request("POST", new Uint8Array([123, 34, 255, 34, 58, 49, 125])))).status).toBe(400);
    let cancel = 0; const cleanup = deferred(), stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { cancel++; return cleanup.gate; } });
    const response = await f.handle(request("POST", stream)); expect(response.status).toBe(408); expect((await response.json()).code).toBe("HISTORY_BODY_TIMEOUT"); expect(cancel).toBe(1);
    expect(f.retained.size).toBeGreaterThan(0); expect(f.runs).toBe(f.finishes); expect(f.made).toBe(0); expect(f.calls).toHaveLength(0);
    // work-finally is not a physical-drain receipt: the injected retention still
    // owns cleanup after HTTP408. This is synthetic, not a real runtime counter.
    cleanup.release(); await Bun.sleep(0); expect(f.retained.size).toBe(0);
  } finally { f.close(); }
});

test("SYNTHETIC HOLD permits cached GET and blocks POST before body/service; lifecycle is mandatory and cannot fabricate completed work", async () => {
  const f = await fixture();
  try {
    const first = await (await f.handle(request())).json(); f.hold(); const before = f.dump(), made = f.made;
    const held = await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token }))); expect(held.status).toBe(503); expect((await held.json()).code).toBe("STORAGE_MIGRATION_HOLD"); expect(f.made).toBe(made); expect(f.runs).toBe(0); expect(f.dump()).toBe(before); expect(f.calls).toHaveLength(0);
    expect((await f.handle(request())).status).toBe(200);
    f.deps.lifecycle = undefined; expect((await f.handle(request("POST", "{}"))).status).toBe(503);
    f.deps.lifecycle = { held: () => false, run: async () => ({} as any) }; const fake = await f.handle(request("POST", "{}")); expect(fake.status).toBe(503); expect((await fake.json()).code).toBe("HISTORY_LIFECYCLE_UNAVAILABLE"); expect(f.collections).toBe(0);
    f.deps.revokePublicCapture = undefined as any; const privacyMissing = await f.handle(request("POST", "{}")); expect(privacyMissing.status).toBe(503); expect((await privacyMissing.json()).code).toBe("HISTORY_PRIVACY_UNAVAILABLE");
    expect(f.requestCharges).toBe(6);
  } finally { f.close(); }
});

test("SYNTHETIC definitive private metadata revokes actual cached capture and alias mock, strips all source response, preserves immutable history", async () => {
  const f = await fixture({ head: 4 });
  try {
    const first = await (await f.handle(request())).json(), saved = await (await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token })))).json(), before = f.dump();
    f.intercept(url => url.pathname === `/repos/${repo}` ? json({ ...metadata(), private: true }) : undefined);
    const rejected = await f.handle(request("POST", JSON.stringify({ action: "frames", cursor: saved.token, members: [sha(4)] }))), text = await rejected.text();
    expect(rejected.status).toBe(403); expect(JSON.parse(text).code).toBe("PUBLIC_ONLY"); expect(text).not.toContain(repo); expect(text).not.toContain(sha(4)); expect(text).not.toContain("observed"); expect(f.revokes).toBe(1); expect(f.world).toBeNull(); expect(f.aliases.size).toBe(0); expect(f.dump()).toBe(before);
    const denied = await f.handle(request()); expect(denied.status).toBe(404); expect((await denied.json()).code).toBe("HISTORY_CACHE_MISSING"); expect(f.calls).toHaveLength(6);
  } finally { f.close(); }
});

test("SYNTHETIC generic403/429/NOASSERTION/storage unknown never revoke; privacy callback failure fails closed without claimed success", async () => {
  for (const variant of ["403", "429", "NOASSERTION", "storage", "revoke-failure"] as const) {
    const f = await fixture();
    try {
      const first = await (await f.handle(request())).json();
      if (variant === "403" || variant === "429") f.intercept(() => json({}, Number(variant), variant === "429" ? { "retry-after": "7" } : {}));
      if (variant === "storage") { const original = f.deps.makeService!; f.deps.makeService = async access => { const service = (await original(access))!; return { read: (...a) => service.read(...a), act: async () => { throw Object.assign(new Error("SYNTHETIC_SQL_SECRET"), { code: "history-storage-unavailable", status: 503 }); } }; }; }
      if (variant === "revoke-failure") { f.failRevoke(); f.intercept(() => json({ ...metadata(), private: true })); }
      const r = await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token }))), text = await r.text();
      if (variant === "NOASSERTION") expect(r.status).toBe(200);
      else if (variant === "revoke-failure") { expect(r.status).toBe(503); expect(JSON.parse(text).code).toBe("HISTORY_PRIVACY_UNAVAILABLE"); expect(text).not.toContain(repo); }
      else expect(r.status).toBe(variant === "403" ? 403 : variant === "429" ? 429 : 503);
      if (variant === "429") expect(r.headers.get("retry-after")).toBe("7");
      expect(f.revokes).toBe(variant === "revoke-failure" ? 1 : 0); expect(f.world).not.toBeNull(); expect(f.aliases.size).toBe(1); expect(text).not.toContain("SYNTHETIC_SQL_SECRET");
    } finally { f.close(); }
  }
});

test("SYNTHETIC partial accepted action keeps HTTP error status and exact old-anchor counts without stale token; no secret exception text", async () => {
  const f = await fixture({ head: 4 }), wait = deferred();
  try {
    const first = await (await f.handle(request())).json(), original = f.deps.makeService!, issue = f.key.issue.bind(f.key);
    f.key.issue = async (claim: HistoryCursorClaim) => { wait.enter(); await wait.gate; return issue(claim); };
    const pending = f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token }))); await wait.waiting;
    f.world = { ...f.world!, collectedAt: "2026-11-04T17:00:00Z" }; wait.release(); const result = await pending, payload = await result.json();
    expect(result.status).toBe(409); expect(payload).toMatchObject({ status: "partially-saved", token: null, persisted: { commits: 4, batches: 1 }, capture: first.capture, error: { code: "HISTORY_CAPTURE_CHANGED" } }); expect(payload.observed.persistence).toBe("not-persisted");
    f.deps.makeService = async access => { const service = (await original(access))!; return { read: async () => { throw Object.assign(new Error(`SQL:${gatewayKey}`), { code: "ARBITRARY_SECRET_CODE", status: 400, cause: { token: first.token } }); }, act: (...a) => service.act(...a) }; };
    const failed = await f.handle(request()), text = await failed.text(); expect(failed.status).toBe(503); expect(text).not.toContain(gatewayKey); expect(text).not.toContain(first.token); expect(text).not.toContain("ARBITRARY_SECRET_CODE"); expect(text).not.toContain("SQL:");
  } finally { wait.release(); f.close(); }
});

test("SYNTHETIC trusted public origin works through changed upstream Host and failures never reuse an expired admission guard", async () => {
  const f = await fixture({ head: 4 });
  try {
    let remembered: (() => void) | undefined; const make = f.deps.makeService!;
    f.deps.makeService = access => { remembered = access.admitRequest; return make(access); };
    const initial = await (await f.handle(request("GET", undefined, {}, "", "http://origin.synthetic.invalid"))).json(); expect(() => remembered!()).toThrow();
    const action = await f.handle(request("POST", JSON.stringify({ action: "walk", cursor: initial.token }), {}, "", "http://origin.synthetic.invalid")); expect(action.status).toBe(200); expect(f.requestCharges).toBe(2); expect(f.guards).toBe(2); expect(() => remembered!()).toThrow();
  } finally { f.close(); }
});

test("SYNTHETIC exact 2KiB body and original two-request budget permit GET+POST exactly once each", async () => {
  const f = await fixture({ head: 4, requests: 2 });
  try {
    const first = await (await f.handle(request())).json(), text = JSON.stringify({ action: "walk", cursor: first.token });
    const exact = text + " ".repeat(2048 - new TextEncoder().encode(text).length);
    expect(new TextEncoder().encode(exact).length).toBe(2048);
    const accepted = await f.handle(request("POST", exact, { "content-length": "1" })); expect(accepted.status).toBe(200);
    const denied = await f.handle(request()); expect(denied.status).toBe(429); expect(f.requestCharges).toBe(2); expect(f.guards).toBe(2); expect(f.collections).toBe(1); expect(f.calls).toHaveLength(5);
  } finally { f.close(); }
});

test("SYNTHETIC unconfigured gateway and unverified access contracts never construct a service, even for loopback", async () => {
  const f = await fixture();
  try {
    f.deps.authenticate = req => { clientIdentity(req, { secret: "", publicOrigin }); throw new Error("unreachable"); };
    const unconfigured = await f.handle(request("GET", undefined, {}, "", "http://127.0.0.1:4199")); expect(unconfigured.status).toBe(503); expect((await unconfigured.json()).code).toBe("GATEWAY_UNCONFIGURED");
    for (const invalid of [{ gatewayAuthenticated: false, requestAdmitted: true, identity: "a".repeat(64) }, { gatewayAuthenticated: true, requestAdmitted: false, identity: "a".repeat(64) }, { gatewayAuthenticated: true, requestAdmitted: true, identity: "192.0.2.44" }]) {
      f.deps.authenticate = () => ({ ...invalid, admitCollection() {} } as any);
      expect((await f.handle(request())).status).toBe(403);
    }
    expect(f.made).toBe(0); expect(f.cacheReads).toBe(0); expect(f.requestCharges).toBe(0);
  } finally { f.close(); }
});

test("SYNTHETIC safe status/RetryAfter bounds and malformed retention executor reject without leaking canaries", async () => {
  const f = await fixture();
  try {
    const original = f.deps.authenticate;
    for (const retryAfter of [0, -7, Infinity, 2.2, 100000]) {
      f.deps.authenticate = () => { throw Object.assign(new Error(`SQL:${gatewayKey}`), { code: "IP_RATE_LIMIT", status: 429, retryAfter }); };
      const r = await f.handle(request()); expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBe(retryAfter > 0 && Number.isFinite(retryAfter) ? String(Math.min(86400, Math.ceil(retryAfter))) : null); expect(await r.text()).not.toContain(gatewayKey);
    }
    f.deps.authenticate = original;
    f.deps.lifecycle = { held: () => false, run: work => work(() => { throw new Error(`CLEANUP:${gatewayKey}`); }) };
    const failed = await f.handle(request("POST", "{}")); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain(gatewayKey); expect(f.collections).toBe(0); expect(f.made).toBe(0);
  } finally { f.close(); }
});

test("SYNTHETIC privacy revocation settles inside the injected action lifecycle before its finally or HTTP response", async () => {
  const f = await fixture(), wait = deferred();
  try {
    const first = await (await f.handle(request())).json(), revoke = f.deps.revokePublicCapture;
    f.intercept(() => json({ ...metadata(), private: true }));
    f.deps.revokePublicCapture = async input => { wait.enter(); await wait.gate; await revoke(input); };
    const pending = f.handle(request("POST", JSON.stringify({ action: "walk", cursor: first.token }))); await wait.waiting;
    expect(f.runs).toBe(1); expect(f.finishes).toBe(0); expect(f.world).not.toBeNull(); expect(f.aliases.size).toBe(1);
    wait.release(); expect((await pending).status).toBe(403); expect(f.finishes).toBe(1); expect(f.world).toBeNull(); expect(f.aliases.size).toBe(0);
  } finally { wait.release(); f.close(); }
});
