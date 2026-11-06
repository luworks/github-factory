import { historyAnchor, validHistoryCursor, type HistoryAppendBatch } from "./history-storage";
import { topologyBytes, topologyFrameKey, topologyPath, validateImmutableCommit } from "../history/topology";
import type { ImmutableTreeFrame, TopologyAnchor } from "../history/topology-contracts";

export const HISTORY_RPC_URL = "https://chaorders.com/github-factory/_storage/history";
/** SHA256 of committed, UNAPPLIED deploy/d1/0003-history.sql, not a claim that
 * the current Worker/bootstrap accepts schema3 or that this endpoint is live. */
export const HISTORY_SCHEMA3_SQL_SHA256 = "6b0f837993b07fee15e7ebf45244b55fa7d9303dfb1ed6a0a885ae0979892994";

export class HistoryRpcInputError extends Error { readonly code = "HISTORY_RPC_INVALID_REQUEST"; readonly status = 400; constructor() { super("Invalid fixed history storage operation."); } }
const reject = (): never => { throw new HistoryRpcInputError(); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const historyWireInteger = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);

const integer = historyWireInteger;

export function parseHistoryWireJson(text: string): unknown {
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

function normalizedFrame(input: unknown, anchor: TopologyAnchor): ImmutableTreeFrame {
  if (!record(input) || !exact(input, ["schemaVersion", "repoKey", "commitSha", "treeSha", "scope", "completeness", "sourceCompleteness", "sourceOmittedEntries", "entries", "inputEntryCount", "omittedInputEntries", "deduplicatedInputEntries", "limits", "provenance", "omittedProvenance"]) || input.schemaVersion !== 1 || input.repoKey !== anchor.repoKey || !sha(input.commitSha) || !sha(input.treeSha) || !record(input.scope) || !exact(input.scope, ["prefix", "recursive"]) || !(input.scope.prefix === "" || topologyPath(input.scope.prefix)) || input.scope.recursive !== true) return reject();
  if (!["full", "partial"].includes(input.completeness as string) || !["full", "partial"].includes(input.sourceCompleteness as string) || !(input.sourceOmittedEntries === null || integer(input.sourceOmittedEntries)) || !(input.omittedProvenance === null || integer(input.omittedProvenance)) || !integer(input.inputEntryCount) || !integer(input.omittedInputEntries) || !integer(input.deduplicatedInputEntries) || !Array.isArray(input.entries) || input.entries.length > 8000 || !Array.isArray(input.limits) || input.limits.length > 2 || new Set(input.limits).size !== input.limits.length || input.limits.some(v => v !== "entry-cap" && v !== "byte-cap")) return reject();
  if (input.entries.some(e => !record(e) || !exact(e, ["path", "type", "sha"]) || !topologyPath(e.path) || !["blob", "tree", "symlink", "submodule"].includes(e.type as string) || !sha(e.sha)) || !Array.isArray(input.provenance) || input.provenance.length < 1 || input.provenance.length > 8 || input.provenance.some(p => !record(p) || !exact(p, ["sourceUrl", "fetchedAt"]) || ![`https://github.com/${anchor.repoKey}/tree/${input.commitSha}`, `https://api.github.com/repos/${anchor.repoKey}/git/trees/${input.treeSha}?recursive=1`].includes(p.sourceUrl as string) || typeof p.fetchedAt !== "string" || p.fetchedAt.length > 64 || !Number.isFinite(Date.parse(p.fetchedAt))) || topologyBytes(input) > 512 * 1024) return reject();
  // Identity-dependent C1 semantics (including normalized duplicates, ancestor
  // conflicts and source timestamps) are validated by the ORIGINAL store against
  // its retained commit, never a manufactured commit or independent persistence.
  return input as unknown as ImmutableTreeFrame;
}
export type HistoryRpcOperation = { op: "historyPage"; anchor: TopologyAnchor; offset: number; limit: number } | { op: "historyFrame"; anchor: TopologyAnchor; frameKey: string } | { op: "historyAppend"; batch: HistoryAppendBatch };
export function parseHistoryRpcOperation(input: unknown): HistoryRpcOperation {
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
