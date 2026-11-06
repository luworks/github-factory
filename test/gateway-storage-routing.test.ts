import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import gateway, { type GatewayEnvironment } from "../deploy/gateway";
import { WORLD_SCHEMA4_MIGRATIONS } from "../deploy/storage-schema4";
import type { HistoryD1Binding } from "../deploy/history-storage";
import { syntheticWorldD1 } from "./fixtures/world-public-d1";

const secret = "SYNTHETIC-server-storage-credential-at-least-32";
const keyHex = "29".repeat(32); // matches the fixture's HMAC key bytes (41)
const fakeFetch = (fn: () => Promise<Response>): typeof fetch => Object.assign(fn, { preconnect: fetch.preconnect });

async function fixture(patch: Partial<GatewayEnvironment> = {}) {
  const f = await syntheticWorldD1();
  f.a.db.exec(readFileSync(new URL("../deploy/d1/0003-history.sql", import.meta.url), "utf8"));
  for (const b of [f.a, f.b]) b.db.exec("PRAGMA foreign_keys=ON");
  for (const [version, hash] of WORLD_SCHEMA4_MIGRATIONS) f.a.db.query("INSERT INTO schema_migrations VALUES(?,?,?)").run(version, "2026-11-05T00:00:00Z", hash);
  let queries = 0;
  const binding = { prepare(sql: string) { queries++; return f.a.prepare(sql); }, batch(s: unknown[]) { return f.a.batch(s as never); }, withSession() { return this; } } as unknown as HistoryD1Binding;
  const env = {
    FACTORY_ORIGIN: "https://factory-origin.example", FACTORY_GATEWAY_SECRET: "synthetic-gateway-key-32-characters-long",
    WORLDS_DB: binding, FACTORY_STORAGE_SECRET: secret, FACTORY_STORAGE_MODE: "worlds", FACTORY_ADMISSION_FENCE: "",
    FACTORY_STORAGE_DATABASE_ID: f.identity.databaseId, FACTORY_STORAGE_BINDING_NONCE: f.identity.bindingNonce, FACTORY_MIGRATION_EPOCH: f.identity.epoch,
    FACTORY_WORLD_CAPTURE_SCHEMA_VERSION: "4", FACTORY_WORLD_CAPTURE_KEY_HEX: keyHex, ...patch,
  } as GatewayEnvironment;
  const call = (path: string, body: unknown = { op: "status" }) => gateway.fetch(new Request(`https://chaorders.com${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-factory-storage-key": secret }, body: JSON.stringify(body),
  }), env);
  return { f, env, call, queries: () => queries };
}
const noOrigin = () => spyOn(globalThis, "fetch").mockImplementation(fakeFetch(async () => { throw new Error("storage must never reach origin"); }));

test("SYNTHETIC schema4 profile routes /_storage to the world capture RPC with Worker-pinned identity", async () => {
  const mock = noOrigin(); const { f, call } = await fixture();
  try {
    const response = await call("/github-factory/_storage");
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, backend: "d1", op: "status", schemaVersion: 4, protocol: 1, identity: f.identity });
    expect(mock).not.toHaveBeenCalled();
  } finally { mock.mockRestore(); f.close(); }
});

test("SYNTHETIC schema4 profile fails closed on wrong key/version and never falls back to legacy storage", async () => {
  const mock = noOrigin();
  try {
    for (const patch of [{ FACTORY_WORLD_CAPTURE_KEY_HEX: "" }, { FACTORY_WORLD_CAPTURE_KEY_HEX: "29".repeat(31) }, { FACTORY_WORLD_CAPTURE_KEY_HEX: "AB".repeat(32) }, { FACTORY_WORLD_CAPTURE_SCHEMA_VERSION: "3" }, { FACTORY_WORLD_CAPTURE_SCHEMA_VERSION: "true" }]) {
      const { f, call, queries } = await fixture(patch);
      try {
        const response = await call("/github-factory/_storage", { op: "migrationSnapshot" });
        expect(response.status).toBe(503);
        expect((await response.json() as any).code).toBe("WORLD_STORAGE_UNAVAILABLE");
        expect(queries()).toBe(0);
      } finally { f.close(); }
    }
    // A different but well-formed key is rejected by the stored authority tag, not by the gateway.
    const { f, call } = await fixture({ FACTORY_WORLD_CAPTURE_KEY_HEX: "2a".repeat(32) });
    try { const r = await call("/github-factory/_storage"); expect(r.status).toBe(503); expect((await r.json() as any).ok).toBe(false); }
    finally { f.close(); }
    expect(mock).not.toHaveBeenCalled();
  } finally { mock.mockRestore(); }
});

test("SYNTHETIC unset capture profile keeps the legacy storage RPC unchanged", async () => {
  const mock = noOrigin();
  try {
    for (const version of [undefined, ""]) {
      const { f, call } = await fixture({ FACTORY_WORLD_CAPTURE_SCHEMA_VERSION: version, FACTORY_STORAGE_MODE: "worlds" });
      try {
        // Legacy RPC replies with its own {error} shape (no code/backend), proving dispatch reached it.
        const response = await call("/github-factory/_storage");
        expect(response.status).toBe(503);
        const legacy = await response.json() as any; expect(legacy.error).toBeString(); expect(legacy.code).toBeUndefined(); expect(legacy.backend).toBeUndefined();
      } finally { f.close(); }
    }
    expect(mock).not.toHaveBeenCalled();
  } finally { mock.mockRestore(); }
});

test("SYNTHETIC history RPC mounts only when explicitly enabled; other storage subpaths are edge 404", async () => {
  const mock = noOrigin();
  try {
    for (const enabled of [undefined, "", "1", "TRUE"]) {
      const { f, call, queries } = await fixture({ FACTORY_HISTORY_RPC_ENABLED: enabled });
      try { expect((await call("/github-factory/_storage/history")).status).toBe(404); expect(queries()).toBe(0); } finally { f.close(); }
    }
    const { f, env, call } = await fixture({ FACTORY_HISTORY_RPC_ENABLED: "true" });
    try {
      const wrongKey = await gateway.fetch(new Request("https://chaorders.com/github-factory/_storage/history", { method: "POST", headers: { "content-type": "application/json", "x-factory-storage-key": "wrong".repeat(8) }, body: "{}" }), env);
      expect(wrongKey.status).toBe(403);
      expect((await wrongKey.json() as any).code).toBe("HISTORY_STORAGE_AUTH_REQUIRED");
      // Mounted: authenticated request reaches the history dispatcher (identity pins absent → its own 503).
      const mounted = await call("/github-factory/_storage/history");
      expect(mounted.status).toBe(503);
      expect((await mounted.json() as any).code).toBe("HISTORY_STORAGE_IDENTITY_UNAVAILABLE");
      for (const path of ["/github-factory/_storage/", "/github-factory/_storage/history/", "/github-factory/_storage/x"]) expect((await call(path)).status).toBe(404);
    } finally { f.close(); }
    expect(mock).not.toHaveBeenCalled();
  } finally { mock.mockRestore(); }
});
