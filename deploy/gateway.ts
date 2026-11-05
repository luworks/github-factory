import { worldStorageRpc, type StorageEnvironment } from "./d1-storage";
/** Independent path Worker. A prefix route also catches bare-path query strings.
 * No company-site bundle, credentials, SQLite or model code is included. */
export default {
  async fetch(request: Request, env: StorageEnvironment & { FACTORY_ORIGIN: string; FACTORY_GATEWAY_SECRET?: string; COMPANY_SITE?: { fetch(request: Request): Promise<Response> } }): Promise<Response> {
    const publicUrl = new URL(request.url);
    if (publicUrl.hostname !== "chaorders.com")
      return new Response("Not found", { status: 404 });
    // Cloudflare matches the query string too: an exact bare-path zone route
    // misses /github-factory?style=... . The prefix route therefore needs a
    // transparent service binding for adjacent company paths, never recursion.
    if (!(publicUrl.pathname === "/github-factory" || publicUrl.pathname.startsWith("/github-factory/")))
      return env.COMPANY_SITE?.fetch(request) ?? new Response("Not found", { status: 404 });
    if (publicUrl.pathname === "/github-factory/_storage") return worldStorageRpc(request, env);
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
