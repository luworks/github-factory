import { expect, test } from "@playwright/test";

// Server-rendered share metadata as a crawler sees it (no JavaScript), plus the
// image endpoints. The offline runtime has no cached GitHub world, so world
// cards must fall back to the generic card without any outbound request.
const meta = (html: string, key: string) =>
  html.match(new RegExp(`<meta (?:name|property)="${key.replace(/[:.]/g, "\\$&")}" content="([^"]*)"`))?.[1];

test("SYNTHETIC crawlers get absolute per-world share meta under the base path", async ({ request, baseURL }) => {
  const base = new URL(baseURL!);
  const html = await (await request.get("world/synthetic-moonshot/browser-fixture?style=factorio")).text();
  expect(html).toContain("<title>synthetic-moonshot/browser-fixture as a Factorio world · Moon Factory</title>");
  expect(meta(html, "og:image")).toMatch(new RegExp(`^https?://[^/]+${base.pathname}og/world/synthetic-moonshot/browser-fixture\\?style=factorio$`));
  expect(meta(html, "og:url")).toMatch(new RegExp(`^https?://[^/]+${base.pathname}world/synthetic-moonshot/browser-fixture\\?style=factorio$`));
  expect(meta(html, "twitter:card")).toBe("summary_large_image");
  expect(html.match(/property="og:image"/g)).toHaveLength(1);
  const home = await (await request.get("")).text();
  expect(meta(home, "og:image")).toMatch(new RegExp(`${base.pathname}og/home\\.png$`));
  expect(meta(home, "theme-color")).toBeTruthy();
});

test("SYNTHETIC share images are PNGs; a cache miss serves the generic card briefly", async ({ request }) => {
  const home = await request.get("og/home.png");
  expect(home.status()).toBe(200);
  expect(home.headers()["content-type"]).toBe("image/png");
  const body = await home.body();
  expect([...body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([1200, 630]);
  const miss = await request.get("og/world/synthetic-moonshot/browser-fixture?style=civilization");
  expect(miss.status()).toBe(200);
  expect(miss.headers()["x-og-image"]).toBe("home");
  expect(miss.headers()["cache-control"]).toBe("public, max-age=300, s-maxage=600");
  expect((await request.get("og/world/..%2F/x")).status()).toBe(400);
});
