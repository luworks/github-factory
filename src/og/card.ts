import type { StyleId, WorldEdge, WorldNode } from "../contracts";
import { illustration, STYLES } from "../client/demo";
import { layoutWorld, mapBounds } from "../world/layout";
import { PALETTES, paintBuilding, paintConnections, paintTerrain } from "../world/paint";
import type { Pen } from "../world/primitives";
import { drawableText, asciiShare, strokeFont } from "./font";
import { STYLE_TITLES } from "./meta";
import { encodePng } from "./png";
import { SoftCanvas } from "./raster";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** Districts drawn per card; the rest are summarised by the stats line. */
export const OG_MAX_NODES = 30;
export const OG_MAX_EDGES = 96;
export const TAGLINE = "Every codebase. A world of its own.";

export interface CardWorld {
  fullName: string;
  nodes: WorldNode[];
  edges: WorldEdge[];
  totalNodes: number;
  totalEdges: number;
  stars: number | null;
  language: string | null;
  description: string | null;
}
export interface CardOptions {
  /** Absolute monotonic deadline (performance.now()). */
  deadline?: number;
  /** Display-only host/path line, e.g. "chaorders.com/github-factory". */
  site?: string | null;
}

const BRAND_INK = "#f5f3ea";
const pen = (c: SoftCanvas) => c as unknown as Pen;
function canvas(width: number, height: number, deadline: number) {
  const c = new SoftCanvas(width, height, deadline);
  c.text = strokeFont;
  return c;
}

/** Draws a world into the target rectangle using the live canvas's shared art. */
function paintWorld(target: SoftCanvas, world: Pick<CardWorld, "fullName" | "nodes" | "edges">, style: StyleId, view: { x: number; y: number; w: number; h: number; zoom: number }, deadline: number) {
  const nodes = world.nodes.slice(0, OG_MAX_NODES);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = world.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).slice(0, OG_MAX_EDGES);
  const placed = layoutWorld(nodes, style);
  const b = mapBounds(placed);
  // Red Alert keeps its deliberately coarse raster, like the live world.
  const res = style === "red-alert" ? 0.62 : 1;
  const scene = res === 1 ? target : canvas(Math.ceil(target.width * res), Math.ceil(target.height * res), deadline);
  // Fit the district bounds into the requested focus rectangle; terrain fills the rest.
  const k = Math.min(1.6, Math.min(view.w / b.width, view.h / b.height) * view.zoom);
  const ox = view.x + view.w / 2 - (b.x + b.width / 2) * k, oy = view.y + view.h / 2 - (b.y + b.height / 2) * k;
  const g = pen(scene);
  g.setTransform(res, 0, 0, res, 0, 0);
  g.fillStyle = PALETTES[style].ground;
  g.fillRect(0, 0, target.width, target.height);
  g.setTransform(res * k, 0, 0, res * k, res * ox, res * oy);
  paintTerrain(g, style, placed, world.fullName);
  paintConnections(g, placed, edges, style, 0, false);
  for (const pn of placed.toSorted((a, c) => a.y - c.y)) paintBuilding(g, pn, style, false, false, 1);
  g.resetTransform();
  if (scene !== target) target.blitNearest(scene);
}

function scrims(g: Pen, style: StyleId, strength = 1) {
  const left = g.createLinearGradient(0, 0, OG_WIDTH * 0.72, 0);
  left.addColorStop(0, `rgba(8,10,12,${0.94 * strength})`);
  left.addColorStop(0.45, `rgba(8,10,12,${0.78 * strength})`);
  left.addColorStop(1, "rgba(8,10,12,0)");
  g.fillStyle = left;
  g.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);
  const bottom = g.createLinearGradient(0, OG_HEIGHT * 0.55, 0, OG_HEIGHT);
  bottom.addColorStop(0, "rgba(8,10,12,0)");
  bottom.addColorStop(1, `rgba(8,10,12,${0.72 * strength})`);
  g.fillStyle = bottom;
  g.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);
  const vignette = g.createRadialGradient(OG_WIDTH * 0.62, OG_HEIGHT * 0.5, OG_HEIGHT * 0.3, OG_WIDTH * 0.62, OG_HEIGHT * 0.5, OG_WIDTH * 0.75);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, style === "civilization" ? "rgba(48,40,22,0.35)" : "rgba(4,8,12,0.5)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);
}

/** Original crescent mark plus wordmark. The crescent is one polygon, so it
 * reads correctly on light and dark ground alike. */
function crescent(g: Pen, cx: number, cy: number, r: number) {
  const ix = cx + r * 0.42, iy = cy - r * 0.34, ir = r * 0.84;
  const outer: number[][] = [], inner: number[][] = [];
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    // Ray from the outer centre leaves the inner disc at t; keep [t, r].
    const ox = cx - ix, oy = cy - iy, b = ox * dx + oy * dy, c = ox * ox + oy * oy - ir * ir;
    const t = -b + Math.sqrt(Math.max(0, b * b - c));
    if (t >= r) continue;
    outer.push([cx + dx * r, cy + dy * r]);
    inner.push([cx + dx * t, cy + dy * t]);
  }
  g.beginPath();
  [...outer, ...inner.reverse()].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
}
function brand(g: Pen, x: number, y: number, accent: string, size = 1) {
  g.save();
  g.fillStyle = accent;
  crescent(g, x + 15 * size, y, 15 * size);
  g.fillStyle = BRAND_INK;
  g.font = `700 ${Math.round(21 * size)}px spacing=1.6`;
  g.textBaseline = "middle";
  g.fillText("MOON FACTORY", x + 40 * size, y);
  g.restore();
}

function fitFont(g: Pen, text: string, weight: number, max: number, min: number, width: number) {
  for (let size = max; size > min; size -= 2) {
    g.font = `${weight} ${size}px`;
    if (g.measureText(text).width <= width) return size;
  }
  g.font = `${weight} ${min}px`;
  return min;
}
function ellipsize(g: Pen, text: string, width: number) {
  if (g.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + "…").width > width) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n)).replace(".0", "");

function chip(g: Pen, x: number, y: number, text: string, accent: string) {
  g.font = "600 21px";
  const w = g.measureText(text).width + 30;
  g.fillStyle = "rgba(10,12,14,0.72)";
  g.beginPath();
  g.roundRect(x, y, w, 42, 21);
  g.fill();
  g.strokeStyle = `${accent}99`;
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = BRAND_INK;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText(text, x + 15, y + 21);
  return w;
}

function footer(g: Pen, site: string | null | undefined, accent: string) {
  g.fillStyle = accent;
  g.fillRect(0, OG_HEIGHT - 6, OG_WIDTH, 6);
  if (!site) return;
  g.font = "500 19px spacing=0.6";
  g.textBaseline = "alphabetic";
  g.textAlign = "right";
  g.fillStyle = "rgba(245,243,234,0.82)";
  g.fillText(drawableText(site, 60), OG_WIDTH - 52, OG_HEIGHT - 34);
  g.textAlign = "left";
}

function finish(c: SoftCanvas) {
  return encodePng(c.width, c.height, c.toRgb([11, 13, 16, 1]));
}

export function renderWorldCard(world: CardWorld, style: StyleId, options: CardOptions = {}): Uint8Array {
  const deadline = options.deadline ?? performance.now() + 2500;
  const c = canvas(OG_WIDTH, OG_HEIGHT, deadline), g = pen(c);
  const p = PALETTES[style];
  paintWorld(c, world, style, { x: 520, y: 40, w: 660, h: 560, zoom: 1.08 }, deadline);
  scrims(g, style);
  brand(g, 64, 74, p.trim);
  // Eyebrow: perspective name in the style's accent.
  g.font = "700 20px spacing=2.4";
  g.fillStyle = p.trim;
  g.textBaseline = "alphabetic";
  g.fillText(`${STYLE_TITLES[style].toUpperCase()} WORLD`, 66, 214);
  const [owner, repo] = world.fullName.split("/");
  const safeOwner = drawableText(owner ?? "", 60), safeRepo = drawableText(repo ?? "", 100);
  g.font = "500 34px";
  g.fillStyle = "rgba(245,243,234,0.72)";
  g.fillText(ellipsize(g, `${safeOwner} /`, 640), 64, 268);
  const size = fitFont(g, safeRepo, 700, 92, 46, 660);
  g.fillStyle = BRAND_INK;
  g.fillText(ellipsize(g, safeRepo, 660), 62, 268 + size * 1.02);
  let y = 268 + size * 1.02 + 30;
  const description = world.description && asciiShare(world.description) > 0.85 ? drawableText(world.description, 160) : "";
  if (description) {
    g.font = "450 22px";
    g.fillStyle = "rgba(245,243,234,0.78)";
    g.fillText(ellipsize(g, description, 600), 64, y + 24);
    y += 44;
  }
  let x = 64;
  const chips = [
    world.stars !== null ? `★ ${compact(world.stars)}` : null,
    `${compact(world.totalNodes)} district${world.totalNodes === 1 ? "" : "s"}`,
    `${compact(world.totalEdges)} link${world.totalEdges === 1 ? "" : "s"}`,
    world.language ? drawableText(world.language, 18) : null,
  ].filter((v): v is string => Boolean(v));
  for (const text of chips) x += chip(g, x, Math.min(y + 18, OG_HEIGHT - 120), text, p.trim) + 12;
  footer(g, options.site, p.trim);
  g.font = "500 19px";
  g.fillStyle = "rgba(245,243,234,0.62)";
  g.fillText(TAGLINE, 64, OG_HEIGHT - 34);
  return finish(c);
}

/** Generic card: the illustrative world seen through all five perspectives. */
export function renderHomeCard(options: CardOptions = {}): Uint8Array {
  const deadline = options.deadline ?? performance.now() + 8000;
  const c = canvas(OG_WIDTH, OG_HEIGHT, deadline), g = pen(c);
  const demo = illustration();
  const world = { fullName: "moon-factory/illustration", nodes: demo.nodes, edges: demo.edges };
  const order: StyleId[] = ["moonshot", "factorio", "red-alert", "red-alert-2", "civilization"];
  // Five slanted bands on the right, each a different perspective of one world.
  const x0 = 470, band = (OG_WIDTH - x0) / order.length + 26, slant = 70;
  order.forEach((style, i) => {
    const slice = canvas(OG_WIDTH, OG_HEIGHT, deadline);
    paintWorld(slice, world, style, { x: 520, y: 20, w: 680, h: 610, zoom: 1.15 }, deadline);
    const left = x0 + i * (band - 26) - (i ? 0 : 400), right = left + band + (i ? 0 : 400);
    // Copy a parallelogram from the slice into the card.
    for (let y = 0; y < OG_HEIGHT; y++) {
      const shift = (1 - y / OG_HEIGHT) * slant;
      const a = Math.max(0, Math.floor(left + shift)), b = Math.min(OG_WIDTH, Math.floor(right + shift));
      c.data.set(slice.data.subarray((y * OG_WIDTH + a) * 4, (y * OG_WIDTH + b) * 4), (y * OG_WIDTH + a) * 4);
    }
    if (i) {
      g.strokeStyle = "rgba(11,13,16,0.9)";
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(left + slant, 0);
      g.lineTo(left, OG_HEIGHT);
      g.stroke();
    }
  });
  const left = g.createLinearGradient(0, 0, 900, 0);
  left.addColorStop(0, "rgba(9,11,14,0.97)");
  left.addColorStop(0.5, "rgba(9,11,14,0.88)");
  left.addColorStop(1, "rgba(9,11,14,0)");
  g.fillStyle = left;
  g.fillRect(0, 0, OG_WIDTH, OG_HEIGHT);
  brand(g, 64, 78, "#efb17c");
  g.fillStyle = BRAND_INK;
  g.font = "700 76px";
  g.textBaseline = "alphabetic";
  g.fillText("Every codebase.", 60, 268);
  g.fillStyle = "#efb17c";
  g.fillText("A world of its own.", 60, 360);
  g.font = "450 25px";
  g.fillStyle = "rgba(245,243,234,0.8)";
  g.fillText("Turn any public GitHub repository into", 64, 432);
  g.fillText("a living world. Five perspectives, one source.", 64, 468);
  let x = 64;
  for (const s of order) {
    const info = STYLES.find((v) => v.id === s)!;
    g.fillStyle = PALETTES[s].trim;
    g.beginPath();
    g.arc(x + 7, 531, 7, 0, Math.PI * 2);
    g.fill();
    x += 26;
  }
  g.font = "600 19px spacing=1.2";
  g.fillStyle = "rgba(245,243,234,0.7)";
  g.textBaseline = "middle";
  g.fillText("5 ORIGINAL ART STYLES", x + 8, 531);
  footer(g, options.site, "#efb17c");
  return finish(c);
}
