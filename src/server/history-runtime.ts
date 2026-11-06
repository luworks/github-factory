import { accessRequest } from "./access";
import { historyConfig, projectEnv, type HistoryRuntimeConfig } from "./config";
import { D1RpcHistoryStore } from "./d1-history-store";
import { HistoryCursorCodec } from "./history-cursor";
import { createHistoryHttp, type HistoryHttpAccess, type HistoryHttpContext } from "./history-http";
import { createHistoryLifecycle } from "./history-lifecycle";
import { HistoryService } from "./history-service";
import type { Fetcher } from "./github";
import type { PublicGitHubQuota } from "./public-quota";
import type { SnapshotStore } from "./world-storage";

export const HISTORY_RUNTIME_GATES = ["WORLD_SCHEMA3_COMPATIBILITY_NOT_WIRED", "DURABLE_PUBLIC_REVOCATION_NOT_WIRED"] as const;
export interface HistoryRuntimeResources {
  /** Trusted server adapter, never a client flag or schema migration request. */
  readonly schemaVersion: 3;
  readonly cache: Pick<SnapshotStore, "get">;
  readonly quota: Pick<PublicGitHubQuota, "take">;
  readonly network: Fetcher;
  readonly revokePublicCapture?: (repo: string) => void | Promise<void>;
}
const unavailable = (code = "HISTORY_HTTP_UNAVAILABLE"): never => { throw Object.assign(new Error("History is unavailable."), { code, status: 503 }); };

/** Actual factory -> HTTP -> service -> RPC composition. All authorities are
 * server-injected; production adoption remains gated below. GET only reads.
 * No configuration, database, network, key or quota initialization on import. */
export function createHistoryRuntime(options: {
  /** Parsed by historyConfig; never assembled from request data. */
  config: HistoryRuntimeConfig | null;
  authenticate(request: Request): HistoryHttpAccess | Promise<HistoryHttpAccess>;
  resources(): HistoryRuntimeResources | null | Promise<HistoryRuntimeResources | null>;
}) {
  // Concurrent first requests must share the SAME original resource authority,
  // even if a provider allocates lazily or resolves out of order.
  let resourcePromise: Promise<HistoryRuntimeResources | null> | undefined;
  const resourcesOnce = () => resourcePromise ??= Promise.resolve().then(() => options.resources());
  let composition: Promise<{ resources: HistoryRuntimeResources; store: D1RpcHistoryStore; cursor: HistoryCursorCodec; lifecycle: ReturnType<typeof createHistoryLifecycle> }> | undefined;
  const compose = (resources: HistoryRuntimeResources) => composition ??= (async () => {
    const config = options.config!;
    const bytes = Uint8Array.from(config.cursorKeyHex.match(/../g) ?? [], pair => parseInt(pair, 16));
    const cursor = new HistoryCursorCodec(await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
    const store = new D1RpcHistoryStore(config.rpc, resources.network);
    return { resources, store, cursor, lifecycle: createHistoryLifecycle(resources.quota, store.observeSettlement) };
  })();
  return async (request: Request, context: Omit<HistoryHttpContext, "publicOrigin">): Promise<Response> => {
    let current: Awaited<NonNullable<typeof composition>> | undefined;
    return createHistoryHttp({
      async authenticate(input) {
        if (!options.config) return unavailable();
        const access = await options.authenticate(input);
        if (!access || access.gatewayAuthenticated !== true || access.requestAdmitted !== true) return access;
        const resources = await resourcesOnce();
        if (!resources || resources.schemaVersion !== 3) return unavailable();
        // No body read, collection allowance, GitHub request or append before
        // a real durable original-cache revocation authority is available.
        if (input.method === "POST" && typeof resources.revokePublicCapture !== "function") return unavailable("HISTORY_PRIVACY_UNAVAILABLE");
        current = await compose(resources);
        return access;
      },
      makeService(admission) {
        if (!current) return null;
        return new HistoryService({ cache: current.resources.cache, store: current.store, cursor: current.cursor,
          reader: { quota: current.resources.quota, fetcher: current.resources.network }, ...admission });
      },
      lifecycle: {
        held() { if (!current) return unavailable(); return current.lifecycle.held(); },
        run(work) { if (!current) return unavailable(); return current.lifecycle.run(work); },
      },
      revokePublicCapture(repo) { if (!current?.resources.revokePublicCapture) return unavailable("HISTORY_PRIVACY_UNAVAILABLE"); return current.resources.revokePublicCapture(repo); },
    })(request, { ...context, publicOrigin: options.config?.publicOrigin ?? "" });
  };
}

let singleton: ReturnType<typeof createHistoryRuntime> | undefined;
/** Registered production route remains unavailable until BOTH original-world
 * schema3 compatibility and durable privacy fencing are implemented/reviewed.
 * Setting a flag cannot bypass these gates. No SQLite fallback or policy DB. */
export function handleHistoryRequest(request: Request, context: Omit<HistoryHttpContext, "publicOrigin">) {
  if (!singleton) {
    let config: HistoryRuntimeConfig | null = null;
    try { config = historyConfig(projectEnv()); } catch { /* fixed unavailable */ }
    singleton = createHistoryRuntime({ config,
      authenticate(input) {
        const access = accessRequest(input, { requireGateway: true });
        return { ...access, gatewayAuthenticated: true, requestAdmitted: true };
      },
      // The original adapters do not yet provide either release-gate proof.
      // Do not initialize world storage/quota or pretend delete() is a fence.
      resources: () => null,
    });
  }
  return singleton(request, context);
}
