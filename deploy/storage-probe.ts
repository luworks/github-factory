import { worldStorageRpc, type StorageEnvironment } from "./d1-storage";
export const STORAGE_PROBE_HOST = "moon-factory-storage-probe-9ee81fb8.1031luy.workers.dev";
export const STORAGE_PROBE_PATH = "/github-factory/_storage-probe";
export const STORAGE_PROBE_DATABASE = "b2210c4a-4ed3-49ba-b044-2f6c24958fac";
/** Isolated rollback-proof endpoint. Never forwards company/product traffic,
 * arbitrary SQL/URLs, business operations, or a caller-selected RPC profile. */
export default {
  fetch(request: Request, env: StorageEnvironment): Promise<Response> | Response {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.host !== STORAGE_PROBE_HOST || url.username || url.password || url.pathname !== STORAGE_PROBE_PATH || url.search || url.hash || request.method !== "POST") return new Response("Not found", { status: 404 });
    return worldStorageRpc(request, env, "rollback-proof");
  },
};
