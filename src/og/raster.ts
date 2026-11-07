/** A small, original, dependency-free software subset of CanvasRenderingContext2D.
 * It exists so the server can draw the shared procedural world art (src/world)
 * into a PNG for social previews without a native canvas. Unsupported features
 * are ignored rather than emulated; every fill/stroke checks a CPU deadline. */

export class RenderBudgetError extends Error {
  constructor() {
    super("Preview render exceeded its CPU budget");
  }
}

type Rgba = readonly [number, number, number, number]; // straight 0..255 rgb, alpha 0..1
const TRANSPARENT: Rgba = [0, 0, 0, 0];
const colorCache = new Map<string, Rgba | null>();
const NAMED: Record<string, Rgba> = {
  black: [0, 0, 0, 1], white: [255, 255, 255, 1], transparent: TRANSPARENT, red: [255, 0, 0, 1],
  green: [0, 128, 0, 1], blue: [0, 0, 255, 1], gray: [128, 128, 128, 1], grey: [128, 128, 128, 1],
};

function hsl(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Parses the CSS color forms used by the art; null means "invalid, keep previous". */
export function parseColor(input: string): Rgba | null {
  const key = input.trim().toLowerCase();
  const hit = colorCache.get(key);
  if (hit !== undefined) return hit;
  let out: Rgba | null = null;
  if (key in NAMED) out = NAMED[key];
  else if (/^#[0-9a-f]+$/.test(key) && [4, 5, 7, 9].includes(key.length)) {
    const short = key.length < 6;
    const digits = short ? key.slice(1).split("").map((c) => c + c) : key.slice(1).match(/../g)!;
    const v = digits.map((d) => parseInt(d, 16));
    out = [v[0], v[1], v[2], v.length > 3 ? v[3] / 255 : 1];
  } else {
    const m = key.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
    if (m) {
      const parts = m[2].split(/[\s,/]+/).filter(Boolean);
      const num = (s: string, scale: number) => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s));
      if (parts.length >= 3) {
        const a = parts.length > 3 ? Math.max(0, Math.min(1, num(parts[3], 1))) : 1;
        if (m[1].startsWith("rgb")) out = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255), a];
        else {
          const [r, g, b] = hsl(parseFloat(parts[0]), num(parts[1], 1), num(parts[2], 1));
          out = [r, g, b, a];
        }
        if (out.some((v) => !Number.isFinite(v))) out = null;
      }
    }
  }
  if (colorCache.size > 4096) colorCache.clear();
  colorCache.set(key, out);
  return out;
}

type Stop = { offset: number; color: Rgba };
/** Premultiplied 256-entry lookup, matching canvas premultiplied interpolation. */
function gradientLut(stops: Stop[]) {
  const lut = new Float32Array(256 * 4);
  const sorted = stops.toSorted((a, b) => a.offset - b.offset);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < sorted.length - 1 && sorted[k + 1].offset < t) k++;
    const a = sorted[k], b = sorted[Math.min(sorted.length - 1, k + 1)];
    const span = b.offset - a.offset;
    const u = t <= a.offset ? 0 : t >= b.offset ? 1 : span > 0 ? (t - a.offset) / span : 1;
    const pa = a.color[3], pb = b.color[3];
    lut[i * 4] = a.color[0] * pa * (1 - u) + b.color[0] * pb * u;
    lut[i * 4 + 1] = a.color[1] * pa * (1 - u) + b.color[1] * pb * u;
    lut[i * 4 + 2] = a.color[2] * pa * (1 - u) + b.color[2] * pb * u;
    lut[i * 4 + 3] = pa * (1 - u) + pb * u;
  }
  return lut;
}

export class SoftGradient {
  stops: Stop[] = [];
  constructor(
    readonly type: "linear" | "radial",
    readonly coords: number[],
  ) {}
  addColorStop(offset: number, color: string) {
    const c = parseColor(color);
    if (!c || !Number.isFinite(offset)) return;
    this.stops.push({ offset: Math.max(0, Math.min(1, offset)), color: c });
  }
}

type Matrix = [number, number, number, number, number, number];
type Point = [number, number];
interface SubPath { points: Point[]; closed: boolean }
interface State {
  m: Matrix; fill: Rgba | SoftGradient; stroke: Rgba | SoftGradient; alpha: number; lineWidth: number;
  dash: number[]; dashOffset: number; cap: string; join: string; font: string; align: string; baseline: string;
}

/** Glyph renderer injected by the font module so text uses the same rasterizer. */
export interface TextEngine {
  measure(text: string, font: string): number;
  draw(g: SoftCanvas, text: string, x: number, y: number, font: string, align: string, baseline: string, stroke: boolean): void;
}

const signedArea = (p: Point[]) => {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return s;
};
const oriented = (p: Point[]) => (signedArea(p) < 0 ? p.toReversed() : p);
function disc(cx: number, cy: number, r: number): Point[] {
  const n = Math.max(8, Math.min(48, Math.ceil(r * 2.4)));
  return oriented(Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r] as Point));
}

export class SoftCanvas {
  readonly data: Float32Array; // straight-alpha RGBA, rgb 0..255, a 0..1
  private state: State;
  private stack: State[] = [];
  private path: SubPath[] = [];
  private cover: Float32Array;
  private ops = 0;
  text: TextEngine | null = null;
  imageSmoothingEnabled = true;
  globalCompositeOperation = "source-over";
  shadowBlur = 0;
  shadowColor = "transparent";
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly deadline = Number.POSITIVE_INFINITY,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.data = new Float32Array(width * height * 4);
    this.cover = new Float32Array(width + 2);
    this.state = {
      m: [1, 0, 0, 1, 0, 0], fill: [0, 0, 0, 1], stroke: [0, 0, 0, 1], alpha: 1, lineWidth: 1,
      dash: [], dashOffset: 0, cap: "butt", join: "miter", font: "10px sans-serif", align: "start", baseline: "alphabetic",
    };
  }
  /** Coarse CPU guard; the clock is read every few operations. */
  private tick() {
    if (++this.ops % 64 === 0 && this.clock() > this.deadline) throw new RenderBudgetError();
  }

  // --- state -------------------------------------------------------------
  save() { this.stack.push({ ...this.state, m: [...this.state.m] as Matrix, dash: [...this.state.dash] }); }
  restore() { const s = this.stack.pop(); if (s) this.state = s; }
  get fillStyle(): string | SoftGradient { return this.state.fill instanceof SoftGradient ? this.state.fill : `rgba(${this.state.fill.join(",")})`; }
  set fillStyle(v: string | SoftGradient) { const c = typeof v === "string" ? parseColor(v) : v instanceof SoftGradient ? v : null; if (c) this.state.fill = c; }
  get strokeStyle(): string | SoftGradient { return this.state.stroke instanceof SoftGradient ? this.state.stroke : `rgba(${this.state.stroke.join(",")})`; }
  set strokeStyle(v: string | SoftGradient) { const c = typeof v === "string" ? parseColor(v) : v instanceof SoftGradient ? v : null; if (c) this.state.stroke = c; }
  get globalAlpha() { return this.state.alpha; }
  set globalAlpha(v: number) { if (Number.isFinite(v) && v >= 0 && v <= 1) this.state.alpha = v; }
  get lineWidth() { return this.state.lineWidth; }
  set lineWidth(v: number) { if (Number.isFinite(v) && v > 0) this.state.lineWidth = v; }
  get lineCap() { return this.state.cap; }
  set lineCap(v: string) { this.state.cap = v; }
  get lineJoin() { return this.state.join; }
  set lineJoin(v: string) { this.state.join = v; }
  get lineDashOffset() { return this.state.dashOffset; }
  set lineDashOffset(v: number) { if (Number.isFinite(v)) this.state.dashOffset = v; }
  get font() { return this.state.font; }
  set font(v: string) { this.state.font = v; }
  get textAlign() { return this.state.align; }
  set textAlign(v: string) { this.state.align = v; }
  get textBaseline() { return this.state.baseline; }
  set textBaseline(v: string) { this.state.baseline = v; }
  setLineDash(d: number[]) { if (d.every((v) => Number.isFinite(v) && v >= 0)) this.state.dash = d.length % 2 ? [...d, ...d] : [...d]; }
  getLineDash() { return [...this.state.dash]; }

  // --- transforms --------------------------------------------------------
  setTransform(a: number, b = 0, c = 0, d = 1, e = 0, f = 0) { this.state.m = [a, b, c, d, e, f]; }
  resetTransform() { this.state.m = [1, 0, 0, 1, 0, 0]; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const [A, B, C, D, E, F] = this.state.m;
    this.state.m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  }
  translate(x: number, y: number) { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(a: number) { const c = Math.cos(a), s = Math.sin(a); this.transform(c, s, -s, c, 0, 0); }
  getTransform() {
    const [a, b, c, d, e, f] = this.state.m;
    return { a, b, c, d, e, f, transformPoint: (p: { x: number; y: number }) => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f }) };
  }
  private tp(x: number, y: number): Point {
    const [a, b, c, d, e, f] = this.state.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }
  private get scaleFactor() { const [a, b, c, d] = this.state.m; return Math.sqrt(Math.abs(a * d - b * c)) || 1; }

  // --- paths ---------------------------------------------------------------
  beginPath() { this.path = []; }
  private current(): SubPath | undefined { return this.path[this.path.length - 1]; }
  moveTo(x: number, y: number) { if (Number.isFinite(x) && Number.isFinite(y)) this.path.push({ points: [this.tp(x, y)], closed: false }); }
  private lineToDevice(p: Point) {
    const sp = this.current();
    if (!sp || sp.closed) this.path.push({ points: [p], closed: false });
    else sp.points.push(p);
  }
  lineTo(x: number, y: number) { if (Number.isFinite(x) && Number.isFinite(y)) this.lineToDevice(this.tp(x, y)); }
  closePath() {
    const sp = this.current();
    if (!sp) return;
    sp.closed = true;
    this.path.push({ points: [sp.points[0]], closed: false });
  }
  private lastUser(): Point | null {
    const sp = this.current();
    if (!sp) return null;
    const [a, b, c, d, e, f] = this.state.m, det = a * d - b * c;
    if (!det) return null;
    const [X, Y] = sp.points[sp.points.length - 1];
    return [(d * (X - e) - c * (Y - f)) / det, (-b * (X - e) + a * (Y - f)) / det];
  }
  private segments(len: number) { return Math.max(2, Math.min(64, Math.ceil((len * this.scaleFactor) / 3))); }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const p0 = this.lastUser() ?? [c1x, c1y];
    if (!this.current()) this.moveTo(p0[0], p0[1]);
    const n = this.segments(Math.hypot(c1x - p0[0], c1y - p0[1]) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(x - c2x, y - c2y));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      this.lineTo(u * u * u * p0[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * p0[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y);
    }
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    const p0 = this.lastUser() ?? [cx, cy];
    if (!this.current()) this.moveTo(p0[0], p0[1]);
    const n = this.segments(Math.hypot(cx - p0[0], cy - p0[1]) + Math.hypot(x - cx, y - cy));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      this.lineTo(u * u * p0[0] + 2 * u * t * cx + t * t * x, u * u * p0[1] + 2 * u * t * cy + t * t * y);
    }
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw = false) {
    if (![x, y, rx, ry, rotation, start, end].every(Number.isFinite) || rx < 0 || ry < 0) return;
    let sweep = end - start;
    const full = Math.PI * 2;
    if (!ccw && sweep >= full) sweep = full;
    else if (ccw && -sweep >= full) sweep = -full;
    else if (!ccw) sweep = ((sweep % full) + full) % full;
    else sweep = -(((-sweep % full) + full) % full);
    const n = Math.max(4, Math.min(160, Math.ceil((Math.abs(sweep) / full) * Math.max(12, Math.max(rx, ry) * this.scaleFactor * 0.9))));
    const cr = Math.cos(rotation), sr = Math.sin(rotation);
    for (let i = 0; i <= n; i++) {
      const a = start + (sweep * i) / n, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
      const p = this.tp(x + ex * cr - ey * sr, y + ex * sr + ey * cr);
      this.lineToDevice(p);
    }
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false) { this.ellipse(x, y, r, r, 0, start, end, ccw); }
  rect(x: number, y: number, w: number, h: number) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0) {
    const r0 = Array.isArray(radii) ? radii[0] ?? 0 : radii;
    const r = Math.max(0, Math.min(Math.abs(w) / 2, Math.abs(h) / 2, typeof r0 === "number" ? r0 : 0));
    if (!r) return this.rect(x, y, w, h);
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.ellipse(x + w - r, y + r, r, r, 0, -Math.PI / 2, 0);
    this.lineTo(x + w, y + h - r);
    this.ellipse(x + w - r, y + h - r, r, r, 0, 0, Math.PI / 2);
    this.lineTo(x + r, y + h);
    this.ellipse(x + r, y + h - r, r, r, 0, Math.PI / 2, Math.PI);
    this.lineTo(x, y + r);
    this.ellipse(x + r, y + r, r, r, 0, Math.PI, Math.PI * 1.5);
    this.closePath();
  }
  clip() {}

  // --- painting ------------------------------------------------------------
  fill(rule: "nonzero" | "evenodd" = "nonzero") {
    const polys = this.path.filter((s) => s.points.length > 2).map((s) => s.points);
    this.raster(polys, this.state.fill, rule === "evenodd");
  }
  stroke() {
    const polys: Point[][] = [];
    const s = this.scaleFactor;
    const width = this.state.lineWidth * s;
    // Hairlines keep a minimum footprint and fade instead of disappearing.
    const w = Math.max(0.6, width), fade = Math.min(1, width / 0.6);
    for (const sp of this.path) {
      const pts = sp.closed ? [...sp.points, sp.points[0]] : sp.points;
      const pieces = this.state.dash.length && this.state.dash.some((d) => d > 0) ? dashed(pts, this.state.dash.map((d) => d * s), this.state.dashOffset * s) : [pts];
      for (const piece of pieces) strokePolyline(piece, w / 2, this.state.cap, this.state.join, sp.closed && pieces.length === 1, polys);
    }
    this.raster(polys, this.state.stroke, false, fade);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    if (![x, y, w, h].every(Number.isFinite)) return;
    const [a, b, c, d, e, f] = this.state.m;
    if (b === 0 && c === 0) {
      let x0 = a * x + e, x1 = a * (x + w) + e, y0 = d * y + f, y1 = d * (y + h) + f;
      if (x0 > x1) [x0, x1] = [x1, x0];
      if (y0 > y1) [y0, y1] = [y1, y0];
      return this.rectFast(x0, y0, x1, y1, this.state.fill);
    }
    const saved = this.path;
    this.path = [];
    this.rect(x, y, w, h);
    this.fill();
    this.path = saved;
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    const saved = this.path;
    this.path = [];
    this.rect(x, y, w, h);
    this.stroke();
    this.path = saved;
  }
  clearRect(x: number, y: number, w: number, h: number) {
    const [a, , , d, e, f] = this.state.m;
    const x0 = Math.max(0, Math.floor(a * x + e)), x1 = Math.min(this.width, Math.ceil(a * (x + w) + e));
    const y0 = Math.max(0, Math.floor(d * y + f)), y1 = Math.min(this.height, Math.ceil(d * (y + h) + f));
    for (let yy = y0; yy < y1; yy++) this.data.fill(0, (yy * this.width + x0) * 4, (yy * this.width + x1) * 4);
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number) { return new SoftGradient("linear", [x0, y0, x1, y1]); }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) { return new SoftGradient("radial", [x0, y0, r0, x1, y1, r1]); }
  measureText(text: string) { return { width: this.text ? this.text.measure(String(text), this.state.font) : String(text).length * 6 }; }
  fillText(text: string, x: number, y: number) { const p = this.text; if (p) { this.save(); p.draw(this, String(text), x, y, this.state.font, this.state.align, this.state.baseline, false); this.restore(); } }
  strokeText(text: string, x: number, y: number) { const p = this.text; if (p) { this.save(); p.draw(this, String(text), x, y, this.state.font, this.state.align, this.state.baseline, true); this.restore(); } }
  drawImage() {}

  /** Copies another canvas with nearest-neighbour scaling (retro low-resolution look). */
  blitNearest(src: SoftCanvas) {
    for (let y = 0; y < this.height; y++) {
      const sy = Math.min(src.height - 1, Math.floor((y * src.height) / this.height));
      for (let x = 0; x < this.width; x++) {
        const sx = Math.min(src.width - 1, Math.floor((x * src.width) / this.width));
        const si = (sy * src.width + sx) * 4, di = (y * this.width + x) * 4;
        this.data[di] = src.data[si]; this.data[di + 1] = src.data[si + 1]; this.data[di + 2] = src.data[si + 2]; this.data[di + 3] = src.data[si + 3];
      }
    }
  }

  // --- rasterization -------------------------------------------------------
  private paintAt(paint: Rgba | SoftGradient, cache: { lut?: Float32Array; m?: Matrix }) {
    if (!(paint instanceof SoftGradient)) return null;
    if (!cache.lut) { cache.lut = gradientLut(paint.stops.length ? paint.stops : [{ offset: 0, color: TRANSPARENT }]); cache.m = [...this.state.m] as Matrix; }
    const lut = cache.lut, m = cache.m!;
    const map = (x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    if (paint.type === "linear") {
      const [ax, ay] = map(paint.coords[0], paint.coords[1]), [bx, by] = map(paint.coords[2], paint.coords[3]);
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      return (px: number, py: number, out: Float32Array) => {
        const t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
        out[0] = lut[i]; out[1] = lut[i + 1]; out[2] = lut[i + 2]; out[3] = lut[i + 3];
      };
    }
    const [x0, y0] = map(paint.coords[0], paint.coords[1]), r0 = paint.coords[2] * s;
    const [x1, y1] = map(paint.coords[3], paint.coords[4]), r1 = paint.coords[5] * s;
    const cdx = x1 - x0, cdy = y1 - y0, dr = r1 - r0, a = cdx * cdx + cdy * cdy - dr * dr;
    return (px: number, py: number, out: Float32Array) => {
      const pdx = px - x0, pdy = py - y0;
      const b = pdx * cdx + pdy * cdy + r0 * dr, c = pdx * pdx + pdy * pdy - r0 * r0;
      let t: number;
      if (Math.abs(a) < 1e-9) t = b ? c / (2 * b) : 0;
      else {
        const disc = b * b - a * c;
        if (disc < 0) { out[0] = out[1] = out[2] = out[3] = 0; return; }
        const sq = Math.sqrt(disc), t1 = (b + sq) / a, t2 = (b - sq) / a;
        t = r0 + Math.max(t1, t2) * dr >= 0 ? Math.max(t1, t2) : Math.min(t1, t2);
        if (r0 + t * dr < 0) { out[0] = out[1] = out[2] = out[3] = 0; return; }
      }
      const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
      out[0] = lut[i]; out[1] = lut[i + 1]; out[2] = lut[i + 2]; out[3] = lut[i + 3];
    };
  }
  private blend(i: number, r: number, g: number, b: number, a: number) {
    // r,g,b premultiplied by a; destination straight alpha.
    if (a <= 0) return;
    const d = this.data, da = d[i + 3], keep = 1 - a, outA = a + da * keep;
    if (outA <= 0) return;
    d[i] = (r + d[i] * da * keep) / outA;
    d[i + 1] = (g + d[i + 1] * da * keep) / outA;
    d[i + 2] = (b + d[i + 2] * da * keep) / outA;
    d[i + 3] = outA;
  }
  private rectFast(x0: number, y0: number, x1: number, y1: number, paint: Rgba | SoftGradient) {
    this.tick();
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(this.width, x1); y1 = Math.min(this.height, y1);
    if (x1 <= x0 || y1 <= y0) return;
    const sample = this.paintAt(paint, {}), px = new Float32Array(4), alpha = this.state.alpha;
    const solid = paint instanceof SoftGradient ? null : paint;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const cy = Math.min(y + 1, y1) - Math.max(y, y0);
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const cov = cy * (Math.min(x + 1, x1) - Math.max(x, x0)) * alpha;
        if (cov <= 0) continue;
        if (solid) { const a = solid[3] * cov; this.blend((y * this.width + x) * 4, solid[0] * a, solid[1] * a, solid[2] * a, a); }
        else { sample!(x + 0.5, y + 0.5, px); this.blend((y * this.width + x) * 4, px[0] * cov, px[1] * cov, px[2] * cov, px[3] * cov); }
      }
    }
  }
  /** Scanline coverage rasterizer: 4 vertical sub-samples, exact horizontal span ends. */
  private raster(polys: Point[][], paint: Rgba | SoftGradient, evenOdd: boolean, fade = 1) {
    this.tick();
    const edges: number[] = []; // x0,y0,x1,y1,dir
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
        if (!Number.isFinite(ax + ay + bx + by)) return;
        minX = Math.min(minX, ax); maxX = Math.max(maxX, ax);
        if (ay === by) continue;
        if (ay < by) edges.push(ax, ay, bx, by, 1); else edges.push(bx, by, ax, ay, -1);
        minY = Math.min(minY, ay, by); maxY = Math.max(maxY, ay, by);
      }
    }
    if (!edges.length) return;
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(this.height, Math.ceil(maxY));
    const xLo = Math.max(0, Math.floor(minX)), xHi = Math.min(this.width, Math.ceil(maxX));
    if (y0 >= y1 || xLo >= xHi) return;
    const count = edges.length / 5;
    const order = Array.from({ length: count }, (_, i) => i).sort((p, q) => edges[p * 5 + 1] - edges[q * 5 + 1]);
    const sample = this.paintAt(paint, {}), px = new Float32Array(4);
    const solid = paint instanceof SoftGradient ? null : paint;
    const alpha = this.state.alpha * fade, cover = this.cover, SS = 4;
    let next = 0;
    let active: number[] = [];
    const xs: number[] = [], ws: number[] = [];
    for (let y = y0; y < y1; y++) {
      if ((y & 15) === 0) this.tick();
      let spanLo = Infinity, spanHi = -Infinity;
      for (let s = 0; s < SS; s++) {
        const sy = y + (s + 0.5) / SS;
        while (next < count && edges[order[next] * 5 + 1] <= sy) active.push(order[next++]);
        active = active.filter((e) => edges[e * 5 + 3] > sy);
        xs.length = 0; ws.length = 0;
        for (const e of active) {
          const o = e * 5, ey0 = edges[o + 1];
          if (ey0 > sy) continue;
          const t = (sy - ey0) / (edges[o + 3] - ey0);
          xs.push(edges[o] + (edges[o + 2] - edges[o]) * t);
          ws.push(edges[o + 4]);
        }
        if (xs.length < 2) continue;
        const idx = xs.map((_, i) => i).sort((p, q) => xs[p] - xs[q]);
        let wind = 0;
        for (let k = 0; k < idx.length - 1; k++) {
          wind += evenOdd ? 1 : ws[idx[k]];
          const inside = evenOdd ? wind % 2 !== 0 : wind !== 0;
          if (!inside) continue;
          const a = Math.max(xLo, xs[idx[k]]), b = Math.min(xHi, xs[idx[k + 1]]);
          if (b <= a) continue;
          const ia = Math.floor(a), ib = Math.floor(b);
          spanLo = Math.min(spanLo, ia); spanHi = Math.max(spanHi, ib);
          if (ia === ib) cover[ia] += (b - a) / SS;
          else {
            cover[ia] += (ia + 1 - a) / SS;
            for (let x = ia + 1; x < ib; x++) cover[x] += 1 / SS;
            if (ib < this.width) cover[ib] += (b - ib) / SS;
          }
        }
      }
      if (spanLo > spanHi) continue;
      const hi = Math.min(this.width - 1, spanHi);
      for (let x = spanLo; x <= hi; x++) {
        const c = Math.min(1, cover[x]) * alpha;
        cover[x] = 0;
        if (c <= 0.002) continue;
        const i = (y * this.width + x) * 4;
        if (solid) { const a = solid[3] * c; this.blend(i, solid[0] * a, solid[1] * a, solid[2] * a, a); }
        else { sample!(x + 0.5, y + 0.5, px); this.blend(i, px[0] * c, px[1] * c, px[2] * c, px[3] * c); }
      }
      if (spanHi + 1 < cover.length) cover[spanHi + 1] = 0;
    }
  }

  /** Opaque 8-bit RGB over a background colour. */
  toRgb(background: Rgba = [0, 0, 0, 1]): Uint8Array {
    const out = new Uint8Array(this.width * this.height * 3);
    for (let i = 0, j = 0; i < this.data.length; i += 4, j += 3) {
      const a = this.data[i + 3];
      out[j] = Math.round(this.data[i] * a + background[0] * (1 - a));
      out[j + 1] = Math.round(this.data[i + 1] * a + background[1] * (1 - a));
      out[j + 2] = Math.round(this.data[i + 2] * a + background[2] * (1 - a));
    }
    return out;
  }
}

function dashed(pts: Point[], dash: number[], offset: number): Point[][] {
  const total = dash.reduce((a, b) => a + b, 0);
  if (total <= 0.5) return [pts];
  const out: Point[][] = [];
  let k = 0, left = dash[0], on = true;
  let o = ((offset % total) + total) % total;
  while (o > 0) { if (o >= left) { o -= left; k = (k + 1) % dash.length; left = dash[k]; on = !on; } else { left -= o; o = 0; } }
  let cur: Point[] | null = on ? [pts[0]] : null;
  let pieces = 0;
  for (let i = 1; i < pts.length; i++) {
    let [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    let seg = Math.hypot(bx - ax, by - ay);
    while (seg > 0) {
      if (++pieces > 20000) return out;
      const step = Math.min(left, seg), t = step / seg;
      const nx = ax + (bx - ax) * t, ny = ay + (by - ay) * t;
      if (cur) cur.push([nx, ny]);
      ax = nx; ay = ny; seg -= step; left -= step;
      if (left <= 1e-9) {
        if (cur && cur.length > 1) out.push(cur);
        k = (k + 1) % dash.length; left = dash[k]; on = !on;
        cur = on ? [[ax, ay]] : null;
      }
    }
  }
  if (cur && cur.length > 1) out.push(cur);
  return out;
}

/** Converts one polyline into consistently oriented polygons whose nonzero union is the stroke. */
function strokePolyline(raw: Point[], hw: number, cap: string, join: string, closed: boolean, out: Point[][]) {
  const pts: Point[] = [];
  for (const p of raw) { const q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3) pts.push(p); }
  if (pts.length < 2) {
    if (pts.length === 1 && cap === "round") out.push(disc(pts[0][0], pts[0][1], hw));
    return;
  }
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    let [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
    if (cap === "square" && !closed) {
      if (i === 0) { ax -= ux * hw; ay -= uy * hw; }
      if (i === n - 2) { bx += ux * hw; by += uy * hw; }
    }
    const nx = -uy * hw, ny = ux * hw;
    out.push(oriented([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]));
  }
  const joints = closed ? n : n - 1;
  for (let i = 1; i < joints; i++) {
    const p = pts[i % n], a = pts[i - 1], b = pts[(i + 1) % n];
    if (!a || !b) continue;
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    if (!l1 || !l2) continue;
    const u1: Point = [(p[0] - a[0]) / l1, (p[1] - a[1]) / l1], u2: Point = [(b[0] - p[0]) / l2, (b[1] - p[1]) / l2];
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    if (Math.abs(cross) < 1e-4 && u1[0] * u2[0] + u1[1] * u2[1] > 0) continue;
    if (join === "round" && hw > 0.9) { out.push(disc(p[0], p[1], hw)); continue; }
    // Bevel on the outer side; miters extend it when the angle is gentle.
    const side = cross > 0 ? -1 : 1;
    const o1: Point = [p[0] - u1[1] * hw * side, p[1] + u1[0] * hw * side], o2: Point = [p[0] - u2[1] * hw * side, p[1] + u2[0] * hw * side];
    const tri: Point[] = [p, o1, o2];
    if (join === "miter") {
      const mx = o1[0] + o2[0] - 2 * p[0], my = o1[1] + o2[1] - 2 * p[1], ml = Math.hypot(mx, my);
      const cosHalf = Math.sqrt(Math.max(0, (1 + u1[0] * u2[0] + u1[1] * u2[1]) / 2));
      if (ml > 1e-6 && cosHalf > 0.1) {
        const d = hw / cosHalf;
        tri.splice(2, 0, [p[0] + (mx / ml) * d, p[1] + (my / ml) * d]);
      }
    }
    out.push(oriented(tri));
  }
  if (cap === "round" && !closed) {
    out.push(disc(pts[0][0], pts[0][1], hw));
    out.push(disc(pts[n - 1][0], pts[n - 1][1], hw));
  }
}
