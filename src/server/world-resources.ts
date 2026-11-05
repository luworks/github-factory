import { join } from "node:path";
import { getConfig } from "./config";
import { D1WorldStore } from "./d1-store";
import { GitHubClient, type Fetcher } from "./github";
import { PublicGitHubQuota } from "./public-quota";
import { WorldStore, worldStorePath } from "./store";
import type { SnapshotStore } from "./world-storage";

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
export function createWorldResources(config: ReturnType<typeof getConfig>, options: {
  network?: Fetcher; makeQuota?: () => Pick<PublicGitHubQuota, "take">; makeStore?: () => SnapshotStore;
} = {}) {
  const network = options.network ?? fetch;
  const quota = lazyGitHubQuota(options.makeQuota ?? (() => new PublicGitHubQuota(join(config.dataDir, "public-quota.sqlite"), config.githubRequestsPerHour)));
  let store: SnapshotStore | undefined, collector: GitHubClient | undefined;
  return {
    quota, network,
    get store(): SnapshotStore {
      return store ??= options.makeStore ? options.makeStore() : config.worldStore === "d1"
        ? new D1WorldStore({ endpoint: config.d1StorageUrl, secret: config.d1StorageSecret, databaseId: config.d1DatabaseId })
        : new WorldStore(worldStorePath(config.dataDir));
    },
    collector: { collect: (ref: Parameters<GitHubClient["collect"]>[0]) => (collector ??= new GitHubClient(config.githubToken, quota.wrap(network))).collect(ref) },
  };
}
let singleton: ReturnType<typeof createWorldResources> | undefined;
export const getWorldResources = () => singleton ??= createWorldResources(getConfig());
