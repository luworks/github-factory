import type { HistoryD1Binding } from "./history-storage";
import { D1PublicCaptureCore } from "./world-public-captures";
import { assertStorageSchema4 } from "./storage-schema4";
import { WORLD_CAPTURE_RPC_LIMITS as L, WORLD_CAPTURE_RPC_URL, WorldCaptureRpcInputError, parseWorldCaptureJson, parseWorldCaptureOperation, worldWireInteger } from "../src/server/world-capture-rpc-contract";
import { WorldCaptureError, captureBytes, captureCryptoKey, captureHash, captureIdentity, type WorldCaptureIdentity, type RemoteWorldGeneration } from "../src/server/world-public-capture-contract";
import { isRenderableWorld } from "../src/server/world-readiness";
import type { WorldSnapshot } from "../src/contracts";

export interface WorldCaptureRpcEnvironment {
  WORLDS_DB?: HistoryD1Binding; FACTORY_STORAGE_SECRET?: string; FACTORY_STORAGE_MODE?: string;
  FACTORY_STORAGE_DATABASE_ID?: string; FACTORY_STORAGE_BINDING_NONCE?: string;
  FACTORY_MIGRATION_EPOCH?: string; FACTORY_ADMISSION_FENCE?: string;
}
export interface WorldCaptureRpcOptions { identity: WorldCaptureIdentity; key: CryptoKey; bodyTimeoutMs?: number; timeoutMs?: number }
class Rejection extends Error { constructor(readonly code: string, readonly status: number) { super("Fixed world storage operation rejected."); } }
const reject = (code = "WORLD_RPC_INVALID_REQUEST", status = 400): never => { throw new Rejection(code, status); };
async function authenticated(actual: string, expected: unknown) {
  if (typeof expected !== "string" || actual.length < 32 || actual.length > 256 || expected.length < 32 || expected.length > 256 || captureBytes(actual) > 256 || captureBytes(expected) > 256) return false;
  const [a, b] = await Promise.all([captureHash(actual), captureHash(expected)]); let difference = 0; for (let i = 0; i < 64; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i); return difference === 0;
}
async function body(request: Request, duration: number) {
  const advertised = request.headers.get("content-length");
  if (advertised !== null && (!/^(0|[1-9][0-9]*)$/.test(advertised) || !worldWireInteger(Number(advertised), L.bodyBytes))) return reject("WORLD_RPC_BODY_TOO_LARGE", 413);
  const reader = request.body?.getReader(); if (!reader) return reject();
  let timer: ReturnType<typeof setTimeout> | undefined, size = 0;
  const deadline = performance.now() + duration, timeout = new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new Rejection("WORLD_RPC_BODY_TIMEOUT", 408)), duration); });
  try {
    const parts: Uint8Array[] = [];
    for (;;) { const part = await Promise.race([reader.read(), timeout]); if (performance.now() >= deadline) return reject("WORLD_RPC_BODY_TIMEOUT", 408); if (part.done) break; if (!(part.value instanceof Uint8Array)) return reject(); size += part.value.byteLength; if (size > L.bodyBytes) return reject("WORLD_RPC_BODY_TOO_LARGE", 413); parts.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const p of parts) { bytes.set(p, offset); offset += p.byteLength; }
    let value: unknown; try { value = parseWorldCaptureJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { return reject(); }
    if (performance.now() >= deadline) return reject("WORLD_RPC_BODY_TIMEOUT", 408); return value;
  } finally { clearTimeout(timer); try { void reader.cancel().catch(() => {}); } catch { /* no awaited hung cancellation */ } }
}
const newWork = new Set(["captureBegin", "put", "alias", "evict"]);
const coreCodes = new Set(["WORLD_CAPTURE_CONFLICT", "WORLD_CAPTURE_CAPACITY", "WORLD_CAPTURE_INVALID_REQUEST"]);
function reply(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }

/** Independently callable SERVER dispatcher. NOT mounted, registered or
 * imported by any Worker/gateway/runtime. No env/file/key lookup or defaults.
 * Logical identity is not physical binding/retirement proof. */
export async function worldCaptureRpc(request: Request, env: WorldCaptureRpcEnvironment, options: WorldCaptureRpcOptions): Promise<Response> {
  let dispatched = false, expired = false, timer: ReturnType<typeof setTimeout> | undefined, verified: { op: string; identity: WorldCaptureIdentity; schemaVersion: 4; protocol: 1 } | undefined;
  let core: D1PublicCaptureCore | undefined, generation: RemoteWorldGeneration | undefined;
  const duration = options?.timeoutMs ?? L.totalMs, bodyDuration = options?.bodyTimeoutMs ?? L.bodyMs;
  const end = performance.now() + (worldWireInteger(duration, L.totalMs) && duration > 0 ? duration : 0);
  const checkTime = () => { if (expired || performance.now() >= end) { expired = true; return reject("WORLD_RPC_TIMEOUT", 503); } };
  const fence = () => { if (!(env.FACTORY_ADMISSION_FENCE === "" || env.FACTORY_ADMISSION_FENCE === options.identity.epoch)) return reject("WORLD_STORAGE_IDENTITY_UNAVAILABLE", 503); return env.FACTORY_ADMISSION_FENCE !== ""; };
  async function execute() {
    if (!await authenticated(request.headers.get("x-factory-storage-key") ?? "", env.FACTORY_STORAGE_SECRET)) return reject("WORLD_STORAGE_AUTH_REQUIRED", 403);
    checkTime();
    if (!worldWireInteger(duration, L.totalMs) || duration < 1 || !worldWireInteger(bodyDuration, L.bodyMs) || bodyDuration < 1) return reject("WORLD_STORAGE_UNAVAILABLE", 503);
    if (env.FACTORY_STORAGE_MODE !== "worlds") return reject("WORLD_STORAGE_MODE_REJECTED", 503);
    if (request.url !== WORLD_CAPTURE_RPC_URL || request.method !== "POST" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "") || request.headers.has("content-encoding")) return reject();
    const identity = captureIdentity(options.identity), key = captureCryptoKey(options.key);
    if (env.FACTORY_STORAGE_DATABASE_ID !== identity.databaseId || env.FACTORY_STORAGE_BINDING_NONCE !== identity.bindingNonce || env.FACTORY_MIGRATION_EPOCH !== identity.epoch) return reject("WORLD_STORAGE_IDENTITY_UNAVAILABLE", 503);
    fence(); const op = parseWorldCaptureOperation(await body(request, Math.min(bodyDuration, Math.max(1, end - performance.now())))); checkTime();
    if (newWork.has(op.op) && fence()) return reject("STORAGE_MIGRATION_HOLD", 503);
    if (!env.WORLDS_DB) return reject("WORLD_STORAGE_UNAVAILABLE", 503);
    const source = env.WORLDS_DB.withSession?.("first-primary") ?? env.WORLDS_DB;
    const db: HistoryD1Binding = {
      prepare(sql) { checkTime(); return source.prepare(sql); },
      async batch(statements) {
        checkTime(); await assertStorageSchema4(db, identity); checkTime();
        if (newWork.has(op.op) && fence()) return reject("STORAGE_MIGRATION_HOLD", 503); fence();
        // This observes actual dispatch, never an exported exception class.
        dispatched = true; return source.batch(statements);
      },
    };
    await assertStorageSchema4(db, identity); checkTime(); core = new D1PublicCaptureCore(db, identity, key);
    const status = await core.status(); checkTime(); verified = { op: op.op, identity: status.identity, schemaVersion: 4, protocol: status.protocol };
    if ("generation" in op) generation = op.generation;
    let result: unknown;
    if (op.op === "status") result = { ...status, admissionFenced: fence(), retirementQuiet: "unknown" };
    else if (op.op === "getMany" || op.op === "summaries") {
      const rows: unknown[] = [];
      for (const key of op.keys) { checkTime(); const row = await core.get(key); if (row) { let w: WorldSnapshot; try { w = parseWorldCaptureJson(row.snapshot) as WorldSnapshot; } catch { return reject("WORLD_STORAGE_UNAVAILABLE", 503); } rows.push(op.op === "getMany" ? { key, ...row } : { key, repo: w.repo, collectedAt: w.collectedAt, expiresAt: row.expiresAt, ready: isRenderableWorld(w) }); } }
      if ((await core.status()).revision !== status.revision) return reject("WORLD_STORAGE_READ_CONFLICT", 503); result = rows;
    } else if (op.op === "captureBegin") result = await core.begin(op.repo, { explicitRevalidation: op.explicitRevalidation });
    else if (op.op === "captureAssert") result = await core.assert(op.generation);
    else if (op.op === "captureInspect") result = await core.inspect(op.generation);
    else if (op.op === "captureCommit") result = await core.commit(op.generation, op.write);
    else if (op.op === "captureRevoke") result = await core.revoke(op.generation, op.claim);
    else if (op.op === "put") { await core.putLegacy(op.write); result = { saved: true }; }
    else if (op.op === "alias") { await core.aliasLegacy(op.alias, op.canonical); result = { accepted: true }; }
    else if (op.op === "evict") { await core.evict(op.repo); result = { evicted: true }; }
    checkTime();
    const payload = { ok: true, backend: "d1", ...verified, result }; if (captureBytes(JSON.stringify(payload)) > L.responseBytes) return reject("WORLD_RPC_RESPONSE_TOO_LARGE", 503);
    return reply(payload);
  }
  const timeout = new Promise<never>((_, fail) => { timer = setTimeout(() => { expired = true; fail(new Rejection("WORLD_RPC_TIMEOUT", 503)); }, Math.max(1, Math.min(L.totalMs, duration || 1))); });
  try { return await Promise.race([execute(), timeout]); }
  catch (error) {
    if (dispatched) {
      let privacy: { barrier: string; cleanup: string } | undefined;
      // Narrow evidence comes from the ORIGINAL authenticated receipt/barrier
      // state, never arbitrary properties of a transport exception. Read only.
      if (!expired && verified?.op === "captureRevoke" && core && generation) { try { privacy = await Promise.race([core.privacyStatus(generation), timeout]); } catch { /* outcome remains unknown */ } }
      return reply({ ok: false, backend: "d1", ...verified, code: "WORLD_WRITE_OUTCOME_UNKNOWN", error: "World storage outcome is unknown. No automatic retry or rollback was claimed.", writeOutcome: "unknown", ...(privacy ? { privacy } : {}) }, 503);
    }
    const code = error instanceof Rejection ? error.code : error instanceof WorldCaptureRpcInputError ? "WORLD_RPC_INVALID_REQUEST" : core && error instanceof WorldCaptureError && coreCodes.has(error.code) ? error.code : "WORLD_STORAGE_UNAVAILABLE";
    const status = error instanceof Rejection ? error.status : code === "WORLD_RPC_INVALID_REQUEST" || code === "WORLD_CAPTURE_INVALID_REQUEST" ? 400 : code === "WORLD_CAPTURE_CONFLICT" ? 409 : 503;
    return reply({ ok: false, backend: "d1", ...verified, code, error: "The fixed world storage operation is unavailable or rejected.", writeOutcome: "not-started" }, status);
  } finally { clearTimeout(timer); }
}
