import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { WorldSnapshot } from "../contracts";
import { parseRepo } from "./github";
import { isRenderableWorld } from "./world-readiness";
import { WorldRevocationError, WorldStorageError, type CachedWorld, type WorldSummary, type WorldStorageStatus, type PublicCaptureAuthority, type PublicCaptureGeneration } from "./world-storage";
export type { CachedWorld } from "./world-storage";
type Barrier = { sequence: number; denied: number };
type Generation = { repo: string; canonical: string; sequence: number; explicit: boolean; ended: boolean; revocation?: { sequence?: number; keys: string[]; error?: WorldRevocationError } };
const keyOf = (repo: string) => parseRepo(repo).fullName.toLowerCase();
const unavailable = (): never => { throw new WorldStorageError(); };
const controlDigest = (sequence: number, rows: { repo: string; sequence: number; denied: number }[]) => createHash("sha256").update(JSON.stringify([sequence, rows.map(row => [row.repo, row.sequence, row.denied])])).digest("hex");

/** Independent SQLite file; a complete snapshot is replaced atomically in a single statement. */
export class WorldStore {
  private db: Database;
  private generations = new WeakMap<PublicCaptureGeneration, Generation>();
  // A failed initial barrier cannot promise durability. Fail closed in THIS
  // instance only; another process/restart is explicitly UNKNOWN in that case.
  private unconfirmedDenials = new Set<string>();
  readonly publicCaptures = {
    begin: (repo, options) => this.beginCapture(repo, options),
    assert: generation => this.assertCapture(generation),
    commit: (generation, world, ttl?: number, now?: number) => this.commitCapture(generation, world, ttl, now),
    revoke: (repo, observation?: PublicCaptureGeneration) => this.revokeCapture(repo, observation),
  } satisfies PublicCaptureAuthority;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS worlds (repo TEXT PRIMARY KEY, snapshot TEXT NOT NULL, expires_at INTEGER NOT NULL, saved_at INTEGER NOT NULL)",
    );
    this.db.exec("CREATE TABLE IF NOT EXISTS world_aliases (alias TEXT PRIMARY KEY, canonical TEXT NOT NULL)");
    try {
      this.db.transaction(() => {
        const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('world_public_state','world_public_barriers')").all() as { name: string }[];
        const marker = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
        if (tables.length === 0 && marker === 0) {
          this.db.exec("CREATE TABLE world_public_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), schema_version INTEGER NOT NULL CHECK(schema_version=1), sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence BETWEEN 0 AND 9007199254740991), barrier_digest TEXT NOT NULL)");
          this.db.query("INSERT INTO world_public_state VALUES(1,1,0,?)").run(controlDigest(0, []));
          this.db.exec("CREATE TABLE world_public_barriers (repo TEXT PRIMARY KEY, sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991), denied INTEGER NOT NULL CHECK(denied IN (0,1)))");
          this.db.exec("PRAGMA user_version=1");
        } else if (tables.length !== 2 || marker !== 1) return unavailable();
        this.control();
      }).immediate();
    } catch { this.db.close(); return unavailable(); }
  }
  /** Validate persisted control before treating absence as legacy-public. Never
   * repair malformed/missing rows, reset a sequence or infer state from clocks. */
  private control() {
    try {
      if ((this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version !== 1) return unavailable();
      const rows = this.db.query("SELECT * FROM world_public_state").all() as { singleton: number; schema_version: number; sequence: number; barrier_digest: string }[];
      if (rows.length !== 1 || Object.keys(rows[0]!).sort().join() !== "barrier_digest,schema_version,sequence,singleton" || rows[0]!.singleton !== 1 || rows[0]!.schema_version !== 1 || !Number.isSafeInteger(rows[0]!.sequence) || rows[0]!.sequence < 0 || !/^[a-f0-9]{64}$/.test(rows[0]!.barrier_digest)) return unavailable();
      const sequence = rows[0]!.sequence, barriers = new Map<string, Barrier>();
      const persisted = this.db.query("SELECT * FROM world_public_barriers ORDER BY repo").all() as { repo: string; sequence: number; denied: number }[];
      for (const row of persisted) {
        if (Object.keys(row).sort().join() !== "denied,repo,sequence" || typeof row.repo !== "string" || keyOf(row.repo) !== row.repo || !Number.isSafeInteger(row.sequence) || row.sequence < 1 || row.sequence > sequence || ![0, 1].includes(row.denied) || barriers.has(row.repo)) return unavailable();
        barriers.set(row.repo, { sequence: row.sequence, denied: row.denied });
      }
      if (sequence > 0 && !barriers.size || controlDigest(sequence, persisted) !== rows[0]!.barrier_digest) return unavailable();
      return { sequence, barriers };
    } catch { return unavailable(); }
  }
  /** Detect missing/altered control rows as corruption instead of treating them
   * as never-revoked legacy data. This is not protection from a DB owner/old
   * binary that can deliberately rewrite both data and its checksum. */
  private saveControl(sequence: number) {
    const rows = this.db.query("SELECT repo,sequence,denied FROM world_public_barriers ORDER BY repo").all() as { repo: string; sequence: number; denied: number }[];
    if (this.db.query("UPDATE world_public_state SET sequence=?,barrier_digest=? WHERE singleton=1").run(sequence, controlDigest(sequence, rows)).changes !== 1) return unavailable();
  }
  private canonical(key: string) {
    const alias = this.db.query("SELECT canonical FROM world_aliases WHERE alias=?").get(key) as { canonical: string } | null;
    if (!alias) return key;
    if (typeof alias.canonical !== "string" || keyOf(alias.canonical) !== alias.canonical) return unavailable();
    return alias.canonical;
  }
  private admitted(keys: string[], control: ReturnType<WorldStore["control"]>, generation?: Generation) {
    for (const key of keys) {
      const barrier = control.barriers.get(key);
      if (this.unconfirmedDenials.has(key) || (generation ? barrier && (barrier.sequence > generation.sequence || barrier.denied === 1 && !generation.explicit) : barrier)) return unavailable();
    }
  }
  private generation(token: PublicCaptureGeneration) {
    const generation = token && this.generations.get(token);
    if (!generation || generation.ended) return unavailable();
    return generation;
  }
  private beginCapture(repo: string, options: { explicitRevalidation: boolean }): PublicCaptureGeneration {
    const key = keyOf(repo);
    return this.db.transaction(() => {
      const control = this.control(), canonical = this.canonical(key);
      const explicit = options?.explicitRevalidation === true;
      const generation: Generation = { repo: key, canonical, sequence: control.sequence, explicit, ended: false };
      this.admitted([key, canonical], control, generation);
      const token = Object.freeze({ repo: key, sequence: control.sequence });
      this.generations.set(token, generation); return token;
    })();
  }
  private assertCapture(token: PublicCaptureGeneration) {
    const generation = this.generation(token);
    this.db.transaction(() => { const control = this.control(); this.admitted([generation.repo, generation.canonical, this.canonical(generation.repo)], control, generation); })();
  }
  private nextSequence(sequence: number) { if (!Number.isSafeInteger(sequence + 1)) return unavailable(); return sequence + 1; }
  private commitCapture(token: PublicCaptureGeneration, world: WorldSnapshot, ttlMs = 90_000, now = Date.now()) {
    const generation = this.generation(token); generation.ended = true;
    try {
      this.db.transaction(() => {
        const canonical = keyOf(world.repo.fullName), control = this.control();
        if (world.source !== "github" || world.repo.url !== `https://github.com/${world.repo.fullName}`) return unavailable();
        // A canonical rename learned AFTER collection uses the START sequence,
        // never a fresh lease minted from this older public metadata response.
        const keys = [...new Set([generation.repo, generation.canonical, this.canonical(generation.repo), canonical])];
        this.admitted(keys, control, generation);
        if (keys.some(key => control.barriers.get(key)?.denied === 1)) {
          if (!generation.explicit) return unavailable();
          const sequence = this.nextSequence(control.sequence);
          // Reopen only the freshly verified input/canonical identity; other old
          // aliases retain their deny barrier until independently revalidated.
          for (const key of new Set([generation.repo, canonical])) if (this.db.query("INSERT INTO world_public_barriers VALUES(?,?,0) ON CONFLICT(repo) DO UPDATE SET sequence=excluded.sequence,denied=0").run(key, sequence).changes !== 1) return unavailable();
          this.saveControl(sequence);
          const reopened = this.control();
          if ([generation.repo, canonical].some(key => reopened.barriers.get(key)?.sequence !== sequence || reopened.barriers.get(key)?.denied !== 0)) return unavailable();
        }
        this.putSnapshot(world, ttlMs, now); this.putAlias(generation.repo, canonical);
        const saved = this.db.query("SELECT snapshot,expires_at,saved_at FROM worlds WHERE repo=?").get(canonical) as { snapshot: string; expires_at: number; saved_at: number } | null;
        if (!saved || saved.snapshot !== JSON.stringify(world) || saved.saved_at !== now || saved.expires_at !== now + Math.max(60_000, Math.min(120_000, ttlMs))) return unavailable();
        if (generation.repo !== canonical && (this.canonical(generation.repo) !== canonical || this.db.query("SELECT repo FROM worlds WHERE repo=?").get(generation.repo))) return unavailable();
        const final = this.control();
        if ([generation.repo, canonical].some(key => final.barriers.get(key)?.denied === 1)) return unavailable();
      }).immediate();
    } catch { return unavailable(); }
  }
  private revokeCapture(repo: string, token?: PublicCaptureGeneration): { barrier: "confirmed"; cleanup: "confirmed" } {
    const key = keyOf(repo), generation = token ? this.generations.get(token) : undefined;
    if (token && (!generation || generation.repo !== key)) return unavailable();
    if (generation?.revocation) {
      const previous = generation.revocation;
      if (previous.error) throw previous.error;
      const control = this.control();
      if (previous.keys.some(repo => control.barriers.get(repo)?.sequence !== previous.sequence || control.barriers.get(repo)?.denied !== 1)) return unavailable();
      return { barrier: "confirmed", cleanup: "confirmed" };
    }
    if (generation?.ended) return unavailable();
    const observation: NonNullable<Generation["revocation"]> = { keys: [key] };
    if (generation) { generation.ended = true; generation.revocation = observation; }
    this.unconfirmedDenials.add(key);
    let confirmed = false;
    try {
      // FIRST independently commit the deny barrier. Cleanup must never roll it
      // back; a failed barrier write is not a durable guarantee or zero writes.
      this.db.transaction(() => {
        const control = this.control(), canonical = this.canonical(key);
        const aliases = this.db.query("SELECT alias FROM world_aliases WHERE canonical=?").all(canonical) as { alias: string }[];
        observation.keys = [...new Set([key, canonical, ...aliases.map(row => keyOf(row.alias))])];
        for (const repo of observation.keys) this.unconfirmedDenials.add(repo);
        const sequence = this.nextSequence(control.sequence);
        for (const repo of observation.keys) if (this.db.query("INSERT INTO world_public_barriers VALUES(?,?,1) ON CONFLICT(repo) DO UPDATE SET sequence=excluded.sequence,denied=1").run(repo, sequence).changes !== 1) return unavailable();
        this.saveControl(sequence);
        const denied = this.control();
        if (observation.keys.some(repo => denied.barriers.get(repo)?.sequence !== sequence || denied.barriers.get(repo)?.denied !== 1)) return unavailable();
        observation.sequence = sequence;
      }).immediate();
      confirmed = true;
      for (const repo of observation.keys) this.unconfirmedDenials.delete(repo);
      // SECOND clean physical data. Trigger/storage failure leaves the FIRST
      // transaction's deny state intact across another connection or restart.
      this.db.transaction(() => {
        const control = this.control();
        if (observation.keys.some(repo => control.barriers.get(repo)?.sequence !== observation.sequence || control.barriers.get(repo)?.denied !== 1)) return unavailable();
        for (const repo of observation.keys) {
          this.db.query("DELETE FROM worlds WHERE repo=?").run(repo);
          this.db.query("DELETE FROM world_aliases WHERE alias=? OR canonical=?").run(repo, repo);
          if (this.db.query("SELECT repo FROM worlds WHERE repo=?").get(repo) || this.db.query("SELECT alias FROM world_aliases WHERE alias=? OR canonical=? LIMIT 1").get(repo, repo)) return unavailable();
        }
      }).immediate();
      return { barrier: "confirmed", cleanup: "confirmed" };
    } catch {
      const error = new WorldRevocationError(confirmed ? "confirmed" : "unknown", confirmed ? "unconfirmed" : "not-started");
      observation.error = error; throw error;
    }
  }
  get(repo: string, now = Date.now(), options?: { readOnly?: boolean }): CachedWorld | null {
    return this.db.transaction(() => {
      const key = repo.toLowerCase(), control = this.control();
      const canonical = this.canonical(key);
      if ([key, canonical].some(repo => this.unconfirmedDenials.has(repo))) return unavailable();
      if ([key, canonical].some(repo => control.barriers.get(repo)?.denied === 1)) return null;
      const row = this.db.query("SELECT snapshot, expires_at FROM worlds WHERE repo = ?").get(canonical) as {
        snapshot: string;
        expires_at: number;
      } | null;
      if (!row) return null;
      try {
        const world: WorldSnapshot = JSON.parse(row.snapshot);
        if (
          world.schemaVersion !== 1 ||
          !world.repo ||
          world.repo.fullName.toLowerCase() !== canonical ||
          !Array.isArray(world.nodes) ||
          !Array.isArray(world.edges) ||
          !world.blueprint
        )
          throw new Error("Invalid cached snapshot");
        return { world, expiresAt: row.expires_at, fresh: row.expires_at > now };
      } catch {
        if (options?.readOnly) throw new WorldStorageError();
        this.delete(repo);
        return null;
      }
    })();
  }
  summaries(repos: string[], now = Date.now()): WorldSummary[] {
    return repos.flatMap((key) => { const entry = this.get(key, now, { readOnly: true }); return entry ? [{ key, repo: entry.world.repo, collectedAt: entry.world.collectedAt, expiresAt: entry.expiresAt, ready: isRenderableWorld(entry.world, now) }] : []; });
  }
  status(): WorldStorageStatus {
    this.control();
    const worlds = this.db.query("SELECT COUNT(*) count FROM worlds").get() as { count: number };
    const aliases = this.db.query("SELECT COUNT(*) count FROM world_aliases").get() as { count: number };
    return { backend: "sqlite", authoritative: true, schemaVersion: 1, worlds: worlds.count, aliases: aliases.count };
  }
  put(world: WorldSnapshot, ttlMs = 90_000, now = Date.now()): void {
    this.db.transaction(() => { this.admitted([keyOf(world.repo.fullName)], this.control()); this.putSnapshot(world, ttlMs, now); }).immediate();
  }
  private putSnapshot(world: WorldSnapshot, ttlMs: number, now: number): void {
    const expiry = now + Math.max(60_000, Math.min(120_000, ttlMs));
    // Bounded disk use: retain at most 100 recently saved public repository snapshots.
    this.db.transaction(() => {
      const written = this.db
        .query(
          "INSERT INTO worlds(repo, snapshot, expires_at, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(repo) DO UPDATE SET snapshot=excluded.snapshot, expires_at=excluded.expires_at, saved_at=excluded.saved_at",
        )
        .run(world.repo.fullName.toLowerCase(), JSON.stringify(world), expiry, now);
      if (written.changes !== 1) return unavailable();
      this.db.query("DELETE FROM worlds WHERE repo NOT IN (SELECT repo FROM worlds ORDER BY saved_at DESC, repo LIMIT 100)").run();
      this.db
        .query("DELETE FROM world_aliases WHERE alias = ? OR canonical NOT IN (SELECT repo FROM worlds)")
        .run(world.repo.fullName.toLowerCase());
    })();
  }
  /** Only the collector's verified public canonical identity establishes a one-hop alias. */
  alias(input: string, canonical: string): void {
    const key = parseRepo(input).fullName.toLowerCase();
    const target = parseRepo(canonical).fullName.toLowerCase();
    this.db.transaction(() => { this.admitted([key, target, this.canonical(key), this.canonical(target)], this.control()); this.putAlias(key, target); }).immediate();
  }
  private putAlias(key: string, target: string): void {
    if (key === target) return;
    this.db.transaction(() => {
      if (!this.db.query("SELECT repo FROM worlds WHERE repo = ?").get(target)) return;
      this.db.query("DELETE FROM worlds WHERE repo = ?").run(key);
      this.db.query("DELETE FROM world_aliases WHERE canonical = ?").run(key);
      this.db
        .query("INSERT INTO world_aliases(alias,canonical) VALUES (?,?) ON CONFLICT(alias) DO UPDATE SET canonical=excluded.canonical")
        .run(key, target);
      this.db.query("DELETE FROM world_aliases WHERE rowid NOT IN (SELECT rowid FROM world_aliases ORDER BY rowid DESC LIMIT 200)").run();
    })();
  }
  delete(repo: string): void {
    const key = repo.toLowerCase();
    this.db.transaction(() => {
      const alias = this.db.query("SELECT canonical FROM world_aliases WHERE alias = ?").get(key) as { canonical: string } | null;
      const target = alias?.canonical || key;
      this.db.query("DELETE FROM worlds WHERE repo = ?").run(target);
      this.db.query("DELETE FROM world_aliases WHERE alias = ? OR canonical = ?").run(key, target);
    })();
  }
  close() {
    this.db.close();
  }
}
export const worldStorePath = (dataDir: string) => join(dataDir, "worlds.sqlite");
