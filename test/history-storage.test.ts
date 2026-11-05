import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { D1HistoryStore, type HistoryD1Binding, type HistoryStatement } from "../deploy/history-storage";
import { HISTORY_STORAGE_LIMITS as L, historyCursor, type HistoryAppendBatch, type HistoryCursor } from "../src/server/history-storage";
import { topologyFrameKey, validateImmutableCommit, validateImmutableTreeFrame } from "../src/history/topology";
import type { ImmutableCommit, ImmutableTreeFrame, TopologyAnchor, TopologyResult } from "../src/history/topology-contracts";

// SYNTHETIC ONLY. New temporary SQLite fixtures emulate D1 transactional batch.
// Never opens an existing database, env, credentials, quota or model ledger.
const repo = "synthetic-history/storage", sha = (n: number) => n.toString(16).padStart(40, "0");
const unwrap = <T>(r: TopologyResult<T>): T => { if (!r.ok) throw new Error(r.code); return r.value; };
const commit = (n: number, parents: number[] | null = []): ImmutableCommit => unwrap(validateImmutableCommit({ schemaVersion: 1, repoKey: repo, sha: sha(n), treeSha: sha(n + 1000), parents: parents?.map(sha) ?? null, authorAt: "original author clock", committerAt: null, message: `SYNTHETIC commit ${n}`, provenance: [{ sourceUrl: `https://github.com/${repo}/commit/${sha(n)}`, fetchedAt: "2026-11-01T00:00:00Z" }], omittedProvenance: 0 }));
const anchor = (n: number, generation = "SYNTHETIC_generation"): TopologyAnchor => ({ repoKey: repo, sha: sha(n), generation });
const frame = (c: ImmutableCommit, count = 1, prefix = "", partial = false): ImmutableTreeFrame => unwrap(validateImmutableTreeFrame({ schemaVersion: 1, repoKey: repo, commitSha: c.sha, treeSha: c.treeSha, scope: { prefix, recursive: true }, completeness: partial ? "partial" : "full", sourceOmittedEntries: partial ? null : 0, entries: Array.from({ length: count }, (_, i) => ({ path: `${prefix ? prefix + "/" : ""}${i.toString().padStart(5, "0")}-原始🚀.ts`, type: "blob", sha: sha(10000 + i) })), provenance: [{ sourceUrl: `https://api.github.com/repos/${repo}/git/trees/${c.treeSha}?recursive=1`, fetchedAt: "2026-11-01T00:00:00Z" }], omittedProvenance: 0 }, c));
const append = (a: TopologyAnchor, commits: ImmutableCommit[], cursor: HistoryCursor = historyCursor(a, [], 0), name = "batch_1"): HistoryAppendBatch => ({ anchor: a, batchId: name, actionId: `action_${name}`, expectedRevision: cursor.revision, expectedCursor: cursor, unit: { kind: "commits", complete: true, commits } });
const appendFrames = (a: TopologyAnchor, frames: ImmutableTreeFrame[], cursor: HistoryCursor, name = "frames_1"): HistoryAppendBatch => ({ ...append(a, [], cursor, name), unit: { kind: "frames", complete: true, frames } });
const tables = ["history_repositories", "history_commits", "history_anchors", "history_frames", "history_frame_chunks", "history_batches", "history_append_guards"];
interface Options { interrupt?: number; beforeBatch?: () => Promise<void> | void; readError?: boolean; falseRead?: boolean; falseBatch?: boolean; lastStatements?: number; sql?: string[] }
function fixture(options: Options = {}, path = ":memory:", initialize = true) {
  const db = new Database(path);
  db.exec("PRAGMA foreign_keys=ON");
  if (initialize) db.exec(readFileSync(new URL("../deploy/d1/0003-history.sql", import.meta.url), "utf8"));
  const statement = (sql: string, values: unknown[] = []) => ({
    bind(...next: unknown[]) { return statement(sql, next); },
    async all<T>() { if (options.readError) throw new Error("SYNTHETIC READ ERROR"); options.sql?.push(sql); return { success: !options.falseRead, results: db.query(sql).all(...values as any[]) as T[] }; },
    async first<T>() { if (options.readError) throw new Error("SYNTHETIC READ ERROR"); options.sql?.push(sql); return db.query(sql).get(...values as any[]) as T | null; },
    execute() { options.sql?.push(sql); db.query(sql).run(...values as any[]); return { success: true }; },
  });
  const binding: HistoryD1Binding = {
    prepare: sql => statement(sql),
    async batch(statements) {
      options.lastStatements = statements.length; await options.beforeBatch?.();
      if (options.falseBatch) return statements.map(() => ({ success: false }));
      return db.transaction(() => {
        const result = statements.map((s, index) => { if (options.interrupt === index) throw new Error("SYNTHETIC INTERRUPTION"); return (s as ReturnType<typeof statement>).execute(); });
        if (options.interrupt === statements.length) throw new Error("SYNTHETIC INTERRUPTION BEFORE COMMIT");
        return result;
      })();
    },
    withSession: () => binding,
  };
  const dump = () => JSON.stringify(tables.map(t => db.query(`SELECT * FROM ${t} ORDER BY rowid`).all()));
  return { db, binding, store: new D1HistoryStore(binding), dump, options };
}
async function rejectedUnchanged(b: ReturnType<typeof fixture>, batch: unknown, code?: string) {
  const before = b.dump();
  if (code) await expect(b.store.append(batch as HistoryAppendBatch)).rejects.toMatchObject({ code });
  else await expect(b.store.append(batch as HistoryAppendBatch)).rejects.toBeDefined();
  expect(b.dump()).toBe(before);
}

test("SYNTHETIC history persistence survives close/reopen with exact first-parent facts, provenance, clocks and unknown totals", async () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-history-synthetic-")), path = join(dir, "new.sqlite"), a = anchor(3), head = commit(3, [2, 9]), middle = commit(2, [1]), root = commit(1);
  let b = fixture({}, path);
  try {
    const missing = await b.store.page(a); expect(missing.status).toBe("missing-anchor"); expect(missing.retention.normalizedBytes).toBe(0);
    const result = await b.store.append(append(a, [head]));
    expect(result.currentCursor).toMatchObject({ revision: 1, retainedCommits: 1, termination: "missing-parent", nextParentSha: sha(2), reachedRoot: null });
    const second = await b.store.append(append(a, [root, middle], result.currentCursor, "batch_2"));
    expect(second.currentCursor).toMatchObject({ retainedCommits: 3, reachedRoot: true, nextParentSha: null });
    const f = frame(middle, 3, "src", true);
    await b.store.append(appendFrames(a, [f], second.currentCursor));
    const before = b.dump(); b.db.close(); b = fixture({}, path, false);
    expect(b.dump()).toBe(before);
    const page = await b.store.page(a, 0, 2);
    expect(page.commits).toEqual([head, middle]); expect(page.nextOffset).toBe(2); expect(page.total).toBeNull(); expect(page.completeHistory).toBe(false);
    expect(page.retention).toMatchObject({ commits: 3, memberships: 3, frames: 1, anchors: 1, receipts: 3, physicalBytes: null });
    expect((await b.store.page(a, 2)).commits).toEqual([root]);
    expect(await b.store.frame(a, topologyFrameKey(f))).toEqual({ status: "available", frame: f });
    expect((await b.store.page(a)).commits[0]?.authorAt).toBe("original author clock"); expect((await b.store.page(a)).commits[0]?.committerAt).toBeNull();
  } finally { b.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("SYNTHETIC canonical batch idempotency separates original receipt and current cursor; SHA/batch/action conflicts do not mutate", async () => {
  const b = fixture(), a = anchor(2), head = commit(2, [1]), root = commit(1), first = append(a, [head]);
  try {
    const one = await b.store.append(first), two = await b.store.append(append(a, [root], one.currentCursor, "next")), before = b.dump();
    const retry = await b.store.append({ ...first, expectedCursor: { termination: first.expectedCursor.termination, reachedRoot: null, nextParentSha: a.sha, retainedCommits: 0, revision: 0 } });
    expect(retry).toMatchObject({ idempotent: true, acceptedCursor: one.currentCursor, currentCursor: two.currentCursor }); expect(b.dump()).toBe(before);
    await rejectedUnchanged(b, { ...first, actionId: "other_action" }, "batch-payload-conflict");
    await rejectedUnchanged(b, append(a, [{ ...head, message: "immutable conflict" }], two.currentCursor, "conflict"), "immutable-commit-conflict");
    await rejectedUnchanged(b, { ...append(a, [head], two.currentCursor, "other_batch"), actionId: first.actionId }, "action-already-used");
    await rejectedUnchanged(b, append(a, [{ ...head, treeSha: sha(999) }], two.currentCursor, "tree_conflict"), "immutable-commit-conflict");
  } finally { b.db.close(); }
});

test("SYNTHETIC identical canonical payload ignores commit array/property order and retains legitimate provenance refinements", async () => {
  const b = fixture(), a = anchor(2), h = commit(2, [1]), r = commit(1), batch = append(a, [r, h]);
  try {
    const saved = await b.store.append(batch), before = b.dump();
    expect((await b.store.append({ ...batch, unit: { kind: "commits", complete: true, commits: [h, r] } })).idempotent).toBe(true); expect(b.dump()).toBe(before);
    const refined = { ...h, provenance: [{ ...h.provenance[0]!, fetchedAt: "2026-11-02T00:00:00Z" }] };
    await b.store.append(append(a, [refined], saved.currentCursor, "provenance"));
    expect((await b.store.page(a)).commits[0]?.provenance).toHaveLength(2);
    expect((await b.store.append(batch)).idempotent).toBe(true);
  } finally { b.db.close(); }
});

test("SYNTHETIC two same-revision contenders have exactly one winner and no losing facts, receipt or cursor", async () => {
  const b = fixture(), a = anchor(3), h = commit(3, [2]), m = commit(2, [1]), r = commit(1);
  try {
    const first = await b.store.append(append(a, [h])); let arrivals = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    b.options.beforeBatch = async () => { if (++arrivals === 2) release(); await gate; };
    const results = await Promise.allSettled([b.store.append(append(a, [m], first.currentCursor, "contender_a")), b.store.append(append(a, [r, m], first.currentCursor, "contender_b"))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const page = await b.store.page(a); expect(page.cursor.revision).toBe(2); expect(page.retention.receipts).toBe(2);
    expect(b.db.query("SELECT * FROM history_append_guards").all()).toHaveLength(0);
    const winner = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<D1HistoryStore["append"]>>>;
    expect(page.cursor).toEqual(winner.value.currentCursor); expect(page.retention.normalizedBytes).toBe(winner.value.retention.normalizedBytes);
  } finally { b.db.close(); }
});

test("SYNTHETIC initially absent repo cannot splice concurrent different anchor generations or lose global byte counters", async () => {
  const b = fixture(); let arrivals = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  b.options.beforeBatch = async () => { if (++arrivals === 2) release(); await gate; };
  try {
    const results = await Promise.allSettled([b.store.append(append(anchor(1, "one"), [commit(1)], undefined, "one")), b.store.append(append(anchor(2, "two"), [commit(2)], undefined, "two"))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(b.db.query("SELECT * FROM history_anchors").all()).toHaveLength(1);
    expect(b.db.query("SELECT * FROM history_commits").all()).toHaveLength(1);
  } finally { b.db.close(); }
});

test("SYNTHETIC actual CAS comparison failure aborts the transaction and leaves no zero-row-update orphan writes", async () => {
  const b = fixture(), a = anchor(2);
  try {
    const saved = await b.store.append(append(a, [commit(2, [1])])); let concurrentState = "";
    b.options.beforeBatch = () => { b.db.query("UPDATE history_repositories SET revision=revision+1").run(); concurrentState = b.dump(); };
    await expect(b.store.append(append(a, [commit(1)], saved.currentCursor, "loser"))).rejects.toMatchObject({ code: "history-storage-unavailable" });
    expect(b.dump()).toBe(concurrentState); expect(b.db.query("SELECT * FROM history_append_guards").all()).toHaveLength(0);
  } finally { b.db.close(); }
});

test("SYNTHETIC EVERY commit batch statement boundary rolls back including just before commit", async () => {
  const probe = fixture(), a = anchor(2), batch = append(a, [commit(2, [1]), commit(1)]);
  await probe.store.append(batch); const count = probe.options.lastStatements!; probe.db.close();
  for (let interruption = 0; interruption <= count; interruption++) {
    const b = fixture({ interrupt: interruption });
    try { await rejectedUnchanged(b, batch, "history-storage-unavailable"); expect((await b.store.page(a)).status).toBe("missing-anchor"); }
    finally { b.db.close(); }
  }
});

test("SYNTHETIC EVERY new multi-chunk frame statement boundary leaves no manifest, cursor or fact fragments", async () => {
  const a = anchor(1), c = commit(1), f = frame(c, 2500), probe = fixture();
  const seed = await probe.store.append(append(a, [c])), batch = appendFrames(a, [f], seed.currentCursor);
  await probe.store.append(batch); const count = probe.options.lastStatements!;
  expect(probe.db.query("SELECT * FROM history_frame_chunks").all().length).toBeGreaterThan(1); probe.db.close();
  for (let interruption = 0; interruption <= count; interruption++) {
    const b = fixture();
    try {
      await b.store.append(append(a, [c])); b.options.interrupt = interruption;
      await rejectedUnchanged(b, batch, "history-storage-unavailable");
      expect(await b.store.frame(a, topologyFrameKey(f))).toEqual({ status: "missing-frame" });
    } finally { b.db.close(); }
  }
});

test("SYNTHETIC EVERY existing frame replacement statement boundary preserves original partial manifest and chunks", async () => {
  const a = anchor(1), c = commit(1), old = frame(c, 1, "", true), full = frame(c, 2500), probe = fixture();
  const seed = await probe.store.append(append(a, [c]));
  const prior = await probe.store.append(appendFrames(a, [old], seed.currentCursor, "partial"));
  const batch = appendFrames(a, [full], prior.currentCursor, "full");
  await probe.store.append(batch); const count = probe.options.lastStatements!; probe.db.close();
  for (let interruption = 0; interruption <= count; interruption++) {
    const b = fixture();
    try {
      const one = await b.store.append(append(a, [c])); await b.store.append(appendFrames(a, [old], one.currentCursor, "partial"));
      b.options.interrupt = interruption; await rejectedUnchanged(b, batch, "history-storage-unavailable");
      expect(await b.store.frame(a, topologyFrameKey(old))).toEqual({ status: "available", frame: old });
    } finally { b.db.close(); }
  }
});

test("SYNTHETIC anchor-only CAS mismatch also aborts all writes even when the repository revision still matches", async () => {
  const b = fixture(), a = anchor(2);
  try {
    const saved = await b.store.append(append(a, [commit(2, [1])])); let concurrentState = "";
    b.options.beforeBatch = () => {
      b.db.query("UPDATE history_anchors SET payload=replace(payload,'\"revision\":1','\"revision\":2')").run(); concurrentState = b.dump();
    };
    await expect(b.store.append(append(a, [commit(1)], saved.currentCursor, "loser"))).rejects.toMatchObject({ code: "history-storage-unavailable" }); expect(b.dump()).toBe(concurrentState);
  } finally { b.db.close(); }
});

test("SYNTHETIC UTF8 multi-chunk frame roundtrip and interrupted/corrupt manifest are unavailable, never partial success", async () => {
  const b = fixture(), a = anchor(1), c = commit(1), f = frame(c, 2500);
  try {
    const seed = await b.store.append(append(a, [c])); await b.store.append(appendFrames(a, [f], seed.currentCursor));
    expect(await b.store.frame(a, topologyFrameKey(f))).toEqual({ status: "available", frame: f });
    const pieces = b.db.query("SELECT ordinal,payload FROM history_frame_chunks ORDER BY ordinal").all() as { ordinal: number; payload: string }[];
    expect(pieces.length).toBeGreaterThan(1); expect(pieces.every(p => new TextEncoder().encode(p.payload).length <= L.chunkBytes && !p.payload.includes("�"))).toBe(true);
    b.db.query("DELETE FROM history_frame_chunks WHERE ordinal=1").run();
    await expect(b.store.frame(a, topologyFrameKey(f))).rejects.toMatchObject({ code: "history-storage-unavailable" });
    b.db.query("INSERT INTO history_frame_chunks VALUES(?,?,?,?)").run(repo, topologyFrameKey(f), 1, pieces[1]!.payload.replace("原始", "伪造"));
    await expect(b.store.frame(a, topologyFrameKey(f))).rejects.toMatchObject({ code: "history-storage-unavailable" });
  } finally { b.db.close(); }
});

test("SYNTHETIC maximum 512KiB normalized UTF8 frame remains storable when safe boundaries require a ninth chunk", async () => {
  const b = fixture(), a = anchor(1), c = commit(1);
  try {
    const f = structuredClone(frame(c, 8000)), remaining = 512 * 1024 - new TextEncoder().encode(JSON.stringify(f)).length;
    expect(remaining).toBeGreaterThanOrEqual(0); expect(remaining).toBeLessThan(400);
    // Deliberately place a multibyte character across the first chunk boundary.
    // A generic Unicode fixture can happen to land all eight boundaries on ASCII.
    const firstPath = f.entries[0]!.path; let padding = -1;
    for (let n = 0; n <= remaining; n++) {
      (f.entries[0]! as { path: string }).path = firstPath + "x".repeat(n);
      if ((new TextEncoder().encode(JSON.stringify(f))[L.chunkBytes]! & 0xc0) === 0x80) { padding = n; break; }
    }
    expect(padding).toBeGreaterThanOrEqual(0);
    (f.entries.at(-1)! as { path: string }).path += "x".repeat(remaining - padding);
    const exact = unwrap(validateImmutableTreeFrame(f, c)); expect(new TextEncoder().encode(JSON.stringify(exact)).length).toBe(512 * 1024);
    const seed = await b.store.append(append(a, [c])); await b.store.append(appendFrames(a, [exact], seed.currentCursor));
    const count = (b.db.query("SELECT chunk_count FROM history_frames").get() as { chunk_count: number }).chunk_count;
    expect(count).toBe(9); expect(await b.store.frame(a, topologyFrameKey(exact))).toEqual({ status: "available", frame: exact });
  } finally { b.db.close(); }
});

test("SYNTHETIC fetch/parse/page failure, side branch and wrong generation cannot move an accepted unit cursor", async () => {
  const b = fixture(), a = anchor(3), h = commit(3, [2, 8]);
  try {
    const saved = await b.store.append(append(a, [h])), next = append(a, [commit(2, [1])], saved.currentCursor, "next");
    for (const unit of [{ ...next.unit, complete: false }, { kind: "error", complete: true, code: "fetch-429" }, { kind: "commits", complete: true, commits: [], error: "parse" }]) await rejectedUnchanged(b, { ...next, unit });
    await rejectedUnchanged(b, append(a, [commit(8)], saved.currentCursor, "side"), "non-spine-commit");
    await rejectedUnchanged(b, append(a, [commit(1)], saved.currentCursor, "gap"), "non-spine-commit");
    await rejectedUnchanged(b, append(anchor(9), [commit(9)], undefined, "wrong_head"), "anchor-generation-conflict");
    await rejectedUnchanged(b, { ...next, anchor: anchor(3, "other" ) }, "history-revision-conflict");
    await rejectedUnchanged(b, { ...next, expectedCursor: { ...saved.currentCursor, nextParentSha: sha(88) } }, "history-revision-conflict");
    expect((await b.store.page(a)).cursor).toEqual(saved.currentCursor);
    for (const [offset, limit] of [[-1, 1], [501, 1], [0, 51], [0, 0], [0, 1.5]]) await expect(b.store.page(a, offset, limit)).rejects.toMatchObject({ code: "invalid-history-page" });
  } finally { b.db.close(); }
});

test("SYNTHETIC unknown parents refine only on accepted commit units; frames preserve partial scope and ancestry gaps", async () => {
  const b = fixture(), a = anchor(1), c = commit(1, null);
  try {
    const one = await b.store.append(append(a, [c])); expect(one.currentCursor).toMatchObject({ termination: "parents-unobserved", reachedRoot: null, nextParentSha: null });
    const f = frame(c, 2, "src", true), two = await b.store.append(appendFrames(a, [f], one.currentCursor));
    expect(two.currentCursor).toEqual({ ...one.currentCursor, revision: 2 });
    expect(await b.store.frame(a, topologyFrameKey(f))).toEqual({ status: "available", frame: f });
    const three = await b.store.append(append(a, [commit(1)], two.currentCursor, "observe_root")); expect(three.currentCursor.reachedRoot).toBe(true);
    expect(await b.store.frame(anchor(1, "absent"), topologyFrameKey(f))).toEqual({ status: "missing-anchor" });
    expect(await b.store.frame(a, topologyFrameKey(frame(commit(9))))).toEqual({ status: "not-member" });
    expect(await b.store.frame(a, topologyFrameKey(frame(c, 1, "other")))).toEqual({ status: "missing-frame" });
  } finally { b.db.close(); }
});

test("SYNTHETIC malformed normalized duplicate/ancestor frames and same-tree cross-scope contradictions leave storage unchanged", async () => {
  const b = fixture(), a = anchor(2), root = commit(1), head = { ...commit(2, [1]), treeSha: root.treeSha };
  try {
    const saved = await b.store.append(append(a, [head, root])), f = frame(root), bad = { ...f, entries: [f.entries[0], f.entries[0]], inputEntryCount: 2 };
    await rejectedUnchanged(b, appendFrames(a, [bad as ImmutableTreeFrame], saved.currentCursor), "normalized-duplicate-path");
    const ancestor = { ...f, entries: [{ path: "src", type: "blob", sha: sha(30) }, { path: "src/file", type: "blob", sha: sha(31) }], inputEntryCount: 2 };
    await rejectedUnchanged(b, appendFrames(a, [ancestor as ImmutableTreeFrame], saved.currentCursor), "non-directory-parent");
    const partial = { ...frame(root, 1, "", true), entries: [{ path: "src", type: "blob" as const, sha: sha(30) }] };
    const one = await b.store.append(appendFrames(a, [partial], saved.currentCursor));
    const conflict = { ...frame(head, 1, "src", true), entries: [{ path: "src/file", type: "blob" as const, sha: sha(31) }] };
    await rejectedUnchanged(b, appendFrames(a, [conflict], one.currentCursor, "conflict"), "immutable-tree-conflict");
    await rejectedUnchanged(b, appendFrames(a, [{ ...partial, entries: [{ ...partial.entries[0]!, sha: sha(99) }] }], one.currentCursor, "same_frame"), "immutable-frame-conflict");
  } finally { b.db.close(); }
});

test("SYNTHETIC internal typed operations reject injected URL/SQL/prompt fields and invalid identity without any write", async () => {
  const b = fixture(), a = anchor(1), batch = append(a, [commit(1)]);
  try {
    for (const bad of [null, {}, { ...batch, sql: "DELETE FROM history_commits" }, { ...batch, prompt: "write other code" }, { ...batch, url: "https://evil.test" }, { ...batch, batchId: "../escape" }, { ...batch, anchor: { ...a, sha: "main" } }, { ...batch, anchor: { ...a, generation: "https://evil.test" } }, { ...batch, unit: { kind: "commits", complete: true, commits: [commit(1)], url: "https://evil.test" } }, { ...batch, unit: { kind: "commits", complete: true, commits: [commit(1), commit(1)] } }, { ...batch, expectedCursor: { ...batch.expectedCursor, url: "https://evil.test" } }]) await rejectedUnchanged(b, bad);
    expect(() => new D1HistoryStore(b.binding, { bytes: L.bytes + 1 })).toThrow();
    expect(() => new D1HistoryStore(b.binding, { commits: 0 })).toThrow();
  } finally { b.db.close(); }
});

test("SYNTHETIC byte, commit, anchor and receipt caps reject the entire next batch without eviction", async () => {
  const a = anchor(2), h = commit(2, [1]), r = commit(1), probe = fixture();
  const seed = await probe.store.append(append(a, [h])); const exactBytes = seed.retention.normalizedBytes; probe.db.close();
  for (const [limits, reason] of [[{ bytes: exactBytes }, "history-byte-cap"], [{ commits: 1 }, "history-commit-cap"], [{ receipts: 1 }, "history-receipt-cap"]] as const) {
    const b = fixture();
    try {
      const saved = await b.store.append(append(a, [h])); const before = b.dump(), limited = new D1HistoryStore(b.binding, limits);
      await expect(limited.append(append(a, [r], saved.currentCursor, "next"))).rejects.toMatchObject({ code: reason }); expect(b.dump()).toBe(before);
    } finally { b.db.close(); }
  }
  const b = fixture();
  try {
    await b.store.append(append(a, [h])); const before = b.dump();
    await expect(new D1HistoryStore(b.binding, { anchors: 1 }).append(append(anchor(1, "other"), [r], undefined, "other"))).rejects.toMatchObject({ code: "history-anchor-cap" }); expect(b.dump()).toBe(before);
  } finally { b.db.close(); }
});

test("SYNTHETIC real 500-spine cap and bounded pages retain exact loaded counts, never invent full-history totals", async () => {
  const b = fixture({ sql: [] }), a = anchor(501); let cursor = historyCursor(a, [], 0);
  try {
    for (let n = 501; n >= 2; n -= 4) {
      const facts = Array.from({ length: Math.min(4, n - 1) }, (_, i) => commit(n - i, [n - i - 1]));
      cursor = (await b.store.append(append(a, facts, cursor, `page_${n}`))).currentCursor;
    }
    const page = await b.store.page(a, 450); expect(page.commits).toHaveLength(50); expect(page.retention.commits).toBe(500); expect(page.cursor).toMatchObject({ retainedCommits: 500, nextParentSha: sha(1), reachedRoot: null }); expect(page.total).toBeNull(); expect(page.completeHistory).toBe(false);
    await rejectedUnchanged(b, append(a, [commit(1)], cursor, "over_cap"), "history-commit-cap");
    expect(b.options.sql!.filter(s => s.includes("FROM history_commits")).every(s => s.includes("LIMIT 50"))).toBe(true);
  } finally { b.db.close(); }
});

test("SYNTHETIC real eight-frame cap and exact frame provenance additions never evict older facts", async () => {
  const b = fixture(), a = anchor(9), commits = Array.from({ length: 9 }, (_, i) => commit(9 - i, i < 8 ? [8 - i] : [])); let cursor = historyCursor(a, [], 0);
  try {
    for (let i = 0; i < commits.length; i += 4) cursor = (await b.store.append(append(a, commits.slice(i, i + 4), cursor, `commits_${i}`))).currentCursor;
    for (let i = 0; i < 8; i += 2) cursor = (await b.store.append(appendFrames(a, commits.slice(i, i + 2).map(c => frame(c)), cursor, `frames_${i}`))).currentCursor;
    expect((await b.store.page(a)).retention.frames).toBe(8);
    await rejectedUnchanged(b, appendFrames(a, [frame(commits[8]!)], cursor, "ninth"), "history-frame-cap");
    const f = frame(commits[0]!), newer = { ...f, provenance: [{ ...f.provenance[0]!, fetchedAt: "2026-11-02T00:00:00Z" }] };
    await b.store.append(appendFrames(a, [newer], cursor, "refine_frame"));
    const saved = await b.store.frame(a, topologyFrameKey(f)); expect(saved.status).toBe("available"); if (saved.status === "available") expect(saved.frame.provenance).toHaveLength(2);
    expect((await b.store.page(a)).retention.frames).toBe(8);
  } finally { b.db.close(); }
});

test("SYNTHETIC authoritative read/batch errors fail closed with no fallback or retry", async () => {
  const b = fixture(), a = anchor(1), batch = append(a, [commit(1)]);
  try {
    const before = b.dump(); b.options.readError = true;
    await expect(b.store.page(a)).rejects.toMatchObject({ code: "history-storage-unavailable" }); await expect(b.store.append(batch)).rejects.toMatchObject({ code: "history-storage-unavailable" });
    b.options.readError = false; b.options.falseBatch = true;
    await rejectedUnchanged(b, batch, "history-storage-unavailable"); expect(b.dump()).toBe(before);
    b.options.falseBatch = false; await b.store.append(batch); b.options.falseRead = true;
    await expect(b.store.page(a)).rejects.toMatchObject({ code: "history-storage-unavailable" });
  } finally { b.db.close(); }
});
