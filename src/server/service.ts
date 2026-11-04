import { CURATED_PROJECTS } from "../catalog";
import type { FeaturedProject, WorldSnapshot } from "../contracts";
import { analyzeCollection } from "./analysis";
import { getConfig } from "./config";
import { GitHubClient, GitHubError, parseRepo, type RepoCollection, type RepoRef } from "./github";
import { WorldStore, worldStorePath } from "./store";

interface Collector {
  collect(ref: RepoRef): Promise<RepoCollection>;
}
interface SnapshotStore {
  delete?(repo: string): void;
  alias?(input: string, canonical: string): void;
  get(repo: string, now?: number): ReturnType<WorldStore["get"]>;
  put(world: WorldSnapshot, ttlMs?: number, now?: number): void;
}

/** Injectable service factory keeps tests deterministic and prevents all network access on import. */
export function createWorldService(options: { collector: Collector; store: SnapshotStore; now?: () => number; maxConcurrent?: number }) {
  const now = options.now || Date.now;
  const inflight = new Map<string, Promise<WorldSnapshot>>();
  const cooldown = new Map<string, { until: number; error: GitHubError }>();
  let active = 0;
  const maxConcurrent = Math.max(1, Math.min(3, options.maxConcurrent ?? 2));
  const stale = (world: WorldSnapshot, error: GitHubError): WorldSnapshot => ({
    ...world,
    health: { ...world.health, github: "error" },
    coverage: {
      ...world.coverage,
      notes: [
        ...world.coverage.notes,
        `STALE snapshot from ${world.collectedAt}: refresh failed (${error.code}). Previous evidence is retained; freshness and current GitHub state are unknown.`,
      ],
    },
  });
  const asError = (error: unknown) =>
    error instanceof GitHubError ? error : new GitHubError("WORLD_UNAVAILABLE", 503, "Repository analysis is temporarily unavailable.");
  const getCachedWorld = (input: string): WorldSnapshot | null => {
    const ref = parseRepo(input);
    const entry = options.store.get(ref.fullName, now());
    if (!entry) return null;
    return entry.fresh
      ? entry.world
      : {
          ...entry.world,
          coverage: {
            ...entry.world.coverage,
            notes: [
              ...entry.world.coverage.notes,
              `STALE cached snapshot captured at ${entry.world.collectedAt}; no refresh was requested.`,
            ],
          },
        };
  };
  const loadWorld = async (input: string, settings?: { refresh?: boolean }): Promise<WorldSnapshot> => {
    const ref = parseRepo(input),
      key = ref.fullName.toLowerCase();
    const cached = options.store.get(key, now());
    if (cached?.fresh && !settings?.refresh) return cached.world;
    if (inflight.has(key)) return inflight.get(key)!;
    // Forced refresh cannot turn one browser into an unbounded GitHub request loop.
    if (cached && settings?.refresh && now() - Date.parse(cached.world.collectedAt) < 15_000) return cached.world;
    const failure = cooldown.get(key);
    if (failure && failure.until > now()) {
      if (cached) return stale(cached.world, failure.error);
      throw failure.error;
    }
    if (active >= maxConcurrent) {
      const error = new GitHubError("WORLD_BUSY", 429, "Repository collection slots are busy; retry shortly.", 5);
      if (cached) return stale(cached.world, error);
      throw error;
    }
    active++;
    const promise = (async () => {
      try {
        const world = analyzeCollection(await options.collector.collect(ref));
        const expiresAt = now() + 90_000;
        world.refreshAfter = expiresAt;
        options.store.put(world, 90_000, now());
        options.store.alias?.(key, world.repo.fullName);
        cooldown.set(key, {
          until: now() + 15_000,
          error: new GitHubError("REFRESH_COOLDOWN", 429, "Wait briefly before refreshing.", 15),
        });
        return world;
      } catch (error) {
        const typed = asError(error);
        cooldown.set(key, { until: now() + Math.max(15, Math.min(3600, typed.retryAfter || 15)) * 1000, error: typed });
        if (typed.code === "PUBLIC_ONLY") {
          options.store.delete?.(key);
          throw typed;
        }
        if (cached) return stale(cached.world, typed);
        throw typed;
      } finally {
        active--;
        inflight.delete(key);
        if (cooldown.size > 200) {
          for (const [id, value] of cooldown) if (value.until <= now()) cooldown.delete(id);
          if (cooldown.size > 200) cooldown.delete(cooldown.keys().next().value!);
        }
      }
    })();
    inflight.set(key, promise);
    return promise;
  };
  const listFeatured = async (): Promise<FeaturedProject[]> =>
    CURATED_PROJECTS.map((project) => {
      const cached = options.store.get(project.fullName, now());
      return cached
        ? {
            ...project,
            description: cached.world.repo.description || project.description,
            language: cached.world.repo.language,
            stars: cached.world.repo.stars,
            ready: true,
            collectedAt: cached.world.collectedAt,
          }
        : { ...project };
    });
  return { loadWorld, listFeatured, getCachedWorld };
}
let singleton: ReturnType<typeof createWorldService> | undefined;
function service() {
  if (!singleton) {
    const config = getConfig();
    singleton = createWorldService({
      collector: new GitHubClient(config.githubToken),
      store: new WorldStore(worldStorePath(config.dataDir)),
    });
  }
  return singleton;
}
/** Public GitHub facts only. refreshAfter is an absolute epoch-millisecond cache expiry.
 * refresh bypasses the 90s TTL after a 15s minimum interval; no AI module is imported.
 * Rejects with GitHubError { status, code, message, retryAfter? } without cached evidence.
 * Failed refreshes retain the original capture timestamp and mark the snapshot STALE. */
export const loadWorld = (input: string, options?: { refresh?: boolean }): Promise<WorldSnapshot> => service().loadWorld(input, options);
/** Curated catalog + persisted facts only; ready means a real cached snapshot exists. */
export const listFeatured = (): Promise<FeaturedProject[]> => service().listFeatured();
/** Cache-only read: no GitHub or paid requests; null on a miss, STALE note on expiry.
 * This reads the backend snapshot, whose blueprint is rules-generated. Parent integration
 * overlays its independently cached successful AI blueprint for the exact repository/head. */
export const getCachedWorld = (input: string): WorldSnapshot | null => service().getCachedWorld(input);
