import type { ImmutableCommit, ImmutableTreeFrame, TopologyAnchor } from "../src/history/topology-contracts";
import { coalesceImmutableCommit, coalesceImmutableFrame, compareTopologyFrames, firstParentSpine, topologyBytes, topologyFrameKey, validateImmutableCommit, validateImmutableTreeFrame } from "../src/history/topology";
import { codePointCompare, digest } from "../src/evidence/contracts";
import { HISTORY_STORAGE_LIMITS as L, HistoryStorageError, historyAnchor, historyCursor, historyReject, validHistoryCursor, type HistoryAppendBatch, type HistoryAppendResult, type HistoryCursor, type HistoryFrameResult, type HistoryPage, type HistoryRetention, type HistoryStore } from "../src/server/history-storage";

/** Minimal injectable D1 shape. No HTTP/RPC surface and no production fallback.
 * batch MUST have D1's all-statements-atomic/rollback-on-error semantics. */
export interface HistoryStatement {
  bind(...values: unknown[]): HistoryStatement;
  all<T>(): Promise<{ success: boolean; results: T[] }>;
  first<T>(): Promise<T | null>;
}
export interface HistoryD1Binding {
  prepare(sql: string): HistoryStatement;
  batch(statements: HistoryStatement[]): Promise<{ success: boolean }[]>;
  withSession?(constraint: "first-primary"): HistoryD1Binding;
}
interface AnchorRow { anchor: TopologyAnchor; cursor: HistoryCursor; members: string[] }
interface Manifest { frame_key: string; commit_sha: string; chunk_count: number; payload_bytes: number; payload_hash: string }
interface Receipt { batchId: string; actionId: string; anchorKey: string; fingerprint: string; acceptedCursor: HistoryCursor }
interface State {
  revision: number; normalizedBytes: number; commits: Map<string, ImmutableCommit>; anchors: Map<string, AnchorRow>;
  manifests: Map<string, Manifest>; receipts: number; receiptBytes: number;
}
const key = (a: TopologyAnchor) => JSON.stringify([a.sha, a.generation]);
const json = JSON.stringify;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fields = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(n => Object.hasOwn(v, n));
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const cursorValue = (c: HistoryCursor): HistoryCursor => ({ revision: c.revision, retainedCommits: c.retainedCommits, nextParentSha: c.nextParentSha, reachedRoot: c.reachedRoot, termination: c.termination });
function unwrap<T>(r: { ok: true; value: T } | { ok: false; code: string }): T { return r.ok ? r.value : historyReject(r.code); }
function corrupt(): never { return historyReject("history-storage-unavailable"); }
const emptyRetention = (): HistoryRetention => ({ commits: 0, memberships: 0, frames: 0, anchors: 0, receipts: 0, normalizedBytes: 0, physicalBytes: null });

/** Strings remain valid UTF-8 independently, including characters crossing the
 * byte boundary. Each D1 bound parameter remains below its 100KB limit. */
function chunks(payload: string): string[] {
  const encoded = new TextEncoder().encode(payload), result: string[] = [];
  for (let at = 0; at < encoded.length;) {
    let end = Math.min(at + L.chunkBytes, encoded.length);
    while (end < encoded.length && (encoded[end]! & 0xc0) === 0x80) end--;
    result.push(new TextDecoder("utf-8", { fatal: true }).decode(encoded.subarray(at, end))); at = end;
  }
  return result;
}

/** Every limit can only be reduced for isolated deployments/tests. No eviction. */
export class D1HistoryStore implements HistoryStore {
  private readonly limits: typeof L;
  constructor(private readonly binding: HistoryD1Binding, limits: Partial<Record<"commits" | "frames" | "bytes" | "anchors" | "receipts", number>> = {}) {
    for (const [name, value] of Object.entries(limits)) if (!["commits", "frames", "bytes", "anchors", "receipts"].includes(name) || !Number.isSafeInteger(value) || value < 1 || value > L[name as keyof typeof L]) historyReject("invalid-storage-limit");
    this.limits = { ...L, ...limits } as typeof L;
  }
  private async safe<T>(action: (db: HistoryD1Binding) => Promise<T>): Promise<T> {
    try { return await action(this.binding.withSession?.("first-primary") ?? this.binding); }
    catch (error) { if (error instanceof HistoryStorageError) throw error; return corrupt(); }
  }
  private async all<T>(db: HistoryD1Binding, sql: string, values: unknown[], max: number): Promise<T[]> {
    const r = await db.prepare(sql).bind(...values).all<T>();
    if (!r.success || !Array.isArray(r.results) || r.results.length > max) return corrupt();
    return r.results;
  }
  private async revision(db: HistoryD1Binding, repo: string): Promise<number> {
    const row = await db.prepare("SELECT revision FROM history_repositories WHERE repo=?").bind(repo).first<{ revision: number }>();
    if (row && (!Number.isSafeInteger(row.revision) || row.revision < 0)) return corrupt();
    return row?.revision ?? -1;
  }
  private async state(db: HistoryD1Binding, repo: string): Promise<State> {
    const row = await db.prepare("SELECT revision,normalized_bytes FROM history_repositories WHERE repo=?").bind(repo).first<{ revision: number; normalized_bytes: number }>();
    const state: State = { revision: row?.revision ?? -1, normalizedBytes: row?.normalized_bytes ?? 0, commits: new Map(), anchors: new Map(), manifests: new Map(), receipts: 0, receiptBytes: 0 };
    if (!row) return state;
    if (!Number.isSafeInteger(row.revision) || row.revision < 0 || !Number.isSafeInteger(row.normalized_bytes) || row.normalized_bytes < 0 || row.normalized_bytes > L.bytes) return corrupt();
    // Bounded keyset pages: never materialize an unbounded history table.
    let after = "";
    for (;;) {
      const rows = await this.all<{ sha: string; payload: string }>(db, "SELECT sha,payload FROM history_commits WHERE repo=? AND sha>? ORDER BY sha LIMIT 50", [repo, after], L.page);
      for (const r of rows) {
        if (bytes(r.payload) > 2048) return corrupt();
        const c = unwrap(validateImmutableCommit(JSON.parse(r.payload)));
        if (c.repoKey !== repo || c.sha !== r.sha || json(c) !== r.payload || state.commits.has(c.sha)) return corrupt();
        state.commits.set(c.sha, c);
        if (state.commits.size > this.limits.commits) return corrupt();
        after = r.sha;
      }
      if (rows.length < L.page) break;
    }
    const anchors = await this.all<{ anchor_key: string; generation: string; payload: string }>(db, "SELECT anchor_key,generation,payload FROM history_anchors WHERE repo=? ORDER BY anchor_key LIMIT 9", [repo], this.limits.anchors);
    for (const r of anchors) {
      if (bytes(r.payload) > 32 * 1024) return corrupt();
      const a = JSON.parse(r.payload) as AnchorRow;
      if (!record(a) || !fields(a as unknown as Record<string, unknown>, ["anchor", "cursor", "members"]) || !validHistoryCursor(a.cursor) || !Array.isArray(a.members) || a.members.length > this.limits.commits || new Set(a.members).size !== a.members.length || a.members.some(s => !state.commits.has(s))) return corrupt();
      const anchor = historyAnchor(a.anchor);
      if (anchor.repoKey !== repo || key(anchor) !== r.anchor_key || anchor.generation !== r.generation || a.cursor.retainedCommits !== a.members.length) return corrupt();
      const spine = unwrap(firstParentSpine(anchor, a.members.map(s => state.commits.get(s)!)));
      if (json(spine.commits.map(c => c.sha)) !== json(a.members) || spine.nonSpineShas.length) return corrupt();
      state.anchors.set(r.anchor_key, a);
    }
    const manifests = await this.all<Manifest>(db, "SELECT frame_key,commit_sha,chunk_count,payload_bytes,payload_hash FROM history_frames WHERE repo=? ORDER BY frame_key LIMIT 9", [repo], this.limits.frames);
    for (const m of manifests) {
      if (!state.commits.has(m.commit_sha) || !Number.isSafeInteger(m.chunk_count) || m.chunk_count < 1 || m.chunk_count > 9 || !Number.isSafeInteger(m.payload_bytes) || m.payload_bytes < 1 || m.payload_bytes > 512 * 1024 || !/^[a-f0-9]{64}$/.test(m.payload_hash) || m.frame_key.length > 2048) return corrupt();
      state.manifests.set(m.frame_key, m);
    }
    const counts = await db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM history_batches WHERE repo=?").bind(repo).first<{ count: number; bytes: number }>();
    if (!counts || !Number.isSafeInteger(counts.count) || counts.count < 0 || counts.count > this.limits.receipts || !Number.isSafeInteger(counts.bytes) || counts.bytes < 0 || counts.bytes > L.bytes) return corrupt();
    state.receipts = counts.count; state.receiptBytes = counts.bytes;
    if (this.logicalBytes(repo, state, state.revision) !== state.normalizedBytes || await this.revision(db, repo) !== state.revision) return historyReject("history-revision-conflict");
    return state;
  }
  private logicalBytes(repo: string, state: State, revision: number): number {
    return topologyBytes({ repo, revision }) + [...state.commits.values()].reduce((n, c) => n + topologyBytes(c), 0)
      + [...state.anchors.values()].reduce((n, a) => n + topologyBytes(a), 0)
      + [...state.manifests.values()].reduce((n, m) => n + topologyBytes(m) + m.payload_bytes, 0) + state.receiptBytes;
  }
  private retention(s: State): HistoryRetention {
    return { commits: s.commits.size, memberships: [...s.anchors.values()].reduce((n, a) => n + a.members.length, 0), frames: s.manifests.size, anchors: s.anchors.size, receipts: s.receipts, normalizedBytes: s.normalizedBytes, physicalBytes: null };
  }
  private async decode(db: HistoryD1Binding, repo: string, manifest: Manifest, commit: ImmutableCommit): Promise<ImmutableTreeFrame> {
    const rows = await this.all<{ ordinal: number; payload: string }>(db, "SELECT ordinal,payload FROM history_frame_chunks WHERE repo=? AND frame_key=? ORDER BY ordinal LIMIT 10", [repo, manifest.frame_key], 9);
    if (rows.length !== manifest.chunk_count || rows.some((r, i) => r.ordinal !== i || bytes(r.payload) > L.chunkBytes)) return corrupt();
    const payload = rows.map(r => r.payload).join("");
    if (bytes(payload) !== manifest.payload_bytes || await digest(JSON.parse(payload)) !== manifest.payload_hash) return corrupt();
    const frame = unwrap(validateImmutableTreeFrame(JSON.parse(payload), commit));
    if (json(frame) !== payload || topologyFrameKey(frame) !== manifest.frame_key) return corrupt();
    return frame;
  }
  async page(anchorInput: TopologyAnchor, offset = 0, limit: number = L.page): Promise<HistoryPage> {
    const anchor = historyAnchor(anchorInput);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > L.commits || !Number.isSafeInteger(limit) || limit < 1 || limit > L.page) return historyReject("invalid-history-page");
    return this.safe(async db => {
      const s = await this.state(db, anchor.repoKey), a = s.anchors.get(key(anchor));
      return { status: a ? "available" : "missing-anchor", anchor, cursor: a?.cursor ?? historyCursor(anchor, [], 0), commits: a ? a.members.slice(offset, offset + limit).map(sha => s.commits.get(sha)!) : [], nextOffset: a && offset + limit < a.members.length ? offset + limit : null, completeHistory: false, total: null, retention: s.revision === -1 ? emptyRetention() : this.retention(s) };
    });
  }
  async frame(anchorInput: TopologyAnchor, frameKey: string): Promise<HistoryFrameResult> {
    const anchor = historyAnchor(anchorInput);
    if (typeof frameKey !== "string" || frameKey.length > 2048) return historyReject("invalid-frame-key");
    return this.safe(async db => {
      const s = await this.state(db, anchor.repoKey), a = s.anchors.get(key(anchor));
      if (!a) return { status: "missing-anchor" };
      let parts: unknown; try { parts = JSON.parse(frameKey); } catch { return historyReject("invalid-frame-key"); }
      if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== anchor.repoKey || !a.members.includes(parts[1])) return { status: "not-member" };
      const m = s.manifests.get(frameKey); if (!m) return { status: "missing-frame" };
      const frame = await this.decode(db, anchor.repoKey, m, s.commits.get(m.commit_sha)!);
      if (await this.revision(db, anchor.repoKey) !== s.revision) return historyReject("history-revision-conflict");
      return { status: "available", frame };
    });
  }
  async append(input: HistoryAppendBatch): Promise<HistoryAppendResult> {
    // Runtime validation is intentional even though internal callers have types.
    if (!record(input) || !fields(input, ["anchor", "batchId", "actionId", "expectedRevision", "expectedCursor", "unit"]) || !id(input.batchId) || !id(input.actionId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !validHistoryCursor(input.expectedCursor) || input.expectedCursor.revision !== input.expectedRevision || !record(input.unit) || input.unit.complete !== true) return historyReject("invalid-history-batch");
    const anchor = historyAnchor(input.anchor), repo = anchor.repoKey, anchorKey = key(anchor), unit = input.unit;
    if (unit.kind === "commits" ? !fields(unit, ["kind", "complete", "commits"]) || !Array.isArray(unit.commits) || unit.commits.length < 1 || unit.commits.length > 4 : unit.kind === "frames" ? !fields(unit, ["kind", "complete", "frames"]) || !Array.isArray(unit.frames) || unit.frames.length < 1 || unit.frames.length > 2 : true) return historyReject("invalid-history-unit");
    return this.safe(async db => {
      const s = await this.state(db, repo), prior = s.anchors.get(anchorKey);
      if ([...s.anchors.values()].some(a => a.anchor.generation === anchor.generation && a.anchor.sha !== anchor.sha)) return historyReject("anchor-generation-conflict");
      const current = prior?.cursor ?? historyCursor(anchor, [], 0), normalizedCommits: ImmutableCommit[] = [], normalizedFrames: ImmutableTreeFrame[] = [];
      const changedCommits = new Map<string, ImmutableCommit>();
      if (unit.kind === "commits") {
        for (const raw of unit.commits) {
          const c = unwrap(validateImmutableCommit(raw)); if (c.repoKey !== repo) return historyReject("repo-mismatch");
          if (normalizedCommits.some(x => x.sha === c.sha)) return historyReject("duplicate-batch-commit");
          normalizedCommits.push(c); const old = s.commits.get(c.sha); changedCommits.set(c.sha, old ? unwrap(coalesceImmutableCommit(old, c)) : c);
        }
      } else {
        for (const raw of unit.frames) {
          if (!record(raw) || !Object.hasOwn(raw, "sourceCompleteness")) return historyReject("normalized-frame-required");
          const c = s.commits.get(raw.commitSha as string); if (!c || !prior?.members.includes(c.sha)) return historyReject("frame-membership-unknown");
          const f = unwrap(validateImmutableTreeFrame(raw, c)); if (normalizedFrames.some(x => topologyFrameKey(x) === topologyFrameKey(f))) return historyReject("duplicate-batch-frame");
          normalizedFrames.push(f);
        }
      }
      normalizedCommits.sort((a, b) => codePointCompare(a.sha, b.sha)); normalizedFrames.sort((a, b) => codePointCompare(topologyFrameKey(a), topologyFrameKey(b)));
      const fingerprint = await digest({ anchor, batchId: input.batchId, actionId: input.actionId, expectedRevision: input.expectedRevision, expectedCursor: cursorValue(input.expectedCursor), unit: unit.kind === "commits" ? { kind: "commits", complete: true, commits: normalizedCommits } : { kind: "frames", complete: true, frames: normalizedFrames } });
      const previous = await db.prepare("SELECT payload FROM history_batches WHERE repo=? AND batch_id=?").bind(repo, input.batchId).first<{ payload: string }>();
      if (previous) {
        if (bytes(previous.payload) > 2048) return corrupt();
        const receipt = JSON.parse(previous.payload) as Receipt;
        if (receipt.fingerprint !== fingerprint || receipt.anchorKey !== anchorKey || receipt.batchId !== input.batchId || receipt.actionId !== input.actionId || !validHistoryCursor(receipt.acceptedCursor)) return historyReject("batch-payload-conflict");
        if (await this.revision(db, repo) !== s.revision) return historyReject("history-revision-conflict");
        return { idempotent: true, acceptedCursor: receipt.acceptedCursor, currentCursor: current, retention: this.retention(s) };
      }
      if (json(cursorValue(input.expectedCursor)) !== json(current)) return historyReject("history-revision-conflict");
      if (await db.prepare("SELECT batch_id FROM history_batches WHERE repo=? AND anchor_key=? AND action_id=?").bind(repo, anchorKey, input.actionId).first()) return historyReject("action-already-used");
      const oldRepoRevision = s.revision, nextRepoRevision = Math.max(0, s.revision) + 1, oldAnchorPayload = prior ? json(prior) : null;
      let acceptedCursor: HistoryCursor, members = prior?.members ?? [];
      if (unit.kind === "commits") {
        const memberFacts = new Map(members.map(sha => [sha, s.commits.get(sha)!]));
        for (const [sha, commit] of changedCommits) memberFacts.set(sha, commit);
        if (memberFacts.size > this.limits.commits) return historyReject("history-commit-cap");
        const spine = unwrap(firstParentSpine(anchor, [...memberFacts.values()]));
        if (spine.nonSpineShas.length || spine.commits.length < members.length || members.some((sha, i) => spine.commits[i]?.sha !== sha)) return historyReject("non-spine-commit");
        members = spine.commits.map(c => c.sha); acceptedCursor = historyCursor(anchor, spine.commits, current.revision + 1);
      } else acceptedCursor = { ...current, revision: current.revision + 1 };
      for (const [sha, c] of changedCommits) s.commits.set(sha, c);
      s.anchors.set(anchorKey, { anchor, cursor: acceptedCursor, members });
      const changedFrames = new Map<string, { frame: ImmutableTreeFrame; pieces: string[]; manifest: Manifest }>();
      for (const f of normalizedFrames) {
        const frameKey = topologyFrameKey(f), c = s.commits.get(f.commitSha)!, old = s.manifests.get(frameKey);
        const merged = old ? unwrap(coalesceImmutableFrame(await this.decode(db, repo, old, c), f, c)) : f;
        // Decode one old frame at a time; never retain eight decoded frames.
        for (const [otherKey, m] of s.manifests) {
          if (otherKey === frameKey) continue;
          const other = changedFrames.get(otherKey)?.frame ?? await this.decode(db, repo, m, s.commits.get(m.commit_sha)!);
          if (other.treeSha === merged.treeSha) unwrap(compareTopologyFrames(other, merged, s.commits.get(other.commitSha)!, c));
        }
        const payload = json(merged), pieces = chunks(payload), manifest: Manifest = { frame_key: frameKey, commit_sha: merged.commitSha, chunk_count: pieces.length, payload_bytes: bytes(payload), payload_hash: await digest(merged) };
        changedFrames.set(frameKey, { frame: merged, pieces, manifest }); s.manifests.set(frameKey, manifest);
      }
      const receipt: Receipt = { batchId: input.batchId, actionId: input.actionId, anchorKey, fingerprint, acceptedCursor };
      s.receipts++; s.receiptBytes += topologyBytes(receipt); s.normalizedBytes = this.logicalBytes(repo, s, nextRepoRevision);
      if (s.commits.size > this.limits.commits || members.length > this.limits.commits) return historyReject("history-commit-cap");
      if (s.anchors.size > this.limits.anchors) return historyReject("history-anchor-cap");
      if (s.manifests.size > this.limits.frames) return historyReject("history-frame-cap");
      if (s.receipts > this.limits.receipts) return historyReject("history-receipt-cap");
      if (s.normalizedBytes > this.limits.bytes) return historyReject("history-byte-cap");
      const statements: HistoryStatement[] = [];
      const add = (sql: string, ...values: unknown[]) => statements.push(db.prepare(sql).bind(...values));
      add("INSERT INTO history_repositories(repo,revision,normalized_bytes) VALUES(?,0,0) ON CONFLICT(repo) DO NOTHING", repo);
      // The CHECK failure rolls back even the preceding repository creation.
      // Both repo and anchor observations are compared inside this transaction.
      add(`INSERT INTO history_append_guards(repo,accepted) SELECT ?,CASE WHEN
        (SELECT revision FROM history_repositories WHERE repo=?)=? AND
        COALESCE((SELECT payload FROM history_anchors WHERE repo=? AND anchor_key=?),'')=?
        THEN 1 ELSE 0 END`, repo, repo, Math.max(0, oldRepoRevision), repo, anchorKey, oldAnchorPayload ?? "");
      for (const [sha, c] of changedCommits) add("INSERT INTO history_commits(repo,sha,payload) VALUES(?,?,?) ON CONFLICT(repo,sha) DO UPDATE SET payload=excluded.payload", repo, sha, json(c));
      add("INSERT INTO history_anchors(repo,anchor_key,generation,payload) VALUES(?,?,?,?) ON CONFLICT(repo,anchor_key) DO UPDATE SET payload=excluded.payload", repo, anchorKey, anchor.generation, json(s.anchors.get(anchorKey)));
      for (const [frameKey, f] of changedFrames) {
        add("DELETE FROM history_frame_chunks WHERE repo=? AND frame_key=?", repo, frameKey);
        add("INSERT INTO history_frames(repo,frame_key,commit_sha,chunk_count,payload_bytes,payload_hash) VALUES(?,?,?,?,?,?) ON CONFLICT(repo,frame_key) DO UPDATE SET chunk_count=excluded.chunk_count,payload_bytes=excluded.payload_bytes,payload_hash=excluded.payload_hash", repo, frameKey, f.manifest.commit_sha, f.manifest.chunk_count, f.manifest.payload_bytes, f.manifest.payload_hash);
        f.pieces.forEach((piece, i) => add("INSERT INTO history_frame_chunks(repo,frame_key,ordinal,payload) VALUES(?,?,?,?)", repo, frameKey, i, piece));
      }
      add("INSERT INTO history_batches(repo,batch_id,action_id,anchor_key,fingerprint,payload) VALUES(?,?,?,?,?,?)", repo, input.batchId, input.actionId, anchorKey, fingerprint, json(receipt));
      add("UPDATE history_repositories SET revision=?,normalized_bytes=? WHERE repo=?", nextRepoRevision, s.normalizedBytes, repo);
      add("DELETE FROM history_append_guards WHERE repo=?", repo);
      const results = await db.batch(statements);
      if (results.length !== statements.length || results.some(r => !r.success)) return corrupt();
      return { idempotent: false, acceptedCursor, currentCursor: acceptedCursor, retention: this.retention(s) };
    });
  }
}
