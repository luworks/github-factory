/**
 * Live, procedural world effects: sky/time of day, directional shadows, emissive night lights,
 * particles (smoke, traffic, drones, weather) and atmosphere. Everything here is original art.
 *
 * Honesty rules: motion illustrates structure (edges are real repository relationships) and
 * never invents telemetry. Only the snapshot's node status and observed commit dates change
 * intensity; unknown data stays at a neutral baseline. Every effect is a pure function of time,
 * so paused/reduced-motion frames are still, and resuming never "catches up".
 */
import type { NodeKind, StyleId, WorldEdge, WorldSnapshot } from "../contracts";
import { drawArchitecture } from "./art";
import { hash, type PlacedNode } from "./layout";
import { recordMarks, type LightMark, type Pen, type SmokeMark } from "./primitives";
import type { SceneryAnchors } from "./terrain";

type RGB = [number, number, number];
type Weather = "dust" | "ash" | "rain" | "snow" | "pollen";
interface StyleFx {
  night: RGB;
  golden: RGB;
  haze: RGB;
  hazeDay: number;
  hazeNight: number;
  shadow: number;
  weather: Weather;
  clouds: boolean;
  window: string;
}
const STYLE_FX: Record<StyleId, StyleFx> = {
  moonshot: { night: [70, 86, 132], golden: [236, 226, 214], haze: [120, 150, 190], hazeDay: 0.06, hazeNight: 0.1, shadow: 0.62, weather: "dust", clouds: false, window: "#c4f6ff" },
  factorio: { night: [74, 66, 104], golden: [255, 206, 150], haze: [150, 128, 92], hazeDay: 0.26, hazeNight: 0.18, shadow: 0.46, weather: "ash", clouds: true, window: "#ffd27a" },
  "red-alert": { night: [58, 78, 102], golden: [255, 214, 168], haze: [150, 168, 150], hazeDay: 0.2, hazeNight: 0.16, shadow: 0.44, weather: "rain", clouds: true, window: "#ffe09a" },
  "red-alert-2": { night: [60, 82, 126], golden: [255, 218, 182], haze: [176, 204, 220], hazeDay: 0.22, hazeNight: 0.14, shadow: 0.42, weather: "snow", clouds: true, window: "#c8f0ff" },
  civilization: { night: [104, 104, 150], golden: [255, 220, 170], haze: [236, 222, 186], hazeDay: 0.18, hazeNight: 0.1, shadow: 0.36, weather: "pollen", clouds: true, window: "#ffd47e" },
};
/** Seconds for one full day/night cycle. */
export const DAY_CYCLE = 120;
/** Live motion starts in late afternoon so the first minute shows sunset and city lights. */
export const START_PHASE = 0.43;
/** Reduced motion: one still golden-hour frame with the first lights coming on. */
export const STATIC_PHASE = 0.485;
/** Still frames evaluate particles at this fixed time so they read as a paused game. */
export const STATIC_TIME = 37.25;

export interface Sky {
  elevation: number;
  sunX: number;
  day: number;
  lights: number;
  tint: RGB | null;
  haze: RGB;
  hazeAlpha: number;
  shadowAngle: number;
  shadowLength: number;
  shadowAlpha: number;
}
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgb = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const frac = (v: number) => v - Math.floor(v);
const WHITE: RGB = [255, 255, 255];

export function skyAt(style: StyleId, phase: number): Sky {
  const s = STYLE_FX[style],
    a = frac(phase) * Math.PI * 2;
  const elevation = Math.sin(a) * 0.9 + 0.12,
    sunX = Math.cos(a);
  const day = clamp(elevation / 0.35),
    lights = clamp((0.3 - elevation) / 0.5);
  let tint: RGB | null = null;
  if (elevation < 0.45) {
    const golden = mix(WHITE, s.golden, clamp((0.45 - elevation) / 0.4));
    tint = elevation > 0.05 ? golden : mix(s.golden, s.night, clamp((0.05 - elevation) / 0.4));
  }
  const night = 1 - day;
  return {
    elevation,
    sunX,
    day,
    lights,
    tint,
    haze: tint ? mix(s.haze, mix(s.haze, s.night, 0.6), night) : s.haze,
    hazeAlpha: s.hazeDay * day + s.hazeNight * night,
    // Shadows fall away from the sun, slightly toward the viewer so they read on screen.
    shadowAngle: Math.atan2(0.42, -sunX * 1.1),
    shadowLength: clamp(0.5 / Math.max(elevation, 0.14), 0.55, 3.1),
    shadowAlpha: s.shadow * day + 0.1 * night,
  };
}

/** Observed commit cadence → 0..1 intensity. No commits observed means a neutral baseline. */
export function activityLevel(world: Pick<WorldSnapshot, "commits" | "collectedAt">): number {
  const commits = world.commits ?? [];
  if (!commits.length) return 0.45;
  const end = Date.parse(world.collectedAt);
  if (!Number.isFinite(end)) return 0.45;
  const recent = commits.filter((c) => {
    const at = Date.parse(c.date);
    return Number.isFinite(at) && at <= end + 60_000 && end - at < 30 * 86_400_000;
  }).length;
  return clamp(0.2 + recent / 12, 0.2, 1);
}

// ---------- Sprites (built once per color; avoids per-frame gradient allocation) ----------
const sprites = new Map<string, HTMLCanvasElement>();
function sprite(key: string, size: number, paint: (g: CanvasRenderingContext2D, size: number) => void) {
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = size;
    paint(c.getContext("2d")!, size);
    sprites.set(key, c);
  }
  return c;
}
function glow(color: string) {
  return sprite("glow:" + color, 64, (g, n) => {
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, color);
    r.addColorStop(0.18, color);
    r.addColorStop(0.45, color + "55");
    r.addColorStop(1, color + "00");
    g.fillStyle = r;
    g.fillRect(0, 0, n, n);
  });
}
function blob() {
  return sprite("blob", 128, (g, n) => {
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, "rgba(6,10,18,1)");
    r.addColorStop(0.55, "rgba(6,10,18,0.75)");
    r.addColorStop(1, "rgba(6,10,18,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, n, n);
  });
}
function puff(color: string) {
  return sprite("puff:" + color, 64, (g, n) => {
    const r = g.createRadialGradient(n * 0.45, n * 0.42, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, color);
    r.addColorStop(0.5, color + "aa");
    r.addColorStop(1, color + "00");
    g.fillStyle = r;
    g.fillRect(0, 0, n, n);
  });
}
function stamp(g: Pen, image: HTMLCanvasElement, x: number, y: number, rx: number, ry = rx) {
  g.drawImage(image, x - rx, y - ry, rx * 2, ry * 2);
}

// ---------- Per-kind light/smoke anchors, recorded from the same art the canvas draws ----------
const markCache = new Map<string, { lights: LightMark[]; smoke: SmokeMark[] }>();
let scratch: CanvasRenderingContext2D | null = null;
export function marksFor(style: StyleId, kind: NodeKind) {
  const key = style + ":" + kind;
  let m = markCache.get(key);
  if (!m) {
    scratch ??= document.createElement("canvas").getContext("2d")!;
    const g = scratch;
    g.resetTransform();
    m = recordMarks(() => drawArchitecture(g, kind, style, 0));
    markCache.set(key, m);
  }
  return m;
}
const HEIGHT: Record<NodeKind, number> = { app: 70, service: 78, data: 62, package: 50, infra: 86, docs: 48, test: 62, tool: 56, external: 66 };

// ---------- Routes along real repository edges ----------
export interface Route {
  edge: WorldEdge;
  pts: number[];
  cum: number[];
  length: number;
}
export function buildRoutes(nodes: PlacedNode[], edges: WorldEdge[], style: StyleId): Route[] {
  const byId = new Map(nodes.map((n) => [n.node.id, n]));
  const routes: Route[] = [];
  for (const edge of edges) {
    const a = byId.get(edge.source),
      b = byId.get(edge.target);
    if (!a || !b) continue;
    const pts: number[] = [];
    if (style === "factorio" || style === "red-alert") pts.push(a.x, a.y + 9, b.x, a.y + 9, b.x, b.y + 9);
    else {
      const mx = (a.x + b.x) / 2;
      for (let i = 0; i <= 24; i++) {
        const u = i / 24,
          v = 1 - u;
        pts.push(v * v * v * a.x + 3 * v * v * u * mx + 3 * v * u * u * mx + u * u * u * b.x, v * v * v * (a.y + 9) + 3 * v * v * u * (a.y + 9) + 3 * v * u * u * (b.y + 9) + u * u * u * (b.y + 9));
      }
    }
    const cum = [0];
    for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
    const length = cum[cum.length - 1];
    if (length > 20) routes.push({ edge, pts, cum, length });
  }
  return routes;
}
function along(r: Route, d: number) {
  const { pts, cum } = r;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const span = cum[i] - cum[i - 1] || 1,
    u = clamp((d - cum[i - 1]) / span);
  const x0 = pts[(i - 1) * 2],
    y0 = pts[(i - 1) * 2 + 1],
    x1 = pts[i * 2],
    y1 = pts[i * 2 + 1];
  return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, angle: Math.atan2(y1 - y0, x1 - x0) };
}

export interface FxFrame {
  style: StyleId;
  t: number;
  sky: Sky;
  activity: number;
  nodes: PlacedNode[];
  routes: Route[];
  anchors: SceneryAnchors;
  /** 1 = full quality; lowered automatically when frames are slow. */
  quality: number;
  /** False for still frames (paused / reduced motion): no strobes, no transient events. */
  live: boolean;
}

// ---------- Ground layer (camera space, before buildings) ----------
export function paintGround(g: Pen, f: FxFrame) {
  const { style, t, sky, anchors } = f,
    s = STYLE_FX[style];
  // Water: moving glints along the river and across lake tiles.
  if (anchors.river) {
    const r = anchors.river;
    g.save();
    g.beginPath();
    g.moveTo(...r.from);
    g.bezierCurveTo(...r.c1, ...r.c2, ...r.to);
    g.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      g.setLineDash([3 + i * 2, 26 + i * 9]);
      g.lineDashOffset = -t * (14 + i * 5) - i * 11;
      g.lineWidth = 2 - i * 0.4;
      g.strokeStyle = sky.lights > 0.5 ? `rgba(190,215,255,${0.18 + 0.1 * i})` : `rgba(235,250,240,${0.22 + 0.08 * i})`;
      g.translate(0, (i - 1) * 9);
      g.stroke();
    }
    g.restore();
  }
  for (const lake of anchors.lakes) {
    for (let j = 0; j < 7; j++) {
      const h = hash(`${lake.x}:${lake.y}:${j}`),
        tw = 0.5 + 0.5 * Math.sin(t * (1.1 + (h % 7) * 0.13) + (h % 31));
      g.globalAlpha = tw * 0.55 * (0.5 + 0.5 * sky.day);
      g.fillStyle = "#f4fbff";
      g.fillRect(lake.x - 55 + (h % 110), lake.y - 28 + ((h >> 8) % 56), 5 + (h % 6), 1.4);
    }
  }
  g.globalAlpha = 1;
  // Directional building shadows.
  const shade = blob();
  for (const pn of f.nodes) {
    const len = HEIGHT[pn.node.kind] * sky.shadowLength;
    g.save();
    g.translate(pn.x + 4, pn.y + 10);
    g.rotate(sky.shadowAngle);
    g.globalAlpha = sky.shadowAlpha * 0.85;
    g.drawImage(shade, -46, -30, len + 80, 60);
    g.restore();
    g.globalAlpha = 0.32 + 0.2 * sky.day;
    g.drawImage(shade, pn.x - 66, pn.y - 14, 132, 46);
  }
  g.globalAlpha = 1;
  // Drifting cloud shadows.
  if (s.clouds && sky.day > 0.05) {
    const b = anchors.bounds;
    for (let i = 0; i < 5; i++) {
      const h = hash(style + ":cloud:" + i),
        span = b.width + 1400;
      const x = b.x - 700 + frac((h % 997) / 997 + t * (0.006 + (h % 5) * 0.001)) * span,
        y = b.y + ((h >> 6) % 1000) / 1000 * b.height;
      g.globalAlpha = 0.11 * sky.day;
      g.drawImage(shade, x - 260, y - 120, 520 + (h % 160), 240);
    }
    g.globalAlpha = 1;
  }
  paintTraffic(g, f);
}

const VEHICLE: Record<StyleId, { spacing: number; speed: number }> = {
  moonshot: { spacing: 230, speed: 72 },
  factorio: { spacing: 34, speed: 30 },
  "red-alert": { spacing: 260, speed: 44 },
  "red-alert-2": { spacing: 230, speed: 58 },
  civilization: { spacing: 320, speed: 17 },
};
function vehicles(f: FxFrame, each: (x: number, y: number, angle: number, ghost: boolean, h: number) => void) {
  const v = VEHICLE[f.style],
    density = 0.5 + f.activity;
  for (const r of f.routes) {
    const ghost = r.edge.confidence !== "observed";
    const count = Math.max(1, Math.round((r.length / v.spacing) * density * (ghost ? 0.5 : 1)));
    const h = hash(r.edge.id),
      offset = (h % 1000) / 1000;
    for (let i = 0; i < count; i++) {
      const d = frac(offset + i / count + (f.t * v.speed) / r.length) * r.length;
      const p = along(r, d);
      each(p.x, p.y, p.angle, ghost, h + i * 7919);
    }
  }
}
function paintTraffic(g: Pen, f: FxFrame) {
  const style = f.style;
  vehicles(f, (x, y, angle, ghost, h) => {
    g.save();
    g.translate(x, y);
    g.globalAlpha = ghost ? 0.5 : 1;
    if (style === "factorio") {
      // Items riding the belt.
      const c = ["#c98a4b", "#a9b4bd", "#5fa36a", "#d9c35a"][h % 4];
      g.fillStyle = "#1d1f1a";
      g.fillRect(-3.2, -2.2, 6.4, 5);
      g.fillStyle = c;
      g.fillRect(-2.6, -3, 5.2, 4.2);
    } else {
      g.rotate(angle);
      g.scale(1, 0.72);
      if (style === "moonshot") {
        g.fillStyle = "#0d1518";
        g.beginPath();
        g.roundRect(-11, -3.4, 22, 8, 4);
        g.fill();
        g.fillStyle = "#e7efe8";
        g.beginPath();
        g.roundRect(-10, -4.5, 20, 8, 4);
        g.fill();
        g.fillStyle = "#6fd3e0";
        g.fillRect(2, -3.2, 6, 2.4);
      } else if (style === "civilization") {
        g.fillStyle = "#4a3a26";
        g.fillRect(-9, -3, 11, 6);
        g.fillStyle = "#e9d7a8";
        g.beginPath();
        g.ellipse(-3.5, -3, 6, 4, 0, Math.PI, Math.PI * 2);
        g.fill();
        g.fillStyle = "#6b4a2c";
        g.beginPath();
        g.ellipse(7, 0, 3.6, 2.2, 0, 0, Math.PI * 2);
        g.fill();
      } else {
        const allied = style === "red-alert-2";
        g.fillStyle = "#11160f";
        g.fillRect(-9, -4, 18, 9);
        g.fillStyle = allied ? "#8ea9b3" : "#6f7a4c";
        g.fillRect(-9, -5, 18, 8);
        g.fillStyle = allied ? "#c9dde0" : "#9aa36b";
        g.fillRect(2, -4, 6, 6);
        g.fillStyle = allied ? "#5a7d8b" : "#4a5232";
        g.beginPath();
        g.arc(-2, -1, 3.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  });
  g.globalAlpha = 1;
}

// ---------- Above-building layer: smoke, beacons, drones, trains, landers ----------
export function paintAbove(g: Pen, f: FxFrame) {
  const { style, t, sky } = f,
    wind = 0.7 + 0.3 * Math.sin(t * 0.05);
  for (const pn of f.nodes) {
    const m = marksFor(style, pn.node.kind);
    const busy = pn.node.status === "active" ? 1.5 : 1;
    for (let e = 0; e < m.smoke.length; e++) {
      const s = m.smoke[e],
        h = hash(pn.node.id + ":smoke:" + e);
      const color = s.steam ? "#eef3f2" : style === "factorio" ? "#6e6a60" : "#b8b4a6";
      const image = puff(color),
        n = Math.round(8 * f.quality) + 2,
        rate = 0.16 * busy;
      for (let i = 0; i < n; i++) {
        const u = frac(t * rate + i / n + (h % 100) / 100);
        const rise = u * 95 * s.scale,
          r = (4 + u * 19) * s.scale;
        const x = pn.x + s.x + wind * u * u * 52 + Math.sin(t * 0.9 + i * 1.7 + h) * 3 * u;
        const y = pn.y + s.y - rise;
        g.globalAlpha = Math.pow(1 - u, 1.4) * Math.min(1, u * 8) * (s.steam ? 0.55 : 0.62) * (0.65 + 0.35 * sky.day);
        stamp(g, image, x, y, r);
      }
    }
  }
  g.globalAlpha = 1;
  // Status beacons come only from snapshot status: attention pulses, active blinks, unknown is quiet.
  for (const pn of f.nodes) {
    const status = pn.node.status;
    if (status === "attention") {
      const u = f.live ? frac(t / 2.2 + (hash(pn.node.id) % 100) / 100) : 0.35;
      g.beginPath();
      g.ellipse(pn.x, pn.y + 6, 60 + u * 70, (60 + u * 70) * 0.42, 0, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,128,64,${(0.75 * (1 - u)).toFixed(3)})`;
      g.lineWidth = 2.5;
      g.stroke();
      g.fillStyle = "#3a1d16";
      g.fillRect(pn.x + 52, pn.y - 66, 3, 22);
      g.fillStyle = "#ff6a3d";
      g.beginPath();
      g.arc(pn.x + 53.5, pn.y - 68, 4.5, Math.PI, 0);
      g.fill();
    } else if (status === "active") {
      g.fillStyle = "#2c3a3a";
      g.fillRect(pn.x + 52, pn.y - 60, 3, 16);
      g.fillStyle = "#7fe3f0";
      g.fillRect(pn.x + 50.5, pn.y - 64, 6, 4);
    }
  }
  paintDrones(g, f);
  if (f.anchors.rail) paintTrain(g, f);
  if (f.anchors.pad && f.live) paintLander(g, f);
}

function droneCount(f: FxFrame) {
  return f.nodes.length < 2 ? 0 : Math.round((2 + f.activity * 5) * (f.style === "civilization" ? 1.4 : 1));
}
function dronePos(f: FxFrame, i: number) {
  const h = hash(f.style + ":drone:" + i),
    n = f.nodes.length;
  // Prefer active districts so busy repositories gather visible work around them.
  const active = f.nodes.filter((p) => p.node.status === "active");
  const a = active.length && i % 2 === 0 ? active[i % active.length] : f.nodes[h % n],
    b = f.nodes[(h >>> 9) % n] === a ? f.nodes[((h >>> 9) + 1) % n] : f.nodes[(h >>> 9) % n];
  const dist = Math.hypot(b.x - a.x, b.y - a.y) + 80,
    speed = f.style === "civilization" ? 26 : 48;
  const cycle = frac(f.t * (speed / dist) * 0.5 + (h % 1000) / 1000) * 2,
    u = cycle < 1 ? cycle : 2 - cycle;
  const e = u * u * (3 - 2 * u);
  const altitude = 78 + 26 * Math.sin(Math.PI * e) + (h % 20);
  const x = a.x + (b.x - a.x) * e + Math.sin(f.t * 0.7 + h) * 12,
    y = a.y + (b.y - a.y) * e + Math.cos(f.t * 0.6 + h) * 6;
  return { x, y, altitude, heading: Math.atan2(b.y - a.y, b.x - a.x) * (cycle < 1 ? 1 : -1) + (cycle < 1 ? 0 : 0), dir: cycle < 1 ? Math.sign(b.x - a.x) || 1 : -(Math.sign(b.x - a.x) || 1), h };
}
function paintDrones(g: Pen, f: FxFrame) {
  const count = droneCount(f),
    shade = blob();
  for (let i = 0; i < count; i++) {
    const d = dronePos(f, i),
      y = d.y - d.altitude;
    if (f.style !== "civilization") {
      g.globalAlpha = 0.28 * f.sky.day + 0.08;
      g.drawImage(shade, d.x - 11 - Math.cos(f.sky.shadowAngle) * 18, d.y - 4, 22, 9);
      g.globalAlpha = 1;
    }
    g.save();
    g.translate(d.x, y);
    if (f.style === "civilization") {
      // A small flock of birds.
      g.strokeStyle = f.sky.lights > 0.6 ? "#3b3a48" : "#4a4232";
      g.lineWidth = 1.4;
      for (let b = 0; b < 4; b++) {
        const flap = Math.sin(f.t * 9 + b * 1.3 + d.h) * 2.4,
          bx = -b * 9 * d.dir,
          by = (b % 2 ? 4 : -3) + b;
        g.beginPath();
        g.moveTo(bx - 4, by - flap);
        g.quadraticCurveTo(bx - 1.5, by - 1, bx, by);
        g.quadraticCurveTo(bx + 1.5, by - 1, bx + 4, by - flap);
        g.stroke();
      }
    } else if (f.style === "moonshot") {
      g.fillStyle = "#1a2326";
      g.beginPath();
      g.ellipse(0, 1, 9, 4, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#dfe8e2";
      g.beginPath();
      g.ellipse(0, 0, 8, 3.4, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#79d7e6";
      g.fillRect(-2, -3, 4, 2);
    } else if (f.style === "factorio") {
      g.fillStyle = "#2b2c25";
      g.fillRect(-5, -3, 10, 6);
      g.fillStyle = "#c2b07a";
      g.fillRect(-4, -4, 8, 5);
      g.strokeStyle = "#2b2c25";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-8, -4);
      g.lineTo(8, -4);
      g.stroke();
    } else {
      // Original light utility rotorcraft.
      const allied = f.style === "red-alert-2";
      g.scale(d.dir, 1);
      g.fillStyle = "#151a14";
      g.beginPath();
      g.ellipse(0, 0, 9, 4.2, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = allied ? "#9db7bf" : "#7b8656";
      g.beginPath();
      g.ellipse(0, -0.6, 8, 3.4, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-17, -1.6, 10, 2.2);
      g.fillStyle = allied ? "#d8f0f4" : "#c7cf9e";
      g.fillRect(3, -2.4, 4, 2);
      const spin = f.t * 40 + d.h;
      g.strokeStyle = "rgba(20,24,20,0.55)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(0, -5, 15, 3, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(-Math.cos(spin) * 15, -5 - Math.sin(spin) * 3);
      g.lineTo(Math.cos(spin) * 15, -5 + Math.sin(spin) * 3);
      g.stroke();
    }
    g.restore();
  }
}
function trainState(f: FxFrame) {
  const rail = f.anchors.rail!,
    period = 28,
    u = frac(f.t / period),
    run = u / 0.42;
  if (run > 1) return null;
  const span = rail.x1 - rail.x0;
  return { x: rail.x0 - 260 + run * (span + 520), y: rail.y };
}
function paintTrain(g: Pen, f: FxFrame) {
  const s = trainState(f);
  if (!s) return;
  for (let i = 0; i < 6; i++) {
    const x = s.x - i * 34;
    g.fillStyle = "#1c1e19";
    g.fillRect(x - 15, s.y - 9, 31, 15);
    g.fillStyle = i === 0 ? "#b0583a" : i % 2 ? "#7c7f6c" : "#8d826a";
    g.fillRect(x - 15, s.y - 12, 30, 13);
    g.fillStyle = i === 0 ? "#e2b069" : "#5d6052";
    g.fillRect(x - (i === 0 ? -4 : 12), s.y - 10, i === 0 ? 8 : 24, 3);
  }
}
function landerState(f: FxFrame) {
  const u = frac(f.t / 34),
    pad = f.anchors.pad!;
  let altitude: number;
  if (u < 0.25) altitude = Math.pow(1 - u / 0.25, 2) * 280;
  else if (u < 0.55) altitude = 0;
  else if (u < 0.8) altitude = Math.pow((u - 0.55) / 0.25, 2) * 280;
  else return null;
  const burn = u < 0.25 ? 1 - u / 0.25 * 0.4 : u >= 0.55 ? 1 : 0;
  return { x: pad.x, y: pad.y, altitude, burn };
}
function paintLander(g: Pen, f: FxFrame) {
  const s = landerState(f);
  if (!s) return;
  const shade = blob(),
    near = clamp(1 - s.altitude / 280);
  g.globalAlpha = 0.25 + 0.45 * near;
  g.drawImage(shade, s.x - 24 - (1 - near) * 10, s.y - 9, 48 + (1 - near) * 20, 18);
  if (s.burn && s.altitude < 60) {
    g.globalAlpha = 0.35 * (1 - s.altitude / 60);
    stamp(g, puff("#c9c4b4"), s.x, s.y - 2, 44 + (1 - s.altitude / 60) * 30, 12);
  }
  g.globalAlpha = 1;
  const y = s.y - s.altitude - 12;
  g.fillStyle = "#1a2226";
  g.fillRect(s.x - 13, y + 6, 4, 9);
  g.fillRect(s.x + 9, y + 6, 4, 9);
  g.fillStyle = "#d7ddd2";
  g.beginPath();
  g.moveTo(s.x - 11, y + 8);
  g.lineTo(s.x - 7, y - 16);
  g.lineTo(s.x, y - 23);
  g.lineTo(s.x + 7, y - 16);
  g.lineTo(s.x + 11, y + 8);
  g.closePath();
  g.fill();
  g.fillStyle = "#8aa0a4";
  g.fillRect(s.x - 11, y + 2, 22, 6);
  g.fillStyle = "#79d7e6";
  g.fillRect(s.x - 3, y - 14, 6, 4);
}

// ---------- Light pass ----------
/** Screen-space multiply grade for golden hour and night. */
export function paintTint(g: Pen, f: FxFrame, width: number, height: number) {
  const tint = f.sky.tint;
  if (!tint) return;
  g.save();
  g.globalCompositeOperation = "multiply";
  g.fillStyle = rgb(tint);
  g.fillRect(0, 0, width, height);
  g.restore();
}
/** Camera-space emissive lights drawn after the grade, so they glow through the night. */
export function paintEmissive(g: Pen, f: FxFrame) {
  const { style, t, sky } = f,
    s = STYLE_FX[style],
    L = sky.lights;
  g.save();
  if (L > 0.02) {
    const lit = 0.5 + 0.35 * f.activity;
    for (const pn of f.nodes) {
      const m = marksFor(style, pn.node.kind),
        h0 = hash(pn.node.id);
      for (let i = 0; i < m.lights.length; i++) {
        const l = m.lights[i];
        if (l.lamp) continue;
        const h = hash(pn.node.id + ":w:" + i);
        const epoch = f.live ? Math.floor(t / 19 + (h % 13) / 13) : 0;
        if (hash(`${h0}:${i}:${epoch}`) % 100 >= lit * 100) continue;
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = L * 0.95;
        g.fillStyle = s.window;
        g.fillRect(pn.x + l.x, pn.y + l.y, l.w, l.h);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = L * 0.42;
        stamp(g, glow(s.window), pn.x + l.x + l.w / 2, pn.y + l.y + l.h / 2, 13 + l.w);
      }
      // Ground light pool at the entrance.
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = L * 0.22;
      stamp(g, glow(s.window), pn.x, pn.y + 14, 70, 26);
    }
  }
  g.globalCompositeOperation = "lighter";
  // Lamps: architectural lights glow at dusk; aviation lights blink.
  for (const pn of f.nodes) {
    const m = marksFor(style, pn.node.kind);
    for (let i = 0; i < m.lights.length; i++) {
      const l = m.lights[i];
      if (!l.lamp) continue;
      const aviation = l.color === "#ff5a4a";
      if (aviation && style === "civilization") continue;
      const blink = aviation ? (f.live ? (frac(t * 0.8 + (hash(pn.node.id) % 10) / 10) < 0.18 ? 1 : 0.15) : 1) : 1;
      g.globalAlpha = Math.min(1, L * 0.9 + 0.08) * blink;
      stamp(g, glow(l.color), pn.x + l.x, pn.y + l.y, aviation ? 10 : 9);
    }
    // Status glows (data-driven). Unknown stays dark/neutral.
    const st = pn.node.status;
    if (st === "attention") {
      const strobe = f.live ? Math.pow(0.5 + 0.5 * Math.sin(t * 6.2), 6) : 0.8;
      g.globalAlpha = 0.35 + 0.65 * strobe;
      stamp(g, glow("#ff6a3d"), pn.x + 53.5, pn.y - 69, 16 + 22 * strobe);
      g.globalAlpha = (0.15 + 0.35 * L) * strobe;
      stamp(g, glow("#ff6a3d"), pn.x, pn.y + 4, 90, 36);
    } else if (st === "active") {
      const on = f.live ? (frac(t * 1.3 + (hash(pn.node.id) % 10) / 10) < 0.5 ? 1 : 0.35) : 1;
      g.globalAlpha = (0.5 + 0.5 * L) * on;
      stamp(g, glow("#7fe3f0"), pn.x + 53.5, pn.y - 62, 14);
    } else if (st === "healthy") {
      g.globalAlpha = 0.25 + 0.5 * L;
      stamp(g, glow("#a9ce94"), pn.x - 51, pn.y + 17, 9);
    }
    // Furnace/chimney mouths glow at night.
    if (L > 0.05)
      for (const sm of marksFor(style, pn.node.kind).smoke) {
        if (sm.steam) continue;
        g.globalAlpha = L * (0.55 + 0.2 * Math.sin(t * 3 + pn.x));
        stamp(g, glow("#ff9a4a"), pn.x + sm.x, pn.y + sm.y + 2, 12);
      }
  }
  // Vehicle lights.
  if (L > 0.05 && style !== "factorio") {
    const color = style === "moonshot" || style === "red-alert-2" ? "#9fefff" : "#ffe2a0";
    vehicles(f, (x, y, angle, ghost) => {
      g.globalAlpha = L * (ghost ? 0.35 : 0.7);
      stamp(g, glow(color), x + Math.cos(angle) * 10, y + Math.sin(angle) * 7, 10);
    });
  }
  if (style === "factorio" && L > 0.05)
    vehicles(f, (x, y, _a, ghost, h) => {
      if (h % 5) return;
      g.globalAlpha = L * (ghost ? 0.2 : 0.4);
      stamp(g, glow("#ffc26a"), x, y, 7);
    });
  // Drone and rotorcraft nav lights.
  const count = droneCount(f);
  for (let i = 0; i < count && style !== "civilization"; i++) {
    const d = dronePos(f, i),
      blink = f.live ? (frac(t * 1.1 + i * 0.37) < 0.25 ? 1 : 0.25) : 1;
    g.globalAlpha = (0.35 + 0.65 * L) * blink;
    stamp(g, glow(style === "factorio" ? "#ffb347" : style === "red-alert" ? "#ff5a4a" : "#9fefff"), d.x, d.y - d.altitude, 8);
  }
  // Searchlights sweep the military bases after dark.
  if ((style === "red-alert" || style === "red-alert-2") && L > 0.15) {
    const towers = f.nodes.filter((p) => hash(p.node.id) % 3 === 0).slice(0, 4);
    for (const pn of towers) {
      const h = hash(pn.node.id + ":search"),
        a = (h % 628) / 100 + (f.live ? Math.sin(t * 0.35 + h) * 0.9 : 0.4);
      const tx = pn.x + Math.cos(a) * 230,
        ty = pn.y + Math.sin(a) * 120;
      const ox = pn.x,
        oy = pn.y - 58;
      const grad = g.createLinearGradient(ox, oy, tx, ty);
      const c = style === "red-alert-2" ? "190,236,255" : "255,240,200";
      grad.addColorStop(0, `rgba(${c},${0.42 * L})`);
      grad.addColorStop(1, `rgba(${c},0)`);
      const nx = -(ty - oy),
        ny = tx - ox,
        nl = Math.hypot(nx, ny) || 1;
      g.globalAlpha = 1;
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(tx + (nx / nl) * 38, ty + (ny / nl) * 20);
      g.lineTo(tx - (nx / nl) * 38, ty - (ny / nl) * 20);
      g.closePath();
      g.fill();
      g.globalAlpha = 0.35 * L;
      stamp(g, glow(style === "red-alert-2" ? "#c8f0ff" : "#fff1c8"), tx, ty, 46, 22);
    }
  }
  // Train headlight and lit windows.
  if (f.anchors.rail) {
    const tr = trainState(f);
    if (tr && L > 0.05) {
      g.globalAlpha = L * 0.9;
      stamp(g, glow("#ffe7a8"), tr.x + 24, tr.y - 6, 26, 12);
      for (let i = 1; i < 6; i++) {
        g.globalAlpha = L * 0.45;
        stamp(g, glow("#ffc66a"), tr.x - i * 34, tr.y - 7, 9, 5);
      }
    }
  }
  if (f.anchors.pad && f.live) {
    const ls = landerState(f);
    if (ls && ls.burn) {
      const flick = 0.75 + 0.25 * Math.sin(t * 31);
      g.globalAlpha = 0.9 * flick;
      stamp(g, glow("#ffd08a"), ls.x, ls.y - ls.altitude + 2, 9, 20);
      g.globalAlpha = 0.4 * flick;
      stamp(g, glow("#9fefff"), ls.x, ls.y - ls.altitude, 30);
    }
  }
  // Fireflies over the countryside at night.
  if (style === "civilization" && L > 0.3) {
    const b = f.anchors.bounds;
    for (let i = 0; i < Math.round(60 * f.quality); i++) {
      const h = hash("firefly:" + i);
      const x = b.x + (h % 1000) / 1000 * b.width + Math.sin(t * 0.4 + i) * 22,
        y = b.y + ((h >> 10) % 1000) / 1000 * b.height + Math.cos(t * 0.33 + i * 2) * 14;
      g.globalAlpha = L * Math.max(0, Math.sin(t * (1.3 + (h % 9) * 0.1) + i)) * 0.9;
      stamp(g, glow("#e8ff9a"), x, y, 5);
    }
  }
  g.restore();
}

// ---------- Atmosphere (screen space) ----------
export function paintAtmosphere(g: Pen, f: FxFrame, width: number, height: number) {
  const { style, t, sky } = f,
    s = STYLE_FX[style];
  g.save();
  // Depth haze: the far (upper) map recedes into the air.
  if (sky.hazeAlpha > 0.01) {
    const haze = g.createLinearGradient(0, 0, 0, height);
    haze.addColorStop(0, rgb(sky.haze, sky.hazeAlpha));
    haze.addColorStop(0.42, rgb(sky.haze, sky.hazeAlpha * 0.25));
    haze.addColorStop(0.7, rgb(sky.haze, 0));
    haze.addColorStop(1, rgb(sky.haze, sky.hazeAlpha * 0.3));
    g.fillStyle = haze;
    g.fillRect(0, 0, width, height);
  }
  const q = f.quality,
    area = clamp((width * height) / (1440 * 900), 0.25, 1.4);
  if (s.weather === "rain") {
    const n = Math.round(150 * q * area);
    g.strokeStyle = sky.lights > 0.5 ? "rgba(170,190,220,0.28)" : "rgba(214,226,232,0.3)";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const h = hash("rain:" + i);
      const y = frac((h % 1000) / 1000 + t * (1.05 + (h % 7) * 0.04)) * (height + 40) - 20;
      const x = frac(((h >> 10) % 1000) / 1000 - (t * 0.04)) * (width + 60) - 30 + (y / height) * -18;
      g.moveTo(x, y);
      g.lineTo(x - 4, y + 13);
    }
    g.stroke();
  } else if (s.weather === "snow") {
    const n = Math.round(130 * q * area);
    g.fillStyle = "rgba(248,252,255,0.85)";
    for (let i = 0; i < n; i++) {
      const h = hash("snow:" + i),
        r = 0.8 + (h % 3) * 0.55;
      const y = frac((h % 1000) / 1000 + t * (0.035 + (h % 5) * 0.008)) * (height + 20) - 10;
      const x = frac(((h >> 10) % 1000) / 1000 + Math.sin(t * 0.6 + i) * 0.006 + t * 0.006) * width;
      g.globalAlpha = 0.45 + (h % 4) * 0.14;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Floating motes: lunar dust, factory ash/embers, countryside pollen.
    const n = Math.round((style === "factorio" ? 70 : 40) * q * area);
    const ember = style === "factorio" && sky.lights > 0.3;
    for (let i = 0; i < n; i++) {
      const h = hash(style + ":mote:" + i);
      const x = frac((h % 1000) / 1000 + t * (0.004 + (h % 5) * 0.002)) * width;
      const y = frac(((h >> 10) % 1000) / 1000 - t * (ember && i % 3 === 0 ? 0.03 : 0.006)) * height;
      g.globalAlpha = (0.25 + 0.35 * Math.abs(Math.sin(t * 0.7 + i))) * (style === "moonshot" ? 0.6 : 1);
      g.fillStyle = ember && i % 3 === 0 ? "#ffa54d" : style === "moonshot" ? "#cfe6ef" : style === "factorio" ? "#cbb98e" : "#fff6cf";
      g.fillRect(x, y, 1.6 + (h % 2), 1.6 + (h % 2));
    }
    // A rare meteor crosses the lunar sky.
    if (style === "moonshot" && f.live) {
      const u = frac(t / 11);
      if (u < 0.08) {
        const k = u / 0.08,
          x = width * (0.15 + 0.6 * k),
          y = height * (0.08 + 0.12 * k);
        const tail = g.createLinearGradient(x, y, x - 90, y - 18);
        tail.addColorStop(0, `rgba(220,245,255,${0.9 * (1 - k)})`);
        tail.addColorStop(1, "rgba(220,245,255,0)");
        g.globalAlpha = 1;
        g.strokeStyle = tail;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 90, y - 18);
        g.stroke();
      }
    }
  }
  g.restore();
}
