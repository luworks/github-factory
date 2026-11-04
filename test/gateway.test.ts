import { expect, spyOn, test } from "bun:test";
import gateway from "../deploy/gateway";

const fakeFetch = (fn: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>): typeof fetch =>
  Object.assign(fn, { preconnect: fetch.preconnect });

const env = { FACTORY_ORIGIN: "https://factory-origin.example", FACTORY_GATEWAY_SECRET: "synthetic-gateway-key-32-characters-long" };
test("path gateway preserves deep links/query/body and browser Origin, strips caller authority", async () => {
  let received: { url: string; init?: RequestInit } | undefined;
  const mock = spyOn(globalThis, "fetch").mockImplementation(fakeFetch(async (url, init) => {
    received = { url: String(url), init };
    return new Response("synthetic upstream", { headers: { "content-type": "application/json" } });
  }));
  try {
    const response = await gateway.fetch(new Request("https://chaorders.com/github-factory/api/world/example/repo?refresh=1", {
      method: "POST", body: "{}", headers: {
        origin: "https://chaorders.com", "content-type": "application/json", authorization: "synthetic",
        cookie: "synthetic", "cf-connecting-ip": "192.0.2.10", "x-factory-client-ip": "192.0.2.99", "x-factory-gateway-key": "forged", "x-forwarded-host": "evil.example", host: "evil.example",
      },
    }), env);
    expect(received?.url).toBe("https://factory-origin.example/github-factory/api/world/example/repo?refresh=1");
    const headers = new Headers(received?.init?.headers);
    expect(headers.get("origin")).toBe("https://chaorders.com");
    expect(headers.get("x-factory-client-ip")).toBe("192.0.2.10");
    expect(headers.get("x-factory-gateway-key")).toBe(env.FACTORY_GATEWAY_SECRET);
    expect(headers.has("cf-connecting-ip")).toBe(false);
    for (const key of ["host", "authorization", "cookie", "x-forwarded-host"]) expect(headers.has(key)).toBe(false);
    expect(await new Response(received?.init?.body).text()).toBe("{}");
    expect(await response.text()).toBe("synthetic upstream");
    expect(response.headers.get("cache-control")).toBe("no-store");
  } finally { mock.mockRestore(); }
});

test("path gateway confines routes and rejects cross-origin writes before upstream", async () => {
  const mock = spyOn(globalThis, "fetch").mockImplementation(fakeFetch(async () => { throw new Error("must not fetch"); }));
  try {
    for (const path of ["/", "/api/health", "/github-factory-other"]) {
      expect((await gateway.fetch(new Request(`https://chaorders.com${path}`), env)).status).toBe(404);
    }
    const redirect = await gateway.fetch(new Request("https://chaorders.com/github-factory?style=moonshot"), env);
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe("https://chaorders.com/github-factory/?style=moonshot");
    const rejected = await gateway.fetch(new Request("https://chaorders.com/github-factory/api/worlds", {
      method: "POST", headers: { origin: "https://evil.example" },
    }), env);
    expect(rejected.status).toBe(403);
    expect(mock).not.toHaveBeenCalled();
  } finally { mock.mockRestore(); }
});

test("gateway transport failure remains a recoverable error without upstream details", async () => {
  const mock = spyOn(globalThis, "fetch").mockImplementation(fakeFetch(async () => { throw new Error("sensitive-origin-detail"); }));
  try {
    const response = await gateway.fetch(new Request("https://chaorders.com/github-factory/api/gallery", { headers: { "cf-connecting-ip": "192.0.2.10" } }), env);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive-origin-detail");
  } finally { mock.mockRestore(); }
});

test("adjacent company paths preserve the original request and response through the company binding", async () => {
  const request = new Request("https://chaorders.com/github-factory-other?x=1", {
    method: "POST", body: "synthetic company payload", headers: { cookie: "synthetic=company" },
  });
  let received: Request | undefined;
  const original = new Response("synthetic existing company response", { status: 404, headers: { "x-company-fixture": "retained" } });
  const result = await gateway.fetch(request, { ...env, COMPANY_SITE: { async fetch(input) { received = input; return original; } } });
  expect(received).toBe(request);
  expect(result).toBe(original);
  expect(result.headers.get("x-company-fixture")).toBe("retained");
});

test("gateway fails closed without a shared secret or platform client IP", async () => {
  const mock = spyOn(globalThis, "fetch").mockImplementation(fakeFetch(async () => { throw new Error("must not forward"); }));
  try {
    expect((await gateway.fetch(new Request("https://chaorders.com/github-factory/api/worlds", {
      headers: { "cf-connecting-ip": "192.0.2.10", "x-factory-gateway-key": "forged" },
    }), { FACTORY_ORIGIN: env.FACTORY_ORIGIN })).status).toBe(503);
    expect((await gateway.fetch(new Request("https://chaorders.com/github-factory/api/worlds"), env)).status).toBe(503);
    expect(mock).not.toHaveBeenCalled();
  } finally { mock.mockRestore(); }
});
