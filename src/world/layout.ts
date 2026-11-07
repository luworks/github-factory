import type { StyleId, WorldNode } from "../contracts";
export interface MapPoint {
  x: number;
  y: number;
}
export interface PlacedNode extends MapPoint {
  node: WorldNode;
  width: number;
  height: number;
}
export const hash = (s: string) => {
  let n = 2166136261;
  for (let i = 0; i < s.length; i++) {
    n ^= s.charCodeAt(i);
    n = Math.imul(n, 16777619);
  }
  return n >>> 0;
};
export function hexSpiral(count: number): MapPoint[] {
  const points: MapPoint[] = [{ x: 0, y: 0 }];
  for (let radius = 1; points.length < count; radius++) {
    let q = -radius,
      r = radius;
    for (const [dq, dr] of [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ])
      for (let i = 0; i < radius; i++) {
        if (points.length < count) points.push({ x: q, y: r });
        q += dq;
        r += dr;
      }
  }
  return points.slice(0, count);
}
export function layoutWorld(nodes: WorldNode[], style: StyleId): PlacedNode[] {
  const sorted = [...nodes].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const n = sorted.length,
    cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.5))),
    rows = Math.ceil(n / cols);
  const hex = hexSpiral(n + 1).slice(1);
  return sorted.map((node, i) => {
    let x = 0,
      y = 0;
    if (style === "moonshot") {
      const ring = i < 6 ? 0 : i < 18 ? 1 : 2;
      const start = ring === 0 ? 0 : ring === 1 ? 6 : 18;
      const items = Math.min(ring === 0 ? 6 : ring === 1 ? 12 : 18, n - start);
      const k = i - start;
      const a = (k / items) * Math.PI * 2 - 0.8;
      const radius = 230 + ring * 235;
      x = Math.cos(a) * radius;
      y = Math.sin(a) * radius * 0.65;
    } else if (style === "civilization") {
      x = (hex[i].x + hex[i].y * 0.5) * 166.28;
      y = hex[i].y * 108;
    } else if (style === "red-alert-2") {
      const c = (i % cols) - (cols - 1) / 2,
        r = Math.floor(i / cols) - (rows - 1) / 2;
      x = (c - r) * 137;
      y = (c + r) * 82;
    } else {
      x = ((i % cols) - (cols - 1) / 2) * 200;
      y = (Math.floor(i / cols) - (rows - 1) / 2) * 175;
      if (style === "red-alert" && i % 2) y += 22;
    }
    return { node, x, y, width: 132, height: 105 };
  });
}
export function mapBounds(nodes: PlacedNode[]) {
  if (!nodes.length) return { x: -500, y: -330, width: 1000, height: 660 };
  const xs = nodes.map((n) => n.x),
    ys = nodes.map((n) => n.y);
  const x = Math.min(-130, ...xs) - 130,
    y = Math.min(-130, ...ys) - 155;
  return { x, y, width: Math.max(130, ...xs) - x + 140, height: Math.max(130, ...ys) - y + 140 };
}
export function pickNode(nodes: PlacedNode[], x: number, y: number): string | null {
  return (
    [...nodes].sort((a, b) => b.y - a.y).find((p) => Math.abs(p.x - x) < p.width * 0.65 && y < p.y + 25 && y > p.y - p.height - 5)?.node
      .id ?? null
  );
}
export interface LabelRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Where labels may go: the visible canvas minus HTML chrome drawn over it. */
export interface LabelView {
  width: number;
  height: number;
  /** Screen rectangles covered by overlays (heading, controls, style switcher). */
  blocked?: LabelRect[];
  /** Share of the canvas area that label plates may cover (priority culling). */
  coverage?: number;
  /** Minimum clear space between plates. */
  gap?: number;
}
const overlaps = (a: LabelRect, b: LabelRect, gap: number) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
/** Keep the selected/hovered label first; zooming progressively reveals the rest.
 * With a view, labels must also sit fully on screen, avoid overlays and fit an
 * area budget, so small screens show fewer, more important names. Priority
 * labels (selected/hovered) are never culled by the budget or overlays. */
export function declutterLabels(labels: LabelRect[], priority: (string | null)[], view?: LabelView): LabelRect[] {
  const rank = (id: string) => {
    const i = priority.indexOf(id);
    return i < 0 ? priority.length : i;
  };
  const gap = view?.gap ?? 4;
  const budget = view ? view.width * view.height * (view.coverage ?? 1) : Infinity;
  let used = 0;
  const accepted: LabelRect[] = [];
  for (const label of labels.toSorted((a, b) => rank(a.id) - rank(b.id))) {
    const important = rank(label.id) < priority.length;
    if (view && !important) {
      const margin = 4;
      if (label.x < margin || label.y < margin || label.x + label.width > view.width - margin || label.y + label.height > view.height - margin) continue;
      if (view.blocked?.some((r) => overlaps(label, r, 2))) continue;
      if (used + label.width * label.height > budget) continue;
    }
    if (accepted.some((r) => overlaps(label, r, gap))) continue;
    accepted.push(label);
    used += label.width * label.height;
  }
  return accepted;
}
