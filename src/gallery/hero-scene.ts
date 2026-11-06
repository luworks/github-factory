import type { StyleId } from "../contracts";

/** Original procedural hero diorama for the landing page. Everything here is
 * illustration: no repository facts are drawn, and the motion is decorative. */

type Grid = "diamond" | "hex";
type Particle = "dust" | "smoke" | "ember" | "spark" | "leaf";
type TileKind = "ground" | "alt" | "road" | "crater" | "forest" | "field" | "mountain" | "plate";
export type BuildingKind =
  | "block" | "tower" | "dome" | "tank" | "factory" | "radar" | "tesla" | "house" | "temple" | "solar" | "crane" | "rocket" | "pylon";

export interface HeroTheme {
  id: StyleId;
  name: string;
  grid: Grid;
  /** Render scale for the deliberately coarse 90s-RTS raster (1 = full resolution). */
  pixel: number;
  sky: { day: [string, string]; night: [string, string]; dusk: [string, string] };
  ocean: string | null;
  tile: Record<TileKind, string>;
  side: [string, string];
  wall: [string, string];
  roof: string;
  accent: string;
  window: string;
  glow: string;
  particle: Particle;
  stars: number;
  clouds: boolean;
  kit: BuildingKind[];
  hub: BuildingKind[];
}

export const HERO_THEMES: Record<StyleId, HeroTheme> = {
  moonshot: {
    id: "moonshot", name: "Moon Factory", grid: "diamond", pixel: 1,
    sky: { day: ["#0c1424", "#2b3953"], night: ["#03050b", "#0f1828"], dusk: ["#120f22", "#3a3150"] },
    ocean: null,
    tile: { ground: "#8e9096", alt: "#9a9ca1", road: "#6c6f76", crater: "#7b7d83", forest: "#8e9096", field: "#a3a5aa", mountain: "#b3b5ba", plate: "#5d6a72" },
    side: ["#585a61", "#3a3c42"], wall: ["#c9d3d6", "#93a0a6"], roof: "#eef2ef",
    accent: "#7fe7dc", window: "#ffd49a", glow: "#8ff3ea", particle: "dust", stars: 140, clouds: false,
    kit: ["dome", "dome", "solar", "tower", "block", "tank", "solar"], hub: ["rocket", "dome", "crane"],
  },
  factorio: {
    id: "factorio", name: "Factorio", grid: "diamond", pixel: 1,
    sky: { day: ["#8a7650", "#d8bd83"], night: ["#15130f", "#3b3123"], dusk: ["#5c3d2a", "#d68a4c"] },
    ocean: null,
    tile: { ground: "#7a6943", alt: "#85744c", road: "#35342f", crater: "#6e5e3b", forest: "#5f6a3a", field: "#8f7c4f", mountain: "#94866a", plate: "#5c5848" },
    side: ["#5b4b2f", "#3b311f"], wall: ["#8f9284", "#666a5f"], roof: "#b9b59c",
    accent: "#f2b13b", window: "#ffc35a", glow: "#ffcf6e", particle: "smoke", stars: 40, clouds: false,
    kit: ["factory", "factory", "tank", "block", "tower", "factory", "tank"], hub: ["factory", "crane", "tank"],
  },
  "red-alert": {
    id: "red-alert", name: "Red Alert", grid: "diamond", pixel: 0.5,
    sky: { day: ["#5f8796", "#bccaa6"], night: ["#0d1815", "#25362b"], dusk: ["#3f3a3a", "#c98a5a"] },
    ocean: "#2f5e6e",
    tile: { ground: "#5e7c3e", alt: "#678746", road: "#8b8571", crater: "#55703a", forest: "#456533", field: "#768f4a", mountain: "#8a8466", plate: "#76776a" },
    side: ["#6b5a3a", "#4a3e28"], wall: ["#a7a98e", "#7b7d68"], roof: "#c9c7aa",
    accent: "#d8432f", window: "#ffe08a", glow: "#ffd27a", particle: "ember", stars: 50, clouds: false,
    kit: ["block", "radar", "block", "pylon", "tank", "block", "tower"], hub: ["radar", "block", "crane"],
  },
  "red-alert-2": {
    id: "red-alert-2", name: "Red Alert 2", grid: "diamond", pixel: 1,
    sky: { day: ["#3f87bd", "#c3e6f0"], night: ["#06132a", "#163a5a"], dusk: ["#3b3a6a", "#f0a37a"] },
    ocean: "#1d6d92",
    tile: { ground: "#6ea86a", alt: "#79b273", road: "#5b6b76", crater: "#649b60", forest: "#4f8a52", field: "#8fbf7a", mountain: "#a7b39a", plate: "#6f8590" },
    side: ["#b9a575", "#8c7a52"], wall: ["#b8cfd3", "#86a1a8"], roof: "#eaf3ef",
    accent: "#39d0ff", window: "#c4f6ff", glow: "#6fe3ff", particle: "spark", stars: 90, clouds: true,
    kit: ["tesla", "block", "dome", "tower", "block", "pylon", "dome"], hub: ["tesla", "tower", "crane"],
  },
  civilization: {
    id: "civilization", name: "Civilization", grid: "hex", pixel: 1,
    sky: { day: ["#86c2e6", "#eef3df"], night: ["#0d1730", "#2b3a5e"], dusk: ["#6a5a8a", "#f2b77a"] },
    ocean: "#3c83b2",
    tile: { ground: "#8fae5a", alt: "#9bb966", road: "#c4ad74", crater: "#88a656", forest: "#5d8842", field: "#cdb65e", mountain: "#8f897a", plate: "#a99a73" },
    side: ["#8c6f4a", "#6a5236"], wall: ["#d9c094", "#b39a6e"], roof: "#a8553a",
    accent: "#e0b04a", window: "#ffd27a", glow: "#ffe1a0", particle: "leaf", stars: 110, clouds: true,
    kit: ["house", "house", "house", "tower", "house", "block"], hub: ["temple", "house", "crane"],
  },
};

export interface HeroTile { x: number; y: number; kind: TileKind; seed: number }
export interface HeroWindow { face: 0 | 1; u: number; v: number }
export interface HeroBuilding {
  x: number; y: number; kind: BuildingKind; w: number; d: number; h: number;
  /** Seconds after the intro starts when construction begins. */
  delay: number; seed: number; windows: HeroWindow[]; label: string | null;
}
export interface HeroRoute { points: [number, number][]; length: number }
export interface HeroScene {
  theme: HeroTheme;
  tiles: HeroTile[];
  buildings: HeroBuilding[];
  routes: HeroRoute[];
  bounds: { x: number; y: number; width: number; height: number };
  tileSize: number;
  depth: number;
}

/** Small deterministic PRNG so the server render, every reload and tests agree. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashString = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

const LABELS = ["Web app", "API gateway", "Agent engine", "Data vault"];
const RADIUS = 6;

export function buildHeroScene(style: StyleId): HeroScene {
  const theme = HERO_THEMES[style];
  const random = seeded(hashString(`hero:${style}`));
  const T = theme.grid === "hex" ? 30 : 34;
  const depth = theme.grid === "hex" ? 16 : 22;
  const tiles: HeroTile[] = [];
  const project = (i: number, j: number): [number, number] => theme.grid === "hex"
    ? [T * Math.sqrt(3) * (i + j / 2), T * 1.5 * j * 0.58]
    : [(i - j) * T, (i + j) * T / 2];
  const road = (i: number, j: number) => theme.grid === "hex" ? (j === 0 || i === 0) && Math.abs(i) + Math.abs(j) <= RADIUS - 1 : (i === 0 || j === 0) && Math.abs(i + j) <= RADIUS * 2;
  const occupied = new Set<string>();
  for (let j = -RADIUS; j <= RADIUS; j++) for (let i = -RADIUS; i <= RADIUS; i++) {
    const distance = theme.grid === "hex" ? (Math.abs(i) + Math.abs(j) + Math.abs(i + j)) / 2 : Math.hypot(i, j);
    const edgeNoise = random() * 1.1;
    if (distance > RADIUS - 0.6 + edgeNoise * 0.6) continue;
    const [x, y] = project(i, j);
    const r = random();
    let kind: TileKind = r < 0.5 ? "ground" : "alt";
    if (road(i, j)) kind = "road";
    else if (distance > 2.2) {
      if (style === "moonshot" && r > 0.82) kind = "crater";
      if (style === "civilization") kind = r > 0.78 ? "forest" : r > 0.62 ? "field" : r < 0.08 ? "mountain" : kind;
      if ((style === "red-alert" || style === "red-alert-2") && r > 0.86) kind = "forest";
      if (style === "factorio" && r > 0.85) kind = "plate";
    }
    tiles.push({ x, y, kind, seed: random() });
    if (kind === "road" || kind === "mountain" || kind === "forest") occupied.add(`${i},${j}`);
  }
  const has = new Set(tiles.map((t) => `${Math.round(t.x)},${Math.round(t.y)}`));
  // Buildings: a hub at the center ring, then a seeded skyline that thins toward the coast.
  const buildings: HeroBuilding[] = [];
  const spots: [number, number, number][] = [];
  for (let j = -RADIUS; j <= RADIUS; j++) for (let i = -RADIUS; i <= RADIUS; i++) {
    const [x, y] = project(i, j);
    if (!has.has(`${Math.round(x)},${Math.round(y)}`) || occupied.has(`${i},${j}`)) continue;
    const distance = Math.hypot(i, j);
    if (distance > RADIUS - 1.4) continue;
    spots.push([i, j, distance]);
  }
  spots.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  let hubIndex = 0;
  for (const [i, j, distance] of spots) {
    const chance = distance < 1.6 ? 1 : 0.78 - distance * 0.075;
    if (random() > chance) continue;
    const [x, y] = project(i, j);
    const kind = hubIndex < theme.hub.length ? theme.hub[hubIndex++] : theme.kit[Math.floor(random() * theme.kit.length)];
    const tall = Math.max(0.35, 1.25 - distance * 0.16);
    const w = T * (0.5 + random() * 0.16), d = (theme.grid === "hex" ? T * 0.42 : T / 2) * (0.55 + random() * 0.15);
    const h = kind === "tower" || kind === "tesla" || kind === "pylon" ? 70 + random() * 40 * tall
      : kind === "rocket" ? 92 : kind === "crane" ? 96 : kind === "solar" ? 10 : kind === "dome" ? 30 + random() * 16
      : kind === "temple" ? 64 : kind === "house" ? 20 + random() * 10 : 28 + random() * 58 * tall;
    const windows: HeroWindow[] = [];
    if (kind === "block" || kind === "tower" || kind === "factory" || kind === "house") {
      const rows = Math.max(1, Math.floor(h / 13)), cols = kind === "house" ? 1 : 2;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) for (const face of [0, 1] as const) {
        if (random() < 0.45) windows.push({ face, u: (col + 0.5) / cols, v: (row + 0.55) / (rows + 0.4) });
      }
    }
    buildings.push({ x, y, kind, w, d, h, delay: 0.25 + distance * 0.16 + random() * 0.18, seed: random(), windows, label: null });
    occupied.add(`${i},${j}`);
  }
  buildings.sort((a, b) => a.y - b.y || a.x - b.x);
  // Name the four most prominent structures (illustrative districts, not repository facts).
  [...buildings].filter((b) => b.kind !== "crane" && b.kind !== "solar").sort((a, b) => b.h - a.h || a.x - b.x).slice(0, 4)
    .forEach((b, index) => { b.label = LABELS[index]; });
  const routes: HeroRoute[] = [];
  const line = (points: [number, number][]) => {
    let length = 0;
    for (let k = 1; k < points.length; k++) length += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    if (points.length > 1) routes.push({ points, length });
  };
  const span = (fixed: "i" | "j") => {
    const points: [number, number][] = [];
    for (let k = -RADIUS; k <= RADIUS; k++) {
      const [x, y] = fixed === "i" ? project(0, k) : project(k, 0);
      if (has.has(`${Math.round(x)},${Math.round(y)}`)) points.push([x, y]);
    }
    line(points);
  };
  span("i"); span("j");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) { minX = Math.min(minX, t.x - T); maxX = Math.max(maxX, t.x + T); minY = Math.min(minY, t.y - T); maxY = Math.max(maxY, t.y + T + depth); }
  for (const b of buildings) minY = Math.min(minY, b.y - b.h - 30);
  return { theme, tiles: tiles.sort((a, b) => a.y - b.y || a.x - b.x), buildings, routes, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, tileSize: T, depth };
}

/** Day/night clock. One full cycle every `period` seconds; returns 0 (night) … 1 (noon). */
export const DAY_PERIOD = 28;
export function heroDaylight(time: number, period = DAY_PERIOD) {
  const phase = (((time / period) % 1) + 1) % 1;
  const sun = Math.sin(phase * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
  const daylight = Math.min(1, Math.max(0, (sun - 0.18) / 0.64));
  const dusk = Math.max(0, 1 - Math.abs(sun - 0.36) / 0.22);
  return { phase, sun, daylight, dusk };
}
/** The reduced-motion still frame: golden hour, every building finished, lights on. */
export const STILL_TIME = DAY_PERIOD * 0.79;

/** Construction easing with a small settle overshoot, clamped to [0, 1.06]. */
export function riseProgress(elapsed: number, delay: number, duration = 0.75) {
  const t = Math.min(1, Math.max(0, (elapsed - delay) / duration));
  if (t <= 0) return 0;
  const c = 1.9;
  return Math.min(1.06, 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2);
}
export function introLength(scene: HeroScene) {
  return Math.max(0, ...scene.buildings.map((b) => b.delay)) + 0.9;
}

// ---- Color helpers (cached parse; per-frame calls only build short strings). ----
const parsed = new Map<string, [number, number, number]>();
function rgb(hex: string): [number, number, number] {
  let value = parsed.get(hex);
  if (!value) { const n = Number.parseInt(hex.slice(1), 16); value = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; parsed.set(hex, value); }
  return value;
}
function blend(a: string, b: string, t: number) {
  const x = rgb(a), y = rgb(b), k = Math.min(1, Math.max(0, t));
  return [0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * k));
}
export function mixHex(a: string, b: string, t: number) {
  return `#${blend(a, b, t).map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
export function mix(a: string, b: string, t: number, alpha = 1) {
  const [r, g, bl] = blend(a, b, t);
  return `rgba(${r},${g},${bl},${alpha})`;
}
const shade = (hex: string, k: number) => mix(hex, k < 0 ? "#000000" : "#ffffff", Math.abs(k));

// ---- Primitive geometry ----
type G = CanvasRenderingContext2D;
function poly(g: G, points: number[], fill: string) {
  g.beginPath(); g.moveTo(points[0], points[1]);
  for (let k = 2; k < points.length; k += 2) g.lineTo(points[k], points[k + 1]);
  g.closePath(); g.fillStyle = fill; g.fill();
}
function box(g: G, x: number, y: number, w: number, d: number, h: number, top: string, left: string, right: string) {
  poly(g, [x - w, y, x, y + d, x, y + d - h, x - w, y - h], left);
  poly(g, [x, y + d, x + w, y, x + w, y - h, x, y + d - h], right);
  poly(g, [x, y - d - h, x + w, y - h, x, y + d - h, x - w, y - h], top);
}
function cylinder(g: G, x: number, y: number, r: number, h: number, wall: string, top: string) {
  const ry = r * 0.5;
  g.fillStyle = wall;
  g.beginPath(); g.ellipse(x, y, r, ry, 0, 0, Math.PI); g.lineTo(x - r, y - h); g.ellipse(x, y - h, r, ry, 0, Math.PI, 0, true); g.closePath(); g.fill();
  g.fillStyle = top; g.beginPath(); g.ellipse(x, y - h, r, ry, 0, 0, Math.PI * 2); g.fill();
}

// ---- Static island layer (cached by the component per style and size). ----
export function paintIsland(g: G, scene: HeroScene) {
  const { theme, tileSize: T, depth } = scene;
  const hex = theme.grid === "hex";
  const corners = (x: number, y: number, inset = 0): number[] => hex
    ? Array.from({ length: 6 }, (_, k) => { const a = Math.PI / 3 * k + Math.PI / 6; return [x + Math.cos(a) * (T - inset), y + Math.sin(a) * (T - inset) * 0.58]; }).flat()
    : [x, y - T / 2 + inset / 2, x + T - inset, y, x, y + T / 2 - inset / 2, x - T + inset, y];
  // Soft contact shadow under the floating slab.
  const b = scene.bounds;
  const shadow = g.createRadialGradient(b.x + b.width / 2, b.y + b.height * 0.92, 10, b.x + b.width / 2, b.y + b.height * 0.92, b.width * 0.55);
  shadow.addColorStop(0, "rgba(0,0,0,0.35)"); shadow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = shadow; g.beginPath(); g.ellipse(b.x + b.width / 2, b.y + b.height * 0.92, b.width * 0.55, b.height * 0.16, 0, 0, Math.PI * 2); g.fill();
  for (const tile of scene.tiles) {
    const { x, y } = tile;
    const c = corners(x, y);
    // Extruded side faces: lit earth on the left, deeper shadow on the right, strata line.
    if (hex) {
      poly(g, [c[2], c[3], c[4], c[5], c[4], c[5] + depth, c[2], c[3] + depth], theme.side[1]);
      poly(g, [c[4], c[5], c[6], c[7], c[6], c[7] + depth, c[4], c[5] + depth], theme.side[0]);
      poly(g, [c[0], c[1], c[2], c[3], c[2], c[3] + depth, c[0], c[1] + depth], theme.side[1]);
    } else {
      poly(g, [x - T, y, x, y + T / 2, x, y + T / 2 + depth, x - T, y + depth], theme.side[0]);
      poly(g, [x, y + T / 2, x + T, y, x + T, y + depth, x, y + T / 2 + depth], theme.side[1]);
      g.strokeStyle = "rgba(0,0,0,0.18)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - T, y + depth * 0.55); g.lineTo(x, y + T / 2 + depth * 0.55); g.lineTo(x + T, y + depth * 0.55); g.stroke();
    }
    const top = theme.tile[tile.kind];
    poly(g, c, shade(top, (tile.seed - 0.5) * 0.08));
    g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 1; g.stroke();
    // Tile details.
    if (tile.kind === "crater") {
      g.fillStyle = shade(top, -0.18); g.beginPath(); g.ellipse(x, y, T * 0.34, T * 0.15, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = shade(top, 0.12); g.beginPath(); g.ellipse(x + 2, y + 2, T * 0.26, T * 0.1, 0, 0, Math.PI); g.fill();
    } else if (tile.kind === "forest") {
      for (let k = 0; k < 3; k++) {
        const tx = x + (k - 1) * T * 0.3, ty = y + ((k * 7) % 3 - 1) * 3;
        g.fillStyle = shade(top, -0.25); g.beginPath(); g.moveTo(tx, ty - 18); g.lineTo(tx + 7, ty + 2); g.lineTo(tx - 7, ty + 2); g.closePath(); g.fill();
        g.fillStyle = shade(top, 0.08); g.beginPath(); g.moveTo(tx, ty - 18); g.lineTo(tx - 7, ty + 2); g.lineTo(tx - 1, ty + 2); g.closePath(); g.fill();
      }
    } else if (tile.kind === "field") {
      g.save(); g.beginPath(); const inner = corners(x, y, 5); g.moveTo(inner[0], inner[1]); for (let k = 2; k < inner.length; k += 2) g.lineTo(inner[k], inner[k + 1]); g.closePath(); g.clip();
      g.strokeStyle = shade(top, -0.16); g.lineWidth = 2;
      for (let k = -4; k <= 4; k++) { g.beginPath(); g.moveTo(x - T + k * 7, y - T); g.lineTo(x + T + k * 7, y + T); g.stroke(); }
      g.restore();
    } else if (tile.kind === "mountain") {
      poly(g, [x - T * 0.6, y + 4, x - 4, y - 30, x + T * 0.55, y + 4], shade(top, -0.1));
      poly(g, [x - 4, y - 30, x + 4, y - 22, x + T * 0.55, y + 4, x + 2, y + 4], shade(top, -0.25));
      poly(g, [x - 10, y - 19, x - 4, y - 30, x + 3, y - 23, x - 3, y - 20], "#f4f1e8");
    } else if (tile.kind === "plate") {
      g.strokeStyle = shade(top, 0.2); g.lineWidth = 1; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);
    } else if (tile.kind === "road") {
      g.strokeStyle = theme.id === "factorio" ? "rgba(242,177,59,0.55)" : "rgba(255,255,255,0.28)";
      g.lineWidth = theme.id === "factorio" ? 2 : 1.2;
      g.setLineDash(theme.id === "factorio" ? [4, 4] : [6, 6]);
      g.beginPath(); const inner = corners(x, y, 9); g.moveTo(inner[0], inner[1]); for (let k = 2; k < inner.length; k += 2) g.lineTo(inner[k], inner[k + 1]); g.closePath(); g.stroke();
      g.setLineDash([]);
    }
  }
}

// ---- Buildings (drawn each frame: they rise, blink and rotate). ----
export function paintBuilding(g: G, b: HeroBuilding, theme: HeroTheme, rise: number, time: number) {
  if (rise <= 0.001) return;
  const { x, y, w, d } = b, h = b.h * rise;
  const [wallL, wallR] = theme.wall;
  const roof = theme.roof;
  // Ground footprint shadow.
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.beginPath(); g.ellipse(x + 6, y + 3, w * 1.05, d * 1.05, 0, 0, Math.PI * 2); g.fill();
  switch (b.kind) {
    case "block": {
      box(g, x, y, w * 0.82, d * 0.82, h, roof, wallL, wallR);
      box(g, x, y - h, w * 0.5, d * 0.5, Math.min(8, h * 0.12), shade(roof, -0.08), shade(wallL, -0.05), shade(wallR, -0.05));
      g.fillStyle = theme.accent; g.fillRect(x - w * 0.82, y - h * 0.32, w * 0.82, 2);
      break;
    }
    case "tower": {
      box(g, x, y, w * 0.45, d * 0.45, h, roof, wallL, wallR);
      g.strokeStyle = shade(wallR, -0.3); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y - h - d * 0.45); g.lineTo(x, y - h - d * 0.45 - 16 * rise); g.stroke();
      if (rise > 0.95) { const blink = Math.sin(time * 3 + b.seed * 9) > 0.2; g.fillStyle = blink ? theme.accent : shade(theme.accent, -0.5); g.beginPath(); g.arc(x, y - h - d * 0.45 - 17, 2.4, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case "dome": {
      const r = w * 0.8;
      g.fillStyle = shade(wallR, -0.1); g.beginPath(); g.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2); g.fill();
      const grad = g.createRadialGradient(x - r * 0.35, y - h * 0.8, 2, x, y - h * 0.3, r * 1.2);
      grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.35, roof); grad.addColorStop(1, wallR);
      g.fillStyle = grad; g.beginPath(); g.ellipse(x, y, r, Math.max(1, h), 0, Math.PI, 0); g.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI); g.fill();
      g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, r * 0.55, Math.max(1, h * 0.98), 0, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
      g.fillStyle = theme.accent; g.fillRect(x - 3, y - 4, 6, 4);
      break;
    }
    case "tank": {
      const r = w * 0.48;
      cylinder(g, x - r * 0.6, y, r, h * 0.7, wallL, roof);
      cylinder(g, x + r * 0.7, y + 4, r * 0.8, h * 0.55, wallR, shade(roof, -0.05));
      g.strokeStyle = theme.accent; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x - r * 0.6, y - h * 0.35, r, r * 0.5, 0, 0, Math.PI); g.stroke();
      break;
    }
    case "factory": {
      box(g, x, y, w * 0.9, d * 0.9, h * 0.55, roof, wallL, wallR);
      // Sawtooth roof.
      for (let k = 0; k < 3; k++) {
        const sx = x - w * 0.9 + (k + 0.5) * w * 0.6, sy = y - h * 0.55 + (k - 1) * d * 0.3;
        poly(g, [sx - 9, sy, sx + 7, sy - 10 * rise, sx + 9, sy], shade(roof, -0.12));
        g.fillStyle = theme.window; g.globalAlpha = 0.7; g.fillRect(sx + 4, sy - 8 * rise, 2, 7 * rise); g.globalAlpha = 1;
      }
      cylinder(g, x + w * 0.5, y - d * 0.2, 5, h * 1.15, shade(wallR, -0.15), "#2b2a26");
      g.fillStyle = theme.accent; g.fillRect(x + w * 0.5 - 5, y - d * 0.2 - h * 1.0, 10, 3);
      break;
    }
    case "radar": {
      box(g, x, y, w * 0.6, d * 0.6, h * 0.45, roof, wallL, wallR);
      const top = y - h * 0.45, angle = time * 1.4 + b.seed * 6;
      g.strokeStyle = shade(wallR, -0.35); g.lineWidth = 2; g.beginPath(); g.moveTo(x, top); g.lineTo(x, top - 14 * rise); g.stroke();
      g.save(); g.translate(x, top - 14 * rise); g.scale(Math.cos(angle), 1);
      g.fillStyle = "#dcdcc8"; g.beginPath(); g.ellipse(0, 0, 13, 9, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = theme.accent; g.lineWidth = 1.5; g.stroke();
      g.restore();
      break;
    }
    case "tesla": {
      cylinder(g, x, y, w * 0.4, h * 0.25, wallL, roof);
      g.fillStyle = shade(wallR, -0.25); g.beginPath(); g.moveTo(x - 5, y - h * 0.25); g.lineTo(x + 5, y - h * 0.25); g.lineTo(x + 2, y - h); g.lineTo(x - 2, y - h); g.closePath(); g.fill();
      for (let k = 1; k <= 3; k++) { g.strokeStyle = theme.accent; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y - h * (0.3 + k * 0.17), 9 - k * 1.5, 3, 0, 0, Math.PI * 2); g.stroke(); }
      if (rise > 0.95) {
        const pulse = 0.6 + Math.sin(time * 6 + b.seed * 10) * 0.4;
        const orb = g.createRadialGradient(x, y - h - 4, 1, x, y - h - 4, 16);
        orb.addColorStop(0, "#ffffff"); orb.addColorStop(0.3, theme.glow); orb.addColorStop(1, "rgba(111,227,255,0)");
        g.globalAlpha = pulse; g.fillStyle = orb; g.beginPath(); g.arc(x, y - h - 4, 16, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      }
      break;
    }
    case "pylon": {
      g.strokeStyle = shade(wallR, -0.35); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x, y - h * 0.8); g.lineTo(x + 6, y); g.moveTo(x - 8, y - h * 0.55); g.lineTo(x + 8, y - h * 0.55); g.moveTo(x - 4, y - h * 0.3); g.lineTo(x + 4, y - h * 0.3); g.stroke();
      if (rise > 0.95 && Math.sin(time * 2.4 + b.seed * 7) > 0) { g.fillStyle = theme.accent; g.beginPath(); g.arc(x, y - h * 0.8, 2, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case "house": {
      box(g, x, y, w * 0.62, d * 0.62, h * 0.6, roof, wallL, wallR);
      // Pitched roof prism.
      const top = y - h * 0.6, rw = w * 0.66, rd = d * 0.66, ridge = 12 * rise;
      poly(g, [x - rw, top, x, top + rd, x + rw * 0.0, top + rd - ridge - rd, x - rw, top - ridge], shade(roof, -0.12));
      poly(g, [x, top + rd, x + rw, top, x + rw, top - ridge, x, top + rd - ridge - rd], roof);
      poly(g, [x - rw, top, x - rw, top - ridge, x, top - rd - ridge + rd * 0, x, top - rd], shade(roof, 0.1));
      break;
    }
    case "temple": {
      const steps = 4;
      for (let k = 0; k < steps; k++) {
        const s = 1 - k * 0.2, base = y - (h / steps) * k;
        box(g, x, base, w * s, d * s, h / steps, shade(theme.tile.field, 0.1 - k * 0.04), shade(theme.wall[0], -k * 0.03), shade(theme.wall[1], -k * 0.03));
      }
      g.fillStyle = theme.accent; g.beginPath(); g.moveTo(x, y - h - 12 * rise); g.lineTo(x + 6, y - h - 2); g.lineTo(x - 6, y - h - 2); g.closePath(); g.fill();
      break;
    }
    case "solar": {
      for (let k = -1; k <= 1; k++) {
        const sx = x + k * w * 0.45, sy = y + k * d * 0.2;
        g.strokeStyle = "#555"; g.lineWidth = 1; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 6 * rise); g.stroke();
        poly(g, [sx - 10, sy - 6 * rise, sx + 2, sy - 12 * rise, sx + 12, sy - 6 * rise, sx, sy], "#2e4a6b");
        g.strokeStyle = "rgba(143,243,234,0.55)"; g.beginPath(); g.moveTo(sx - 4, sy - 9 * rise); g.lineTo(sx + 6, sy - 3 * rise); g.stroke();
      }
      break;
    }
    case "crane": {
      // A construction crane slowly swings its jib: the world is always being built.
      const mast = h, top = y - mast;
      g.strokeStyle = theme.accent; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x - 3, top); g.moveTo(x + 3, y); g.lineTo(x + 3, top); g.stroke();
      g.lineWidth = 1;
      for (let k = 0; k < mast; k += 9) { g.beginPath(); g.moveTo(x - 3, y - k); g.lineTo(x + 3, y - k - 9); g.stroke(); }
      if (rise > 0.6) {
        const swing = Math.sin(time * 0.35 + b.seed * 4) * 0.9, jx = Math.cos(swing) * 46, jy = Math.sin(swing) * 14;
        g.lineWidth = 2; g.beginPath(); g.moveTo(x - jx * 0.35, top - jy * 0.35); g.lineTo(x + jx, top + jy); g.stroke();
        const hookX = x + jx * 0.8, hookY = top + jy * 0.8, drop = 22 + Math.sin(time * 0.7 + b.seed) * 8;
        g.strokeStyle = "rgba(0,0,0,0.6)"; g.beginPath(); g.moveTo(hookX, hookY); g.lineTo(hookX, hookY + drop); g.stroke();
        box(g, hookX, hookY + drop + 8, 6, 3, 6, roof, wallL, wallR);
        g.fillStyle = shade(theme.accent, -0.3); g.fillRect(x - jx * 0.35 - 4, top - jy * 0.35 - 2, 8, 6);
      }
      break;
    }
    case "rocket": {
      // Launch pad and an original rocket that launches on a long cycle.
      cylinder(g, x, y, w * 0.85, 4, "#4a4f57", "#6c727b");
      g.strokeStyle = theme.accent; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y - 4, w * 0.55, w * 0.27, 0, 0, Math.PI * 2); g.stroke();
      const launch = rocketLift(time) * rise;
      const ry = y - 6 - launch, rh = 46 * rise;
      if (launch > 0 && launch < 600) {
        const flame = 10 + Math.sin(time * 40) * 3;
        const fg = g.createLinearGradient(x, ry, x, ry + flame * 2);
        fg.addColorStop(0, "#ffffff"); fg.addColorStop(0.4, "#ffc36b"); fg.addColorStop(1, "rgba(255,110,60,0)");
        g.fillStyle = fg; g.beginPath(); g.moveTo(x - 4, ry); g.lineTo(x + 4, ry); g.lineTo(x, ry + flame * 2); g.closePath(); g.fill();
      }
      if (launch < 600) {
        g.fillStyle = "#e9edf0"; g.beginPath(); g.moveTo(x - 5, ry); g.lineTo(x + 5, ry); g.lineTo(x + 5, ry - rh * 0.75); g.quadraticCurveTo(x, ry - rh * 1.05, x - 5, ry - rh * 0.75); g.closePath(); g.fill();
        g.fillStyle = "#b9c3c9"; g.fillRect(x + 1, ry - rh * 0.75, 4, rh * 0.75);
        g.fillStyle = theme.accent; g.fillRect(x - 5, ry - rh * 0.45, 10, 3);
        poly(g, [x - 5, ry, x - 10, ry + 2, x - 5, ry - 10], "#c44a3a");
        poly(g, [x + 5, ry, x + 10, ry + 2, x + 5, ry - 10], "#a63a2e");
      }
      // Gantry.
      g.strokeStyle = "#8a9099"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - w * 0.6, y - 4); g.lineTo(x - w * 0.6, y - 4 - 52 * rise); g.lineTo(x - 6, y - 4 - 52 * rise); g.stroke();
      break;
    }
  }
}
/** Rocket altitude (world units) on a 20s cycle: idle, ignition, climb, then a new rocket rolls out. */
export function rocketLift(time: number) {
  const t = ((time % 20) + 20) % 20;
  if (t < 12) return 0;
  if (t < 12.6) return Math.sin((t - 12) * 60) * 0.8; // ignition shudder
  const k = t - 12.6;
  return k * k * 26;
}

export function paintWindows(g: G, b: HeroBuilding, theme: HeroTheme, rise: number, night: number, time: number) {
  if (rise < 0.97 || night <= 0.02) return;
  const w = b.kind === "tower" ? b.w * 0.45 : b.kind === "house" ? b.w * 0.62 : b.w * 0.82;
  const d = b.kind === "tower" ? b.d * 0.45 : b.kind === "house" ? b.d * 0.62 : b.d * 0.82;
  const h = b.kind === "house" ? b.h * 0.6 : b.kind === "factory" ? b.h * 0.55 : b.h;
  g.fillStyle = theme.window;
  for (const [index, win] of b.windows.entries()) {
    const on = Math.sin(time * 0.21 + b.seed * 31 + index * 2.7) > -0.55;
    if (!on) continue;
    g.globalAlpha = night * (0.75 + 0.25 * Math.sin(time * 1.7 + index));
    const px = win.face === 0 ? b.x - w + win.u * w : b.x + win.u * w;
    const py = win.face === 0 ? b.y + win.u * d - win.v * h : b.y + d - win.u * d - win.v * h;
    g.fillRect(px - 1.5, py - 2, 3, 3.5);
  }
  g.globalAlpha = 1;
}

/** Point at fraction `t` along a route polyline. */
export function routePoint(route: HeroRoute, t: number): [number, number] {
  let remaining = (((t % 1) + 1) % 1) * route.length;
  for (let k = 1; k < route.points.length; k++) {
    const a = route.points[k - 1], b = route.points[k], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= length) { const f = length ? remaining / length : 0; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
    remaining -= length;
  }
  return route.points[route.points.length - 1];
}

/** Vehicles and data pulses travelling along the roads. */
export function paintTraffic(g: G, scene: HeroScene, time: number, night: number) {
  const { theme } = scene;
  for (const [index, route] of scene.routes.entries()) {
    const count = theme.id === "factorio" ? 14 : 4;
    for (let k = 0; k < count; k++) {
      const forward = k % 2 === 0;
      const speed = theme.id === "factorio" ? 0.035 : 0.05 + (k % 3) * 0.012;
      const t = (forward ? 1 : -1) * time * speed + k / count + index * 0.31;
      const [x, y] = routePoint(route, t);
      const offset = forward ? -5 : 5;
      if (theme.id === "factorio") {
        poly(g, [x - 4, y - 2, x, y - 4, x + 4, y - 2, x, y], k % 3 ? "#c9a25a" : "#9fb8c9");
      } else if (theme.id === "red-alert") {
        box(g, x + offset, y, 5, 2.5, 3, "#a83a2c", "#7a2a20", "#5e2018");
        g.fillStyle = "#3b1712"; g.fillRect(x + offset - 1, y - 6, 2, 3);
      } else if (theme.id === "civilization") {
        g.fillStyle = "#6b4a2e"; g.fillRect(x + offset - 3, y - 3, 6, 3);
        g.fillStyle = "#f2e6c8"; g.beginPath(); g.arc(x + offset, y - 5, 2, 0, Math.PI * 2); g.fill();
      } else {
        box(g, x + offset, y, 4, 2, 2.5, "#e9eef0", "#9aa7ad", "#7a878d");
        if (night > 0.2) { g.fillStyle = theme.glow; g.globalAlpha = night; g.fillRect(x + offset - 1, y - 1, 3, 2); g.globalAlpha = 1; }
      }
    }
  }
}
export function paintPulses(g: G, scene: HeroScene, time: number) {
  const { theme } = scene;
  g.fillStyle = theme.glow;
  for (const [index, route] of scene.routes.entries()) {
    for (let k = 0; k < 3; k++) {
      for (let trail = 4; trail >= 0; trail--) {
        const q = routePoint(route, time * 0.09 + k / 3 + index * 0.5 - trail * 0.008);
        g.globalAlpha = trail ? 0.12 * (5 - trail) / 5 : 0.95;
        g.beginPath(); g.arc(q[0], q[1] - 1, trail ? 2.4 : 3.2, 0, Math.PI * 2); g.fill();
      }
    }
  }
  g.globalAlpha = 1;
}

// ---- Particles: a fixed pool, no per-frame allocation. ----
export interface ParticlePool { x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array; next: number }
export const PARTICLE_CAP = 160;
export function createParticles(): ParticlePool {
  const f = () => new Float32Array(PARTICLE_CAP);
  return { x: f(), y: f(), vx: f(), vy: f(), life: f(), max: f(), size: f(), next: 0 };
}
export function emit(pool: ParticlePool, x: number, y: number, vx: number, vy: number, life: number, size: number) {
  const k = pool.next; pool.next = (k + 1) % PARTICLE_CAP;
  pool.x[k] = x; pool.y[k] = y; pool.vx[k] = vx; pool.vy[k] = vy; pool.life[k] = life; pool.max[k] = life; pool.size[k] = size;
}
export function stepParticles(pool: ParticlePool, dt: number, kind: Particle) {
  const lift = kind === "smoke" ? -6 : kind === "leaf" ? 4 : -2;
  for (let k = 0; k < PARTICLE_CAP; k++) {
    if (pool.life[k] <= 0) continue;
    pool.life[k] -= dt;
    pool.vy[k] += lift * dt * 0.2;
    pool.x[k] += pool.vx[k] * dt; pool.y[k] += pool.vy[k] * dt;
  }
}
export function paintParticles(g: G, pool: ParticlePool, theme: HeroTheme, time: number) {
  for (let k = 0; k < PARTICLE_CAP; k++) {
    const life = pool.life[k];
    if (life <= 0) continue;
    const age = 1 - life / pool.max[k], x = pool.x[k], y = pool.y[k], s = pool.size[k];
    const fade = Math.min(1, age * 6) * (1 - age);
    switch (theme.particle) {
      case "smoke": g.fillStyle = mix("#d9d3c4", "#6d675c", age, 0.42 * fade); g.beginPath(); g.arc(x, y, s * (0.6 + age * 2.2), 0, Math.PI * 2); g.fill(); break;
      case "ember": g.fillStyle = mix("#ffd27a", "#d8432f", age, 0.9 * fade); g.fillRect(x, y, s, s); break;
      case "spark": g.fillStyle = `rgba(160,240,255,${0.9 * fade})`; g.fillRect(x - s / 2, y - s / 2, s, s); break;
      case "leaf": {
        g.save(); g.translate(x + Math.sin(time * 2 + k) * 6, y); g.rotate(time * 2 + k);
        g.fillStyle = k % 3 ? `rgba(240,214,120,${0.85 * fade})` : `rgba(168,85,58,${0.8 * fade})`; g.fillRect(-s, -s / 2, s * 2, s); g.restore(); break;
      }
      default: g.fillStyle = `rgba(160,245,236,${0.75 * fade})`; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
  }
}

/** Ambient spawns per second for each particle style (world units). */
export function spawnAmbient(pool: ParticlePool, scene: HeroScene, dt: number, time: number, random: () => number, built: (b: HeroBuilding) => boolean) {
  const { theme, bounds } = scene;
  const rate = theme.particle === "smoke" ? 26 : theme.particle === "spark" ? 14 : 10;
  let count = rate * dt;
  while (count > 0) {
    if (count < 1 && random() > count) break;
    count--;
    if (theme.particle === "smoke") {
      const stacks = scene.buildings.filter((b) => b.kind === "factory" && built(b));
      const b = stacks[Math.floor(random() * stacks.length)];
      if (b) emit(pool, b.x + b.w * 0.5, b.y - b.d * 0.2 - b.h * 1.15, 4 + random() * 5, -10 - random() * 6, 3.2 + random() * 1.4, 3 + random() * 2);
    } else if (theme.particle === "spark") {
      const towers = scene.buildings.filter((b) => b.kind === "tesla" && built(b));
      const b = towers[Math.floor(random() * towers.length)];
      if (b && random() < 0.6) emit(pool, b.x + (random() - 0.5) * 10, b.y - b.h - 4, (random() - 0.5) * 50, (random() - 0.7) * 40, 0.5 + random() * 0.5, 2);
      else emit(pool, bounds.x + random() * bounds.width, bounds.y + bounds.height * (0.3 + random() * 0.6), (random() - 0.5) * 4, -6 - random() * 6, 4 + random() * 3, 1.5);
    } else if (theme.particle === "leaf") {
      emit(pool, bounds.x - 20, bounds.y + random() * bounds.height * 0.7, 22 + random() * 18, 2 + random() * 4, 6 + random() * 4, 2.2);
    } else if (theme.particle === "ember") {
      emit(pool, bounds.x + random() * bounds.width, bounds.y + bounds.height * (0.45 + random() * 0.5), (random() - 0.5) * 6, -8 - random() * 10, 2.5 + random() * 2, 2);
    } else {
      emit(pool, bounds.x + random() * bounds.width, bounds.y + bounds.height * (0.25 + random() * 0.7), (random() - 0.5) * 5, -3 - random() * 5, 5 + random() * 4, 1 + random() * 1.4);
    }
  }
  if (theme.id === "moonshot") {
    const lift = rocketLift(time), rocket = scene.buildings.find((b) => b.kind === "rocket");
    if (rocket && lift > 0 && lift < 500 && built(rocket)) for (let k = 0; k < 3; k++) emit(pool, rocket.x + (random() - 0.5) * 6, rocket.y - 6 - lift + 10, (random() - 0.5) * 30, 25 + random() * 20, 0.9 + random() * 0.5, 2 + random() * 2);
  }
}

// ---- Sky ----
export function paintSky(g: G, theme: HeroTheme, width: number, height: number, time: number, light: ReturnType<typeof heroDaylight>, offsetX: number, offsetY: number) {
  const top = mixHex(mixHex(theme.sky.night[0], theme.sky.day[0], light.daylight), theme.sky.dusk[0], light.dusk * 0.6);
  const bottom = mixHex(mixHex(theme.sky.night[1], theme.sky.day[1], light.daylight), theme.sky.dusk[1], light.dusk * 0.75);
  const sky = g.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, top); sky.addColorStop(1, bottom);
  g.fillStyle = sky; g.fillRect(0, 0, width, height);
  // Stars twinkle at night (always faintly visible in space).
  const starAlpha = theme.id === "moonshot" ? 0.55 + (1 - light.daylight) * 0.45 : Math.max(0, 1 - light.daylight * 1.6);
  if (starAlpha > 0.01) {
    const random = seeded(7);
    g.fillStyle = "#ffffff";
    for (let k = 0; k < theme.stars; k++) {
      const sx = ((random() * width * 1.2 + offsetX * 0.3) % (width * 1.2) + width * 1.2) % (width * 1.2) - width * 0.1;
      const sy = random() * height * 0.75 + offsetY * 0.3;
      const tw = 0.5 + 0.5 * Math.sin(time * (1 + random() * 2) + k);
      g.globalAlpha = starAlpha * (0.35 + 0.65 * tw) * (1 - sy / height);
      const size = random() < 0.08 ? 2 : 1.2;
      g.fillRect(sx, sy, size, size);
    }
    g.globalAlpha = 1;
  }
  // Sun / moon on an arc, or a rising planet for the lunar colony.
  const arc = light.phase * Math.PI * 2;
  const cx = width * (0.5 - Math.cos(arc - Math.PI / 2) * 0.42) + offsetX * 0.4;
  const cy = height * (0.62 - Math.sin(arc - Math.PI / 2) * 0.5) + offsetY * 0.4;
  if (theme.id === "moonshot") {
    const px = width * 0.8 + offsetX * 0.5, py = height * 0.2 + offsetY * 0.5, r = Math.min(width, height) * 0.13;
    const planet = g.createRadialGradient(px - r * 0.4, py - r * 0.4, r * 0.1, px, py, r);
    planet.addColorStop(0, "#9fd8ff"); planet.addColorStop(0.55, "#3c7fb8"); planet.addColorStop(1, "#173455");
    g.fillStyle = planet; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.clip();
    g.fillStyle = "rgba(120,190,120,0.55)";
    for (let k = 0; k < 4; k++) { const drift = ((time * 4 + k * r * 0.7) % (r * 3)) - r * 1.5; g.beginPath(); g.ellipse(px + drift, py + (k - 1.5) * r * 0.35, r * 0.35, r * 0.14, 0.3, 0, Math.PI * 2); g.fill(); }
    // Terminator shadow follows the day cycle.
    const shadow = g.createLinearGradient(px - r, py, px + r, py);
    const k = 0.25 + light.daylight * 0.5;
    shadow.addColorStop(Math.max(0, k - 0.2), "rgba(3,5,11,0)"); shadow.addColorStop(Math.min(1, k + 0.25), "rgba(3,5,11,0.85)");
    g.fillStyle = shadow; g.fillRect(px - r, py - r, r * 2, r * 2);
    g.restore();
    g.strokeStyle = "rgba(159,216,255,0.35)"; g.lineWidth = 3; g.beginPath(); g.arc(px, py, r + 2, 0, Math.PI * 2); g.stroke();
  }
  if (light.sun > 0.12 && theme.id !== "moonshot") {
    const halo = g.createRadialGradient(cx, cy, 2, cx, cy, 70);
    halo.addColorStop(0, "rgba(255,250,225,0.95)"); halo.addColorStop(0.18, "rgba(255,226,160,0.6)"); halo.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, 70, 0, Math.PI * 2); g.fill();
  } else if (theme.id !== "moonshot") {
    const mx = width - cx, my = cy;
    g.fillStyle = "rgba(240,240,225,0.9)"; g.beginPath(); g.arc(mx, my, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = top; g.beginPath(); g.arc(mx + 5, my - 3, 10, 0, Math.PI * 2); g.fill();
  }
}

export function paintOcean(g: G, theme: HeroTheme, width: number, height: number, horizon: number, time: number, daylight: number) {
  if (!theme.ocean) return;
  const water = g.createLinearGradient(0, horizon, 0, height);
  water.addColorStop(0, mix(theme.ocean, "#ffffff", 0.25 * daylight, 1)); water.addColorStop(1, mix(theme.ocean, "#000000", 0.35, 1));
  g.fillStyle = water; g.fillRect(0, horizon, width, height - horizon);
  g.strokeStyle = `rgba(255,255,255,${0.12 + daylight * 0.18})`; g.lineWidth = 1;
  for (let k = 0; k < 18; k++) {
    const y = horizon + 8 + k * k * 1.6;
    if (y > height) break;
    const shift = Math.sin(time * 0.8 + k) * 18 + (time * (6 + k)) % 80;
    g.setLineDash([10 + k * 2, 24 + k * 3]); g.lineDashOffset = -shift;
    g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke();
  }
  g.setLineDash([]); g.lineDashOffset = 0;
}
