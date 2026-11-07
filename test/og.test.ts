import { expect, spyOn, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STYLE_IDS, type WorldSnapshot } from "../src/contracts";
import { renderHomeCard, renderWorldCard, TAGLINE, type CardWorld } from "../src/og/card";
import { asciiShare, drawableText } from "../src/og/font";
import { homeMeta, normalizeOrigin, validRepoParams, worldMeta } from "../src/og/meta";
import { crc32, encodePng } from "../src/og/png";
import { RenderBudgetError } from "../src/og/raster";
import { parseRepo } from "../src/server/github";
import { createOgImageService, imageResponse, OG_CACHE_FALLBACK, OG_CACHE_HOME, OG_CACHE_WORLD, siteLabel } from "../src/server/og-image";
import { resolvePublicOrigin } from "../src/server/public-origin";
import { syntheticWorld } from "./fixtures/browser-world";

const ORIGIN = "https://share.example";
type Tag = { title?: string; name?: string; property?: string; content?: string };
const content = (meta: Tag[], key: string) => meta.find((m) => m.name === key || m.property === key)?.content;

function chunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength), out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  for (let o = 8; o < png.length;) {
    const length = view.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const data = png.subarray(o + 8, o + 8 + length);
    out.push({ type, data, crcOk: crc32(png.subarray(o + 4, o + 8 + length)) === view.getUint32(o + 8 + length) });
    o += 12 + length;
  }
  return out;
}
function expectPng(png: Uint8Array, width: number, height: number) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const list = chunks(png);
  expect(list.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  expect(list.every((c) => c.crcOk)).toBe(true);
  const ihdr = new DataView(list[0].data.buffer, list[0].data.byteOffset, 13);
  expect([ihdr.getUint32(0), ihdr.getUint32(4), list[0].data[8], list[0].data[9]]).toEqual([width, height, 8, 2]);
  expect(inflateSync(list[1].data).length).toBe((width * 3 + 1) * height);
}
/** SYNTHETIC verified-source snapshot: test-only flag, never live GitHub evidence. */
function verifiedWorld(headSha = "1234567890abcdef1234567890abcdef12345678"): WorldSnapshot {
  const world = syntheticWorld();
  world.source = "github";
  world.headSha = headSha;
  world.refreshAfter = Date.now() + 60_000;
  return world;
}
function card(): CardWorld {
  const world = syntheticWorld();
  return { fullName: world.repo.fullName, nodes: world.nodes, edges: world.edges, totalNodes: world.nodes.length, totalEdges: world.edges.length, stars: 42, language: "TypeScript", description: world.repo.description };
}

test("encodePng emits a valid RGB PNG with correct CRCs and scanlines", () => {
  expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
  const rgb = new Uint8Array(5 * 3 * 3).map((_, i) => (i * 37) & 0xff);
  expectPng(encodePng(5, 3, rgb), 5, 3);
  expect(() => encodePng(5, 3, new Uint8Array(4))).toThrow();
});

test("SYNTHETIC world and homepage cards are 1200x630 PNGs in every style", () => {
  for (const style of STYLE_IDS) expectPng(renderWorldCard(card(), style), 1200, 630);
  expectPng(renderHomeCard({ site: "share.example/github-factory" }), 1200, 630);
  expect(TAGLINE).toBe("Every codebase. A world of its own.");
});

test("rendering honours its CPU deadline", () => {
  expect(() => renderWorldCard(card(), "factorio", { deadline: performance.now() - 1 })).toThrow(RenderBudgetError);
});

test("image text is reduced to the drawable ASCII glyph set", () => {
  expect(drawableText("Café “quoted”", 100)).toBe('Cafe "quoted"');
  for (const ch of drawableText("Café “quoted” — 日本 ‮\u0000 🚀", 100)) expect(ch.charCodeAt(0) < 0x7f || "·…★•".includes(ch)).toBe(true);
  expect(drawableText("x".repeat(500), 40).length).toBeLessThanOrEqual(40);
  expect(asciiShare("日本語のリポジトリ")).toBeLessThan(0.5);
});

test("home meta uses absolute origin + base path for page and image", () => {
  const meta = homeMeta(ORIGIN) as Tag[];
  expect(content(meta, "og:url")).toBe(`${ORIGIN}/github-factory/`);
  expect(content(meta, "og:image")).toBe(`${ORIGIN}/github-factory/og/home.png`);
  expect(content(meta, "twitter:image")).toBe(`${ORIGIN}/github-factory/og/home.png`);
  expect(content(meta, "twitter:card")).toBe("summary_large_image");
  expect(content(meta, "theme-color")).toMatch(/^#[0-9a-f]{6}$/);
  expect(meta.find((m) => m.title)?.title).toBe("Moon Factory — Your codebase, a living world");
  expect(content(meta, "og:description")).toContain("Every codebase. A world of its own.");
});

test("world meta is per repository and style; invalid params fall back to generic meta", () => {
  const meta = worldMeta(ORIGIN, "openclaw", "openclaw", "factorio") as Tag[];
  expect(meta.find((m) => m.title)?.title).toBe("openclaw/openclaw as a Factorio world · Moon Factory");
  expect(content(meta, "og:url")).toBe(`${ORIGIN}/github-factory/world/openclaw/openclaw?style=factorio`);
  expect(content(meta, "og:image")).toBe(`${ORIGIN}/github-factory/og/world/openclaw/openclaw?style=factorio`);
  const unstyled = worldMeta(ORIGIN, "vercel", "next.js", "<script>") as Tag[];
  expect(content(unstyled, "og:title")).toBe("vercel/next.js as a Moonshot world · Moon Factory");
  expect(content(unstyled, "og:url")).toBe(`${ORIGIN}/github-factory/world/vercel/next.js`);
  expect(content(unstyled, "og:image")).toBe(`${ORIGIN}/github-factory/og/world/vercel/next.js?style=moonshot`);
  for (const [owner, repo] of [['"><script>alert(1)</script>', "x"], ["ok", "..",], ["-bad", "x"], ["ok", "a/b"], ["ok", "x".repeat(101)], [undefined, "x"]])
    expect(worldMeta(ORIGIN, owner, repo, "factorio")).toEqual(homeMeta(ORIGIN));
});

test("rendered meta escapes every attribute value", () => {
  const hostile = '"><script>alert(1)</script>&';
  const meta = [...(worldMeta(ORIGIN, hostile, hostile, hostile) as Tag[]), { name: "x", content: hostile }];
  const html = renderToStaticMarkup(createElement(Fragment, null, ...meta.filter((m) => !m.title).map((m, i) => createElement("meta", { key: i, ...m }))));
  expect(html).not.toContain("<script");
  expect(html).toContain("&quot;&gt;&lt;script&gt;");
  for (const style of STYLE_IDS) for (const m of worldMeta(ORIGIN, "a-b", "c_d.e", style) as Tag[]) expect(m.content ?? m.title).not.toMatch(/[<>"'`]/);
});

test("meta validation agrees with the server repository parser", () => {
  const owners = ["a", "a-b", "-a", "a-", "A1", "a".repeat(39), "a".repeat(40), "a_b", "a.b", "", "日本"];
  const repos = ["r", "r.git", "next.js", ".", "..", "a_b-c", "r".repeat(100), "r".repeat(101), "a b", "a/b", "%2e%2e"];
  for (const owner of owners) for (const repo of repos) {
    let server: string | null = null;
    try { server = parseRepo(`${owner}/${repo}`).fullName; } catch { server = null; }
    const local = validRepoParams(owner, repo);
    expect(local ? `${local.owner}/${local.repo}` : null).toBe(server);
  }
});

test("public origin comes only from configuration, never the request", () => {
  expect(resolvePublicOrigin({ MOONSHOT_PUBLIC_ORIGIN: "https://chaorders.com" })).toBe("https://chaorders.com");
  expect(resolvePublicOrigin({ MOONSHOT_PUBLIC_ORIGIN: "https://chaorders.com/" })).toBe("https://chaorders.com");
  expect(resolvePublicOrigin({ MOONSHOT_PUBLIC_ORIGIN: "http://127.0.0.1:4362" })).toBe("http://127.0.0.1:4362");
  for (const bad of ["http://chaorders.com", "https://chaorders.com/github-factory/", "https://u:p@chaorders.com", "javascript:alert(1)", "chaorders.com", ""])
    expect(resolvePublicOrigin({ MOONSHOT_PUBLIC_ORIGIN: bad, PORT: "4362" })).toBe("http://localhost:4362");
  expect(resolvePublicOrigin({})).toBe("http://localhost:3000");
  expect(resolvePublicOrigin({ PORT: "99999" })).toBe("http://localhost:3000");
  expect(normalizeOrigin("https://a.example?x")).toBeNull();
  expect(siteLabel("https://chaorders.com", "/github-factory/")).toBe("chaorders.com/github-factory");
  expect(siteLabel(null, "/github-factory/")).toBeNull();
});

function stubRenderers() {
  const calls: string[] = [];
  return {
    calls,
    render: {
      world: (world: CardWorld, style: string) => { calls.push(`${world.fullName}|${style}`); return new TextEncoder().encode(`world:${world.fullName}:${style}`); },
      home: () => { calls.push("home"); return new TextEncoder().encode("home"); },
    },
  };
}

test("SYNTHETIC cache miss serves the generic card without network, collection or writes", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => { throw new Error("network forbidden"); }) as unknown as typeof fetch);
  try {
    let reads = 0;
    const service = createOgImageService({ getCached: async () => { reads++; return null; } });
    const image = await service.world("openclaw", "openclaw", "factorio");
    expect(reads).toBe(1);
    expect(image.kind).toBe("home");
    expect(image.cacheControl).toBe(OG_CACHE_FALLBACK);
    expectPng(image.body, 1200, 630);
    expect(service.home().cacheControl).toBe(OG_CACHE_HOME);
    expect(service.home().etag).toBe(image.etag);
    expect(service.cacheSize()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { fetchSpy.mockRestore(); }
});

test("SYNTHETIC unverified, empty, malformed or failing cache reads degrade to the generic card", async () => {
  const { render, calls } = stubRenderers();
  const demo = syntheticWorld();
  const empty = verifiedWorld();
  empty.coverage.tree = "unavailable";
  const malformed = verifiedWorld() as unknown as { nodes: unknown };
  malformed.nodes = "nope";
  for (const getCached of [async () => demo, async () => empty, async () => malformed as unknown as WorldSnapshot, async () => { throw new Error("storage down"); }]) {
    const image = await createOgImageService({ getCached, render }).world("synthetic-moonshot", "browser-fixture", "factorio");
    expect(image.kind).toBe("home");
  }
  expect(calls.filter((c) => c !== "home")).toEqual([]);
});

test("invalid owner/repo is rejected before any cache read", async () => {
  let reads = 0;
  const service = createOgImageService({ getCached: async () => { reads++; return null; }, render: stubRenderers().render });
  for (const [owner, repo] of [["..", "x"], ["a", ".."], ["-a", "b"], ["a", "b/c"]])
    await expect(service.world(owner, repo, "factorio")).rejects.toMatchObject({ status: 400 });
  expect(reads).toBe(0);
});

test("SYNTHETIC cached worlds render once per repo + style + head (LRU) and use CDN caching", async () => {
  const { render, calls } = stubRenderers();
  let world = verifiedWorld();
  const service = createOgImageService({ getCached: async () => world, render, maxEntries: 2 });
  const first = await service.world("synthetic-moonshot", "browser-fixture", "factorio");
  expect(first).toMatchObject({ kind: "world", cacheControl: OG_CACHE_WORLD });
  expect(await service.world("SYNTHETIC-MOONSHOT", "browser-fixture", "factorio")).toBe(first);
  await service.world("synthetic-moonshot", "browser-fixture", "not-a-style");
  expect(calls).toEqual(["synthetic-moonshot/browser-fixture|factorio", "synthetic-moonshot/browser-fixture|moonshot"]);
  world = verifiedWorld("abcdefabcdefabcdefabcdefabcdefabcdefabcd");
  await service.world("synthetic-moonshot", "browser-fixture", "factorio");
  expect(calls).toHaveLength(3);
  expect(service.cacheSize()).toBe(2);
});

test("SYNTHETIC render rate limit and render budget failures fall back to the generic card", async () => {
  let now = 0;
  const { render, calls } = stubRenderers();
  const limited = createOgImageService({ getCached: async () => verifiedWorld(), render, rendersPerMinute: 1, clock: () => now });
  expect((await limited.world("synthetic-moonshot", "browser-fixture", "factorio")).kind).toBe("world");
  expect((await limited.world("synthetic-moonshot", "browser-fixture", "civilization")).kind).toBe("home");
  now = 60_001;
  expect((await limited.world("synthetic-moonshot", "browser-fixture", "civilization")).kind).toBe("world");
  expect(calls.filter((c) => c !== "home")).toHaveLength(2);
  const slow = createOgImageService({ getCached: async () => verifiedWorld(), render: { ...render, world: () => { throw new RenderBudgetError(); } } });
  expect(await slow.world("synthetic-moonshot", "browser-fixture", "factorio")).toMatchObject({ kind: "home", cacheControl: OG_CACHE_FALLBACK });
  expect(slow.cacheSize()).toBe(0);
});

test("SYNTHETIC real world render through the service is a PNG of the cached districts", async () => {
  const service = createOgImageService({ getCached: async () => verifiedWorld(), site: "share.example/github-factory" });
  const image = await service.world("synthetic-moonshot", "browser-fixture", "civilization");
  expect(image.kind).toBe("world");
  expectPng(image.body, 1200, 630);
});

test("image responses support ETag revalidation and HEAD", async () => {
  const image = { body: new Uint8Array([1, 2, 3]), etag: '"og-abc"', cacheControl: OG_CACHE_WORLD, kind: "world" as const };
  const ok = imageResponse(new Request("http://localhost/og"), image);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/png");
  expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
  expect([...new Uint8Array(await ok.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(imageResponse(new Request("http://localhost/og", { headers: { "if-none-match": 'W/"og-abc"' } }), image).status).toBe(304);
  const head = imageResponse(new Request("http://localhost/og", { method: "HEAD" }), image);
  expect(head.headers.get("content-length")).toBe("3");
  expect(await head.text()).toBe("");
});
