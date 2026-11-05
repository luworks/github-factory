import { D1HistoryStore, type HistoryD1Binding } from "./history-storage";
import type { StorageIdentity } from "./migration-contract";
import { historyAnchor, validHistoryCursor, type HistoryAppendBatch } from "../src/server/history-storage";
import { topologyBytes, topologyFrameKey, topologyPath, validateImmutableCommit } from "../src/history/topology";
import type { ImmutableTreeFrame, TopologyAnchor } from "../src/history/topology-contracts";

export const HISTORY_RPC_URL = "https://chaorders.com/github-factory/_storage/history";
/** SHA256 of committed, UNAPPLIED deploy/d1/0003-history.sql, not a claim that
 * the current Worker/bootstrap accepts schema3 or that this endpoint is live. */
export const HISTORY_SCHEMA3_SQL_SHA256 = "6b0f837993b07fee15e7ebf45244b55fa7d9303dfb1ed6a0a885ae0979892994";
export interface HistoryRpcEnvironment {
  WORLDS_DB?: HistoryD1Binding;
  FACTORY_STORAGE_SECRET?: string; FACTORY_STORAGE_MODE?: string;
  FACTORY_STORAGE_DATABASE_ID?: string; FACTORY_STORAGE_BINDING_NONCE?: string;
  FACTORY_MIGRATION_EPOCH?: string; FACTORY_SOURCE_SHA?: string;
  FACTORY_WORKER_BUNDLE_SHA256?: string; FACTORY_ADMISSION_FENCE?: string;
}
// Full canonical DDL fingerprints compiled from reviewed 0001/0002 control DDL
// and ALL seven 0003 tables, including column/PK/UNIQUE/FK/CHECK contracts.
// No runtime filesystem, caller DDL or claimed marker alone can supply these.
const ddlPins: Record<string, string> = {
  schema_migrations: "f3b91bee1ea996a819b3ee260497938220abbcc35f03b0ae7a8e929eabfc10ef",
  storage_identity: "21840d2d14fd95a53f1eda02367e239dd9fa852c3d80f496070cf72db9d3efc3",
  history_repositories: "d9d6c2625769dda7f4ef6f54008d93f94a50f77ffba81f8ce4f01b1a00bf8523",
  history_commits: "06c05ef9f0d332911e5f3e116e336d7eb8372ec248bc8ab767acdc53a358b781",
  history_anchors: "341d0dd107f8b8617a505cd7f2418990945d516c303e962b0feb667116a27f75",
  history_frames: "05b527573d19d4dca633ce90e53690c254b40d620ec25ae2af74e39257adcab1",
  history_frame_chunks: "10d3f101fe1fb6fdb603502094f84238b5bc0f258758149f1ca1c9e93a1e13b5",
  history_batches: "a1f6c5ac8e810cf33e80ba234c984b4cb62941c7003f9f94f0339a398b052622",
  history_append_guards: "2daa7c8fc1dd739515575e04ef2ae6cbb2c9d722ed7094b08df5ac598f14a439",
};
const autoIndexes = new Set(["history_repositories_1", "history_commits_1", "history_anchors_1", "history_anchors_2", "history_frames_1", "history_frame_chunks_1", "history_batches_1", "history_batches_2", "history_append_guards_1"].map(n => `sqlite_autoindex_${n}`));
const schemaSql = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name IN ('schema_migrations','storage_identity','history_repositories','history_commits','history_anchors','history_frames','history_frame_chunks','history_batches','history_append_guards') ORDER BY type,name LIMIT 32";
const encode = new TextEncoder(), hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(s))), n => n.toString(16).padStart(2, "0")).join("");
class Rejection extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
const reject = (code = "HISTORY_RPC_INVALID_REQUEST", status = 400): never => { throw new Rejection(code, status); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
async function authenticated(actual: string, expected: string) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  if (actual.length < 32 || actual.length > 256 || expected.length < 32 || expected.length > 256 || encode.encode(actual).length > 256 || encode.encode(expected).length > 256) return false;
  const [a, b] = await Promise.all([hash(actual), hash(expected)]); let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function strictJson(text: string): unknown {
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; }
      let next = i + 1; while (next < text.length && /\s/.test(text[next]!)) next++;
      const object = stack.at(-1);
      if (object && text[next] === ":") { const name = JSON.parse(text.slice(start, i + 1)); if (object.has(name)) return reject(); object.add(name); }
    } else if (text[i] === "{" || text[i] === "[") { stack.push(text[i] === "{" ? new Set() : null); if (stack.length > 16) return reject(); }
    else if (text[i] === "}" || text[i] === "]") stack.pop();
  }
  return JSON.parse(text);
}
async function readBody(request: Request, timeoutMs: number) {
  const reader = request.body?.getReader(); if (!reader) return reject();
  let timer: ReturnType<typeof setTimeout> | undefined, length = 0; const end = performance.now() + timeoutMs;
  const timeout = new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new Rejection("HISTORY_RPC_BODY_TIMEOUT", 408)), timeoutMs); });
  try {
    const advertised = request.headers.get("content-length");
    if (advertised !== null && (!/^(0|[1-9][0-9]*)$/.test(advertised) || Number(advertised) > 2 * 1024 * 1024)) return reject("HISTORY_RPC_BODY_TOO_LARGE", 413);
    const chunks: Uint8Array[] = [];
    for (;;) { const part = await Promise.race([reader.read(), timeout]); if (performance.now() >= end) return reject("HISTORY_RPC_BODY_TIMEOUT", 408); if (part.done) break; if (!(part.value instanceof Uint8Array)) return reject(); length += part.value.byteLength; if (length > 2 * 1024 * 1024) return reject("HISTORY_RPC_BODY_TOO_LARGE", 413); chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    let value: unknown; try { value = strictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return reject(); }
    if (performance.now() >= end) return reject("HISTORY_RPC_BODY_TIMEOUT", 408);
    return value;
  } finally { clearTimeout(timer); try { void reader.cancel().catch(() => {}); } catch { /* no pending cancellation promise */ } }
}
function normalizedFrame(input: unknown, anchor: TopologyAnchor): ImmutableTreeFrame {
  if (!record(input) || !exact(input, ["schemaVersion", "repoKey", "commitSha", "treeSha", "scope", "completeness", "sourceCompleteness", "sourceOmittedEntries", "entries", "inputEntryCount", "omittedInputEntries", "deduplicatedInputEntries", "limits", "provenance", "omittedProvenance"]) || input.schemaVersion !== 1 || input.repoKey !== anchor.repoKey || !sha(input.commitSha) || !sha(input.treeSha) || !record(input.scope) || !exact(input.scope, ["prefix", "recursive"]) || !(input.scope.prefix === "" || topologyPath(input.scope.prefix)) || input.scope.recursive !== true) return reject();
  if (!["full", "partial"].includes(input.completeness as string) || !["full", "partial"].includes(input.sourceCompleteness as string) || !(input.sourceOmittedEntries === null || integer(input.sourceOmittedEntries)) || !(input.omittedProvenance === null || integer(input.omittedProvenance)) || !integer(input.inputEntryCount) || !integer(input.omittedInputEntries) || !integer(input.deduplicatedInputEntries) || !Array.isArray(input.entries) || input.entries.length > 8000 || !Array.isArray(input.limits) || input.limits.length > 2 || new Set(input.limits).size !== input.limits.length || input.limits.some(v => v !== "entry-cap" && v !== "byte-cap")) return reject();
  if (input.entries.some(e => !record(e) || !exact(e, ["path", "type", "sha"]) || !topologyPath(e.path) || !["blob", "tree", "symlink", "submodule"].includes(e.type as string) || !sha(e.sha)) || !Array.isArray(input.provenance) || input.provenance.length < 1 || input.provenance.length > 8 || input.provenance.some(p => !record(p) || !exact(p, ["sourceUrl", "fetchedAt"]) || ![`https://github.com/${anchor.repoKey}/tree/${input.commitSha}`, `https://api.github.com/repos/${anchor.repoKey}/git/trees/${input.treeSha}?recursive=1`].includes(p.sourceUrl as string) || typeof p.fetchedAt !== "string" || p.fetchedAt.length > 64 || !Number.isFinite(Date.parse(p.fetchedAt))) || topologyBytes(input) > 512 * 1024) return reject();
  // Identity-dependent C1 semantics (including normalized duplicates, ancestor
  // conflicts and source timestamps) are validated by the ORIGINAL store against
  // its retained commit, never a manufactured commit or independent persistence.
  return input as unknown as ImmutableTreeFrame;
}
type Operation = { op: "historyPage"; anchor: TopologyAnchor; offset: number; limit: number } | { op: "historyFrame"; anchor: TopologyAnchor; frameKey: string } | { op: "historyAppend"; batch: HistoryAppendBatch };
function operation(input: unknown): Operation {
  if (!record(input)) return reject();
  if (input.op === "historyPage" && exact(input, ["op", "anchor", "offset", "limit"]) && integer(input.offset, 500) && integer(input.limit, 50) && input.limit > 0) return { op: input.op, anchor: historyAnchor(input.anchor), offset: input.offset, limit: input.limit };
  if (input.op === "historyFrame" && exact(input, ["op", "anchor", "frameKey"]) && typeof input.frameKey === "string" && input.frameKey.length <= 2048) {
    const anchor = historyAnchor(input.anchor); let parsed: unknown, scope: unknown;
    try { parsed = JSON.parse(input.frameKey); if (!Array.isArray(parsed) || parsed.length !== 4 || parsed[0] !== anchor.repoKey || !sha(parsed[1]) || !sha(parsed[2]) || typeof parsed[3] !== "string" || JSON.stringify(parsed) !== input.frameKey) return reject(); scope = JSON.parse(parsed[3]); } catch { return reject(); }
    if (!Array.isArray(scope) || scope.length !== 2 || !(scope[0] === "" || topologyPath(scope[0])) || scope[1] !== true || JSON.stringify(scope) !== parsed[3]) return reject();
    return { op: input.op, anchor, frameKey: input.frameKey };
  }
  if (input.op === "historyAppend" && exact(input, ["op", "batch"]) && record(input.batch)) {
    const b = input.batch;
    if (!exact(b, ["anchor", "batchId", "actionId", "expectedRevision", "expectedCursor", "unit"]) || !id(b.batchId) || !id(b.actionId) || !integer(b.expectedRevision) || !validHistoryCursor(b.expectedCursor) || b.expectedCursor.revision !== b.expectedRevision || !record(b.unit) || b.unit.complete !== true) return reject();
    const anchor = historyAnchor(b.anchor), u = b.unit;
    if (u.kind === "commits" && exact(u, ["kind", "complete", "commits"]) && Array.isArray(u.commits) && u.commits.length > 0 && u.commits.length <= 4) {
      const commits = u.commits.map(c => { if (!record(c) || !Object.hasOwn(c, "omittedProvenance")) return reject(); const parsed = validateImmutableCommit(c); if (!parsed.ok || parsed.value.repoKey !== anchor.repoKey) return reject(); return parsed.value; });
      if (new Set(commits.map(c => c.sha)).size !== commits.length) return reject();
      return { op: input.op, batch: { anchor, batchId: b.batchId, actionId: b.actionId, expectedRevision: b.expectedRevision, expectedCursor: b.expectedCursor, unit: { kind: "commits", complete: true, commits } } };
    }
    if (u.kind === "frames" && exact(u, ["kind", "complete", "frames"]) && Array.isArray(u.frames) && u.frames.length > 0 && u.frames.length <= 2) {
      const frames = u.frames.map(f => normalizedFrame(f, anchor)); if (new Set(frames.map(topologyFrameKey)).size !== frames.length) return reject();
      return { op: input.op, batch: { anchor, batchId: b.batchId, actionId: b.actionId, expectedRevision: b.expectedRevision, expectedCursor: b.expectedCursor, unit: { kind: "frames", complete: true, frames } } };
    }
  }
  return reject();
}
async function schema(db: HistoryD1Binding) {
  const marker = await db.prepare("SELECT version,sql_sha256 FROM schema_migrations ORDER BY version DESC LIMIT 1").first<{ version: number; sql_sha256: string }>();
  if (marker?.version !== 3 || marker.sql_sha256 !== HISTORY_SCHEMA3_SQL_SHA256) return reject("HISTORY_STORAGE_SCHEMA_UNAVAILABLE", 503);
  const keys = await db.prepare("PRAGMA foreign_keys").first<{ foreign_keys: number }>(); if (keys?.foreign_keys !== 1) return reject("HISTORY_STORAGE_SCHEMA_UNAVAILABLE", 503);
  const rows = await db.prepare(schemaSql).all<{ type: string; name: string; tbl_name: string; sql: string | null }>();
  if (!rows.success || rows.results.length !== Object.keys(ddlPins).length + autoIndexes.size) return reject("HISTORY_STORAGE_SCHEMA_UNAVAILABLE", 503);
  const seen = new Set<string>();
  for (const row of rows.results) {
    if (seen.has(row.name)) return reject("HISTORY_STORAGE_SCHEMA_UNAVAILABLE", 503); seen.add(row.name);
    if (row.type === "index" && autoIndexes.has(row.name) && row.sql === null && row.name.startsWith(`sqlite_autoindex_${row.tbl_name}_`)) continue;
    // Preserve SQL token boundaries. Deleting whitespace would confuse the
    // valid declaration "payload TEXT NOT NULL" with a renamed column
    // "payloadTEXTNOTNULL" and could falsely certify a broken table contract.
    if (row.type !== "table" || row.name !== row.tbl_name || !ddlPins[row.name] || typeof row.sql !== "string" || await hash((row.sql.replace(/--[^\n]*/g, "").replace(/;\s*$/, "").toLowerCase().match(/[a-z_][a-z0-9_]*|[0-9]+|[^\s]/g) ?? []).join(" ")) !== ddlPins[row.name]) return reject("HISTORY_STORAGE_SCHEMA_UNAVAILABLE", 503);
  }
  if (Object.keys(ddlPins).some(n => !seen.has(n)) || [...autoIndexes].some(n => !seen.has(n))) return reject("HISTORY_STORAGE_SCHEMA_UNAVAILABLE", 503);
}
const known = new Set("invalid-anchor invalid-history-batch invalid-history-unit invalid-history-page invalid-frame-key normalized-frame-required duplicate-batch-commit duplicate-batch-frame repo-mismatch non-spine-commit parent-cycle frame-membership-unknown immutable-commit-conflict immutable-frame-conflict immutable-tree-conflict partial-observations-unresolved normalized-duplicate-path non-directory-parent frame-commit-binding-mismatch invalid-frame-coverage invalid-normalized-frame invalid-provenance invalid-tree-entry path-outside-scope commit-byte-cap frame-byte-cap history-revision-conflict action-already-used batch-payload-conflict anchor-generation-conflict history-commit-cap history-frame-cap history-anchor-cap history-receipt-cap history-byte-cap".split(" "));
function reply(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
/** Standalone SERVER dispatcher only. No gateway/Worker import, client, route,
 * network request, secret lookup or schema adoption. Logical UUID/nonce is not
 * proof of the physical Cloudflare binding or active Worker version. */
export async function historyStorageRpc(request: Request, env: HistoryRpcEnvironment, options: { bodyTimeoutMs?: number } = {}): Promise<Response> {
  let batchStarted = false;
  try {
    if (!await authenticated(request.headers.get("x-factory-storage-key") ?? "", env.FACTORY_STORAGE_SECRET ?? "")) return reject("HISTORY_STORAGE_AUTH_REQUIRED", 403);
    if (env.FACTORY_STORAGE_MODE !== "worlds") return reject("HISTORY_STORAGE_MODE_REJECTED", 503);
    if (request.url !== HISTORY_RPC_URL || request.method !== "POST" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return reject();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(env.FACTORY_STORAGE_DATABASE_ID ?? "") || !/^[a-f0-9]{32}$/.test(env.FACTORY_STORAGE_BINDING_NONCE ?? "") || !/^[a-f0-9]{32}$/.test(env.FACTORY_MIGRATION_EPOCH ?? "") || !/^[a-f0-9]{40}$/.test(env.FACTORY_SOURCE_SHA ?? "") || !/^[a-f0-9]{64}$/.test(env.FACTORY_WORKER_BUNDLE_SHA256 ?? "") || !(env.FACTORY_ADMISSION_FENCE === "" || env.FACTORY_ADMISSION_FENCE === env.FACTORY_MIGRATION_EPOCH)) return reject("HISTORY_STORAGE_IDENTITY_UNAVAILABLE", 503);
    const duration = options.bodyTimeoutMs ?? 5000; if (!integer(duration, 5000) || duration < 1) return reject("HISTORY_STORAGE_UNAVAILABLE", 503);
    const op = operation(await readBody(request, duration));
    if (op.op === "historyAppend" && env.FACTORY_ADMISSION_FENCE !== "") return reject("STORAGE_MIGRATION_HOLD", 503);
    if (!env.WORLDS_DB) return reject("HISTORY_STORAGE_UNAVAILABLE", 503);
    const db = env.WORLDS_DB.withSession?.("first-primary") ?? env.WORLDS_DB;
    const identityRows = await db.prepare("SELECT singleton,database_uuid,binding_nonce FROM storage_identity ORDER BY singleton LIMIT 2").all<{ singleton: number; database_uuid: string; binding_nonce: string }>();
    if (!identityRows.success || identityRows.results.length !== 1 || identityRows.results[0]?.singleton !== 1 || identityRows.results[0]?.database_uuid !== env.FACTORY_STORAGE_DATABASE_ID || identityRows.results[0]?.binding_nonce !== env.FACTORY_STORAGE_BINDING_NONCE) return reject("HISTORY_STORAGE_IDENTITY_UNAVAILABLE", 503);
    await schema(db);
    const identity: StorageIdentity = { databaseId: env.FACTORY_STORAGE_DATABASE_ID!, bindingNonce: env.FACTORY_STORAGE_BINDING_NONCE!, epoch: env.FACTORY_MIGRATION_EPOCH!, sourceSha: env.FACTORY_SOURCE_SHA!, workerBundleSha256: env.FACTORY_WORKER_BUNDLE_SHA256!, admissionFenced: env.FACTORY_ADMISSION_FENCE !== "" };
    // Observe initiation only; an exception after this point is not a rollback
    // receipt. This wraps the existing store, never reimplements its persistence.
    const store = new D1HistoryStore({ prepare: sql => db.prepare(sql), batch: statements => { batchStarted = true; return db.batch(statements); } });
    const result = op.op === "historyPage" ? await store.page(op.anchor, op.offset, op.limit) : op.op === "historyFrame" ? await store.frame(op.anchor, op.frameKey) : await store.append(op.batch);
    return reply({ ok: true, backend: "d1", op: op.op, identity, schemaVersion: 3, result });
  } catch (error) {
    if (batchStarted) return reply({ ok: false, backend: "d1", code: "HISTORY_WRITE_OUTCOME_UNKNOWN", error: "The write outcome is unknown. Read authoritative history before another explicit action; no retry was sent.", writeOutcome: "unknown" }, 503);
    const code = error instanceof Rejection ? error.code : known.has((error as { code?: string })?.code ?? "") ? (error as { code: string }).code : "HISTORY_STORAGE_UNAVAILABLE";
    const status = error instanceof Rejection ? error.status : code.endsWith("-cap") ? 429 : /conflict|already-used|non-spine|membership-unknown|unresolved|cycle/.test(code) ? 409 : known.has(code) ? 400 : 503;
    return reply({ ok: false, backend: "d1", code, error: status < 500 ? "The fixed history storage request was rejected." : "Authoritative history storage is unavailable.", writeOutcome: "not-started" }, status);
  }
}
