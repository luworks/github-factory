import type { StyleId, WorldEdge } from "../contracts";
import { declutterLabels, type PlacedNode } from "./layout";
import { drawArchitecture } from "./art";
import { ellipse, line, type Pen } from "./primitives";
import { terrain } from "./terrain";
export interface Palette {
  sky: string;
  ground: string;
  grid: string;
  edge: string;
  wall: string;
  roof: string;
  trim: string;
  text: string;
  muted: string;
  glow: string;
}
/** Shared neutral map chrome; matches the --geist-map-* CSS tokens. */
export const MAP_CONTRAST = {
  bg: "#202020", surface: "#171717", text: "#fafafa", muted: "#a1a1a1",
  border: "#737373", focus: "#52a8ff", labelPlate: "#171717", labelText: "#fafafa",
  labelSelectedPlate: "#ffffff", labelSelectedText: "#171717", labelSelectedBorder: "#0068d6", edge: "#d4d4d4",
} as const;
export const PALETTES: Record<StyleId, Palette> = {
  moonshot: {
    sky: "#111111",
    ground: "#202020",
    grid: "#525252",
    edge: "#d4d4d4",
    wall: "#b2c8bf",
    roof: "#e0e4d2",
    trim: "#efb17c",
    text: "#fafafa",
    muted: "#a1a1a1",
    glow: "#b9e9e2",
  },
  factorio: {
    sky: "#272c26",
    ground: "#575a43",
    grid: "#717259",
    edge: "#ab965b",
    wall: "#6e7d6a",
    roof: "#abb394",
    trim: "#e6b65a",
    text: "#fff0cd",
    muted: "#c3bd97",
    glow: "#e5bd63",
  },
  "red-alert": {
    sky: "#293b2c",
    ground: "#60764c",
    grid: "#77865b",
    edge: "#b1ab7c",
    wall: "#9ea687",
    roof: "#cac8a9",
    trim: "#df7b5f",
    text: "#f1f0cf",
    muted: "#c2c6a5",
    glow: "#d9cf92",
  },
  "red-alert-2": {
    sky: "#2c504b",
    ground: "#6d9470",
    grid: "#8fa981",
    edge: "#d2cc9e",
    wall: "#9db8b8",
    roof: "#e0e5cf",
    trim: "#79c9e9",
    text: "#f9f5d7",
    muted: "#d1dbc4",
    glow: "#b2e8eb",
  },
  civilization: {
    sky: "#c0ba95",
    ground: "#b4b981",
    grid: "#8d9562",
    edge: "#877e54",
    wall: "#c1a477",
    roof: "#e7d2a1",
    trim: "#a86445",
    text: "#fcf2d2",
    muted: "#d5c79f",
    glow: "#f1d28a",
  },
};
export function paintTerrain(g: Pen, style: StyleId, nodes: PlacedNode[], seed: string) {
  terrain(g, style, nodes, seed, PALETTES[style].ground);
}
function connectionPath(g: Pen, a: PlacedNode, b: PlacedNode, style: StyleId) {
  g.beginPath();
  g.moveTo(a.x, a.y + 9);
  if (style === "factorio" || style === "red-alert") {
    g.lineTo(b.x, a.y + 9);
    g.lineTo(b.x, b.y + 9);
  } else {
    const mx = (a.x + b.x) / 2;
    g.bezierCurveTo(mx, a.y + 9, mx, b.y + 9, b.x, b.y + 9);
  }
}
export function paintConnections(g: Pen, nodes: PlacedNode[], edges: WorldEdge[], style: StyleId, _t: number, _animate: boolean) {
  const byId = new Map(nodes.map((n) => [n.node.id, n]));
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const e of edges) {
    const a = byId.get(e.source),
      b = byId.get(e.target);
    if (!a || !b) continue;
    connectionPath(g, a, b, style);
    g.strokeStyle = MAP_CONTRAST.surface;
    g.lineWidth = style === "factorio" ? 13 : style === "civilization" ? 9 : 11;
    g.globalAlpha = 1;
    g.stroke();
    if (e.confidence === "inferred") g.setLineDash([5, 7]);
    g.strokeStyle = MAP_CONTRAST.edge;
    g.lineWidth = style === "factorio" ? 8 : style === "civilization" ? 3 : 7;
    g.globalAlpha = 1;
    g.stroke();
    g.setLineDash(e.confidence === "inferred" ? [5, 7] : style === "factorio" ? [2, 7] : [8, 12]);
    g.lineWidth = 1;
    g.strokeStyle = style === "factorio" ? "#d3a84f" : "#e5e3bf";
    g.globalAlpha = 1;
    g.stroke();
    g.setLineDash([]);
  }
  g.restore();
}
const STATUS = { healthy: "#a9ce94", active: "#92cdd9", attention: "#f2ad6f", unknown: "#b0b6ac" };
/** `liveLight` = the world canvas draws directional shadows itself (fx.ts). */
export function paintBuilding(g: Pen, pn: PlacedNode, style: StyleId, selected: boolean, hover: boolean, t: number, liveLight = false) {
  const p = PALETTES[style];
  g.save();
  g.translate(pn.x, pn.y);
  if (!liveLight) ellipse(g, 17, 14, 69, 25, "#10252745");
  if (selected || hover) {
    const transform = g.getTransform();
    const pixelRatio = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const screenScale = Math.max(0.01, Math.hypot(transform.a, transform.b) / pixelRatio);
    const outlineWidth = Math.max(selected ? 3 : 2, 2 / screenScale);
    ellipse(g, 0, 4, 79, 35, selected ? `${p.trim}28` : "#f4f6df18");
    g.beginPath();
    g.ellipse(0, 4, 79, 35, 0, 0, Math.PI * 2);
    g.strokeStyle = MAP_CONTRAST.surface;
    g.lineWidth = outlineWidth + Math.max(3, 4 / screenScale);
    g.stroke();
    g.strokeStyle = selected ? MAP_CONTRAST.focus : MAP_CONTRAST.text;
    g.lineWidth = outlineWidth;
    g.stroke();
    for (const x of [-77, 77])
      line(
        g,
        [
          [x, 4],
          [x, 14],
          [x - Math.sign(x) * 11, 19],
        ],
        selected ? MAP_CONTRAST.focus : MAP_CONTRAST.text,
        2,
      );
  }
  drawArchitecture(g, pn.node.kind, style, t);
  // The sole status lamp is grounded in the snapshot. Neutral means unknown.
  ellipse(g, -51, 18, 5, 3.5, "#223837");
  ellipse(g, -51, 17, 3, 2.5, STATUS[pn.node.status]);
  g.restore();
}
/** Labels are painted last in screen space, so roofs and vignette never obscure them. */
function labelMetrics(g: Pen, pn: PlacedNode, selected: boolean, _scale: number) {
  const maxWidth = selected ? 260 : 180;
  g.font = `${selected ? 600 : 500} 13px "IBM Plex Mono",ui-monospace,SFMono-Regular,Consolas,monospace`;
  let label = pn.node.label;
  if (g.measureText(label).width > maxWidth) {
    while (label.length > 1 && g.measureText(label + "…").width > maxWidth) label = label.slice(0, -1);
    label += "…";
  }
  return { label, width: g.measureText(label).width + 16 };
}
export function paintLabel(g: Pen, pn: PlacedNode, style: StyleId, selected: boolean, x: number, y: number, scale: number) {
  g.save();
  const { label, width } = labelMetrics(g, pn, selected, scale);
  g.fillStyle = selected ? MAP_CONTRAST.labelSelectedPlate : MAP_CONTRAST.labelPlate;
  g.beginPath();
  g.roundRect(x - width / 2, y, width, 28, 3);
  g.fill();
  g.strokeStyle = selected ? MAP_CONTRAST.labelSelectedBorder : MAP_CONTRAST.border;
  g.lineWidth = selected ? 2 : 1;
  g.stroke();
  g.fillStyle = selected ? MAP_CONTRAST.labelSelectedText : MAP_CONTRAST.labelText;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, x, y + 14);
  g.restore();
}
export function paintLabels(
  g: Pen,
  nodes: PlacedNode[],
  style: StyleId,
  selectedId: string | null,
  hoverId: string | null,
  camera: {
    x: number;
    y: number;
    k: number;
  },
) {
  const { x, y, k } = camera;
  const labels = nodes.map((p) => {
    const { width } = labelMetrics(g, p, p.node.id === selectedId, k);
    return { id: p.node.id, x: p.x * k + x - width / 2, y: (p.y + 34) * k + y, width, height: 28 };
  });
  const visible = new Set(declutterLabels(labels, [selectedId, hoverId]).map((r) => r.id));
  for (const p of nodes) if (visible.has(p.node.id)) paintLabel(g, p, style, p.node.id === selectedId, p.x * k + x, (p.y + 34) * k + y, k);
}
