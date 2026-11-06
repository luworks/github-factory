import type { StyleId } from "../contracts";
import { hash, mapBounds, type PlacedNode } from "./layout";
import { block, cylinder, dome, ellipse, line, panel, poly, tree, type Pen } from "./primitives";
const clearOfNodes = (nodes: PlacedNode[], x: number, y: number, r = 105) =>
  !nodes.some((n) => Math.abs(n.x - x) < r && Math.abs(n.y - y + 25) < r * 0.8);
export function terrain(g: Pen, style: StyleId, nodes: PlacedNode[], seed: string, ground: string) {
  const lunar = style === "moonshot",
    civ = style === "civilization",
    factory = style === "factorio",
    allied = style === "red-alert-2";
  const b = mapBounds(nodes),
    cx = b.x + b.width / 2,
    cy = b.y + b.height / 2;
  g.fillStyle = ground;
  g.fillRect(-1800, -1300, 3600, 2600);
  const light = g.createRadialGradient(cx - 160, cy - 200, 60, cx, cy, Math.max(b.width, b.height));
  light.addColorStop(0, lunar ? "#303030" : civ ? "#e7d7a666" : factory ? "#a1946944" : "#9eaf7155");
  light.addColorStop(1, "#162a2b00");
  g.fillStyle = light;
  g.fillRect(-1800, -1300, 3600, 2600);
  // Seeded granular ground is cached once, rather than regenerated every frame.
  for (let i = 0; i < 6500; i++) {
    const z = hash(seed + ":grain:" + i),
      x = (z % 3200) - 1600,
      y = (hash(seed + ":gy:" + i) % 2200) - 1100;
    g.fillStyle = i % 3 === 0 ? (lunar ? "#ffffff14" : "#e4dfaa14") : lunar ? "#00000028" : "#283c2920";
    g.fillRect(x, y, 1 + (z % 4), 1 + (z % 2));
  }
  if (civ) {
    // Pointy-top hexes share the exact axial geometry used by the node layout.
    for (let r = -10; r <= 10; r++)
      for (let q = -12; q <= 12; q++) {
        const x = (q + r * 0.5) * 166.28,
          y = r * 108,
          z = hash(`${seed}:${q}:${r}`) % 17;
        if (Math.abs(x) > 1550) continue;
        const occupied = !clearOfNodes(nodes, x, y, 90);
        const fill = occupied ? "#b5b67c" : z < 3 ? "#709fa6" : z < 6 ? "#9ba775" : z > 13 ? "#c8bc95" : "#b1b47d";
        poly(
          g,
          Array.from({ length: 6 }, (_, i) => {
            const a = ((i * 60 - 30) * Math.PI) / 180;
            return [x + Math.cos(a) * 96, y + Math.sin(a) * 72];
          }),
          fill,
          "#7e895d70",
        );
        // Parchment scratches and contour marks sit above the tile fill.
        for (let j = 0; j < 20; j++) {
          const h = hash(`${seed}:${q}:${r}:h:${j}`),
            xx = x + (h % 120) - 60,
            yy = y + (h % 69) - 34;
          g.fillStyle = j % 2 ? "#f0e2ad20" : "#56644616";
          g.fillRect(xx, yy, 2 + (h % 5), 1);
        }
        if (z < 3) {
          line(
            g,
            [
              [x - 66, y - 13],
              [x - 68, y],
              [x - 60, y + 14],
            ],
            "#cbd4ae77",
            2,
          );
        }
        if (!occupied && z >= 6 && z < 10) for (let j = 0; j < 4; j++) tree(g, x - 30 + j * 17, y + 8 - (j % 2) * 13, 0.7, false);
        if (!occupied && z > 13) {
          poly(
            g,
            [
              [x - 38, y + 12],
              [x - 6, y - 39],
              [x + 25, y + 12],
            ],
            "#888c78",
          );
          poly(
            g,
            [
              [x - 6, y - 39],
              [x + 25, y + 12],
              [x + 39, y + 7],
            ],
            "#ada78c",
          );
          poly(
            g,
            [
              [x - 18, y - 21],
              [x - 6, y - 39],
              [x + 5, y - 21],
              [x - 3, y - 26],
            ],
            "#e4dcc0",
          );
        }
        if (z < 3)
          for (let j = 0; j < 3; j++)
            line(
              g,
              [
                [x - 23 + j * 10, y - 8 + j * 9],
                [x + 11 + j * 10, y - 8 + j * 9],
              ],
              "#c4d6bc77",
            );
        if (!occupied && z === 11)
          for (let j = 0; j < 6; j++)
            line(
              g,
              [
                [x - 34, y - 14 + j * 6],
                [x + 34, y + 2 + j * 6],
              ],
              "#d0b46a",
              3,
            );
      }
  } else {
    // A meandering frontier / ore seam gives the map a geographic silhouette.
    if (!lunar) {
      g.beginPath();
      g.moveTo(cx - b.width * 0.8, cy + b.height * 0.58);
      g.bezierCurveTo(
        cx - b.width * 0.4,
        cy - b.height * 0.2,
        cx + b.width * 0.35,
        cy + b.height * 0.8,
        cx + b.width * 0.8,
        cy - b.height * 0.1,
      );
      g.strokeStyle = factory ? "#352f29" : "#a5ae7977";
      g.lineWidth = factory ? 49 : 67;
      g.stroke();
      g.strokeStyle = factory ? "#75684b" : "#446e76";
      g.lineWidth = factory ? 35 : 49;
      g.stroke();
      g.strokeStyle = factory ? "#a68c5066" : "#91c2b244";
      g.lineWidth = 3;
      g.stroke();
    }
    for (let i = 0; i < 600; i++) {
      const z = hash(seed + ":scenery:" + i),
        x = (z % 2900) - 1450,
        y = (hash(seed + ":scenery-y:" + i) % 1900) - 950;
      if (!clearOfNodes(nodes, x, y, 115)) continue;
      if (lunar) {
        const r = 5 + (z % 32);
        ellipse(g, x + 3, y + 3, r, r * 0.45, "#171717", "#73737388");
        ellipse(g, x, y - 1, r * 0.8, r * 0.3, "#262626");
        if (z % 4 === 0)
          line(
            g,
            [
              [x - r * 0.6, y - 4],
              [x, y - r * 0.3],
              [x + r * 0.5, y - 3],
            ],
            "#a5bbc133",
            1,
          );
        if (z % 3 === 0)
          for (let j = 0; j < 3; j++)
            poly(
              g,
              [
                [x + r + j * 7, y + 4],
                [x + r + 4 + j * 7, y - 3 - (j % 2) * 4],
                [x + r + 10 + j * 7, y + 3],
              ],
              "#72848b66",
              "#1a2e4233",
            );
      } else if (factory) {
        const ore = z % 4 === 0;
        poly(
          g,
          [
            [x - 8, y],
            [x - 3, y - 7 - (z % 6)],
            [x + 6, y - 5],
            [x + 12, y + 2],
            [x + 2, y + 6],
          ],
          ore ? "#a07844" : "#687365",
          "#303d3533",
        );
        if (ore) {
          g.fillStyle = "#d4b76b";
          g.fillRect(x - 1, y - 4, 3, 2);
        }
        if (z % 9 === 0) tree(g, x, y, 0.6, true);
      } else tree(g, x, y, 0.65 + (z % 5) * 0.08, !allied);
    }
  }
  if (lunar) {
    // The central landing site is scenery, deliberately separate from source nodes.
    ellipse(g, 12, 14, 124, 57, "#15253866");
    ellipse(g, 0, 0, 104, 49, "#566b7b", "#99afb06b");
    ellipse(g, 0, -4, 92, 43, "#344d60", "#a1b7ad");
    g.setLineDash([12, 9]);
    g.beginPath();
    g.ellipse(0, -4, 78, 36, 0, 0, Math.PI * 2);
    g.strokeStyle = "#c3c8aa";
    g.lineWidth = 3;
    g.stroke();
    g.setLineDash([]);
    line(
      g,
      [
        [-27, -9],
        [24, -9],
      ],
      "#e3b781",
      5,
    );
    line(
      g,
      [
        [-20, -19],
        [-20, 11],
      ],
      "#e3b781",
      5,
    );
    line(
      g,
      [
        [20, -19],
        [20, 11],
      ],
      "#e3b781",
      5,
    );
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ellipse(g, Math.cos(a) * 99, Math.sin(a) * 45 - 4, 3, 2, "#addad0");
    }
    for (let i = 0; i < 3; i++) panel(g, -132 + i * 33, -80, 26);
    cylinder(g, 92, -70, 11, 22, "#779398", "#c4d3c8");
    dome(g, 92, -92, 11, "#abd7dc");
    for (const n of nodes) {
      const a = Math.atan2(n.y / 0.65, n.x),
        r = Math.hypot(n.x, n.y / 0.65);
      g.beginPath();
      g.ellipse(0, 0, r, r * 0.65, 0, a - 0.2, a + 0.2);
      g.strokeStyle = "#9fb8b52b";
      g.lineWidth = 14;
      g.stroke();
    }
  } else if (factory) {
    // A fixed rail corridor and power poles make a factory, without implying live traffic.
    const ry = b.y + b.height - 73;
    for (let x = b.x - 200; x < b.x + b.width + 200; x += 14)
      line(
        g,
        [
          [x, ry - 6],
          [x, ry + 13],
        ],
        "#3d4035",
        5,
      );
    for (const dy of [0, 8])
      line(
        g,
        [
          [b.x - 200, ry + dy],
          [b.x + b.width + 200, ry + dy],
        ],
        "#a4a394",
        2,
      );
    for (let x = b.x + 20; x < b.x + b.width; x += 200) {
      line(
        g,
        [
          [x, ry - 20],
          [x, ry - 100],
        ],
        "#86764f",
        4,
      );
      line(
        g,
        [
          [x - 13, ry - 82],
          [x + 13, ry - 82],
        ],
        "#c2ae7e",
        3,
      );
      g.beginPath();
      g.moveTo(x, ry - 84);
      g.quadraticCurveTo(x + 100, ry - 54, x + 200, ry - 84);
      g.strokeStyle = "#272e2d";
      g.lineWidth = 1;
      g.stroke();
    }
  } else if (!civ) {
    const yy = b.y + b.height - 64;
    for (let x = b.x + 30; x < b.x + b.width - 25; x += 24) {
      block(g, x, yy, 22, 10, allied ? 12 : 7, allied ? "#afbaa4" : "#b0a47b", allied ? "#7f9786" : "#898568", "#566e5c");
    }
    for (const x of [b.x + 30, b.x + b.width - 50]) {
      block(g, x, yy, 35, 25, allied ? 42 : 25, "#bbc5aa", "#8b9f86", "#536c62");
      if (allied) dome(g, x, yy - 43, 15, "#95bcc3");
    }
  }
}
/** Scenery anchors for live FX (water shimmer, rail, landing pad). Mirrors terrain() geometry exactly. */
export interface SceneryAnchors {
  river: { from: [number, number]; c1: [number, number]; c2: [number, number]; to: [number, number]; width: number } | null;
  lakes: { x: number; y: number }[];
  rail: { y: number; x0: number; x1: number } | null;
  pad: { x: number; y: number } | null;
  bounds: { x: number; y: number; width: number; height: number };
}
export function sceneryAnchors(style: StyleId, nodes: PlacedNode[], seed: string): SceneryAnchors {
  const b = mapBounds(nodes),
    cx = b.x + b.width / 2,
    cy = b.y + b.height / 2;
  const lakes: { x: number; y: number }[] = [];
  if (style === "civilization")
    for (let r = -10; r <= 10; r++)
      for (let q = -12; q <= 12; q++) {
        const x = (q + r * 0.5) * 166.28,
          y = r * 108;
        if (Math.abs(x) > 1550) continue;
        if (hash(`${seed}:${q}:${r}`) % 17 < 3 && clearOfNodes(nodes, x, y, 90)) lakes.push({ x, y });
      }
  const riverStyle = style === "red-alert" || style === "red-alert-2";
  return {
    river: riverStyle
      ? {
          from: [cx - b.width * 0.8, cy + b.height * 0.58],
          c1: [cx - b.width * 0.4, cy - b.height * 0.2],
          c2: [cx + b.width * 0.35, cy + b.height * 0.8],
          to: [cx + b.width * 0.8, cy - b.height * 0.1],
          width: 49,
        }
      : null,
    lakes,
    rail: style === "factorio" ? { y: b.y + b.height - 73, x0: b.x - 200, x1: b.x + b.width + 200 } : null,
    pad: style === "moonshot" ? { x: 0, y: -4 } : null,
    bounds: b,
  };
}
