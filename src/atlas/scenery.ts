import type { StyleId } from "../contracts";
import { SCENE } from "./camera";
import { hash, type Landmark } from "./model";

/** Original procedural Atlas scenery. Everything here is illustration: no
 * repository facts, dependency graph or live data is encoded in a pixel. Layers
 * are rendered once into small offscreen canvases so an ambient frame is a few
 * image blits plus vector strokes. */

export interface PlanetLook {
  base: string; light: string; dark: string; feature: string; accent: string; glow: string; ring: string | null;
}
/** Planet looks hint at each landmark's suggested art style (palettes after the hero diorama). */
export const PLANETS: Record<StyleId, PlanetLook> = {
  moonshot: { base: "#9a9ca1", light: "#eef2ef", dark: "#24262c", feature: "#6f7178", accent: "#7fe7dc", glow: "#8ff3ea", ring: null },
  factorio: { base: "#9a8452", light: "#e4c98c", dark: "#2a2216", feature: "#6b5a36", accent: "#f2b13b", glow: "#ffcf6e", ring: "#c9a95e" },
  "red-alert": { base: "#5e7c3e", light: "#b6cf86", dark: "#17231a", feature: "#2f5e6e", accent: "#ff5a43", glow: "#ffd27a", ring: null },
  "red-alert-2": { base: "#1d6d92", light: "#c3e6f0", dark: "#06132a", feature: "#6ea86a", accent: "#39d0ff", glow: "#6fe3ff", ring: "#39d0ff" },
  civilization: { base: "#3c83b2", light: "#f4f0d8", dark: "#0d1730", feature: "#8fae5a", accent: "#e0b04a", glow: "#ffe1a0", ring: null },
};
export const planetLook = (style: string): PlanetLook => PLANETS[style as StyleId] ?? PLANETS.moonshot;

/** Nebula tints for editorial regions (category names only; not a data claim). */
const NEBULA = ["#6a4be0", "#1fa3a8", "#c2448a", "#3667e0", "#d0803a", "#3aa866", "#9a4fd6", "#2b8fd6"];
export const regionColor = (category: string) => NEBULA[hash(category.toLowerCase()) % NEBULA.length];

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const canvas = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
export { rgba };

export interface Route { ax: number; ay: number; cx: number; cy: number; bx: number; by: number; length: number; seed: number }
export interface Region { name: string; color: string; x: number; y: number; count: number }
export interface Twinkle { x: number; y: number; size: number; speed: number; phase: number; warm: boolean }

export const STAR_TILE = 512;

/** Greedy nearest-neighbour scenic chain. Purely decorative: it never reads
 * dependencies, stars or response order beyond the stable layout positions. */
export function scenicRoutes(points: readonly Landmark[]): Route[] {
  const pool = points.slice(0, 120), routes: Route[] = [];
  if (pool.length < 2) return routes;
  const left = new Set(pool.map((_, i) => i));
  let at = pool.reduce((best, p, i) => (p.x + p.y < pool[best].x + pool[best].y ? i : best), 0);
  left.delete(at);
  while (left.size) {
    let next = -1, distance = Infinity;
    for (const i of left) { const d = Math.hypot(pool[i].x - pool[at].x, pool[i].y - pool[at].y); if (d < distance) { distance = d; next = i; } }
    left.delete(next);
    const a = pool[at], b = pool[next];
    if (distance < 1900) {
      const seed = hash(a.repoKey + ">" + b.repoKey), bend = ((seed % 1000) / 1000 - .5) * .5, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const cx = mx - (b.y - a.y) * bend, cy = my + (b.x - a.x) * bend;
      routes.push({ ax: a.x, ay: a.y, cx, cy, bx: b.x, by: b.y, length: distance * (1 + Math.abs(bend) * .6), seed });
    }
    at = next;
  }
  return routes;
}
export const routePoint = (r: Route, u: number) => { const v = 1 - u; return { x: v * v * r.ax + 2 * v * u * r.cx + u * u * r.bx, y: v * v * r.ay + 2 * v * u * r.cy + u * u * r.by }; };

/** Editorial regions with a compact footprint get a faint name in the sky. */
export function editorialRegions(points: readonly Landmark[]): Region[] {
  const groups = new Map<string, Landmark[]>();
  for (const p of points.slice(0, 2000)) { const list = groups.get(p.category) ?? []; list.push(p); groups.set(p.category, list); }
  const regions: Region[] = [];
  for (const [name, list] of groups) {
    const x = list.reduce((n, p) => n + p.x, 0) / list.length, y = list.reduce((n, p) => n + p.y, 0) / list.length;
    if (list.length > 40 || list.some(p => Math.hypot(p.x - x, p.y - y) > 1500)) continue;
    regions.push({ name, color: regionColor(name), x, y: Math.min(...list.map(p => p.y)), count: list.length });
  }
  return regions;
}

export interface Scenery {
  stars(ratio: number): { far: CanvasPattern | null; near: CanvasPattern | null; twinkles: Twinkle[] };
  nebula(points: readonly Landmark[]): HTMLCanvasElement;
  routes(points: readonly Landmark[]): Route[];
  regions(points: readonly Landmark[]): Region[];
  planet(style: string, variant: number, px: number): HTMLCanvasElement;
  glow(color: string): HTMLCanvasElement;
  dispose(): void;
}

export function createScenery(g: CanvasRenderingContext2D): Scenery {
  let starRatio = 0, starLayers: ReturnType<Scenery["stars"]> | null = null;
  let nebulaFor: readonly Landmark[] | null = null, nebulaCanvas: HTMLCanvasElement | null = null;
  let routesFor: readonly Landmark[] | null = null, routeList: Route[] = [];
  let regionsFor: readonly Landmark[] | null = null, regionList: Region[] = [];
  const sprites = new Map<string, HTMLCanvasElement>(), glows = new Map<string, HTMLCanvasElement>();
  return {
    stars(ratio) {
      if (starLayers && starRatio === ratio) return starLayers;
      starRatio = ratio;
      const tile = (count: number, seed: number, bright: number) => {
        const c = canvas(STAR_TILE * ratio, STAR_TILE * ratio), x = c.getContext("2d"), r = rng(seed);
        if (!x) return null;
        for (let i = 0; i < count; i++) {
          const size = (.35 + r() ** 3 * bright) * ratio, a = .18 + r() * .62, tint = r();
          x.fillStyle = tint > .9 ? `rgba(255,214,170,${a})` : tint > .75 ? `rgba(170,205,255,${a})` : `rgba(235,240,255,${a})`;
          x.beginPath(); x.arc(r() * c.width, r() * c.height, size, 0, Math.PI * 2); x.fill();
        }
        return g.createPattern(c, "repeat");
      };
      const r = rng(77), twinkles: Twinkle[] = Array.from({ length: 22 }, () => ({ x: r() * 1024, y: r() * 1024, size: .8 + r() * 1.2, speed: .6 + r() * 1.6, phase: r() * Math.PI * 2, warm: r() > .7 }));
      starLayers = { far: tile(340, 11, 1.1), near: tile(70, 29, 1.9), twinkles };
      return starLayers;
    },
    nebula(points) {
      if (nebulaCanvas && nebulaFor === points) return nebulaCanvas;
      nebulaFor = points;
      const k = 1 / 8, c = nebulaCanvas ?? canvas(SCENE.right * k, SCENE.bottom * k), x = c.getContext("2d");
      nebulaCanvas = c;
      if (!x) return c;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = "lighter";
      const r = rng(4242);
      // Deep background dust lanes: decorative, independent of the catalog.
      for (let i = 0; i < 9; i++) {
        const cx = r() * c.width, cy = r() * c.height, rad = 120 + r() * 180, grad = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, rgba(i % 2 ? "#2a3a7a" : "#3b2a6a", .16)); grad.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = grad; x.beginPath(); x.ellipse(cx, cy, rad, rad * (.45 + r() * .4), r() * Math.PI, 0, Math.PI * 2); x.fill();
      }
      for (const p of points.slice(0, 600)) {
        const h = hash(p.repoKey), color = regionColor(p.category), px = p.x * k, py = p.y * k;
        for (let j = 0; j < 3; j++) {
          const ox = ((h >> (j * 5)) % 60 - 30) * (j + 1) * .9, oy = ((h >> (j * 7 + 3)) % 50 - 25) * (j + 1) * .7, rad = (64 + (h >> (j * 3)) % 48) * (1 - j * .15);
          const grad = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rad);
          grad.addColorStop(0, rgba(color, j ? .16 : .3)); grad.addColorStop(.55, rgba(color, j ? .07 : .12)); grad.addColorStop(1, rgba(color, 0));
          x.fillStyle = grad;
          x.beginPath(); x.ellipse(px + ox, py + oy, rad * 1.35, rad * .8, (h % 314) / 100, 0, Math.PI * 2); x.fill();
        }
      }
      x.globalCompositeOperation = "source-over";
      // Fine dust specks inside the clouds.
      for (const p of points.slice(0, 300)) {
        const local = rng(hash(p.repoKey + ":dust"));
        x.fillStyle = rgba("#e6ecff", .35);
        for (let i = 0; i < 14; i++) { const a = local() * Math.PI * 2, d = local() ** .6 * 70; x.fillRect(p.x * k + Math.cos(a) * d, p.y * k + Math.sin(a) * d * .7, .6, .6); }
      }
      return c;
    },
    routes(points) { if (routesFor !== points) { routesFor = points; routeList = scenicRoutes(points); } return routeList; },
    regions(points) { if (regionsFor !== points) { regionsFor = points; regionList = editorialRegions(points); } return regionList; },
    planet(style, variant, px) {
      const key = `${style}:${variant}:${px}`;
      let c = sprites.get(key);
      if (!c) {
        if (sprites.size > 96) sprites.clear();
        c = paintPlanet(style, variant, px);
        sprites.set(key, c);
      }
      return c;
    },
    glow(color) {
      let c = glows.get(color);
      if (!c) {
        c = canvas(64, 64);
        const x = c.getContext("2d");
        if (x) { const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, rgba(color, .9)); grad.addColorStop(.25, rgba(color, .35)); grad.addColorStop(1, rgba(color, 0)); x.fillStyle = grad; x.beginPath(); x.arc(32, 32, 32, 0, Math.PI * 2); x.fill(); }
        glows.set(color, c);
      }
      return c;
    },
    dispose() { sprites.clear(); glows.clear(); nebulaCanvas = null; starLayers = null; },
  };
}

/** A verified landmark: a small lit world with a settlement on its horizon.
 * The sprite is 2.2× the planet diameter so halo and ring fit. */
function paintPlanet(style: string, variant: number, px: number) {
  const look = planetLook(style), size = px * 2.2, c = canvas(size, size), x = c.getContext("2d");
  if (!x) return c;
  const r = px / 2, cx = size / 2, cy = size / 2, rand = rng(hash(style) + variant * 977);
  // Atmosphere halo.
  const halo = x.createRadialGradient(cx, cy, r * .8, cx, cy, r * 1.75);
  halo.addColorStop(0, rgba(look.glow, .42)); halo.addColorStop(.35, rgba(look.glow, .12)); halo.addColorStop(1, rgba(look.glow, 0));
  x.fillStyle = halo; x.beginPath(); x.arc(cx, cy, r * 1.75, 0, Math.PI * 2); x.fill();
  const tilt = -.38 + variant * .05;
  const ring = (front: boolean) => {
    if (!look.ring) return;
    x.save(); x.translate(cx, cy); x.rotate(tilt);
    x.beginPath(); x.ellipse(0, 0, r * 1.62, r * .42, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    x.strokeStyle = rgba(look.ring, front ? .85 : .45); x.lineWidth = Math.max(1, r * .14); x.stroke();
    x.beginPath(); x.ellipse(0, 0, r * 1.38, r * .34, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    x.strokeStyle = rgba(look.ring, front ? .5 : .25); x.lineWidth = Math.max(.6, r * .05); x.stroke();
    x.restore();
  };
  ring(false);
  // Sphere body.
  x.save();
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
  x.fillStyle = look.base; x.fillRect(cx - r, cy - r, px, px);
  if (style === "factorio") {
    for (let i = 0; i < 7; i++) { x.fillStyle = rgba(i % 2 ? look.feature : look.light, .18 + rand() * .2); x.fillRect(cx - r, cy - r + (i / 7) * px + rand() * 3, px, px / 9 + rand() * px / 14); }
    x.fillStyle = rgba(look.accent, .55); x.beginPath(); x.ellipse(cx + r * .25, cy + r * .2, r * .22, r * .11, 0, 0, Math.PI * 2); x.fill();
  } else if (style === "moonshot") {
    for (let i = 0; i < 9; i++) { const a = rand() * Math.PI * 2, d = rand() * r * .8, s = r * (.08 + rand() * .2), ex = cx + Math.cos(a) * d, ey = cy + Math.sin(a) * d; x.fillStyle = rgba(look.feature, .75); x.beginPath(); x.arc(ex, ey, s, 0, Math.PI * 2); x.fill(); x.strokeStyle = rgba(look.light, .35); x.lineWidth = Math.max(.6, s * .25); x.beginPath(); x.arc(ex - s * .15, ey - s * .15, s, Math.PI * .9, Math.PI * 1.8); x.stroke(); }
  } else {
    // Continents (red-alert: seas on olive land; RA2/civ: land on ocean).
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2, d = rand() * r * .75, ex = cx + Math.cos(a) * d, ey = cy + Math.sin(a) * d;
      x.fillStyle = rgba(look.feature, .92); x.beginPath();
      for (let k = 0; k < 7; k++) { const t = (k / 7) * Math.PI * 2, rr = r * (.14 + rand() * .2); k ? x.lineTo(ex + Math.cos(t) * rr * 1.3, ey + Math.sin(t) * rr) : x.moveTo(ex + Math.cos(t) * rr * 1.3, ey + Math.sin(t) * rr); }
      x.closePath(); x.fill();
    }
    if (style === "civilization") {
      x.fillStyle = rgba("#cdb65e", .75);
      for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(cx + (rand() - .5) * r * 1.2, cy + (rand() - .5) * r * 1.2, r * (.06 + rand() * .1), 0, Math.PI * 2); x.fill(); }
      x.strokeStyle = rgba("#ffffff", .5); x.lineWidth = Math.max(.6, r * .07);
      for (let i = 0; i < 3; i++) { x.beginPath(); const yy = cy - r * .6 + i * r * .55 + rand() * r * .2; x.moveTo(cx - r, yy); x.bezierCurveTo(cx - r * .3, yy - r * .2, cx + r * .2, yy + r * .2, cx + r, yy - r * .05); x.stroke(); }
    }
  }
  // Day/night terminator and rim light.
  const shade = x.createRadialGradient(cx - r * .45, cy - r * .5, r * .1, cx - r * .1, cy - r * .1, r * 1.45);
  shade.addColorStop(0, rgba("#ffffff", .32)); shade.addColorStop(.45, "rgba(0,0,0,0)"); shade.addColorStop(.8, rgba(look.dark, .55)); shade.addColorStop(1, rgba(look.dark, .92));
  x.fillStyle = shade; x.fillRect(cx - r, cy - r, px, px);
  // Settlement lights on the night side.
  x.fillStyle = look.accent;
  for (let i = 0; i < 8; i++) { const a = Math.PI * (.05 + rand() * .55), d = r * (.45 + rand() * .45); x.globalAlpha = .55 + rand() * .45; x.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(1, r * .06), Math.max(1, r * .06)); }
  x.globalAlpha = 1;
  x.restore();
  x.strokeStyle = rgba(look.glow, .75); x.lineWidth = Math.max(1, r * .06);
  x.beginPath(); x.arc(cx, cy, r - x.lineWidth / 2, Math.PI * 1.02, Math.PI * 1.72); x.stroke();
  settlement(x, style, cx, cy, r, look);
  ring(true);
  return c;
}

/** Tiny original silhouettes on the top horizon hint at the world's perspective. */
function settlement(x: CanvasRenderingContext2D, style: string, cx: number, cy: number, r: number, look: PlanetLook) {
  if (r < 14) return;
  x.save();
  x.translate(cx, cy); x.rotate(-.42); x.translate(0, -r + r * .04);
  const u = r / 16;
  x.fillStyle = look.light; x.strokeStyle = look.light; x.lineWidth = Math.max(1, u * .7);
  const rect = (px: number, w: number, h: number) => x.fillRect(px * u, -h * u, w * u, h * u + u);
  if (style === "moonshot") {
    x.beginPath(); x.arc(-3 * u, 0, 3.4 * u, Math.PI, 0); x.fill();
    x.beginPath(); x.arc(3.5 * u, 0, 2.2 * u, Math.PI, 0); x.fill();
    rect(6.5, 1.2, 7); x.fillStyle = look.accent; x.fillRect(6.4 * u, -8 * u, 1.4 * u, 1.4 * u);
  } else if (style === "factorio") {
    rect(-6, 6, 3.5); rect(-4.5, 1.4, 7.5); rect(-1.6, 1.4, 6); rect(1.5, 4.5, 2.5);
    x.fillStyle = rgba("#d8cfbf", .55); x.beginPath(); x.arc(-3.8 * u, -9.5 * u, 1.8 * u, 0, Math.PI * 2); x.arc(-2.5 * u, -11.5 * u, 1.3 * u, 0, Math.PI * 2); x.fill();
  } else if (style === "red-alert") {
    rect(-5, 5, 3); rect(1, 1, 6);
    x.beginPath(); x.ellipse(1.5 * u, -7 * u, 3 * u, 1.4 * u, -.4, 0, Math.PI * 2); x.stroke();
    x.fillStyle = look.accent; x.fillRect(-1 * u, -4.5 * u, 1.3 * u, 1.3 * u);
  } else if (style === "red-alert-2") {
    rect(-5.5, 3.6, 4); rect(-.5, 1.2, 8.5);
    x.beginPath(); x.arc(.1 * u, -9.6 * u, 1.8 * u, 0, Math.PI * 2); x.fill();
    x.fillStyle = look.accent; x.beginPath(); x.arc(.1 * u, -9.6 * u, .9 * u, 0, Math.PI * 2); x.fill();
    rect(3, 3, 3);
  } else {
    x.beginPath(); x.moveTo(-6 * u, 0); x.lineTo(-6 * u, -3 * u); x.lineTo(-4 * u, -5 * u); x.lineTo(-2 * u, -3 * u); x.lineTo(-2 * u, 0); x.fill();
    x.beginPath(); x.moveTo(0, u); x.lineTo(0, -5 * u); x.lineTo(2.5 * u, -8 * u); x.lineTo(5 * u, -5 * u); x.lineTo(5 * u, u); x.fill();
    x.fillStyle = look.accent; x.fillRect(1.9 * u, -4 * u, 1.2 * u, 1.6 * u);
  }
  x.restore();
}
