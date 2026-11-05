import type { FirstParentSpine, ImmutableCommit, ImmutableTreeFrame, TopologyAnchor } from "../history/topology-contracts";
import { firstParentSpine, validateTopologyAnchor } from "../history/topology";

/** Offline storage contract only. No route, credential, clock, quota or model dependency. */
export const HISTORY_STORAGE_LIMITS = Object.freeze({ commits: 500, frames: 8, bytes: 12 * 1024 * 1024, anchors: 8, receipts: 512, page: 50, chunkBytes: 64 * 1024 });
export interface HistoryCursor {
  readonly revision: number;
  readonly retainedCommits: number;
  readonly nextParentSha: string | null;
  readonly reachedRoot: true | null;
  readonly termination: FirstParentSpine["termination"];
}
export interface HistoryAppendBatch {
  readonly anchor: TopologyAnchor;
  readonly batchId: string;
  readonly actionId: string;
  readonly expectedRevision: number;
  readonly expectedCursor: HistoryCursor;
  /** Complete means this bounded fetch/parse unit succeeded, not complete repository history. */
  readonly unit: { readonly kind: "commits"; readonly complete: true; readonly commits: readonly ImmutableCommit[] }
    | { readonly kind: "frames"; readonly complete: true; readonly frames: readonly ImmutableTreeFrame[] };
}
export interface HistoryRetention { readonly commits: number; readonly memberships: number; readonly frames: number; readonly anchors: number; readonly receipts: number; readonly normalizedBytes: number; readonly physicalBytes: null }
export interface HistoryPage {
  readonly status: "available" | "missing-anchor";
  readonly anchor: TopologyAnchor;
  readonly cursor: HistoryCursor;
  readonly commits: readonly ImmutableCommit[];
  readonly nextOffset: number | null;
  readonly completeHistory: false;
  readonly total: null;
  readonly retention: HistoryRetention;
}
export interface HistoryAppendResult {
  readonly idempotent: boolean;
  /** Original receipt vs current state are deliberately separate on an old retry. */
  readonly acceptedCursor: HistoryCursor;
  readonly currentCursor: HistoryCursor;
  readonly retention: HistoryRetention;
}
export type HistoryFrameResult = { readonly status: "available"; readonly frame: ImmutableTreeFrame }
  | { readonly status: "missing-anchor" | "not-member" | "missing-frame" };
export interface HistoryStore {
  append(batch: HistoryAppendBatch): Promise<HistoryAppendResult>;
  page(anchor: TopologyAnchor, offset?: number, limit?: number): Promise<HistoryPage>;
  frame(anchor: TopologyAnchor, frameKey: string): Promise<HistoryFrameResult>;
}
export class HistoryStorageError extends Error {
  constructor(readonly code: string) { super(code); this.name = "HistoryStorageError"; }
}
export const historyReject = (code: string): never => { throw new HistoryStorageError(code); };
export function historyAnchor(input: unknown): TopologyAnchor {
  const result = validateTopologyAnchor(input); return result.ok ? result.value : historyReject(result.code);
}
export function historyCursor(anchor: TopologyAnchor, commits: readonly ImmutableCommit[], revision: number): HistoryCursor {
  const result = firstParentSpine(anchor, commits);
  if (!result.ok) return historyReject(result.code);
  if (result.value.nonSpineShas.length) return historyReject("non-spine-commit");
  return { revision, retainedCommits: result.value.commits.length, nextParentSha: result.value.nextParentSha, reachedRoot: result.value.reachedRoot, termination: result.value.termination };
}
export function validHistoryCursor(input: unknown): input is HistoryCursor {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const x = input as Record<string, unknown>;
  return Object.keys(x).length === 5 && ["revision", "retainedCommits", "nextParentSha", "reachedRoot", "termination"].every(k => Object.hasOwn(x, k))
    && Number.isSafeInteger(x.revision) && (x.revision as number) >= 0 && Number.isSafeInteger(x.retainedCommits) && (x.retainedCommits as number) >= 0 && (x.retainedCommits as number) <= HISTORY_STORAGE_LIMITS.commits
    && (x.nextParentSha === null || typeof x.nextParentSha === "string" && /^[a-f0-9]{40}$/.test(x.nextParentSha)) && (x.reachedRoot === true || x.reachedRoot === null)
    && ["observed-root", "missing-anchor", "missing-parent", "parents-unobserved", "cycle", "window-cap"].includes(x.termination as string);
}
