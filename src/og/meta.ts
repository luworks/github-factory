import { STYLE_IDS, type StyleId } from "../contracts";
import { appPath } from "../base-path";

/** Client-safe social metadata. Every value is derived from validated route
 * params and fixed copy; no repository-supplied text reaches a meta tag. */
export const SITE_NAME = "Moon Factory";
export const HOME_TITLE = "Moon Factory — Your codebase, a living world";
export const HOME_DESCRIPTION = "Every codebase. A world of its own. Turn a public GitHub repository into a living, explorable world. Five perspectives. One source of truth.";
export const THEME_COLOR = "#0b0d10";
export const OG_IMAGE_ALT = "A procedurally drawn Moon Factory world diorama.";

/** Social copy names for each perspective. */
export const STYLE_TITLES: Record<StyleId, string> = {
  moonshot: "Moonshot",
  factorio: "Factorio",
  "red-alert": "Red Alert",
  "red-alert-2": "Red Alert 2",
  civilization: "Civilization",
};
export const isStyleId = (value: unknown): value is StyleId => typeof value === "string" && (STYLE_IDS as readonly string[]).includes(value);

/** Same owner/repository rules as server/github.ts parseRepo (verified by tests). */
export function validRepoParams(owner: unknown, repo: unknown): { owner: string; repo: string } | null {
  if (typeof owner !== "string" || typeof repo !== "string") return null;
  const name = repo.replace(/\.git$/, "");
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(name) || name === "." || name === "..") return null;
  return { owner, repo: name };
}

/** Accepts only a bare http(s) origin; anything else is rejected. */
export function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== value.replace(/\/$/, "") || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}
export const absoluteUrl = (origin: string, path: string) => `${origin}${appPath(path)}`;

type Meta = { name?: string; property?: string; content: string } | { title: string };
function social(origin: string, title: string, description: string, path: string, image: string, alt: string): Meta[] {
  const url = absoluteUrl(origin, path), imageUrl = absoluteUrl(origin, image);
  return [
    { title },
    { name: "description", content: description },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "en_US" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:image", content: imageUrl },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: imageUrl },
    { name: "twitter:image:alt", content: alt },
    { name: "theme-color", content: THEME_COLOR },
  ];
}

export const HOME_IMAGE_PATH = "og/home.png";
export const homeMeta = (origin: string) => social(origin, HOME_TITLE, HOME_DESCRIPTION, "", HOME_IMAGE_PATH, OG_IMAGE_ALT);

export function worldImagePath(owner: string, repo: string, style: StyleId) {
  return `og/world/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?style=${style}`;
}
/** Invalid params fall back to the generic homepage card, never echoed text. */
export function worldMeta(origin: string, owner: unknown, repo: unknown, styleParam: unknown) {
  const valid = validRepoParams(owner, repo);
  if (!valid) return homeMeta(origin);
  const style: StyleId = isStyleId(styleParam) ? styleParam : "moonshot";
  const full = `${valid.owner}/${valid.repo}`, perspective = STYLE_TITLES[style];
  const title = `${full} as a ${perspective} world · ${SITE_NAME}`;
  const description = `Explore the public GitHub repository ${full} as a living ${perspective} world: districts, connections and recent activity, every one linked back to source.`;
  const page = `world/${encodeURIComponent(valid.owner)}/${encodeURIComponent(valid.repo)}${isStyleId(styleParam) ? `?style=${style}` : ""}`;
  return social(origin, title, description, page, worldImagePath(valid.owner, valid.repo, style), `${full} drawn as a procedural ${perspective} world.`);
}
