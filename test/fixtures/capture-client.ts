import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worldCaptureRpc } from "../../deploy/world-capture-rpc";
import { WORLD_SCHEMA4_MIGRATIONS } from "../../deploy/storage-schema4";
import { D1CaptureWorldStore, type D1CaptureWorldConfig } from "../../src/server/d1-capture-world-store";
import { WORLD_CAPTURE_RPC_URL } from "../../src/server/world-capture-rpc-contract";
import type { Fetcher } from "../../src/server/github";
import { syntheticWorldD1 } from "./world-public-d1";
import { syntheticWorld } from "./browser-world";

export function captureWorld(repo = "Synthetic/MiXeD", head = "a".repeat(40)) {
  const original = syntheticWorld(); const w = JSON.parse(JSON.stringify(original).replaceAll(original.repo.url, `https://github.com/${repo}`).replaceAll(original.headSha, head)) as ReturnType<typeof syntheticWorld>;
  w.source = "github"; const [owner, name] = repo.split("/"); w.repo = { ...w.repo, owner: owner!, name: name!, fullName: repo, url: `https://github.com/${repo}`, description: "SYNTHETIC 原始CJK Meta source spelling" }; return w;
}
export async function captureClientFixture() {
  const f = await syntheticWorldD1(); f.a.db.exec(readFileSync(new URL("../../deploy/d1/0003-history.sql", import.meta.url), "utf8"));
  for (const b of [f.a, f.b]) b.db.exec("PRAGMA foreign_keys=ON");
  for (const [v, h] of WORLD_SCHEMA4_MIGRATIONS) f.a.db.query("INSERT INTO schema_migrations VALUES(?,?,?)").run(v, "2026-11-05T00:00:00Z", h);
  const config: D1CaptureWorldConfig = { endpoint: WORLD_CAPTURE_RPC_URL, secret: "SYNTHETIC-client-storage-credential-at-least-32", identity: { ...f.identity }, key: f.key };
  const env = { WORLDS_DB: f.a, FACTORY_STORAGE_SECRET: config.secret, FACTORY_STORAGE_MODE: "worlds", FACTORY_STORAGE_DATABASE_ID: f.identity.databaseId, FACTORY_STORAGE_BINDING_NONCE: f.identity.bindingNonce, FACTORY_MIGRATION_EPOCH: f.identity.epoch, FACTORY_ADMISSION_FENCE: "" };
  const calls: { op: string; body: any; init: RequestInit | undefined; url: string }[] = [];
  let transform: ((response: Response, operation: any) => Response | Promise<Response>) | undefined;
  const network: Fetcher = async (target, init) => {
    if (String(target) !== WORLD_CAPTURE_RPC_URL || init?.redirect !== "error") throw Error("SYNTHETIC fixed storage target only");
    const operation = JSON.parse(init?.body as string); calls.push({ op: operation.op, body: operation, init, url: String(target) });
    const response = await worldCaptureRpc(new Request(String(target), init), env, { identity: f.identity, key: f.key }); return transform ? transform(response, operation) : response;
  };
  const client = new D1CaptureWorldStore(config, network), directory = mkdtempSync(join(tmpdir(), "factory-client-quota-"));
  return { ...f, client, config, env, calls, network, directory, transform(value: typeof transform) { transform = value; }, close() { try { f.close(); } finally { rmSync(directory, { recursive: true, force: true }); } } };
}
