import type { RepoIdentity, WorldSnapshot } from "../contracts";

export type Awaitable<T> = T | Promise<T>;
export interface CachedWorld { world: WorldSnapshot; expiresAt: number; fresh: boolean }
export interface WorldSummary { key: string; repo: RepoIdentity; collectedAt: string; expiresAt: number; ready: boolean }
export interface WorldStorageStatus { backend: "sqlite" | "d1"; authoritative: true; schemaVersion: number; databaseId?: string; worlds: number; aliases: number }
export interface SnapshotStore {
  get(repo: string, now?: number, options?: { readOnly?: boolean }): Awaitable<CachedWorld | null>;
  summaries?(repos: string[], now?: number): Awaitable<WorldSummary[]>;
  put(world: WorldSnapshot, ttlMs?: number, now?: number): Awaitable<void>;
  alias?(input: string, canonical: string): Awaitable<void>;
  delete?(repo: string): Awaitable<void>;
  status?(): Awaitable<WorldStorageStatus>;
}
export class WorldStorageError extends Error {
  readonly status = 503;
  readonly code = "WORLD_STORAGE_UNAVAILABLE";
  constructor() { super("The authoritative world store is unavailable. Current source state remains unknown; retry later."); }
}
