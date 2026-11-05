import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorldSnapshot } from "../contracts";
import { parseRepo } from "./github";
import { isRenderableWorld } from "./world-readiness";
import { WorldStorageError, type CachedWorld, type WorldSummary, type WorldStorageStatus } from "./world-storage";
export type { CachedWorld } from "./world-storage";

/** Independent SQLite file; a complete snapshot is replaced atomically in a single statement. */
export class WorldStore {
  private db: Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS worlds (repo TEXT PRIMARY KEY, snapshot TEXT NOT NULL, expires_at INTEGER NOT NULL, saved_at INTEGER NOT NULL)",
    );
    this.db.exec("CREATE TABLE IF NOT EXISTS world_aliases (alias TEXT PRIMARY KEY, canonical TEXT NOT NULL)");
  }
  get(repo: string, now = Date.now(), options?: { readOnly?: boolean }): CachedWorld | null {
    const key = repo.toLowerCase();
    const alias = this.db.query("SELECT canonical FROM world_aliases WHERE alias = ?").get(key) as { canonical: string } | null;
    const canonical = alias?.canonical || key;
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
  }
  summaries(repos: string[], now = Date.now()): WorldSummary[] {
    return repos.flatMap((key) => { const entry = this.get(key, now, { readOnly: true }); return entry ? [{ key, repo: entry.world.repo, collectedAt: entry.world.collectedAt, expiresAt: entry.expiresAt, ready: isRenderableWorld(entry.world, now) }] : []; });
  }
  status(): WorldStorageStatus {
    const worlds = this.db.query("SELECT COUNT(*) count FROM worlds").get() as { count: number };
    const aliases = this.db.query("SELECT COUNT(*) count FROM world_aliases").get() as { count: number };
    return { backend: "sqlite", authoritative: true, schemaVersion: 1, worlds: worlds.count, aliases: aliases.count };
  }
  put(world: WorldSnapshot, ttlMs = 90_000, now = Date.now()): void {
    const expiry = now + Math.max(60_000, Math.min(120_000, ttlMs));
    // Bounded disk use: retain at most 100 recently saved public repository snapshots.
    this.db.transaction(() => {
      this.db
        .query(
          "INSERT INTO worlds(repo, snapshot, expires_at, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(repo) DO UPDATE SET snapshot=excluded.snapshot, expires_at=excluded.expires_at, saved_at=excluded.saved_at",
        )
        .run(world.repo.fullName.toLowerCase(), JSON.stringify(world), expiry, now);
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
