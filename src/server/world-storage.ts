import type { RepoIdentity, WorldSnapshot } from "../contracts";

export type Awaitable<T> = T | Promise<T>;
export interface CachedWorld { world: WorldSnapshot; expiresAt: number; fresh: boolean }
export interface WorldSummary { key: string; repo: RepoIdentity; collectedAt: string; expiresAt: number; ready: boolean }
export interface WorldStorageStatus { backend: "sqlite" | "d1"; authoritative: true; schemaVersion: number; databaseId?: string; worlds: number; aliases: number }
/** Opaque server-only collection lifetime, minted BEFORE calling the public
 * collector. Implementations authenticate object identity; fields are not proof
 * supplied by a browser, timestamps, or a cached WorldSnapshot. */
export interface PublicCaptureGeneration { readonly repo: string; readonly sequence: number }
export interface PublicCaptureAuthority {
  begin(repo: string, options: { explicitRevalidation: boolean }): Awaitable<PublicCaptureGeneration>;
  assert(generation: PublicCaptureGeneration): Awaitable<void>;
  /** Only the trusted service's newly completed public collector may call this.
   * Snapshot+alias+reopening are one atomic compare-and-commit transition. */
  commit(generation: PublicCaptureGeneration, world: WorldSnapshot, ttlMs?: number, now?: number): Awaitable<void>;
  /** Same generation = same observation (no automatic cleanup retry). Omitting
   * it denotes a NEW trusted definitive private observation, never eviction. */
  revoke(repo: string, observation?: PublicCaptureGeneration): Awaitable<{ barrier: "confirmed"; cleanup: "confirmed" }>;
}
export interface SnapshotStore {
  get(repo: string, now?: number, options?: { readOnly?: boolean }): Awaitable<CachedWorld | null>;
  summaries?(repos: string[], now?: number): Awaitable<WorldSummary[]>;
  put(world: WorldSnapshot, ttlMs?: number, now?: number): Awaitable<void>;
  alias?(input: string, canonical: string): Awaitable<void>;
  delete?(repo: string): Awaitable<void>;
  status?(): Awaitable<WorldStorageStatus>;
  readonly publicCaptures?: PublicCaptureAuthority;
}
export class WorldStorageError extends Error {
  readonly status = 503;
  readonly code = "WORLD_STORAGE_UNAVAILABLE";
  constructor() { super("The authoritative world store is unavailable. Current source state remains unknown; retry later."); }
}
export class WorldRevocationError extends WorldStorageError {
  constructor(readonly barrier: "confirmed" | "unknown", readonly cleanup: "unconfirmed" | "not-started") { super(); }
}
