import type { HistoryD1Binding, HistoryStatement } from "./history-storage";
import { WORLD_CAPTURE_LIMITS as L, WORLD_CAPTURE_TABLE_SQL, WorldCaptureError, captureBytes, captureChunks, captureCryptoKey, captureHash, captureIdentity, captureKey, captureKeyTag, captureReject, captureSqlTokens, issueWorldGeneration, verifyWorldGeneration, verifyWorldPrivateObservation, worldGenerationShape, type RemoteWorldGeneration, type WorldCaptureIdentity, type WorldCaptureWrite } from "../src/server/world-public-capture-contract";

type Authority = [number, number, string, string, string, string, number, number];
type Barrier = [string, number, number];
type Generation = [string, string, string, number, number, string, string | null, string | null, string | null, number | null, number];
type Manifest = [string, number, number, string, string, number];
type Alias = [string, string, number];
type View = [Authority[], [number, string, string][], Barrier[], Generation[], Manifest[], Alias[], [number, number][], [string, string, string, string][]];
interface State { view: View; checksum: string; raw: string; snapshot: string | null }
const json = JSON.stringify;
const safe = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const hex = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const sorted = <T extends unknown[]>(rows: T[]) => rows.sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0);
const unique = (keys: string[]) => [...new Set(keys)].sort();
const unavailable = (): never => { throw new WorldCaptureError(); };
const conflict = (): never => captureReject("WORLD_CAPTURE_CONFLICT", 409);
const increment = (n: number) => safe(n + 1) ? n + 1 : unavailable();
function list(value: string | null, cap: number) {
  if (typeof value !== "string") return unavailable();
  const keys: unknown = JSON.parse(value);
  if (!Array.isArray(keys) || !keys.length || keys.length > cap || keys.some(k => captureKey(k) !== k) || json(unique(keys)) !== value) return unavailable();
  return keys as string[];
}

/** A single SQLite statement observes control, aliases, manifests, schema and
 * requested raw bytes in one read snapshot. Capped subqueries expose overflow
 * without materializing unbounded tables. No snapshot payload enters metadata. */
export const WORLD_CAPTURE_VIEW_SQL = `SELECT json_array(
 (SELECT json_group_array(json_array(singleton,protocol,database_uuid,binding_nonce,authority_epoch,key_tag,sequence,revision)) FROM (SELECT * FROM world_capture_authority ORDER BY singleton LIMIT 2)),
 (SELECT json_group_array(json_array(singleton,database_uuid,binding_nonce)) FROM (SELECT * FROM storage_identity ORDER BY singleton LIMIT 2)),
 (SELECT json_group_array(json_array(repo,sequence,denied)) FROM (SELECT * FROM world_capture_barriers ORDER BY repo LIMIT ${L.barriers + 1})),
 (SELECT json_group_array(json_array(handle_hash,repo,start_canonical,start_sequence,explicit,status,operation_hash,roots,targets,accepted_sequence,ordinal)) FROM (SELECT * FROM world_capture_generations ORDER BY handle_hash LIMIT ${L.generations + 1})),
 (SELECT json_group_array(json_array(repo,expires_at,saved_at,snapshot_sha256,origin,length(CAST(snapshot AS BLOB)))) FROM (SELECT * FROM worlds ORDER BY repo LIMIT ${L.worlds + 1})),
 (SELECT json_group_array(json_array(alias,canonical,rowid)) FROM (SELECT alias,canonical,rowid FROM world_aliases ORDER BY alias LIMIT ${L.aliases + 1})),
 (SELECT json_group_array(json_array(singleton,accepted)) FROM (SELECT * FROM world_capture_guard ORDER BY singleton LIMIT 2)),
 (SELECT json_group_array(json_array(type,name,tbl_name,sql)) FROM (SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN ('world_capture_authority','world_capture_barriers','world_capture_generations','world_capture_guard') OR (type='trigger' AND tbl_name LIKE 'world_capture_%') ORDER BY name LIMIT 9))
) AS view`;
const viewExpression = `(${WORLD_CAPTURE_VIEW_SQL})`;

/** Standalone, server-only D1 authority. There is intentionally no initializer,
 * RPC, runtime registration, env fallback, key default or ledger access here.
 * The binding MUST provide D1 all-statements-atomic batch semantics. Logical
 * identity/HMAC cannot fence an old binary, DB owner, or cloned physical DB.
 * All 256 generation receipts are retained; capacity exhaustion fails closed.
 * A lost begin ACK can orphan a slot. Retirement/provisioning needs a separate
 * reviewed protocol, never implicit eviction or an automatic retry/reset. */
export class D1PublicCaptureCore {
  private readonly identity: WorldCaptureIdentity;
  private readonly key: CryptoKey;
  private readonly transient = new Set<string>();
  constructor(private readonly binding: HistoryD1Binding, identity: WorldCaptureIdentity, key: CryptoKey) { this.identity = captureIdentity(identity); this.key = captureCryptoKey(key); }
  private async run<T>(action: (db: HistoryD1Binding) => Promise<T>): Promise<T> {
    try { return await action(this.binding.withSession?.("first-primary") ?? this.binding); }
    catch (error) { if (error instanceof WorldCaptureError) throw error; return unavailable(); }
  }
  private async state(db: HistoryD1Binding, repo = ""): Promise<State> {
    try { return await this.readState(db, repo); } catch { return unavailable(); }
  }
  private async readState(db: HistoryD1Binding, repo: string) {
    const row = await db.prepare(`${WORLD_CAPTURE_VIEW_SQL}, (SELECT checksum FROM world_capture_authority WHERE singleton=1) AS checksum,
      (SELECT snapshot FROM worlds WHERE repo=COALESCE((SELECT canonical FROM world_aliases WHERE alias=?),?)) AS snapshot`).bind(repo, repo).first<{ view: string; checksum: string; snapshot: string | null }>();
    if (!row || typeof row.view !== "string" || captureBytes(row.view) > L.metadataBytes || !hex(row.checksum)) return unavailable();
    const v: View = JSON.parse(row.view);
    if (!Array.isArray(v) || v.length !== 8 || v.some(x => !Array.isArray(x)) || v[0].length !== 1 || v[1].length !== 1 || v[2].length > L.barriers || v[3].length > L.generations || v[4].length > L.worlds || v[5].length > L.aliases || json(v[6]) !== "[[1,1]]" || v[7].length !== 4) return unavailable();
    const a = v[0][0]!, i = v[1][0]!;
    if (a.length !== 8 || a[0] !== 1 || a[1] !== 1 || a[2] !== this.identity.databaseId || a[3] !== this.identity.bindingNonce || a[4] !== this.identity.epoch || a[5] !== await captureKeyTag(this.identity, this.key) || !safe(a[6]) || !safe(a[7]) || a[6] > a[7] || json(i) !== json([1, a[2], a[3]])) return unavailable();
    for (const [name, ddl] of Object.entries(WORLD_CAPTURE_TABLE_SQL)) {
      const schema = v[7].find(r => r[1] === name);
      if (!schema || schema.length !== 4 || schema[0] !== "table" || schema[2] !== name || typeof schema[3] !== "string" || captureSqlTokens(schema[3]) !== captureSqlTokens(ddl)) return unavailable();
    }
    for (const b of v[2]) if (b.length !== 3 || captureKey(b[0]) !== b[0] || !safe(b[1]) || b[1] < 1 || b[1] > a[6] || ![0, 1].includes(b[2])) return unavailable();
    const ordinals = new Set<number>();
    for (const g of v[3]) {
      if (g.length !== 11 || !hex(g[0]) || captureKey(g[1]) !== g[1] || captureKey(g[2]) !== g[2] || !safe(g[3]) || g[3] > a[6] || ![0, 1].includes(g[4]) || !["active", "committed", "deny-pending", "denied"].includes(g[5]) || !safe(g[10]) || g[10] < 1 || g[10] > a[7] || ordinals.has(g[10])) return unavailable();
      ordinals.add(g[10]);
      if (g[5] === "active") { if (g.slice(6, 10).some(x => x !== null)) return unavailable(); }
      else {
        if (!hex(g[6]) || !safe(g[9]) || g[9] < g[3] || g[9] > a[6]) return unavailable();
        const roots = list(g[7], 2), targets = list(g[8], 204);
        if (!roots.includes(g[1]) || roots.some(k => !targets.includes(k)) || (g[5] === "committed" ? g[7] !== g[8] : g[9] <= g[3] || g[6] !== await captureHash(json([roots, targets])))) return unavailable();
      }
    }
    for (const w of v[4]) if (w.length !== 6 || captureKey(w[0]) !== w[0] || !safe(w[1]) || !safe(w[2]) || w[1] <= w[2] || !hex(w[3]) || typeof w[4] !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(w[4]) || !safe(w[5]) || w[5] < 1 || w[5] > L.snapshotBytes) return unavailable();
    const rowids = new Set<number>();
    for (const alias of v[5]) {
      if (alias.length !== 3 || captureKey(alias[0]) !== alias[0] || captureKey(alias[1]) !== alias[1] || alias[0] === alias[1] || !safe(alias[2]) || alias[2] < 1 || rowids.has(alias[2]) || v[5].some(other => other[0] === alias[1]) || v[4].some(w => w[0] === alias[0])) return unavailable();
      rowids.add(alias[2]);
    }
    if (Math.max(0, ...v[2].map(b => b[1])) !== a[6] || await captureHash(row.view) !== row.checksum) return unavailable();
    return { view: v, raw: row.view, checksum: row.checksum, snapshot: row.snapshot } satisfies State;
  }
  private resolve(s: State, repo: string) { return s.view[5].find(a => a[0] === repo)?.[1] ?? repo; }
  private admitted(s: State, keys: string[], g?: Generation) {
    for (const key of keys) {
      const b = s.view[2].find(b => b[0] === key);
      if (this.transient.has(key) || (g ? b && (b[1] > g[3] || b[2] === 1 && g[4] !== 1) : b)) return conflict();
    }
  }
  private next(s: State): State { const n: State = { ...s, view: structuredClone(s.view), snapshot: null }; n.view[0][0]![7] = increment(n.view[0][0]![7]); return n; }
  private statement(db: HistoryD1Binding, sql: string, ...values: unknown[]) { return db.prepare(sql).bind(...values); }
  private guard(db: HistoryD1Binding, view: string, checksum: string, extra = "1", values: unknown[] = []) {
    const pieces = captureChunks(view);
    return this.statement(db, `INSERT INTO world_capture_guard(singleton,accepted) VALUES(1,CASE WHEN ${viewExpression}=(${pieces.map(() => "?").join("||")}) AND (SELECT checksum FROM world_capture_authority WHERE singleton=1)=? AND (${extra}) THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET accepted=excluded.accepted`, ...pieces, checksum, ...values);
  }
  private async save(db: HistoryD1Binding, old: State, next: State, changes: HistoryStatement[] = [], verify?: { repo: string; snapshot: string }) {
    sorted(next.view[2]); sorted(next.view[3]); sorted(next.view[4]); sorted(next.view[5]);
    const raw = json(next.view); if (captureBytes(raw) > L.metadataBytes || next.view[2].length > L.barriers || next.view[3].length > L.generations) return unavailable();
    const checksum = await captureHash(raw), statements: HistoryStatement[] = [this.guard(db, old.raw, old.checksum), ...changes];
    // Rewrite only changed control rows. This also bounds a batch well below
    // D1's statement/parameter limits, with no active receipt eviction.
    const add = (sql: string, ...args: unknown[]) => statements.push(this.statement(db, sql, ...args));
    for (const b of next.view[2]) if (json(old.view[2].find(x => x[0] === b[0])) !== json(b)) add("INSERT INTO world_capture_barriers VALUES(?,?,?) ON CONFLICT(repo) DO UPDATE SET sequence=excluded.sequence,denied=excluded.denied", ...b);
    for (const g of next.view[3]) if (json(old.view[3].find(x => x[0] === g[0])) !== json(g)) add("INSERT INTO world_capture_generations VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(handle_hash) DO UPDATE SET status=excluded.status,operation_hash=excluded.operation_hash,roots=excluded.roots,targets=excluded.targets,accepted_sequence=excluded.accepted_sequence", ...g);
    add("UPDATE world_capture_authority SET sequence=?,revision=?,checksum=? WHERE singleton=1", next.view[0][0]![6], next.view[0][0]![7], checksum);
    const pieces = verify ? captureChunks(verify.snapshot) : [];
    statements.push(this.guard(db, raw, checksum, verify ? `(SELECT snapshot FROM worlds WHERE repo=?)=(${pieces.map(() => "?").join("||")})` : "1", verify ? [verify.repo, ...pieces] : []));
    // Once dispatched, no exported exception or result shape proves rollback.
    // No automatic retries, including CAS conflicts or lost acknowledgement.
    try {
      const result = await db.batch(statements); if (!Array.isArray(result) || result.length !== statements.length || result.some(r => !r || r.success !== true)) throw Error();
      // A successful-shaped ACK alone is insufficient. This independent read
      // does not retry a write or infer rollback. A concurrent newer revision
      // conservatively yields UNKNOWN even if this batch actually committed.
      const observed = await this.state(db, verify?.repo);
      if (observed.raw !== raw || observed.checksum !== checksum || verify && observed.snapshot !== verify.snapshot) throw Error();
    }
    catch { throw new WorldCaptureError("WORLD_CAPTURE_UNAVAILABLE", 503, "unknown"); }
  }
  private async authenticate(s: State, generation: RemoteWorldGeneration) {
    worldGenerationShape(generation); const hash = await captureHash(generation.handle), g = s.view[3].find(g => g[0] === hash);
    if (!g || g[1] !== generation.repo) return conflict();
    await verifyWorldGeneration(generation, this.identity, this.key, { canonical: g[2], sequence: g[3], explicit: g[4] === 1 }); return g;
  }
  async begin(input: string, options: { explicitRevalidation: boolean } = { explicitRevalidation: false }): Promise<RemoteWorldGeneration> {
    const repo = captureKey(input); if (!options || Object.keys(options).join() !== "explicitRevalidation" || typeof options.explicitRevalidation !== "boolean") return captureReject();
    const explicit = options.explicitRevalidation;
    return this.run(async db => {
      const s = await this.state(db), canonical = this.resolve(s, repo);
      this.admitted(s, [repo, canonical], ["", repo, canonical, s.view[0][0]![6], +explicit, "active", null, null, null, null, 1]);
      if (s.view[3].length >= L.generations) return captureReject("WORLD_CAPTURE_CAPACITY", 503);
      const token = await issueWorldGeneration(this.identity, this.key, repo, canonical, s.view[0][0]![6], explicit), n = this.next(s);
      n.view[3].push([await captureHash(token.handle), repo, canonical, token.sequence, +explicit, "active", null, null, null, null, n.view[0][0]![7]]);
      await this.save(db, s, n); return token;
    });
  }
  async inspect(generation: RemoteWorldGeneration) { return this.run(async db => { const g = await this.authenticate(await this.state(db), generation); return { status: g[5], operationHash: g[6], acceptedSequence: g[9] }; }); }
  /** Read-only RPC preflight/identity and drain assertions. These never mint,
   * consume, repair or return keys/private target lists. */
  async status() { return this.run(async db => { const s = await this.state(db), a = s.view[0][0]!; return { identity: { databaseId: a[2], bindingNonce: a[3], epoch: a[4] }, protocol: 1 as const, revision: a[7], sequence: a[6], worlds: s.view[4].length, aliases: s.view[5].length, generations: s.view[3].length }; }); }
  async assert(generation: RemoteWorldGeneration) { return this.run(async db => { const s = await this.state(db), g = await this.authenticate(s, generation); if (g[5] !== "active") return conflict(); this.admitted(s, [g[1], g[2], this.resolve(s, g[1])], g); return { admitted: true as const }; }); }
  async privacyStatus(generation: RemoteWorldGeneration) { return this.run(async db => { const s = await this.state(db), g = await this.authenticate(s, generation); if (!["deny-pending", "denied"].includes(g[5]) || list(g[8], 204).some(k => !s.view[2].some(b => b[0] === k && b[1] === g[9] && b[2] === 1))) return { barrier: "unknown" as const, cleanup: "unconfirmed" as const }; return { barrier: "confirmed" as const, cleanup: g[5] === "denied" ? "confirmed" as const : "unconfirmed" as const }; }); }
  async get(input: string) {
    const repo = captureKey(input);
    return this.run(async db => {
      const s = await this.state(db, repo), canonical = this.resolve(s, repo), keys = [repo, canonical];
      if (keys.some(k => this.transient.has(k))) return unavailable();
      if (keys.some(k => s.view[2].some(b => b[0] === k && b[2] === 1))) return null;
      const w = s.view[4].find(w => w[0] === canonical); if (!w) return null;
      if (typeof s.snapshot !== "string" || await captureHash(s.snapshot) !== w[3]) return unavailable();
      this.snapshot({ snapshot: s.snapshot, savedAt: w[2], expiresAt: w[1] }, canonical);
      return { repo: canonical, snapshot: s.snapshot, expiresAt: w[1], savedAt: w[2], hash: w[3], origin: w[4] };
    });
  }
  private snapshot(write: WorldCaptureWrite, expected?: string) {
    if (!write || Object.keys(write).sort().join() !== "expiresAt,savedAt,snapshot" || typeof write.snapshot !== "string" || !captureBytes(write.snapshot) || captureBytes(write.snapshot) > L.snapshotBytes || !safe(write.savedAt) || !safe(write.expiresAt) || write.expiresAt <= write.savedAt) return captureReject();
    let w: any; try { w = JSON.parse(write.snapshot); } catch { return captureReject(); }
    const canonical = captureKey(w?.repo?.fullName);
    if (expected && canonical !== expected || w?.schemaVersion !== 1 || w.source !== "github" || w.repo.url !== `https://github.com/${w.repo.fullName}` || typeof w.headSha !== "string" || !/^[a-f0-9]{40}$/i.test(w.headSha) || typeof w.collectedAt !== "string" || !Number.isFinite(Date.parse(w.collectedAt)) || !Array.isArray(w.nodes) || !Array.isArray(w.edges) || !w.blueprint) return captureReject();
    return canonical;
  }
  private async put(db: HistoryD1Binding, old: State, n: State, repo: string, write: WorldCaptureWrite, changes: HistoryStatement[]) {
    if (old.view[4].some(w => w[0] === repo && w[2] > write.savedAt)) return conflict();
    const manifest: Manifest = [repo, write.expiresAt, write.savedAt, await captureHash(write.snapshot), "runtime", captureBytes(write.snapshot)], pieces = captureChunks(write.snapshot);
    changes.push(this.statement(db, `INSERT INTO worlds(repo,snapshot,expires_at,saved_at,snapshot_sha256,origin) VALUES(?,(${pieces.map(() => "?").join("||")}),?,?,?,'runtime') ON CONFLICT(repo) DO UPDATE SET snapshot=excluded.snapshot,expires_at=excluded.expires_at,saved_at=excluded.saved_at,snapshot_sha256=excluded.snapshot_sha256,origin=excluded.origin`, repo, ...pieces, write.expiresAt, write.savedAt, manifest[3]));
    n.view[4] = [...n.view[4].filter(w => w[0] !== repo), manifest];
    const retained = [...n.view[4]].sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1)).slice(0, L.worlds), keep = new Set(retained.map(w => w[0]));
    if (!keep.has(repo)) return conflict();
    for (const w of n.view[4]) if (!keep.has(w[0])) changes.push(this.statement(db, "DELETE FROM worlds WHERE repo=?", w[0]));
    n.view[4] = retained;
    // A newly observed real canonical replaces an old alias at that name.
    // Retention also removes aliases whose target was physically evicted,
    // matching the original store without touching any privacy authority.
    changes.push(this.statement(db, "DELETE FROM world_aliases WHERE alias=? OR canonical NOT IN (SELECT repo FROM worlds)", repo));
    n.view[5] = n.view[5].filter(a => a[0] !== repo && keep.has(a[1]));
  }
  private alias(db: HistoryD1Binding, n: State, input: string, canonical: string, changes: HistoryStatement[]) {
    // Never delete a valid source to install an alias to an absent target.
    if (input === canonical || !n.view[4].some(w => w[0] === canonical)) return;
    const previous = n.view[5].find(a => a[0] === input);
    changes.push(this.statement(db, "DELETE FROM worlds WHERE repo=?", input)); n.view[4] = n.view[4].filter(w => w[0] !== input);
    // A canonical can move again. Its former incoming aliases are removed,
    // rather than chained to input -> canonical. Unaffected rowids survive.
    changes.push(this.statement(db, "DELETE FROM world_aliases WHERE canonical=?", input)); n.view[5] = n.view[5].filter(a => a[1] !== input);
    const rowid = previous?.[2] ?? increment(Math.max(0, ...n.view[5].map(a => a[2])));
    changes.push(this.statement(db, "INSERT INTO world_aliases(rowid,alias,canonical) VALUES(?,?,?) ON CONFLICT(alias) DO UPDATE SET canonical=excluded.canonical", rowid, input, canonical));
    n.view[5] = [...n.view[5].filter(a => a[0] !== input), [input, canonical, rowid]];
    if (n.view[5].length > L.aliases) {
      const removed = [...n.view[5]].sort((a, b) => a[2] - b[2])[0]!;
      changes.push(this.statement(db, "DELETE FROM world_aliases WHERE alias=?", removed[0])); n.view[5] = n.view[5].filter(a => a[0] !== removed[0]);
    }
  }
  private barriers(n: State, targets: string[], denied: number) {
    const sequence = n.view[0][0]![6] = increment(n.view[0][0]![6]);
    n.view[2] = [...n.view[2].filter(b => !targets.includes(b[0])), ...targets.map(k => [k, sequence, denied] as Barrier)]; return sequence;
  }
  async commit(generation: RemoteWorldGeneration, write: WorldCaptureWrite) {
    const canonical = this.snapshot(write); write = { ...write };
    return this.run(async db => {
      const s = await this.state(db), g = await this.authenticate(s, generation); if (g[5] !== "active") return conflict();
      const keys = unique([g[1], g[2], this.resolve(s, g[1]), canonical]); this.admitted(s, keys, g);
      const n = this.next(s), ng = n.view[3].find(x => x[0] === g[0])!, roots = unique([g[1], canonical]), changes: HistoryStatement[] = [];
      if (keys.some(k => s.view[2].some(b => b[0] === k && b[2] === 1))) this.barriers(n, roots, 0);
      await this.put(db, s, n, canonical, write, changes); this.alias(db, n, g[1], canonical, changes);
      ng[5] = "committed"; ng[6] = await captureHash(json([canonical, write])); ng[7] = ng[8] = json(roots); ng[9] = n.view[0][0]![6];
      await this.save(db, s, n, changes, { repo: canonical, snapshot: write.snapshot }); return { saved: true as const };
    });
  }
  async putLegacy(write: WorldCaptureWrite) {
    const repo = this.snapshot(write); write = { ...write };
    return this.run(async db => { const s = await this.state(db); this.admitted(s, [repo, this.resolve(s, repo)]); const n = this.next(s), changes: HistoryStatement[] = []; await this.put(db, s, n, repo, write, changes); await this.save(db, s, n, changes, { repo, snapshot: write.snapshot }); });
  }
  async aliasLegacy(input: string, target: string) {
    const repo = captureKey(input), canonical = captureKey(target);
    return this.run(async db => { const s = await this.state(db); this.admitted(s, [repo, canonical, this.resolve(s, repo), this.resolve(s, canonical)]); if (repo === canonical || !s.view[4].some(w => w[0] === canonical)) return; const n = this.next(s), changes: HistoryStatement[] = []; this.alias(db, n, repo, canonical, changes); await this.save(db, s, n, changes); });
  }
  async evict(input: string) {
    const repo = captureKey(input);
    return this.run(async db => { const s = await this.state(db), canonical = this.resolve(s, repo), n = this.next(s), changes: HistoryStatement[] = [this.statement(db, "DELETE FROM worlds WHERE repo=?", canonical), this.statement(db, "DELETE FROM world_aliases WHERE alias=? OR canonical=?", canonical, canonical)]; n.view[4] = n.view[4].filter(w => w[0] !== canonical); n.view[5] = n.view[5].filter(a => a[0] !== canonical && a[1] !== canonical); await this.save(db, s, n, changes); });
  }
  async revoke(generation: RemoteWorldGeneration, claim?: string): Promise<{ barrier: "confirmed"; cleanup: "confirmed"; idempotent: boolean }> {
    return this.run(async db => {
      const s = await this.state(db), g = await this.authenticate(s, generation), canonical = claim === undefined ? undefined : await verifyWorldPrivateObservation(claim, generation, this.identity, this.key), roots = unique([g[1], ...(canonical ? [canonical] : [])]);
      const expanded = unique([...roots, ...roots.map(k => this.resolve(s, k))]), targets = unique([...expanded, ...s.view[5].filter(a => expanded.includes(a[1])).map(a => a[0])]);
      if (targets.length > 204) return captureReject();
      if (g[5] !== "active") {
        if (!["denied", "deny-pending"].includes(g[5]) || g[7] !== json(roots) || g[6] !== await captureHash(json([roots, list(g[8], 204)]))) return conflict();
        const previous = list(g[8], 204);
        if (previous.some(k => !s.view[2].some(b => b[0] === k && b[1] === g[9] && b[2] === 1))) return conflict();
        // Removed aliases after successful cleanup must not change receipt
        // identity. New aliases into the group disallow idempotent acceptance.
        if (targets.some(k => !previous.includes(k))) return conflict();
        if (g[5] === "deny-pending") throw new WorldCaptureError("WORLD_CAPTURE_UNAVAILABLE", 503, "unknown", "confirmed", "unconfirmed");
        return { barrier: "confirmed", cleanup: "confirmed", idempotent: true };
      }
      // A later barrier (including a reopen) fences a delayed private result.
      if (unique([g[1], g[2], ...targets]).some(k => s.view[2].some(b => b[0] === k && b[1] > g[3]))) return conflict();
      for (const key of targets) this.transient.add(key);
      const n = this.next(s), ng = n.view[3].find(x => x[0] === g[0])!, sequence = this.barriers(n, targets, 1);
      ng[5] = "deny-pending"; ng[6] = await captureHash(json([roots, targets])); ng[7] = json(roots); ng[8] = json(targets); ng[9] = sequence;
      try { await this.save(db, s, n); }
      catch { throw new WorldCaptureError("WORLD_CAPTURE_UNAVAILABLE", 503, "unknown", "unknown", "not-started"); }
      for (const key of targets) this.transient.delete(key);
      // Independent second batch. Never remove a concurrent public reopen.
      try {
        const current = await this.state(db), cg = await this.authenticate(current, generation);
        if (cg[5] !== "deny-pending" || targets.some(k => !current.view[2].some(b => b[0] === k && b[1] === sequence && b[2] === 1))) return conflict();
        const clean = this.next(current), changes: HistoryStatement[] = [];
        for (const key of targets) { changes.push(this.statement(db, "DELETE FROM worlds WHERE repo=?", key)); changes.push(this.statement(db, "DELETE FROM world_aliases WHERE alias=? OR canonical=?", key, key)); }
        clean.view[4] = clean.view[4].filter(w => !targets.includes(w[0])); clean.view[5] = clean.view[5].filter(a => !targets.includes(a[0]) && !targets.includes(a[1])); clean.view[3].find(x => x[0] === g[0])![5] = "denied";
        await this.save(db, current, clean, changes);
      } catch { throw new WorldCaptureError("WORLD_CAPTURE_UNAVAILABLE", 503, "unknown", "confirmed", "unconfirmed"); }
      return { barrier: "confirmed", cleanup: "confirmed", idempotent: false };
    });
  }
}
