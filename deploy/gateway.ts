import { worldStorageRpc, type StorageEnvironment } from "./d1-storage";
import { historyStorageRpc } from "./history-rpc";
import { worldCaptureRpc } from "./world-capture-rpc";
import type { HistoryD1Binding } from "./history-storage";

export interface GatewayEnvironment extends Omit<StorageEnvironment, "WORLDS_DB"> {
  WORLDS_DB?: StorageEnvironment["WORLDS_DB"] & HistoryD1Binding;
  FACTORY_ORIGIN: string; FACTORY_GATEWAY_SECRET?: string;
  COMPANY_SITE?: { fetch(request: Request): Promise<Response> };
  /** Unset/"" keeps the legacy storage RPC. "4" mounts ONLY the schema4 world
   * capture RPC at the same path; any other value or invalid key fails closed. */
  FACTORY_WORLD_CAPTURE_SCHEMA_VERSION?: string; FACTORY_WORLD_CAPTURE_KEY_HEX?: string;
  /** Exactly "true" mounts the history RPC; otherwise its path is an edge 404. */
  FACTORY_HISTORY_RPC_ENABLED?: string;
}

const STORAGE_PATH = "/github-factory/_storage";
const noStore = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const unavailable = () => new Response(JSON.stringify({ ok: false, code: "WORLD_STORAGE_UNAVAILABLE", error: "The fixed world storage operation is unavailable or rejected.", writeOutcome: "not-started" }), { status: 503, headers: noStore });
// One non-extractable HMAC key per isolate, re-imported only if the hex changes.
let captureKey: { hex: string; key: Promise<CryptoKey> } | undefined;
function importCaptureKey(hex: string) {
  if (captureKey?.hex !== hex) {
    const raw = Uint8Array.from(hex.match(/../g)!, v => parseInt(v, 16));
    const key = crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    key.catch(() => { if (captureKey?.key === key) captureKey = undefined; });
    captureKey = { hex, key };
  }
  return captureKey.key;
}

/** Private storage paths never reach the Bun origin. Profile selection is by
 * explicit Worker configuration only, never by request content. */
async function storageRoute(request: Request, pathname: string, env: GatewayEnvironment): Promise<Response> {
  if (pathname === `${STORAGE_PATH}/history`)
    return env.FACTORY_HISTORY_RPC_ENABLED === "true" ? historyStorageRpc(request, env) : new Response("Not found", { status: 404 });
  if (pathname !== STORAGE_PATH) return new Response("Not found", { status: 404 });
  const version = env.FACTORY_WORLD_CAPTURE_SCHEMA_VERSION;
  if (version === undefined || version === "") return worldStorageRpc(request, env);
  const hex = env.FACTORY_WORLD_CAPTURE_KEY_HEX ?? "";
  if (version !== "4" || !/^[a-f0-9]{64}$/.test(hex)) return unavailable();
  let key: CryptoKey;
  try { key = await importCaptureKey(hex); } catch { return unavailable(); }
  const identity = { databaseId: env.FACTORY_STORAGE_DATABASE_ID ?? "", bindingNonce: env.FACTORY_STORAGE_BINDING_NONCE ?? "", epoch: env.FACTORY_MIGRATION_EPOCH ?? "" };
  return worldCaptureRpc(request, env, { identity, key });
}

/** Independent path Worker. A prefix route also catches bare-path query strings.
 * No company-site bundle, credentials, SQLite or model code is included. */
export default {
  async fetch(request: Request, env: GatewayEnvironment): Promise<Response> {
    const publicUrl = new URL(request.url);
    if (publicUrl.hostname !== "chaorders.com")
      return new Response("Not found", { status: 404 });
    // Cloudflare matches the query string too: an exact bare-path zone route
    // misses /github-factory?style=... . The prefix route therefore needs a
    // transparent service binding for adjacent company paths, never recursion.
    if (!(publicUrl.pathname === "/github-factory" || publicUrl.pathname.startsWith("/github-factory/")))
      return env.COMPANY_SITE?.fetch(request) ?? new Response("Not found", { status: 404 });
    if (publicUrl.pathname === STORAGE_PATH || publicUrl.pathname.startsWith(`${STORAGE_PATH}/`)) return storageRoute(request, publicUrl.pathname, env);
    // Before retiring a legacy Bun process, close every admission path that can
    // collect or generate. Cached gallery/preview reads remain available until
    // the dedicated connector is stopped to close already accepted slow bodies.
    if (env.FACTORY_ADMISSION_FENCE) {
      const cheapRead = ["GET", "HEAD"].includes(request.method) && (
        ["/github-factory/api/gallery", "/github-factory/api/budget", "/github-factory/api/health"].includes(publicUrl.pathname) ||
        /^\/github-factory\/api\/gallery-preview\/[^/]+\/[^/]+$/.test(publicUrl.pathname));
      if (publicUrl.pathname.startsWith("/github-factory/api/") && !cheapRead || !["GET", "HEAD"].includes(request.method))
        return Response.json({ error: "A short world storage maintenance is in progress. New analysis is temporarily unavailable.", code: "STORAGE_MIGRATION_HOLD", epoch: env.FACTORY_MIGRATION_EPOCH }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "60", "x-factory-admission-fence": env.FACTORY_MIGRATION_EPOCH || "unverified" } });
    }
    if (!["GET", "HEAD", "POST"].includes(request.method))
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD, POST" } });
    if (publicUrl.pathname === "/github-factory") {
      publicUrl.pathname += "/";
      return Response.redirect(publicUrl.href, 308);
    }
    if (request.method === "POST" && request.headers.has("origin") && request.headers.get("origin") !== publicUrl.origin)
      return new Response("Origin rejected", { status: 403 });
    const gatewayKey = env.FACTORY_GATEWAY_SECRET || "";
    const clientIp = request.headers.get("cf-connecting-ip") || "";
    if (gatewayKey.length < 32 || !clientIp || clientIp.length > 64 || !/^[0-9a-f:.]+$/i.test(clientIp))
      return new Response("Gateway client verification unavailable", { status: 503 });
    const upstream = new URL(env.FACTORY_ORIGIN);
    if (upstream.protocol !== "https:" || upstream.pathname !== "/" || upstream.username || upstream.password || upstream.search || upstream.hash)
      return new Response("Gateway configuration unavailable", { status: 503 });
    upstream.pathname = publicUrl.pathname;
    upstream.search = publicUrl.search;
    const headers = new Headers(request.headers);
    for (const key of ["host", "authorization", "cookie", "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-factory-client-ip", "x-factory-gateway-key"])
      headers.delete(key);
    // CF-Connecting-IP is supplied by Cloudflare on this Worker ingress. The
    // origin accepts this identity only together with the private shared key.
    headers.set("x-factory-client-ip", clientIp);
    headers.set("x-factory-gateway-key", gatewayKey);
    headers.delete("cf-connecting-ip");
    // Application validates the exact configured browser Origin. No caller can
    // override that decision using Host or forwarded headers.
    let response: Response;
    try {
      response = await fetch(upstream, { method: request.method, headers, body: request.body, redirect: "manual" });
    } catch {
      return Response.json({ error: "The repository gateway is temporarily unavailable. Please retry.", code: "GATEWAY_UNAVAILABLE" },
        { status: 503, headers: { "cache-control": "no-store" } });
    }
    const result = new Response(response.body, response);
    result.headers.set("x-content-type-options", "nosniff");
    result.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    result.headers.set("cache-control", "no-store");
    return result;
  },
};
