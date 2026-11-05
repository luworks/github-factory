import type { RepoIdentity, WorldSnapshot } from "../contracts";
import { worldShapeValid } from "../evidence/world-shape";
import { parseRepo, type Fetcher, type TrustedPrivateRepositoryObservation } from "./github";
import { WORLD_CAPTURE_RPC_LIMITS as L, WORLD_CAPTURE_RPC_URL, parseWorldCaptureJson, parseWorldCaptureOperation, type WorldCaptureRpcOperation } from "./world-capture-rpc-contract";
import { WORLD_CAPTURE_LIMITS, captureBytes, captureCryptoKey, captureHash, captureIdentity, captureKey, signWorldPrivateObservation, worldGenerationShape, type WorldCaptureIdentity, type RemoteWorldGeneration } from "./world-public-capture-contract";
import { WorldStorageError, type CachedWorld, type PublicCaptureAuthority, type PublicCaptureGeneration, type SnapshotStore, type WorldStorageStatus, type WorldSummary } from "./world-storage";

export interface D1CaptureWorldConfig { endpoint: string; secret: string; identity: WorldCaptureIdentity; key: CryptoKey }
export interface WorldPhysicalObservation { readonly idle: boolean; readonly settled: Promise<void> }
export class D1CaptureWorldStoreError extends WorldStorageError {
  constructor(readonly writeOutcome: "not-started" | "unknown" = "not-started", readonly barrier: "confirmed" | "unknown" | null = null, readonly cleanup: "confirmed" | "unconfirmed" | "not-started" | null = null) { super(); }
}
type Call = { finished: boolean; expired: boolean; pending: Set<Promise<unknown>>; start: number; last: number; dispatchedWrite: boolean; outcomeError?: D1CaptureWorldStoreError };
type Limits = { timeoutMs: number; responseBytes: number; requestBytes: number };
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const exact = (x: object, names: string[]) => Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x, k));
const integer = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= max;
const hash = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const invalid = (): never => { throw new Error("Invalid authoritative world storage operation or response."); };
const writes = new Set(["captureBegin", "captureCommit", "captureRevoke", "put", "alias", "evict"]);
const knownErrors = new Set(["WORLD_RPC_INVALID_REQUEST", "WORLD_RPC_BODY_TIMEOUT", "WORLD_RPC_BODY_TOO_LARGE", "WORLD_RPC_RESPONSE_TOO_LARGE", "WORLD_RPC_TIMEOUT", "WORLD_STORAGE_AUTH_REQUIRED", "WORLD_STORAGE_MODE_REJECTED", "WORLD_STORAGE_IDENTITY_UNAVAILABLE", "WORLD_STORAGE_UNAVAILABLE", "WORLD_STORAGE_READ_CONFLICT", "STORAGE_MIGRATION_HOLD", "WORLD_CAPTURE_INVALID_REQUEST", "WORLD_CAPTURE_CONFLICT", "WORLD_CAPTURE_CAPACITY", "WORLD_WRITE_OUTCOME_UNKNOWN"]);
const normalize = (v: string) => parseRepo(v).fullName.toLowerCase();
function repo(value: unknown): RepoIdentity {
  if (!object(value) || !exact(value, ["owner", "name", "fullName", "url", "description", "stars", "forks", "openIssues", "language", "defaultBranch", "pushedAt", "license", "homepage"]) || typeof value.fullName !== "string" || captureKey(value.fullName) !== value.fullName.toLowerCase() || value.fullName !== `${value.owner}/${value.name}` || value.url !== `https://github.com/${value.fullName}` || ["description", "defaultBranch", "pushedAt"].some(k => typeof value[k] !== "string") || ["stars", "forks", "openIssues"].some(k => !integer(value[k])) || ["language", "license", "homepage"].some(k => value[k] !== null && typeof value[k] !== "string")) return invalid();
  return value as RepoIdentity;
}
function world(raw: string, canonical: string): WorldSnapshot {
  if (typeof raw !== "string" || captureBytes(raw) > WORLD_CAPTURE_LIMITS.snapshotBytes) return invalid();
  const w = parseWorldCaptureJson(raw);
  if (!object(w) || w.source !== "github" || w.schemaVersion !== 1 || captureKey(repo(w.repo).fullName) !== canonical || typeof w.headSha !== "string" || !/^[a-f0-9]{40}$/i.test(w.headSha) || typeof w.collectedAt !== "string" || !Number.isFinite(Date.parse(w.collectedAt)) || !integer(w.refreshAfter) || !worldShapeValid(w)) return invalid();
  return w as WorldSnapshot;
}

/** Independent SERVER adapter, NOT selected by existing resources/runtime.
 * No env/default network/key, SQLite fallback, retries or quota/model calls.
 * Tokens/proofs stay server-only. Physical observation means LOCAL promises,
 * never remote cancellation/rollback or proof of retirement quiet. */
export class D1CaptureWorldStore implements SnapshotStore {
  #config!: D1CaptureWorldConfig; #network!: Fetcher; #clock!: () => number;
  #limits: Limits = { timeoutMs: L.totalMs, responseBytes: L.responseBytes, requestBytes: L.bodyBytes };
  #tokens = new WeakMap<PublicCaptureGeneration, RemoteWorldGeneration>();
  #issuedHandles = new Set<string>();
  #calls = new Set<Call>(); #waiters = new Set<() => void>();
  readonly publicCaptures!: PublicCaptureAuthority;
  constructor(config: D1CaptureWorldConfig, network: Fetcher, limits: Partial<{ timeoutMs: number; responseBytes: number; requestBytes: number }> = {}, clock = () => performance.now()) {
    try {
      if (!object(config) || !exact(config, ["endpoint", "secret", "identity", "key"]) || config.endpoint !== WORLD_CAPTURE_RPC_URL || typeof config.secret !== "string" || config.secret.length < 32 || captureBytes(config.secret) > 256 || typeof network !== "function" || typeof clock !== "function") return invalid();
      this.#config = { endpoint: config.endpoint, secret: config.secret, identity: captureIdentity(config.identity), key: captureCryptoKey(config.key) }; this.#network = network; this.#clock = clock;
      if (!object(limits)) return invalid(); for (const [k, v] of Object.entries(limits)) { if (!(k in this.#limits) || !integer(v, this.#limits[k as keyof Limits]) || v < 1) return invalid(); this.#limits[k as keyof Limits] = v; }
      this.publicCaptures = Object.freeze({ begin: (input, options) => this.#run(async c => { if (!object(options) || !exact(options, ["explicitRevalidation"])) return invalid(); const result = await this.#rpc(c, { op: "captureBegin", repo: normalize(input), explicitRevalidation: options.explicitRevalidation }); const token = Object.freeze(result as RemoteWorldGeneration); if (this.#issuedHandles.has(token.handle) || this.#issuedHandles.size >= WORLD_CAPTURE_LIMITS.generations) return invalid(); this.#issuedHandles.add(token.handle); this.#tokens.set(token, token); return token; }),
        assert: token => this.#run(async c => { await this.#rpc(c, { op: "captureAssert", generation: this.#owned(token) }); }),
        commit: (token, w, ttl = 90000, now = Date.now()) => this.#run(async c => { await this.#rpc(c, { op: "captureCommit", generation: this.#owned(token), write: this.#write(w, ttl, now) }); }),
        revoke: (input, token, proof) => this.#run(async c => { const generation = this.#owned(token); if (generation.repo !== normalize(input)) return invalid(); const claim = proof === undefined ? undefined : await signWorldPrivateObservation(generation, proof, this.#config.identity, this.#config.key); this.#check(c); const result = await this.#rpc(c, { op: "captureRevoke", generation, ...(claim ? { claim } : {}) }); return { barrier: result.barrier as "confirmed", cleanup: result.cleanup as "confirmed" }; }),
      } satisfies PublicCaptureAuthority);
    } catch { throw new D1CaptureWorldStoreError(); }
  }
  readonly observeSettlement = (): WorldPhysicalObservation => this.#calls.size ? { idle: false, settled: new Promise(resolve => this.#waiters.add(resolve)) } : { idle: true, settled: Promise.resolve() };
  #owned(token: PublicCaptureGeneration | undefined) { const stored = token && this.#tokens.get(token); if (!stored || stored !== token) return invalid(); return stored; }
  #check(c: Call) { const n = this.#clock(); if (c.expired || !Number.isFinite(n) || n < c.last || n - c.start >= this.#limits.timeoutMs) return invalid(); c.last = n; }
  #release(c: Call) { if (c.finished && !c.pending.size) { this.#calls.delete(c); if (!this.#calls.size) { const listeners = [...this.#waiters]; this.#waiters.clear(); listeners.forEach(resolve => resolve()); } } }
  async #run<T>(action: (c: Call) => Promise<T>): Promise<T> {
    let started: number; try { started = this.#clock(); if (!Number.isFinite(started)) return invalid(); } catch { throw new D1CaptureWorldStoreError(); }
    const c: Call = { finished: false, expired: false, pending: new Set(), start: started, last: started, dispatchedWrite: false }; this.#calls.add(c);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      this.#check(c); const execution = Promise.resolve().then(() => { this.#check(c); return action(c); });
      // The whole async operation (including local proof signing/validation)
      // stays observed after a response deadline, alongside transport promises.
      c.pending.add(execution); execution.then(() => { c.pending.delete(execution); this.#release(c); }, () => { c.pending.delete(execution); this.#release(c); });
      const timeout = new Promise<never>((_, fail) => { timer = setTimeout(() => { c.expired = true; fail(new Error("World operation deadline.")); }, this.#limits.timeoutMs); });
      return await Promise.race([execution, timeout]);
    }
    catch (e) { if (c.outcomeError && e === c.outcomeError) throw e; throw new D1CaptureWorldStoreError(c.dispatchedWrite ? "unknown" : "not-started"); }
    finally { clearTimeout(timer); c.finished = true; this.#release(c); }
  }
  #identity(value: unknown) { if (!object(value) || !exact(value, ["databaseId", "bindingNonce", "epoch"]) || Object.entries(this.#config.identity).some(([k, v]) => value[k] !== v)) return invalid(); }
  async #result(op: WorldCaptureRpcOperation, value: unknown, c: Call): Promise<any> {
    this.#check(c);
    if (op.op === "getMany" || op.op === "summaries") {
      if (!Array.isArray(value) || value.length > op.keys.length) return invalid(); const seen = new Set<string>();
      for (const row of value) {
        this.#check(c); if (!object(row) || !op.keys.includes(row.key) || seen.has(row.key)) return invalid(); seen.add(row.key);
        if (op.op === "getMany") {
          if (!exact(row, ["key", "repo", "snapshot", "expiresAt", "savedAt", "hash", "origin"]) || captureKey(row.repo) !== row.repo || !integer(row.expiresAt) || !integer(row.savedAt) || row.expiresAt <= row.savedAt || !hash(row.hash) || typeof row.origin !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(row.origin)) return invalid();
          world(row.snapshot, row.repo); if (await captureHash(row.snapshot) !== row.hash) return invalid();
        } else if (!exact(row, ["key", "repo", "collectedAt", "expiresAt", "ready"]) || !repo(row.repo) || typeof row.collectedAt !== "string" || !Number.isFinite(Date.parse(row.collectedAt)) || !integer(row.expiresAt) || typeof row.ready !== "boolean") return invalid();
      }
      this.#check(c); return value;
    }
    if (!object(value)) return invalid();
    if (op.op === "captureBegin") { worldGenerationShape(value as RemoteWorldGeneration); if (value.repo !== op.repo) return invalid(); return { ...value }; }
    if (op.op === "status") {
      if (!exact(value, ["identity", "protocol", "revision", "sequence", "worlds", "aliases", "generations", "admissionFenced", "retirementQuiet"]) || value.protocol !== 1 || !integer(value.revision) || !integer(value.sequence, value.revision) || !integer(value.worlds, WORLD_CAPTURE_LIMITS.worlds) || !integer(value.aliases, WORLD_CAPTURE_LIMITS.aliases) || !integer(value.generations, WORLD_CAPTURE_LIMITS.generations) || typeof value.admissionFenced !== "boolean" || value.retirementQuiet !== "unknown") return invalid(); this.#identity(value.identity); return value;
    }
    if (op.op === "captureInspect") { if (!exact(value, ["status", "operationHash", "acceptedSequence"]) || !["active", "committed", "deny-pending", "denied"].includes(value.status) || (value.status === "active" ? value.operationHash !== null || value.acceptedSequence !== null : !hash(value.operationHash) || !integer(value.acceptedSequence) || value.acceptedSequence < op.generation.sequence || value.status !== "committed" && value.acceptedSequence <= op.generation.sequence)) return invalid(); return value; }
    const field = op.op === "captureAssert" ? "admitted" : op.op === "alias" ? "accepted" : op.op === "evict" ? "evicted" : "saved";
    if (op.op === "captureRevoke") { if (!exact(value, ["barrier", "cleanup", "idempotent"]) || value.barrier !== "confirmed" || value.cleanup !== "confirmed" || typeof value.idempotent !== "boolean") return invalid(); }
    else if (!exact(value, [field]) || value[field] !== true) return invalid();
    return value;
  }
  async #rpc(c: Call, input: unknown): Promise<any> {
    let op: WorldCaptureRpcOperation, body: string;
    try { this.#check(c); op = parseWorldCaptureOperation(input); body = JSON.stringify(op); if (captureBytes(body) > this.#limits.requestBytes) return invalid(); } catch { return invalid(); }
    const track = <T>(p: Promise<T>) => { c.pending.add(p); p.then(() => { c.pending.delete(p); this.#release(c); }, () => { c.pending.delete(p); this.#release(c); }); return p; };
    const abort = new AbortController(); let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, cancelling = false, timer: ReturnType<typeof setTimeout> | undefined, validatedError: D1CaptureWorldStoreError | undefined;
    const cancel = (r = response) => { if (!r || cancelling) return; try { if (!r.body) return; cancelling = true; track(Promise.resolve(reader ? reader.cancel() : r.body.cancel())); } catch (e) { cancelling = true; track(Promise.reject(e)); } };
    try {
      this.#check(c); const timeout = new Promise<never>((_, fail) => { timer = setTimeout(() => { abort.abort(); fail(new Error("World RPC deadline.")); }, Math.max(1, this.#limits.timeoutMs - (c.last - c.start))); });
      const wait = <T>(p: Promise<T>) => Promise.race([p, timeout]);
      response = await wait(track(Promise.resolve().then(() => { this.#check(c); if (writes.has(op.op)) c.dispatchedWrite = true; return this.#network(this.#config.endpoint, { method: "POST", redirect: "error", signal: abort.signal, headers: { "content-type": "application/json", "accept-encoding": "identity", "x-factory-storage-key": this.#config.secret }, body }); }).then(r => { if (abort.signal.aborted) cancel(r); return r; })));
      this.#check(c); if (!response || response.redirected || response.status >= 300 && response.status < 400 || response.url && response.url !== WORLD_CAPTURE_RPC_URL || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "") || response.headers.has("content-encoding")) return invalid();
      const declared = response.headers.get("content-length"); if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || !integer(Number(declared), this.#limits.responseBytes))) return invalid();
      reader = response.body?.getReader(); if (!reader) return invalid(); const parts: Uint8Array[] = []; let size = 0;
      for (;;) { const part = await wait(track(reader.read())); this.#check(c); if (part.done) break; if (!(part.value instanceof Uint8Array)) return invalid(); size += part.value.byteLength; if (size > this.#limits.responseBytes) return invalid(); parts.push(part.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      if (declared !== null && Number(declared) !== size) return invalid();
      const wire = parseWorldCaptureJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); this.#check(c);
      if (!object(wire) || wire.backend !== "d1" || wire.op !== op.op || wire.schemaVersion !== 4 || wire.protocol !== 1) return invalid(); this.#identity(wire.identity);
      if (wire.ok === false) {
        if (!exact(wire, ["ok", "backend", "op", "identity", "schemaVersion", "protocol", "code", "error", "writeOutcome", ...(Object.hasOwn(wire, "privacy") ? ["privacy"] : [])]) || response.status < 400 || response.status > 599 || !knownErrors.has(wire.code) || typeof wire.error !== "string" || wire.error.length > 512 || !["not-started", "unknown"].includes(wire.writeOutcome)) return invalid();
        let barrier: "confirmed" | "unknown" | null = null, cleanup: "confirmed" | "unconfirmed" | null = null;
        if (Object.hasOwn(wire, "privacy")) { if (op.op !== "captureRevoke" || wire.code !== "WORLD_WRITE_OUTCOME_UNKNOWN" || !object(wire.privacy) || !exact(wire.privacy, ["barrier", "cleanup"]) || !["confirmed", "unknown"].includes(wire.privacy.barrier) || !["confirmed", "unconfirmed"].includes(wire.privacy.cleanup) || wire.privacy.barrier === "unknown" && wire.privacy.cleanup === "confirmed") return invalid(); barrier = wire.privacy.barrier; cleanup = wire.privacy.cleanup; }
        const expectedStatus = wire.code === "WORLD_CAPTURE_CONFLICT" ? 409 : ["WORLD_RPC_INVALID_REQUEST", "WORLD_CAPTURE_INVALID_REQUEST"].includes(wire.code) ? 400 : wire.code === "WORLD_RPC_BODY_TIMEOUT" ? 408 : wire.code === "WORLD_RPC_BODY_TOO_LARGE" ? 413 : wire.code === "WORLD_STORAGE_AUTH_REQUIRED" ? 403 : 503;
        if (response.status !== expectedStatus || (wire.writeOutcome === "unknown" ? wire.code !== "WORLD_WRITE_OUTCOME_UNKNOWN" || !writes.has(op.op) : wire.code === "WORLD_WRITE_OUTCOME_UNKNOWN")) return invalid();
        validatedError = new D1CaptureWorldStoreError(wire.writeOutcome, barrier, cleanup); this.#check(c); throw validatedError;
      }
      if (wire.ok !== true || response.status !== 200 || !exact(wire, ["ok", "backend", "op", "identity", "schemaVersion", "protocol", "result"])) return invalid();
      const result = await this.#result(op, wire.result, c); this.#check(c); return result;
    } catch (e) {
      const error = validatedError && e === validatedError ? validatedError : new D1CaptureWorldStoreError(c.dispatchedWrite ? "unknown" : "not-started"); c.outcomeError = error; throw error;
    } finally { clearTimeout(timer); abort.abort(); cancel(); }
  }
  #write(w: WorldSnapshot, ttl: number, now: number) { if (!integer(ttl) || !integer(now)) return invalid(); const snapshot = JSON.stringify(w); world(snapshot, captureKey(w.repo.fullName)); return { snapshot, savedAt: now, expiresAt: now + Math.max(60000, Math.min(120000, ttl)) }; }
  get(input: string, now = Date.now(), _options?: { readOnly?: boolean }): Promise<CachedWorld | null> { return this.#run(async c => { if (!integer(now)) return invalid(); const key = normalize(input), rows = await this.#rpc(c, { op: "getMany", keys: [key] }); return rows.length ? { world: world(rows[0].snapshot, rows[0].repo), expiresAt: rows[0].expiresAt, fresh: rows[0].expiresAt > now } : null; }); }
  summaries(inputs: string[], now = Date.now()): Promise<WorldSummary[]> { return this.#run(async c => { if (!integer(now) || !Array.isArray(inputs) || inputs.length > L.keys) return invalid(); const keys = inputs.map(normalize); if (new Set(keys).size !== keys.length) return invalid(); const result: WorldSummary[] = []; for (const key of keys) { this.#check(c); result.push(...await this.#rpc(c, { op: "summaries", keys: [key] })); } return result; }); }
  put(w: WorldSnapshot, ttl = 90000, now = Date.now()): Promise<void> { return this.#run(async c => { await this.#rpc(c, { op: "put", write: this.#write(w, ttl, now) }); }); }
  alias(input: string, target: string): Promise<void> { return this.#run(async c => { await this.#rpc(c, { op: "alias", alias: normalize(input), canonical: normalize(target) }); }); }
  delete(input: string): Promise<void> { return this.#run(async c => { await this.#rpc(c, { op: "evict", repo: normalize(input) }); }); }
  status(): Promise<WorldStorageStatus> { return this.#run(async c => { const result = await this.#rpc(c, { op: "status" }); return { backend: "d1", authoritative: true, schemaVersion: 4, databaseId: result.identity.databaseId, worlds: result.worlds, aliases: result.aliases }; }); }
  inspect(token: PublicCaptureGeneration): Promise<{ status: string; operationHash: string | null; acceptedSequence: number | null }> { return this.#run(async c => await this.#rpc(c, { op: "captureInspect", generation: this.#owned(token) })); }
}
