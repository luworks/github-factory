import { digest, snapshotKey, type WorldIdentity } from "../evidence/contracts";
import { worldIdentity } from "../evidence/captured";
import { worldShapeValid } from "../evidence/world-shape";
import type { ImmutableCommit, ImmutableTreeFrame, TopologyAnchor } from "../history/topology-contracts";
import { firstParentSpine, topologyScopeKey } from "../history/topology";
import { HistoryGitHubReader, type HistoryReaderDependencies, type HistoryReadResult } from "./history-github";
import { HistoryCursorCodec } from "./history-cursor";
import { HISTORY_STORAGE_LIMITS as L, type HistoryCursor, type HistoryFrameResult, type HistoryPage, type HistoryStore } from "./history-storage";
import type { SnapshotStore } from "./world-storage";

export interface HistoryServiceDependencies {
  cache: Pick<SnapshotStore, "get">;
  store: HistoryStore;
  cursor: HistoryCursorCodec;
  /** Original persisted quota + RAW fetch; never quota.wrap(fetch). */
  reader: Omit<HistoryReaderDependencies, "admitRequest" | "admitCollection" | "resolveCursor">;
  admitRequest: () => void | Promise<void>;
  admitCollection: () => void | Promise<void>;
  now?: () => number;
}
export interface HistoryCapture { identity: WorldIdentity; anchor: TopologyAnchor; stale: boolean; partial: boolean }
export interface HistoryActionResult {
  status: "saved" | "not-saved" | "partially-saved";
  capture: HistoryCapture | null;
  token: string | null;
  observed: HistoryReadResult | null;
  persisted: { commits: number; frames: number; batches: number; cursor: HistoryCursor | null };
  error: { code: string; status: number; message: string; retryAfter?: number } | null;
}
export class HistoryServiceError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly retryAfter?: number) { super(message); }
}
const reject = (code: string, status = 409, message = "History state changed or is unavailable. Read the current cached state before trying again.", retryAfter?: number): never => { throw new HistoryServiceError(code, status, message, retryAfter); };
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const only = (x: Record<string, unknown>, allowed: string[]) => Object.keys(x).every(k => allowed.includes(k));
const memberList = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.length <= 2 && x.every(v => typeof v === "string" && /^[a-f0-9]{40}$/.test(v)) && new Set(x).size === x.length;
const busy = new WeakSet<object>();
const sameCursor = (a: HistoryCursor, b: HistoryCursor) => a.revision === b.revision && a.retainedCommits === b.retainedCommits && a.nextParentSha === b.nextParentSha && a.reachedRoot === b.reachedRoot && a.termination === b.termination;
const frameKey = (repo: string, c: ImmutableCommit) => JSON.stringify([repo, c.sha, c.treeSha, topologyScopeKey({ prefix: "", recursive: true })]);

/** No runtime instance or route. Cache-only reads and explicit actions compose
 * the real bounded reader/store through injected authorities only. */
export class HistoryService {
  private now: () => number;
  constructor(private deps: HistoryServiceDependencies) { this.now = deps.now ?? Date.now; }
  private async capture(repo: string): Promise<HistoryCapture> {
    // Route/context supplies a canonical key; client action bodies cannot override it.
    if (typeof repo !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9_.-]{1,100}$/.test(repo) || [".", ".."].includes(repo.split("/")[1]!)) return reject("HISTORY_INVALID_REPOSITORY", 400, "A canonical repository key is required.");
    let entry; try { entry = await this.deps.cache.get(repo, this.now(), { readOnly: true }); } catch { return reject("HISTORY_CACHE_UNAVAILABLE", 503, "The cached repository is unavailable."); }
    if (!entry) return reject("HISTORY_CACHE_MISSING", 404, "No cached repository capture is available.");
    const identity = worldIdentity(entry.world, this.now());
    if (!identity || identity.source !== "github" || identity.repoKey !== repo || !worldShapeValid(entry.world)) return reject("HISTORY_CAPTURE_INVALID", 503, "The cached repository capture is not valid public source evidence.");
    const generation = await digest(["history-v1", snapshotKey(identity)]);
    return { identity, anchor: { repoKey: repo, sha: identity.headSha, generation }, stale: !entry.fresh, partial: entry.world.coverage.tree !== "full" || entry.world.health.github !== "ok" };
  }
  private async token(c: HistoryCapture, revision: number) { return this.deps.cursor.issue({ identity: c.identity, generation: c.anchor.generation, revision }); }
  private async verify(token: unknown, c: HistoryCapture, page: HistoryPage) {
    const claim = await this.deps.cursor.verify(token);
    if (!claim || snapshotKey(claim.identity) !== snapshotKey(c.identity) || claim.generation !== c.anchor.generation || claim.revision !== page.cursor.revision) return reject("HISTORY_CURSOR_STALE");
  }
  private async current(c: HistoryCapture) {
    const next = await this.capture(c.identity.repoKey);
    if (snapshotKey(next.identity) !== snapshotKey(c.identity)) return reject("HISTORY_CAPTURE_CHANGED");
  }
  private async revision(c: HistoryCapture): Promise<HistoryCursor> {
    // At the hard membership bound, this is a zero-fact metadata bookend.
    // It does not add an eleventh proof page or repeat fifty retained facts.
    const page = await this.deps.store.page(c.anchor, L.commits, 1);
    if (page.commits.length || page.nextOffset !== null || page.anchor.repoKey !== c.anchor.repoKey || page.anchor.sha !== c.anchor.sha || page.anchor.generation !== c.anchor.generation) return reject("HISTORY_CONTEXT_INVALID", 503);
    return page.cursor;
  }
  private async context(c: HistoryCapture, first: HistoryPage): Promise<ImmutableCommit[]> {
    if (first.cursor.retainedCommits > L.commits || first.commits.length > L.page) return reject("HISTORY_CONTEXT_INVALID", 503);
    const commits: ImmutableCommit[] = []; let page = first, offset = 0;
    for (let count = 0; count < 10; count++) {
      if (page.anchor.repoKey !== c.anchor.repoKey || page.anchor.sha !== c.anchor.sha || page.anchor.generation !== c.anchor.generation || !sameCursor(page.cursor, first.cursor) || page.status !== first.status || page.commits.length > L.page) return reject("HISTORY_CONTEXT_DRIFT");
      commits.push(...page.commits);
      if (commits.length > L.commits) return reject("HISTORY_CONTEXT_INVALID", 503);
      const expectedNext = commits.length < first.cursor.retainedCommits ? offset + L.page : null;
      if (page.nextOffset !== expectedNext || (expectedNext !== null && page.commits.length !== L.page)) return reject("HISTORY_CONTEXT_INVALID", 503);
      if (expectedNext === null) break;
      if (count === 9) return reject("HISTORY_CONTEXT_INVALID", 503);
      offset = expectedNext; page = await this.deps.store.page(c.anchor, offset, L.page);
    }
    const spine = firstParentSpine(c.anchor, commits);
    if (commits.length !== first.cursor.retainedCommits || !spine.ok || spine.value.nonSpineShas.length || JSON.stringify(spine.value.commits.map(v => v.sha)) !== JSON.stringify(commits.map(v => v.sha)) || spine.value.nextParentSha !== first.cursor.nextParentSha || spine.value.reachedRoot !== first.cursor.reachedRoot || spine.value.termination !== first.cursor.termination) return reject("HISTORY_CONTEXT_INVALID", 503);
    // Includes the last page: a concurrent writer cannot change the proof after
    // its first read without being detected, and append still performs CAS.
    if (!sameCursor(await this.revision(c), first.cursor)) return reject("HISTORY_CONTEXT_DRIFT");
    return commits;
  }
  async read(repo: string, input: unknown = {}): Promise<{ capture: HistoryCapture; history: HistoryPage; token: string; frames: HistoryFrameResult[] }> {
    await this.deps.admitRequest();
    try {
    if (!record(input) || !only(input, ["cursor", "offset", "members"]) || input.cursor !== undefined && typeof input.cursor !== "string" || input.offset !== undefined && (!Number.isSafeInteger(input.offset) || (input.offset as number) < 0 || (input.offset as number) > L.commits) || input.members !== undefined && !memberList(input.members)) return reject("HISTORY_INVALID_REQUEST", 400, "Invalid cache-only history request.");
    const c = await this.capture(repo), first = await this.deps.store.page(c.anchor, 0, L.page);
    if (input.cursor !== undefined) await this.verify(input.cursor, c, first);
    const frames: HistoryFrameResult[] = [];
    if (input.members) {
      const proof = await this.context(c, first);
      for (const sha of input.members as string[]) {
        const commit = proof.find(v => v.sha === sha); if (!commit) return reject("HISTORY_MEMBER_UNKNOWN", 400, "The selected frame is not a retained first-parent member.");
        frames.push(await this.deps.store.frame(c.anchor, frameKey(repo, commit)));
      }
    }
    const page = input.offset ? await this.deps.store.page(c.anchor, input.offset as number, L.page) : first;
    if (!sameCursor(page.cursor, first.cursor) || !sameCursor(await this.revision(c), first.cursor)) return reject("HISTORY_CONTEXT_DRIFT");
    await this.current(c);
    return { capture: c, history: page, token: await this.token(c, first.cursor.revision), frames };
    } catch (error) {
      if (error instanceof HistoryServiceError) throw error;
      const e = error as { code?: string };
      return reject(e.code ?? "HISTORY_UNAVAILABLE", e.code?.includes("conflict") ? 409 : 503, "The authoritative cached history is unavailable. No collection or repair was attempted.");
    }
  }
  async act(repo: string, input: unknown): Promise<HistoryActionResult> {
    const result: HistoryActionResult = { status: "not-saved", capture: null, token: null, observed: null, persisted: { commits: 0, frames: 0, batches: 0, cursor: null }, error: null };
    const authority = this.deps.reader.quota as object; let held = false;
    try {
      // One invocation-specific request admission. The reader only verifies this
      // settled local guard; it never calls admission again or shares a promise.
      await this.deps.admitRequest(); const requestAdmitted = true;
      if (busy.has(authority)) return reject("HISTORY_BUSY", 409, "A history action is still settling. Try again later.");
      busy.add(authority); held = true;
      if (!record(input) || !only(input, ["action", "cursor", "members"]) || typeof input.cursor !== "string" || (input.action !== "walk" && input.action !== "frames") || input.action === "walk" && Object.hasOwn(input, "members") || input.action === "frames" && !memberList(input.members)) return reject("HISTORY_INVALID_REQUEST", 400, "Only explicit history walk or retained frame selections are allowed.");
      const action = input.action, members = action === "frames" ? [...input.members as string[]] : [];
      const c = await this.capture(repo); result.capture = c;
      const first = await this.deps.store.page(c.anchor, 0, L.page); result.persisted.cursor = first.cursor;
      await this.verify(input.cursor, c, first);
      const context = await this.context(c, first);
      if (action === "frames" && members.some(sha => !context.some(v => v.sha === sha))) return reject("HISTORY_MEMBER_UNKNOWN", 400, "The selected frame is not a retained first-parent member.");
      if (action === "walk" && (context.length >= L.commits || context.length > 0 && !first.cursor.nextParentSha)) return reject("HISTORY_WALK_STOPPED", 409, "This retained window has reached its root, unknown-parent boundary or capacity.");
      if (first.retention.normalizedBytes >= L.bytes || first.retention.receipts >= L.receipts || first.status === "missing-anchor" && first.retention.anchors >= L.anchors) return reject("HISTORY_CAPACITY", 429, "History retention capacity is exhausted.");
      if (action === "frames") {
        let missing = 0;
        for (const sha of members) if ((await this.deps.store.frame(c.anchor, frameKey(repo, context.find(v => v.sha === sha)!))).status !== "available") missing++;
        if (first.retention.frames + missing > L.frames) return reject("HISTORY_CAPACITY", 429, "History frame retention capacity is exhausted.");
      }
      const handle = { id: "server_verified", repoKey: repo, anchorSha: c.anchor.sha, generation: c.anchor.generation };
      const reader = new HistoryGitHubReader({ ...this.deps.reader,
        admitRequest: () => { if (!requestAdmitted || !held || !busy.has(authority)) return reject("HISTORY_AUTHORITY_LOST"); },
        admitCollection: this.deps.admitCollection,
        resolveCursor: h => h.id === handle.id && h.repoKey === repo && h.anchorSha === c.anchor.sha && h.generation === c.anchor.generation ? { anchor: c.anchor, commits: context, nextParentSha: first.cursor.nextParentSha } : null,
      });
      result.observed = await reader.read({ repo, anchorSha: c.anchor.sha, generation: c.anchor.generation, action, frameShas: members, ...(context.length ? { cursor: handle } : {}) });
      if (result.observed.coverage.errors.length || result.observed.outcome === "rejected") {
        const error = result.observed.coverage.errors[0]; return reject(error?.code ?? "HISTORY_READER_REJECTED", error?.status ?? 503, "GitHub history was not saved because the bounded read did not complete.", error?.retryAfter);
      }
      await this.current(c);
      const oldFacts = new Map(context.map(v => [v.sha, JSON.stringify(v)]));
      const commits = result.observed.commits.filter(v => oldFacts.get(v.sha) !== JSON.stringify(v));
      if (commits.length > 4 || result.observed.frames.length > 2) return reject("HISTORY_UNIT_INVALID", 503);
      let cursor = first.cursor;
      const actionId = crypto.randomUUID().replaceAll("-", "");
      const save = async (unit: { kind: "commits"; complete: true; commits: ImmutableCommit[] } | { kind: "frames"; complete: true; frames: ImmutableTreeFrame[] }, suffix: string) => {
        await this.current(c);
        const saved = await this.deps.store.append({ anchor: c.anchor, batchId: `${actionId}_${suffix}`, actionId: `${actionId}_${suffix}`, expectedRevision: cursor.revision, expectedCursor: cursor, unit });
        cursor = saved.currentCursor; result.persisted.cursor = cursor; result.persisted.batches++; result.status = "partially-saved";
      };
      if (commits.length) { await save({ kind: "commits", complete: true, commits }, "commits"); result.persisted.commits = commits.length; }
      if (result.observed.frames.length) { await save({ kind: "frames", complete: true, frames: result.observed.frames }, "frames"); result.persisted.frames = result.observed.frames.length; }
      result.status = result.persisted.batches ? "saved" : "not-saved";
      result.token = await this.token(c, cursor.revision);
    } catch (error) {
      const e = error as { code?: string; status?: number; retryAfter?: number; message?: string };
      result.error = { code: e.code ?? "HISTORY_UNAVAILABLE", status: e.status ?? (e.code?.includes("conflict") ? 409 : e.code?.endsWith("-cap") ? 429 : 503), message: error instanceof HistoryServiceError ? error.message : "History storage or admission is unavailable. No automatic retry was attempted.", ...(e.retryAfter !== undefined ? { retryAfter: e.retryAfter } : {}) };
    } finally { if (held) busy.delete(authority); }
    return result;
  }
}
