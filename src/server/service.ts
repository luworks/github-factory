import { CURATED_PROJECTS } from "../catalog";
import type { FeaturedProject, WorldSnapshot } from "../contracts";
import { analyzeCollection } from "./analysis";
import { GitHubError, parseRepo, createCollectionObservation, takePrivateRepositoryObservation, type CollectionObservation, type RepoCollection, type RepoRef } from "./github";
import { getWorldResources } from "./world-resources";
import { isRenderableWorld } from "./world-readiness";
import { WorldStorageError, type CachedWorld, type SnapshotStore, type WorldStorageStatus, type PublicCaptureGeneration } from "./world-storage";
import { activePublicAnalyses, migrationHeld, requireAnalysisOpen } from "./runtime-activity";
import { createWorldLifecycle } from "./world-lifecycle";

interface Collector {
  collect(ref: RepoRef, context?: CollectionObservation): Promise<RepoCollection>;
}

/** Injectable service factory keeps tests deterministic and prevents all network access on import. */
export function createWorldService(options: { collector: Collector; store: SnapshotStore; now?: () => number; maxConcurrent?: number }) {
  const now = options.now || Date.now;
  // One original store owns reads, writes and the bound lifetime observation.
  const store = options.store;
  const inflight = new Map<string, Promise<WorldSnapshot>>();
  const cooldown = new Map<string, { until: number; error: GitHubError }>();
  let active = 0;
  const maxConcurrent = Math.max(1, Math.min(3, options.maxConcurrent ?? 2));
  const lifecycle = createWorldLifecycle(store);
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
    return cachedSnapshot(await store.get(ref.fullName, now(), { readOnly: true }));
  };
  const loadWorld = async (input: string, settings?: { refresh?: boolean; explicitRevalidation?: boolean; admit?: () => void }): Promise<WorldSnapshot> => {
    const ref = parseRepo(input),
      key = ref.fullName.toLowerCase();
    const cached = await store.get(key, now());
    const authority = store.publicCaptures;
    if (authority && ["begin", "assert", "commit", "revoke"].some(method => typeof authority[method as keyof typeof authority] !== "function")) throw new WorldStorageError();
    const fallback = async (error: GitHubError, generation?: PublicCaptureGeneration) => {
      if (!cached) throw error;
      if (authority && generation) await authority.assert(generation);
      // Cached variables predate asynchronous work. Re-read the authority so a
      // concurrent revocation cannot turn a network/admission error into a leak.
      const current = await store.get(key, now(), { readOnly: true });
      if (!current) throw new WorldStorageError();
      return stale(current.world, error);
    };
    // Navigation is cache-first, including historical snapshots. It must never
    // wait on GitHub, consume collection allowance, or start background work.
    if (cached && !settings?.refresh) return cachedSnapshot(cached)!;
    if (inflight.has(key)) return inflight.get(key)!;
    // Forced refresh cannot turn one browser into an unbounded GitHub request loop.
    if (cached && settings?.refresh && now() - Date.parse(cached.world.collectedAt) < 15_000) return cached.world;
    // A late provider mutation cannot route a newly present observer through
    // the legacy path captured by this factory. Recompose behind a real handoff.
    if (!lifecycle && "observeSettlement" in store) throw new WorldStorageError();
    requireAnalysisOpen();
    const failure = cooldown.get(key);
    if (failure && failure.until > now()) {
      if (cached) return fallback(failure.error);
      throw failure.error;
    }
    if (active >= maxConcurrent) {
      const error = new GitHubError("WORLD_BUSY", 429, "Repository collection slots are busy; retry shortly.", 5);
      if (cached) return fallback(error);
      throw error;
    }
    active++;
    // Install singleflight before awaiting an asynchronous generation authority.
    let publish!: (world: WorldSnapshot) => void, fail!: (error: unknown) => void;
    const promise = new Promise<WorldSnapshot>((resolve, reject) => { publish = resolve; fail = reject; });
    inflight.set(key, promise);
    const collect = async () => {
      let generation: PublicCaptureGeneration | undefined, collectionContext: CollectionObservation | undefined, admitted = false;
      try {
        requireAnalysisOpen();
        if (authority) {
          const pending = authority.begin(key, { explicitRevalidation: settings?.explicitRevalidation === true || settings?.refresh === true });
          generation = pending && typeof (pending as Promise<PublicCaptureGeneration>).then === "function" ? await pending : pending as PublicCaptureGeneration;
          if (!generation || generation.repo !== key || !Number.isSafeInteger(generation.sequence) || generation.sequence < 0) throw new WorldStorageError();
        }
        // A denied legacy GET must not spend collection allowance or fetch.
        settings?.admit?.(); admitted = true;
        collectionContext = createCollectionObservation(key, generation);
        const collected = await options.collector.collect(ref, collectionContext);

        const world = analyzeCollection(collected);
        const expiresAt = now() + 90_000;
        world.refreshAfter = expiresAt;
        if (authority) await authority.commit(generation!, world, 90_000, now());
        else { // Legacy injectable adapters; D1 privacy is NOT advertised ready.
          await store.put(world, 90_000, now());
          await store.alias?.(key, world.repo.fullName);
        }
        cooldown.set(key, {
          until: now() + 15_000,
          error: new GitHubError("REFRESH_COOLDOWN", 429, "Wait briefly before refreshing.", 15),
        });
        return world;
      } catch (error) {
        if ((error as { code?: string })?.code === "WORLD_STORAGE_UNAVAILABLE") throw error;
        const typed = asError(error);
        if (!admitted) { if (cached) return await fallback(typed, generation); throw error; }
        cooldown.set(key, { until: now() + Math.max(15, Math.min(3600, typed.retryAfter || 15)) * 1000, error: typed });
        if (typed.code === "PUBLIC_ONLY" && typed.status === 403) {
          if (authority) await authority.revoke(key, generation, generation ? takePrivateRepositoryObservation(error, collectionContext, key, generation) : undefined);
          else await store.delete?.(key);
          throw typed;
        }
        if (cached) return await fallback(typed, generation);
        throw typed;
      } finally {
        if (!lifecycle) releaseSlot();
      }
    };
    const releaseSlot = () => {
      active--;
      inflight.delete(key);
      if (cooldown.size > 200) {
        for (const [id, value] of cooldown) if (value.until <= now()) cooldown.delete(id);
        if (cooldown.size > 200) cooldown.delete(cooldown.keys().next().value!);
      }
    };
    const work = lifecycle ? lifecycle.run(collect, releaseSlot) : collect();
    void work.then(publish, fail);
    return promise;
  };
  const listFeatured = async (): Promise<FeaturedProject[]> => {
    const keys = CURATED_PROJECTS.map((project) => project.fullName.toLowerCase());
    const summaries = store.summaries ? await store.summaries(keys, now()) :
      (await Promise.all(keys.map(async (key) => { const entry = await store.get(key, now(), { readOnly: true }); return entry ? { key, repo: entry.world.repo, collectedAt: entry.world.collectedAt, expiresAt: entry.expiresAt, ready: isRenderableWorld(entry.world, now()) } : null; }))).filter((row) => row !== null);
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
  const storageStatus = async (): Promise<WorldStorageStatus | { backend: "injected" }> => store.status ? store.status() : { backend: "injected" };
  return { loadWorld, listFeatured, getCachedWorld, storageStatus, activeCollections: () => active };
}
let singleton: ReturnType<typeof createWorldService> | undefined;
function service() {
  if (!singleton) {
    const resources = getWorldResources();
    singleton = createWorldService({ collector: resources.collector, store: resources.store });
  }
  return singleton;
}
/** Public GitHub facts only. refreshAfter is an absolute epoch-millisecond cache expiry.
 * refresh bypasses the 90s TTL after a 15s minimum interval; no AI module is imported.
 * Rejects with GitHubError { status, code, message, retryAfter? } without cached evidence.
 * Failed refreshes retain the original capture timestamp and mark the snapshot STALE. */
export const loadWorld = (input: string, options?: { refresh?: boolean; explicitRevalidation?: boolean; admit?: () => void }): Promise<WorldSnapshot> => service().loadWorld(input, options);
/** Curated catalog + persisted facts only; ready means a real cached snapshot exists. */
export const listFeatured = (): Promise<FeaturedProject[]> => service().listFeatured();
/** Cache-only read: no GitHub or paid requests; null on a miss, STALE note on expiry.
 * This reads the backend snapshot, whose blueprint is rules-generated. Parent integration
 * overlays its independently cached successful AI blueprint for the exact repository/head. */
export const getCachedWorld = (input: string): Promise<WorldSnapshot | null> => service().getCachedWorld(input);
export const getWorldStorageState = async () => ({ ...(await service().storageStatus()), writesHeld: migrationHeld(), activeCollections: service().activeCollections(), activePublicAnalyses: activePublicAnalyses() });
