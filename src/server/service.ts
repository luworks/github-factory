import { CURATED_PROJECTS } from "../catalog";
import type { FeaturedProject, WorldSnapshot } from "../contracts";
import { analyzeCollection } from "./analysis";
import { getConfig } from "./config";
import { GitHubClient, GitHubError, parseRepo, type RepoCollection, type RepoRef } from "./github";
import { WorldStore, worldStorePath } from "./store";
import { PublicGitHubQuota } from "./public-quota";
import { join } from "node:path";
import { isRenderableWorld } from "./world-readiness";
import { D1WorldStore } from "./d1-store";
import type { CachedWorld, SnapshotStore, WorldStorageStatus } from "./world-storage";
import { activePublicAnalyses, migrationHeld, requireAnalysisOpen } from "./runtime-activity";

interface Collector {
  collect(ref: RepoRef): Promise<RepoCollection>;
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
  const asError = (error: unknown) => error instanceof GitHubError ? error
    : (error as { code?: string })?.code === "IP_RATE_LIMIT"
        ? new GitHubError("IP_RATE_LIMIT", 429, (error as Error).message, (error as { retryAfter?: number }).retryAfter)
      : new GitHubError("WORLD_UNAVAILABLE", 503, "Repository analysis is temporarily unavailable.");
  const cachedSnapshot = (entry: CachedWorld | null): WorldSnapshot | null => {
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
  const getCachedWorld = async (input: string): Promise<WorldSnapshot | null> => {
    const ref = parseRepo(input);
    return cachedSnapshot(await options.store.get(ref.fullName, now(), { readOnly: true }));
  };
  const loadWorld = async (input: string, settings?: { refresh?: boolean; admit?: () => void }): Promise<WorldSnapshot> => {
    const ref = parseRepo(input),
      key = ref.fullName.toLowerCase();
    const cached = await options.store.get(key, now());
    // Navigation is cache-first, including historical snapshots. It must never
    // wait on GitHub, consume collection allowance, or start background work.
    if (cached && !settings?.refresh) return cachedSnapshot(cached)!;
    if (inflight.has(key)) return inflight.get(key)!;
    // Forced refresh cannot turn one browser into an unbounded GitHub request loop.
    if (cached && settings?.refresh && now() - Date.parse(cached.world.collectedAt) < 15_000) return cached.world;
    requireAnalysisOpen();
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
    // Admission is before any collector work, after free cache/singleflight reads.
    // Rejection must not create a repository-wide cooldown for other clients.
    try { settings?.admit?.(); }
    catch (error) { if (cached) return stale(cached.world, asError(error)); throw error; }
    active++;
    const promise = (async () => {
      try {
        const collected = await options.collector.collect(ref);

        const world = analyzeCollection(collected);
        const expiresAt = now() + 90_000;
        world.refreshAfter = expiresAt;
        await options.store.put(world, 90_000, now());
        await options.store.alias?.(key, world.repo.fullName);
        cooldown.set(key, {
          until: now() + 15_000,
          error: new GitHubError("REFRESH_COOLDOWN", 429, "Wait briefly before refreshing.", 15),
        });
        return world;
      } catch (error) {
        if ((error as { code?: string })?.code === "WORLD_STORAGE_UNAVAILABLE") throw error;
        const typed = asError(error);
        cooldown.set(key, { until: now() + Math.max(15, Math.min(3600, typed.retryAfter || 15)) * 1000, error: typed });
        if (typed.code === "PUBLIC_ONLY") {
          await options.store.delete?.(key);
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
  const listFeatured = async (): Promise<FeaturedProject[]> => {
    const keys = CURATED_PROJECTS.map((project) => project.fullName.toLowerCase());
    const summaries = options.store.summaries ? await options.store.summaries(keys, now()) :
      (await Promise.all(keys.map(async (key) => { const entry = await options.store.get(key, now(), { readOnly: true }); return entry ? { key, repo: entry.world.repo, collectedAt: entry.world.collectedAt, expiresAt: entry.expiresAt, ready: isRenderableWorld(entry.world, now()) } : null; }))).filter((row) => row !== null);
    const byKey = new Map(summaries.map((row) => [row.key, row]));
    return CURATED_PROJECTS.map((project) => {
      const cached = byKey.get(project.fullName.toLowerCase());
      return cached?.ready
        ? {
            ...project,
            description: cached.repo.description || project.description,
            language: cached.repo.language,
            stars: cached.repo.stars,
            ready: true,
            collectedAt: cached.collectedAt,
          }
        : { ...project };
    });
  };
  const storageStatus = async (): Promise<WorldStorageStatus | { backend: "injected" }> => options.store.status ? options.store.status() : { backend: "injected" };
  return { loadWorld, listFeatured, getCachedWorld, storageStatus, activeCollections: () => active };
}
let singleton: ReturnType<typeof createWorldService> | undefined;
function service() {
  if (!singleton) {
    const config = getConfig();
    let collector: GitHubClient | undefined;
    singleton = createWorldService({
      // Cache reads must not initialize or consume the upstream quota store.
      collector: { collect: (ref) => {
        const client = collector ??= new GitHubClient(config.githubToken, new PublicGitHubQuota(join(config.dataDir, "public-quota.sqlite"), config.githubRequestsPerHour).wrap(fetch));
        return client.collect(ref);
      } },
      store: config.worldStore === "d1" ? new D1WorldStore({ endpoint: config.d1StorageUrl, secret: config.d1StorageSecret, databaseId: config.d1DatabaseId }) : new WorldStore(worldStorePath(config.dataDir)),
    });
  }
  return singleton;
}
/** Public GitHub facts only. refreshAfter is an absolute epoch-millisecond cache expiry.
 * refresh bypasses the 90s TTL after a 15s minimum interval; no AI module is imported.
 * Rejects with GitHubError { status, code, message, retryAfter? } without cached evidence.
 * Failed refreshes retain the original capture timestamp and mark the snapshot STALE. */
export const loadWorld = (input: string, options?: { refresh?: boolean; admit?: () => void }): Promise<WorldSnapshot> => service().loadWorld(input, options);
/** Curated catalog + persisted facts only; ready means a real cached snapshot exists. */
export const listFeatured = (): Promise<FeaturedProject[]> => service().listFeatured();
/** Cache-only read: no GitHub or paid requests; null on a miss, STALE note on expiry.
 * This reads the backend snapshot, whose blueprint is rules-generated. Parent integration
 * overlays its independently cached successful AI blueprint for the exact repository/head. */
export const getCachedWorld = (input: string): Promise<WorldSnapshot | null> => service().getCachedWorld(input);
export const getWorldStorageState = async () => ({ ...(await service().storageStatus()), writesHeld: migrationHeld(), activeCollections: service().activeCollections(), activePublicAnalyses: activePublicAnalyses() });
