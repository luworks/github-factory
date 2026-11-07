import { createHash } from "node:crypto";
import type { StyleId, WorldEdge, WorldNode, WorldSnapshot } from "../contracts";
import { renderHomeCard, renderWorldCard, type CardOptions, type CardWorld } from "../og/card";
import { isStyleId, normalizeOrigin } from "../og/meta";
import { projectRepositoryPreview } from "./gallery-preview";
import { parseRepo } from "./github";

/** A world card is immutable for one capture (repo + style + head), so CDNs may keep it. */
export const OG_CACHE_WORLD = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
/** The generic card stands in for a miss only briefly, so a later capture appears. */
export const OG_CACHE_FALLBACK = "public, max-age=300, s-maxage=600";
export const OG_CACHE_HOME = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800";

export type OgImage = { body: Uint8Array; etag: string; cacheControl: string; kind: "world" | "home" };
type Renderers = {
  world: (world: CardWorld, style: StyleId, options: CardOptions) => Uint8Array;
  home: (options: CardOptions) => Uint8Array;
};
export interface OgImageOptions {
  /** Read-only cache lookup. The service never collects, analyses or writes. */
  getCached: (input: string) => Promise<WorldSnapshot | null>;
  site?: string | null;
  clock?: () => number;
  maxEntries?: number;
  maxBytes?: number;
  rendersPerMinute?: number;
  renderMs?: number;
  render?: Renderers;
}

const etagOf = (body: Uint8Array) => `"og-${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;

/** Cache-only social cards with a bounded LRU, a global render rate and a CPU deadline per render. */
export function createOgImageService(options: OgImageOptions) {
  const clock = options.clock ?? (() => performance.now());
  const render = options.render ?? { world: renderWorldCard, home: renderHomeCard };
  const maxEntries = options.maxEntries ?? 48, maxBytes = options.maxBytes ?? 24 * 1024 * 1024;
  const rendersPerMinute = options.rendersPerMinute ?? 20, renderMs = options.renderMs ?? 1500;
  const site = options.site ?? null;
  const lru = new Map<string, OgImage>();
  let bytes = 0, homeImage: OgImage | undefined, homeFallback: OgImage | undefined;
  const renders: number[] = [];

  const home = (): OgImage => {
    if (!homeImage) {
      const body = render.home({ site, deadline: clock() + 8000 });
      homeImage = { body, etag: etagOf(body), cacheControl: OG_CACHE_HOME, kind: "home" };
      homeFallback = { ...homeImage, cacheControl: OG_CACHE_FALLBACK };
    }
    return homeImage;
  };
  const fallback = () => (home(), homeFallback!);
  const admitRender = () => {
    const now = clock();
    while (renders.length && renders[0] <= now - 60_000) renders.shift();
    if (renders.length >= rendersPerMinute) return false;
    renders.push(now);
    return true;
  };
  const remember = (key: string, image: OgImage) => {
    lru.set(key, image);
    bytes += image.body.length;
    for (const [oldest, value] of lru) {
      if (lru.size <= maxEntries && bytes <= maxBytes) break;
      lru.delete(oldest);
      bytes -= value.body.length;
    }
  };

  /** Invalid owner/repo rejects (GitHubError 400); every other problem degrades to the generic card. */
  const world = async (owner: string, repo: string, styleParam: unknown): Promise<OgImage> => {
    const input = `${owner}/${repo}`;
    parseRepo(input);
    const style: StyleId = isStyleId(styleParam) ? styleParam : "moonshot";
    let snapshot: WorldSnapshot | null;
    let preview: ReturnType<typeof projectRepositoryPreview>;
    try {
      snapshot = await options.getCached(input);
      preview = projectRepositoryPreview(input, snapshot);
    } catch {
      return fallback();
    }
    if (!snapshot || preview.nodes.length === 0) return fallback();
    const key = `${preview.fullName.toLowerCase()}|${style}|${preview.headSha ?? snapshot.collectedAt}`;
    const hit = lru.get(key);
    if (hit) {
      lru.delete(key);
      lru.set(key, hit);
      return hit;
    }
    if (!admitRender()) return fallback();
    const card: CardWorld = {
      fullName: preview.fullName,
      nodes: preview.nodes as unknown as WorldNode[],
      edges: preview.edges as unknown as WorldEdge[],
      totalNodes: preview.totalNodes,
      totalEdges: preview.totalEdges,
      stars: Number.isFinite(snapshot.repo.stars) ? snapshot.repo.stars : null,
      language: typeof snapshot.repo.language === "string" ? snapshot.repo.language : null,
      description: typeof snapshot.repo.description === "string" ? snapshot.repo.description : null,
    };
    let body: Uint8Array;
    try {
      body = render.world(card, style, { site, deadline: clock() + renderMs });
    } catch {
      return fallback();
    }
    const image: OgImage = { body, etag: etagOf(body), cacheControl: OG_CACHE_WORLD, kind: "world" };
    remember(key, image);
    return image;
  };
  return { home, world, cacheSize: () => lru.size };
}

/** Display-only site line, e.g. "chaorders.com/github-factory". */
export function siteLabel(origin: string | null, basePath: string) {
  const valid = normalizeOrigin(origin);
  return valid ? `${new URL(valid).host}${basePath.replace(/\/$/, "")}` : null;
}

export function imageResponse(request: Request, image: OgImage) {
  const headers = {
    "content-type": "image/png",
    "cache-control": image.cacheControl,
    etag: image.etag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'",
    "x-og-image": image.kind,
  };
  const match = request.headers.get("if-none-match");
  if (match && match.split(",").some((tag) => tag.trim().replace(/^W\//, "") === image.etag)) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : (image.body as Uint8Array<ArrayBuffer>), { status: 200, headers: { ...headers, "content-length": String(image.body.length) } });
}
