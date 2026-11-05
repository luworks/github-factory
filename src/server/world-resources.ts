import { join } from "node:path";
import { getConfig, worldCaptureConfig } from "./config";
import { D1WorldStore } from "./d1-store";
import { D1CaptureWorldStore } from "./d1-capture-world-store";
import { GitHubClient, type Fetcher, type CollectionObservation } from "./github";
import { PublicGitHubQuota } from "./public-quota";
import { WorldStore, worldStorePath } from "./store";
import type { SnapshotStore } from "./world-storage";

type Config = ReturnType<typeof getConfig>;
interface ResourceOptions {
  network?: Fetcher;
  makeQuota?: () => Pick<PublicGitHubQuota, "take">;
  makeStore?: () => SnapshotStore;
}
interface BootstrapOptions extends ResourceOptions {
  /** Injectable only at the trusted server assembly boundary. May lower limits. */
  importKey?: (raw: Uint8Array) => Promise<CryptoKey>;
  timeoutMs?: number;
  clock?: () => number;
}

const invalid = (): never => { throw new Error("Invalid world capture configuration"); };
function bindConfig(config: Config): Config {
  const bound = { ...config }, capture = bound.worldCapture;
  if (capture != null) {
    // Revalidate copied fields together: a changed store, endpoint or identity
    // cannot silently turn an enabled profile into the legacy storage client.
    if (capture.endpoint !== bound.d1StorageUrl || capture.secret !== bound.d1StorageSecret || capture.identity.databaseId !== bound.d1DatabaseId) return invalid();
    bound.worldCapture = worldCaptureConfig({
      MOONSHOT_WORLD_CAPTURE_ENABLED: "true", MOONSHOT_WORLD_STORE: bound.worldStore,
      MOONSHOT_WORLD_CAPTURE_SCHEMA_VERSION: String(capture.schemaVersion), MOONSHOT_D1_STORAGE_URL: bound.d1StorageUrl,
      MOONSHOT_D1_STORAGE_SECRET: bound.d1StorageSecret, MOONSHOT_D1_DATABASE_ID: bound.d1DatabaseId,
      MOONSHOT_WORLD_CAPTURE_BINDING_NONCE: capture.identity.bindingNonce, MOONSHOT_WORLD_CAPTURE_EPOCH: capture.identity.epoch,
      MOONSHOT_WORLD_CAPTURE_KEY_HEX: capture.keyHex,
    });
  }
  return Object.freeze(bound);
}

/** One stable upstream identity shared by collector and history reader. Neither
 * constructing this handle nor wrapping fetch creates a file or spends quota. */
export function lazyGitHubQuota(make: () => Pick<PublicGitHubQuota, "take">) {
  let original: Pick<PublicGitHubQuota, "take"> | undefined;
  const quota = {
    take() { (original ??= make()).take(); },
    wrap(network: Fetcher): Fetcher { return (input, init) => { quota.take(); return network(input, init); }; },
  };
  return quota;
}

/** Injectable extraction of the ORIGINAL world-service resources; no second
 * quota file/counter, no history database and no import-time initialization. */
export function createWorldResources(config: Config, options: ResourceOptions = {}) {
  if (config.worldCapture != null) throw new Error("World capture requires asynchronous initialization");
  return resources(bindConfig(config), { ...options });
}

function resources(config: Config, options: ResourceOptions, selectedStore?: SnapshotStore) {
  const network = options.network ?? fetch;
  const quota = lazyGitHubQuota(options.makeQuota ?? (() => new PublicGitHubQuota(join(config.dataDir, "public-quota.sqlite"), config.githubRequestsPerHour)));
  let store = selectedStore, collector: GitHubClient | undefined;
  return {
    quota, network,
    get store(): SnapshotStore {
      return store ??= options.makeStore ? options.makeStore() : config.worldStore === "d1"
        ? new D1WorldStore({ endpoint: config.d1StorageUrl, secret: config.d1StorageSecret, databaseId: config.d1DatabaseId })
        : new WorldStore(worldStorePath(config.dataDir));
    },
    collector: { collect: (ref: Parameters<GitHubClient["collect"]>[0], context?: CollectionObservation) => (collector ??= new GitHubClient(config.githubToken, quota.wrap(network))).collect(ref, context) },
  };
}

/** One graph per initializer, including a latched failure. Snapshot before any
 * await; neither a caller mutation nor a late import can retarget publication.
 * Construction performs no storage health/adoption check and no upstream IO. */
export function createWorldResourceInitializer(config: Config, options: BootstrapOptions = {}) {
  let bootstrap: () => Promise<ReturnType<typeof createWorldResources>>;
  try {
    const bound = bindConfig(config), supplied = { ...options };
    const settings = Object.freeze({ ...supplied, network: supplied.network ?? fetch });
    const capture = bound.worldCapture;
    if (capture && settings.makeStore) return invalid();
    const timeout = settings.timeoutMs ?? 10000;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 10000) return invalid();
    const clock = settings.clock ?? performance.now.bind(performance);
    const importKey = settings.importKey ?? ((raw: Uint8Array) => crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
    bootstrap = async () => {
      if (!capture) return resources(bound, settings);
      const start = clock();
      const check = () => { const current = clock(); if (!Number.isFinite(start) || !Number.isFinite(current) || current < start || current - start >= timeout) throw new Error("World capture initialization unavailable"); };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        check();
        const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("World capture initialization unavailable")), timeout); });
        const raw = Uint8Array.from(capture.keyHex.match(/../g)!, v => parseInt(v, 16));
        const key = await Promise.race([Promise.resolve().then(() => { check(); return importKey(raw); }), deadline]);
        check();
        const store = new D1CaptureWorldStore({ endpoint: capture.endpoint, secret: capture.secret, identity: { ...capture.identity }, key }, settings.network);
        const graph = resources(bound, settings, store);
        check(); // Final monotonic publication check, even before timer dispatch.
        return graph;
      } catch {
        // Do not expose credential-bearing provider errors or retry an import.
        throw new Error("World capture initialization unavailable");
      } finally { if (timer !== undefined) clearTimeout(timer); }
    };
  } catch {
    bootstrap = async () => { throw new Error("Invalid world capture configuration"); };
  }
  let initialization: Promise<ReturnType<typeof createWorldResources>> | undefined;
  return () => initialization ??= Promise.resolve().then(bootstrap);
}

export const initializeWorldResources = (config: Config, options: BootstrapOptions = {}) => createWorldResourceInitializer(config, options)();
let singleton: Promise<ReturnType<typeof createWorldResources>> | undefined;
export function getWorldResources() {
  if (!singleton) {
    try { singleton = initializeWorldResources(getConfig()); }
    catch { singleton = Promise.reject(new Error("Invalid world capture configuration")); }
  }
  return singleton;
}
