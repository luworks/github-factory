import type { Fetcher } from "./github";
import { HISTORY_RPC_URL, parseHistoryRpcOperation, parseHistoryWireJson, type HistoryRpcOperation } from "./history-rpc-contract";
import { HISTORY_STORAGE_LIMITS as L, historyAnchor, validHistoryCursor, type HistoryAppendBatch, type HistoryAppendResult, type HistoryCursor, type HistoryFrameResult, type HistoryPage, type HistoryRetention, type HistoryStore } from "./history-storage";
import { firstParentSpine, topologyFrameKey, validateImmutableCommit, validateImmutableTreeFrame } from "../history/topology";

export interface HistoryRpcIdentity { databaseId: string; bindingNonce: string; epoch: string; sourceSha: string; workerBundleSha256: string }
export interface HistoryRpcStoreConfig { endpoint: string; secret: string; identity: HistoryRpcIdentity }
export interface HistoryPhysicalObservation { readonly idle: boolean; readonly settled: Promise<void> }
export class HistoryRpcStoreError extends Error {
  constructor(readonly code: string, readonly status: number, readonly writeOutcome: "not-started" | "unknown") { super(writeOutcome === "unknown" ? "History save is unconfirmed. Read authoritative history before another explicit action; no retry was sent." : "Authoritative history storage is unavailable or rejected this fixed operation."); }
}
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const keys = (x: object, names: string[]) => Object.keys(x).length === names.length && names.every(n => Object.hasOwn(x, n));
const integer = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= max;
const stable = (x: unknown): string => JSON.stringify(x, (_k, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const invalid = (): never => { throw new Error("Invalid authoritative history response."); };
function cursor(x: unknown): HistoryCursor {
  if (!validHistoryCursor(x) || x.termination === "cycle" || x.reachedRoot === true !== (x.termination === "observed-root") || ["observed-root", "parents-unobserved"].includes(x.termination) && x.nextParentSha !== null || ["missing-parent", "missing-anchor", "window-cap"].includes(x.termination) && x.nextParentSha === null) return invalid();
  if (x.termination === "missing-anchor" ? x.retainedCommits !== 0 || x.revision !== 0 : x.retainedCommits < 1 || x.revision < 1) return invalid();
  if (x.termination === "window-cap" && x.retainedCommits !== L.commits || x.termination === "missing-parent" && x.retainedCommits === L.commits) return invalid();
  return x;
}
function retention(x: unknown, c: HistoryCursor): HistoryRetention {
  if (!object(x) || !keys(x, ["commits", "memberships", "frames", "anchors", "receipts", "normalizedBytes", "physicalBytes"]) || !integer(x.commits, L.commits) || !integer(x.memberships, L.commits * L.anchors) || !integer(x.frames, L.frames) || !integer(x.anchors, L.anchors) || !integer(x.receipts, L.receipts) || !integer(x.normalizedBytes, L.bytes) || x.physicalBytes !== null || x.commits < c.retainedCommits || x.memberships < c.retainedCommits || c.retainedCommits > 0 && (x.anchors < 1 || x.receipts < 1 || x.normalizedBytes < 1)) return invalid();
  return x as HistoryRetention;
}
const rejectionCodes = new Set("invalid-anchor invalid-history-batch invalid-history-unit invalid-history-page invalid-frame-key normalized-frame-required duplicate-batch-commit duplicate-batch-frame repo-mismatch non-spine-commit parent-cycle frame-membership-unknown immutable-commit-conflict immutable-frame-conflict immutable-tree-conflict partial-observations-unresolved normalized-duplicate-path non-directory-parent frame-commit-binding-mismatch invalid-frame-coverage invalid-normalized-frame invalid-provenance invalid-tree-entry path-outside-scope commit-byte-cap frame-byte-cap history-revision-conflict action-already-used batch-payload-conflict anchor-generation-conflict history-commit-cap history-frame-cap history-anchor-cap history-receipt-cap history-byte-cap HISTORY_STORAGE_UNAVAILABLE HISTORY_WRITE_OUTCOME_UNKNOWN".split(" "));

/** Server-only fixed RPC client. No environment/default fetch, singleton, retry,
 * quota, SQLite fallback, or remote rollback/cancellation claim. */
export class D1RpcHistoryStore implements HistoryStore {
  private config: HistoryRpcStoreConfig;
  private readonly limits: { timeoutMs: number; responseBytes: number; requestBytes: number };
  private readonly calls = new Set<{ finished: boolean; pending: Set<Promise<unknown>> }>();
  private readonly waiters = new Set<() => void>();
  constructor(config: HistoryRpcStoreConfig, private readonly network: Fetcher, limits: Partial<{ timeoutMs: number; responseBytes: number; requestBytes: number }> = {}, private readonly clock = () => performance.now()) {
    if (!object(config) || !keys(config, ["endpoint", "secret", "identity"]) || config.endpoint !== HISTORY_RPC_URL || typeof config.secret !== "string" || new TextEncoder().encode(config.secret).length < 32 || new TextEncoder().encode(config.secret).length > 256 || !object(config.identity) || !keys(config.identity, ["databaseId", "bindingNonce", "epoch", "sourceSha", "workerBundleSha256"]) || Object.values(config.identity).some(v => typeof v !== "string") || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(config.identity.databaseId) || !/^[a-f0-9]{32}$/.test(config.identity.bindingNonce) || !/^[a-f0-9]{32}$/.test(config.identity.epoch) || !/^[a-f0-9]{40}$/.test(config.identity.sourceSha) || !/^[a-f0-9]{64}$/.test(config.identity.workerBundleSha256) || typeof network !== "function") throw new HistoryRpcStoreError("HISTORY_RPC_INVALID_REQUEST", 400, "not-started");
    this.config = { endpoint: config.endpoint, secret: config.secret, identity: { ...config.identity } };
    this.limits = { timeoutMs: 10000, responseBytes: 2 * 1024 * 1024, requestBytes: 2 * 1024 * 1024 };
    for (const [k, v] of Object.entries(limits)) { if (!(k in this.limits) || !integer(v, this.limits[k as keyof typeof this.limits]) || v < 1) throw new HistoryRpcStoreError("HISTORY_RPC_INVALID_REQUEST", 400, "not-started"); this.limits[k as keyof typeof this.limits] = v; }
  }
  /** Exact store-instance local finished+pending0 observation, not a future
   * fence or proof that remote processing stopped. All concurrent calls count. */
  readonly observeSettlement = (): HistoryPhysicalObservation => this.calls.size ? { idle: false, settled: new Promise(resolve => this.waiters.add(resolve)) } : { idle: true, settled: Promise.resolve() };
  private identity(value: unknown, append: boolean) {
    if (!object(value) || !keys(value, ["databaseId", "bindingNonce", "epoch", "sourceSha", "workerBundleSha256", "admissionFenced"]) || Object.entries(this.config.identity).some(([k, v]) => value[k] !== v) || typeof value.admissionFenced !== "boolean" || append && value.admissionFenced) return invalid();
  }
  private result(op: HistoryRpcOperation, wire: Record<string, any>, check: () => void): HistoryPage | HistoryFrameResult | HistoryAppendResult {
    const r = wire.result; check();
    if (op.op === "historyPage") {
      if (!object(r) || !keys(r, ["status", "anchor", "cursor", "commits", "nextOffset", "completeHistory", "total", "retention"]) || !["available", "missing-anchor"].includes(r.status) || !same(historyAnchor(r.anchor), op.anchor) || !Array.isArray(r.commits) || r.commits.length > op.limit || r.completeHistory !== false || r.total !== null) return invalid();
      const c = cursor(r.cursor); retention(r.retention, c);
      if (r.commits.length !== Math.min(op.limit, Math.max(0, c.retainedCommits - op.offset)) || r.nextOffset !== (op.offset + op.limit < c.retainedCommits ? op.offset + op.limit : null)) return invalid();
      for (let i = 0; i < r.commits.length; i++) { check(); const raw = r.commits[i], parsed = validateImmutableCommit(raw); if (!parsed.ok || !same(parsed.value, raw) || parsed.value.repoKey !== op.anchor.repoKey || i === 0 && op.offset === 0 && parsed.value.sha !== op.anchor.sha || i > 0 && r.commits[i - 1].parents?.[0] !== parsed.value.sha) return invalid(); }
      if (new Set(r.commits.map((v: any) => v.sha)).size !== r.commits.length) return invalid();
      if (r.status === "missing-anchor" ? c.revision !== 0 || c.retainedCommits !== 0 || c.termination !== "missing-anchor" || c.nextParentSha !== op.anchor.sha : c.revision < 1 || c.retainedCommits < 1 || c.termination === "missing-anchor") return invalid();
      if (r.commits.length && op.offset + r.commits.length === c.retainedCommits) { const last = r.commits.at(-1), termination = last.parents === null ? "parents-unobserved" : last.parents.length === 0 ? "observed-root" : c.retainedCommits === L.commits ? "window-cap" : "missing-parent"; if (c.termination !== termination || c.nextParentSha !== (last.parents?.[0] ?? null)) return invalid(); }
      check(); return r as HistoryPage;
    }
    if (op.op === "historyFrame") {
      if (!object(r)) return invalid();
      if (r.status !== "available") { if (!keys(r, ["status"]) || !["missing-anchor", "not-member", "missing-frame"].includes(r.status) || Object.hasOwn(wire, "proofCommit")) return invalid(); return r as HistoryFrameResult; }
      if (!keys(r, ["status", "frame"])) return invalid();
      const proof = validateImmutableCommit(wire.proofCommit); if (!proof.ok || !same(proof.value, wire.proofCommit) || proof.value.repoKey !== op.anchor.repoKey) return invalid();
      check(); const parsed = validateImmutableTreeFrame(r.frame, proof.value); check(); if (!parsed.ok || !same(parsed.value, r.frame) || topologyFrameKey(parsed.value) !== op.frameKey) return invalid(); return r as HistoryFrameResult;
    }
    if (!object(r) || !keys(r, ["idempotent", "acceptedCursor", "currentCursor", "retention"]) || typeof r.idempotent !== "boolean") return invalid();
    const accepted = cursor(r.acceptedCursor), current = cursor(r.currentCursor); retention(r.retention, current);
    if (accepted.retainedCommits < 1 || current.retainedCommits < accepted.retainedCommits || accepted.revision !== op.batch.expectedRevision + 1 || current.revision < accepted.revision || !r.idempotent && !same(accepted, current) || accepted.retainedCommits < op.batch.expectedCursor.retainedCommits || accepted.retainedCommits > op.batch.expectedCursor.retainedCommits + (op.batch.unit.kind === "commits" ? op.batch.unit.commits.length : 0)) return invalid();
    if (op.batch.unit.kind === "frames" && !same(accepted, { ...op.batch.expectedCursor, revision: accepted.revision })) return invalid();
    if (op.batch.unit.kind === "commits" && op.batch.expectedCursor.retainedCommits === 0) { const spine = firstParentSpine(op.batch.anchor, op.batch.unit.commits); if (!spine.ok || accepted.retainedCommits !== spine.value.commits.length || accepted.nextParentSha !== spine.value.nextParentSha || accepted.reachedRoot !== spine.value.reachedRoot || accepted.termination !== spine.value.termination) return invalid(); }
    check(); return r as HistoryAppendResult;
  }
  private async rpc(input: unknown): Promise<HistoryPage | HistoryFrameResult | HistoryAppendResult> {
    let operationStarted: number;
    try { operationStarted = this.clock(); if (!Number.isFinite(operationStarted)) throw new Error(); } catch { throw new HistoryRpcStoreError("HISTORY_STORAGE_UNAVAILABLE", 503, "not-started"); }
    let op: HistoryRpcOperation, body: string;
    try { op = parseHistoryRpcOperation(input); if (op.op === "historyAppend") { const c = cursor(op.batch.expectedCursor); if (c.retainedCommits === 0 && c.nextParentSha !== op.batch.anchor.sha || !Number.isSafeInteger(c.revision + 1)) return invalid(); } body = JSON.stringify(op); if (new TextEncoder().encode(body).length > this.limits.requestBytes) throw new Error(); } catch { throw new HistoryRpcStoreError("HISTORY_RPC_INVALID_REQUEST", 400, "not-started"); }
    const call = { finished: false, pending: new Set<Promise<unknown>>() }; this.calls.add(call);
    const release = () => { if (call.finished && call.pending.size === 0) { this.calls.delete(call); if (this.calls.size === 0) { const listeners = [...this.waiters]; this.waiters.clear(); listeners.forEach(resolve => resolve()); } } };
    const track = <T>(p: Promise<T>) => { call.pending.add(p); p.then(() => { call.pending.delete(p); release(); }, () => { call.pending.delete(p); release(); }); return p; };
    const abort = new AbortController(); let dispatched = false, last = NaN, started = NaN, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, response: Response | undefined, cancelling = false;
    const check = () => { const n = this.clock(); if (!Number.isFinite(n) || !Number.isFinite(started) || n < last || n - started >= this.limits.timeoutMs || abort.signal.aborted) throw new Error("History RPC deadline."); last = n; };
    const cancelled = (r = response) => { if (cancelling || !r?.body) return; cancelling = true; try { track(Promise.resolve(reader ? reader.cancel() : r.body.cancel())); } catch (e) { track(Promise.reject(e)); } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      started = last = operationStarted; check();
      const timeout = new Promise<never>((_, fail) => { timer = setTimeout(() => { abort.abort(); fail(new Error("History RPC deadline.")); }, Math.max(1, this.limits.timeoutMs - (last - started))); });
      const wait = <T>(p: Promise<T>) => Promise.race([p, timeout]);
      response = await wait(track(Promise.resolve().then(() => { check(); dispatched = true; return this.network(this.config.endpoint, { method: "POST", redirect: "error", signal: abort.signal, headers: { "content-type": "application/json", "x-factory-storage-key": this.config.secret }, body }); }).then(r => { if (abort.signal.aborted) cancelled(r); return r; })));
      check(); if (!response) return invalid(); if (response.redirected || response.status >= 300 && response.status < 400 || response.url && response.url !== HISTORY_RPC_URL || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")) return invalid();
      const declared = response.headers.get("content-length"); if (declared && (!/^\d+$/.test(declared) || Number(declared) > this.limits.responseBytes)) return invalid();
      reader = response.body?.getReader(); if (!reader) return invalid(); const chunks: Uint8Array[] = []; let length = 0;
      for (;;) { const part = await wait(track(reader.read())); check(); if (part.done) break; if (!(part.value instanceof Uint8Array)) return invalid(); length += part.value.byteLength; if (length > this.limits.responseBytes) return invalid(); chunks.push(part.value); }
      const bytes = new Uint8Array(length); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
      const wire: unknown = parseHistoryWireJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); check();
      if (!object(wire) || wire.backend !== "d1" || wire.op !== op.op || wire.schemaVersion !== 3) return invalid();
      if (wire.ok === false) {
        if (!keys(wire, ["ok", "backend", "op", "identity", "schemaVersion", "code", "error", "writeOutcome"]) || !rejectionCodes.has(wire.code) || typeof wire.error !== "string" || !["not-started", "unknown"].includes(wire.writeOutcome) || response.status < 400 || response.status > 599) return invalid();
        this.identity(wire.identity, false); check();
        if (op.op === "historyAppend" && (wire.writeOutcome === "unknown" || wire.code === "HISTORY_WRITE_OUTCOME_UNKNOWN")) throw new HistoryRpcStoreError("HISTORY_WRITE_OUTCOME_UNKNOWN", 503, "unknown");
        if (wire.code === "HISTORY_WRITE_OUTCOME_UNKNOWN") return invalid();
        if (wire.writeOutcome !== "not-started") return invalid();
        throw new HistoryRpcStoreError(wire.code, response.status, "not-started");
      }
      if (wire.ok !== true || !response.ok || !keys(wire, ["ok", "backend", "op", "identity", "schemaVersion", "result", ...(op.op === "historyFrame" && wire.result?.status === "available" ? ["proofCommit"] : [])])) return invalid();
      this.identity(wire.identity, op.op === "historyAppend"); check(); const value = this.result(op, wire, check); check(); return value;
    } catch (e) {
      if (e instanceof HistoryRpcStoreError) throw e;
      throw new HistoryRpcStoreError(op.op === "historyAppend" && dispatched ? "HISTORY_WRITE_OUTCOME_UNKNOWN" : "HISTORY_STORAGE_UNAVAILABLE", 503, op.op === "historyAppend" && dispatched ? "unknown" : "not-started");
    } finally { clearTimeout(timer); abort.abort(); cancelled(); call.finished = true; release(); }
  }
  async page(anchor: Parameters<HistoryStore["page"]>[0], offset = 0, limit: number = L.page): Promise<HistoryPage> { return await this.rpc({ op: "historyPage", anchor, offset, limit }) as HistoryPage; }
  async frame(anchor: Parameters<HistoryStore["frame"]>[0], frameKey: string): Promise<HistoryFrameResult> { return await this.rpc({ op: "historyFrame", anchor, frameKey }) as HistoryFrameResult; }
  async append(batch: HistoryAppendBatch): Promise<HistoryAppendResult> { return await this.rpc({ op: "historyAppend", batch }) as HistoryAppendResult; }
}
