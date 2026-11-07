import type { SoftCanvas, TextEngine } from "./raster";

/** Original monoline geometric stroke font for server-rendered previews.
 * Units: cap height 10, x-height 7, baseline y = 0, y grows downward.
 * Commands: M x y | L x y | A cx cy rx ry fromDeg toDeg (toDeg < fromDeg = anticlockwise). */
const G: Record<string, [number, string]> = {
  " ": [3.4, ""],
  A: [7.4, "M0 0 L3.7 -10 L7.4 0 M1.3 -3.4 L6.1 -3.4"],
  B: [6.6, "M0 0 L0 -10 L3.5 -10 A3.5 -7.6 2.4 2.4 -90 90 L0 -5.2 M3.5 -5.2 L3.9 -5.2 A3.9 -2.6 2.6 2.6 -90 90 L0 0"],
  C: [7.6, "A4.6 -5 4.4 5 -40 -320"],
  D: [7.2, "M0 0 L0 -10 L2.4 -10 A2.4 -5 4.8 5 -90 90 L0 0"],
  E: [6, "M6 -10 L0 -10 L0 0 L6 0 M0 -5.1 L5 -5.1"],
  F: [5.8, "M5.8 -10 L0 -10 L0 0 M0 -5.1 L4.9 -5.1"],
  G: [8, "M5.2 -4.6 L8.8 -4.6 L8.8 -2.6 M8.8 -4.6 A4.4 -5 4.4 5 0 -320"],
  H: [7, "M0 0 L0 -10 M7 0 L7 -10 M0 -5.1 L7 -5.1"],
  I: [0, "M0 0 L0 -10"],
  J: [5, "M5 -10 L5 -2.6 A2.5 -2.6 2.5 2.6 0 180"],
  K: [6.6, "M0 0 L0 -10 M6.4 -10 L0 -3.8 M2.3 -6 L6.6 0"],
  L: [5.6, "M0 -10 L0 0 L5.6 0"],
  M: [8.6, "M0 0 L0 -10 L4.3 -2.6 L8.6 -10 L8.6 0"],
  N: [7.2, "M0 0 L0 -10 L7.2 0 L7.2 -10"],
  O: [9.2, "A4.6 -5 4.6 5 0 360"],
  P: [6.4, "M0 0 L0 -10 L3.6 -10 A3.6 -7.3 2.7 2.7 -90 90 L0 -4.6"],
  Q: [9.2, "A4.6 -5 4.6 5 0 360 M5.8 -2.6 L9 0.6"],
  R: [6.6, "M0 0 L0 -10 L3.6 -10 A3.6 -7.3 2.7 2.7 -90 90 L0 -4.6 M3.4 -4.6 L6.6 0"],
  S: [6.6, "A3.3 -7.5 3 2.5 -25 -270 A3.3 -2.5 3.3 2.5 -90 155"],
  T: [7, "M0 -10 L7 -10 M3.5 -10 L3.5 0"],
  U: [6.8, "M0 -10 L0 -3.4 A3.4 -3.4 3.4 3.4 180 0 L6.8 -10"],
  V: [7.4, "M0 -10 L3.7 0 L7.4 -10"],
  W: [10, "M0 -10 L2.5 0 L5 -7.8 L7.5 0 L10 -10"],
  X: [7, "M0 -10 L7 0 M7 -10 L0 0"],
  Y: [7, "M0 -10 L3.5 -4.8 L7 -10 M3.5 -4.8 L3.5 0"],
  Z: [6.6, "M0 -10 L6.6 -10 L0 0 L6.6 0"],
  a: [6.6, "M6.6 -3.5 A3.3 -3.5 3.3 3.5 0 360 M6.6 -7 L6.6 0"],
  b: [6.6, "M0 -10.4 L0 0 M6.6 -3.5 A3.3 -3.5 3.3 3.5 0 360"],
  c: [6, "A3.4 -3.5 3.3 3.5 -40 -320"],
  d: [6.6, "M6.6 -10.4 L6.6 0 M6.6 -3.5 A3.3 -3.5 3.3 3.5 0 360"],
  e: [6.6, "M0.1 -3.6 L6.6 -3.6 A3.3 -3.5 3.3 3.5 0 -315"],
  f: [4.6, "M5.2 -9.6 A3.4 -8.4 1.9 1.9 -40 -180 L1.5 0 M0 -6.8 L4.4 -6.8"],
  g: [6.6, "M6.6 -3.5 A3.3 -3.5 3.3 3.5 0 360 M6.6 -7 L6.6 0.4 A3.3 0.4 3.3 2.8 0 150"],
  h: [6.4, "M0 -10.4 L0 0 M0 -3.8 A3.2 -3.8 3.2 3.2 180 360 L6.4 0"],
  i: [0, "M0 -7 L0 0 M0 -9.7 L0 -9.65"],
  j: [2, "M2 -7 L2 1.2 A0.2 1.2 1.8 1.9 0 160 M2 -9.7 L2 -9.65"],
  k: [5.8, "M0 -10.4 L0 0 M5.6 -7 L0 -2.6 M2 -4.2 L5.8 0"],
  l: [0, "M0 -10.4 L0 0"],
  m: [10, "M0 -7 L0 0 M0 -4.2 A2.5 -4.2 2.5 2.8 180 360 L5 0 M5 -4.2 A7.5 -4.2 2.5 2.8 180 360 L10 0"],
  n: [6.4, "M0 -7 L0 0 M0 -3.8 A3.2 -3.8 3.2 3.2 180 360 L6.4 0"],
  o: [7, "A3.5 -3.5 3.5 3.5 0 360"],
  p: [6.6, "M0 -7 L0 3.2 M6.6 -3.5 A3.3 -3.5 3.3 3.5 0 360"],
  q: [6.6, "M6.6 -7 L6.6 3.2 M6.6 -3.5 A3.3 -3.5 3.3 3.5 0 360"],
  r: [4.4, "M0 -7 L0 0 M0 -3.6 A3.4 -3.6 3.4 3.4 180 285"],
  s: [5.6, "A2.8 -5.25 2.6 1.75 -25 -270 A2.8 -1.75 2.8 1.75 -90 155"],
  t: [4.6, "M1.6 -9.2 L1.6 -1.8 A3.4 -1.8 1.8 1.8 180 90 L4.6 0 M0 -7 L4.4 -7"],
  u: [6.4, "M0 -7 L0 -3.2 A3.2 -3.2 3.2 3.2 180 0 M6.4 -7 L6.4 0"],
  v: [6.2, "M0 -7 L3.1 0 L6.2 -7"],
  w: [9, "M0 -7 L2.25 0 L4.5 -5.4 L6.75 0 L9 -7"],
  x: [5.8, "M0 -7 L5.8 0 M5.8 -7 L0 0"],
  y: [6.2, "M0 -7 L3.1 0 M6.2 -7 L2.3 2.4 L1.5 3.2 L0.3 3.2"],
  z: [5.8, "M0 -7 L5.8 -7 L0 0 L5.8 0"],
  "0": [6.6, "A3.3 -5 3.3 5 0 360"],
  "1": [3.4, "M0 -7.8 L2.8 -10 L2.8 0"],
  "2": [6.2, "A3.1 -7.1 3 2.9 -165 35 L0 0 L6.4 0"],
  "3": [6.2, "A3.1 -7.6 2.8 2.4 -160 90 A3.1 -2.6 3.2 2.6 -90 155"],
  "4": [6.8, "M5.2 0 L5.2 -10 L0 -3 L6.8 -3"],
  "5": [6.2, "M5.8 -10 L1.1 -10 L0.6 -5.6 A3.1 -3.1 3.1 3.1 -125 150"],
  "6": [6.4, "A3.2 -3.2 3.2 3.2 0 360 M0.3 -4.4 L4.6 -10"],
  "7": [6.2, "M0 -10 L6.2 -10 L2 0"],
  "8": [6.4, "M5.7 -7.5 A3.2 -7.5 2.5 2.5 0 360 M6.4 -2.55 A3.2 -2.55 3.2 2.55 0 360"],
  "9": [6.4, "A3.2 -6.8 3.2 3.2 0 360 M6.1 -5.6 L1.8 0"],
  ".": [0, "M0 0 L0 -0.05"],
  ",": [0.6, "M0.6 -0.3 L-0.2 2"],
  ":": [0, "M0 0 L0 -0.05 M0 -6 L0 -6.05"],
  ";": [0.6, "M0.6 -0.3 L-0.2 2 M0.6 -6 L0.6 -6.05"],
  "-": [3.8, "M0 -3.9 L3.8 -3.9"],
  _: [6, "M0 1.6 L6 1.6"],
  "/": [5, "M0 1 L5 -10.6"],
  "\\": [5, "M0 -10.6 L5 1"],
  "'": [0, "M0 -10 L0 -7.4"],
  '"': [2.4, "M0 -10 L0 -7.4 M2.4 -10 L2.4 -7.4"],
  "`": [1.6, "M0 -10.4 L1.6 -8.6"],
  "!": [0, "M0 -10 L0 -3.2 M0 0 L0 -0.05"],
  "?": [5.6, "A2.8 -7.4 2.8 2.6 -170 70 L2.8 -3 M2.8 0 L2.8 -0.05"],
  "(": [2.6, "A3.4 -3.8 3.4 7.2 -110 -250"],
  ")": [2.6, "A-0.8 -3.8 3.4 7.2 -70 70"],
  "[": [2.6, "M2.6 -10.6 L0 -10.6 L0 2.2 L2.6 2.2"],
  "]": [2.6, "M0 -10.6 L2.6 -10.6 L2.6 2.2 L0 2.2"],
  "{": [3.2, "M3.2 -10.6 L1.8 -10.6 L1.6 -4.6 L0 -4.2 L1.6 -3.8 L1.8 2.2 L3.2 2.2"],
  "}": [3.2, "M0 -10.6 L1.4 -10.6 L1.6 -4.6 L3.2 -4.2 L1.6 -3.8 L1.4 2.2 L0 2.2"],
  "<": [5.4, "M5.4 -8.2 L0 -4.2 L5.4 -0.2"],
  ">": [5.4, "M0 -8.2 L5.4 -4.2 L0 -0.2"],
  "=": [5.6, "M0 -5.6 L5.6 -5.6 M0 -2.6 L5.6 -2.6"],
  "+": [5.8, "M0 -4.1 L5.8 -4.1 M2.9 -7 L2.9 -1.2"],
  "*": [5, "M2.5 -10 L2.5 -5 M0.2 -8.8 L4.8 -6.2 M4.8 -8.8 L0.2 -6.2"],
  "#": [7, "M2.4 -10 L1.4 0 M5.6 -10 L4.6 0 M0.4 -6.6 L7 -6.6 M0 -3.2 L6.6 -3.2"],
  "%": [8, "A1.9 -7.8 1.9 2.1 0 360 M8 -2.1 A6.1 -2.1 1.9 2.1 0 360 M7.2 -10 L0.8 0"],
  "&": [7.4, "M7.4 0 L1.6 -6.6 A3.3 -8.1 1.9 1.9 -150 30 L0.8 -3.6 A3.3 -2.5 2.7 2.5 -150 30 L7 -4"],
  "@": [10, "M6.6 -3.4 A5 -4.4 1.8 2.1 0 360 M6.6 -6.4 L6.6 -2.8 A8 -2.8 1.4 1.4 180 90 A5 -4.4 5 5.4 20 340"],
  $: [6.2, "A3.1 -6.9 2.8 2 -25 -270 A3.1 -2.9 3.1 2 -90 155 M3.1 -10.6 L3.1 0.6"],
  "^": [5, "M0 -6.6 L2.5 -10 L5 -6.6"],
  "~": [6, "M0 -3.6 L1.5 -4.8 L4.5 -3.2 L6 -4.4"],
  "|": [0, "M0 -10.6 L0 2.2"],
  "·": [0, "M0 -4 L0 -4.05"],
  "…": [8, "M0 0 L0 -0.05 M4 0 L4 -0.05 M8 0 L8 -0.05"],
  "★": [9, "M4.5 -10.4 L5.7 -6.9 L9.2 -6.9 L6.4 -4.7 L7.5 -1 L4.5 -3.2 L1.5 -1 L2.6 -4.7 L-0.2 -6.9 L3.3 -6.9 L4.5 -10.4"],
  "•": [0, "M0 -4 L0 -4.05"],
};
type Cmd = ["M" | "L", number, number] | ["A", number, number, number, number, number, number];
const parsed = new Map<string, { w: number; cmds: Cmd[] }>();
function glyph(ch: string) {
  const hit = parsed.get(ch);
  if (hit) return hit;
  const def = G[ch];
  if (!def) return null;
  const tokens = def[1].split(/\s+/).filter(Boolean);
  const cmds: Cmd[] = [];
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i];
    if (t[0] === "A") {
      const v = [t.slice(1), ...tokens.slice(i + 1, i + 6)].map(Number);
      cmds.push(["A", v[0], v[1], v[2], v[3], v[4], v[5]]);
      i += 6;
    } else {
      cmds.push([t[0] as "M" | "L", Number(t.slice(1)), Number(tokens[i + 1])]);
      i += 2;
    }
  }
  const out = { w: def[0], cmds };
  parsed.set(ch, out);
  return out;
}

/** Normalises arbitrary text to drawable glyphs; untrusted input never reaches a font engine. */
export function drawableText(input: string, max = 120): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  let out = "";
  for (const ch of cleaned) {
    if (out.length >= max) break;
    out += G[ch] ? ch : "?";
  }
  return out.replace(/\?{2,}/g, "?");
}
export function asciiShare(input: string) {
  const chars = [...input.replace(/\s/g, "")];
  return chars.length ? chars.filter((c) => G[c] && c !== "?").length / chars.length : 1;
}

export function parseFont(font: string) {
  const size = Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10);
  const w = font.match(/\b([1-9]00)\b/)?.[1];
  const weight = w ? Number(w) : /\bbold\b/.test(font) ? 700 : 400;
  const spacing = Number(font.match(/\bspacing=(-?\d+(?:\.\d+)?)/)?.[1] ?? 0);
  return { size: Math.max(1, Math.min(400, size)), weight, spacing };
}
const strokeUnits = (weight: number) => 0.9 + ((Math.max(100, Math.min(900, weight)) - 100) / 800) * 1.6;

function layout(text: string, font: string) {
  const { size, weight, spacing } = parseFont(font);
  const unit = (size * 0.7) / 10, stroke = strokeUnits(weight);
  const gap = 1.1 + stroke * 0.7 + spacing;
  let x = 0;
  const placed: { g: { w: number; cmds: Cmd[] }; x: number }[] = [];
  for (const ch of text) {
    const g = glyph(ch) ?? glyph("?")!;
    placed.push({ g, x: x + stroke / 2 });
    x += g.w + gap + (ch === " " ? 0 : stroke);
  }
  return { placed, width: Math.max(0, x - gap) * unit, unit, stroke };
}

export const strokeFont: TextEngine = {
  measure: (text, font) => layout(drawableText(text, 400), font).width,
  draw(g: SoftCanvas, text: string, x: number, y: number, font: string, align: string, baseline: string, outline: boolean) {
    const { placed, width, unit, stroke } = layout(drawableText(text, 400), font);
    const ox = align === "center" ? x - width / 2 : align === "right" || align === "end" ? x - width : x;
    const oy = baseline === "middle" ? y + 5 * unit : baseline === "top" || baseline === "hanging" ? y + 10.6 * unit : baseline === "bottom" ? y - 3 * unit : y;
    if (!outline) g.strokeStyle = g.fillStyle;
    g.lineWidth = outline ? g.lineWidth : stroke * unit;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.setLineDash([]);
    for (const { g: gl, x: gx } of placed) {
      g.beginPath();
      const px = (v: number) => ox + (gx + v) * unit, py = (v: number) => oy + v * unit;
      for (const c of gl.cmds) {
        if (c[0] === "M") g.moveTo(px(c[1]), py(c[2]));
        else if (c[0] === "L") g.lineTo(px(c[1]), py(c[2]));
        else {
          const [, cx, cy, rx = 0, ry = 0, from = 0, to = 0] = c;
          g.ellipse(px(cx), py(cy), rx * unit, ry * unit, 0, (from * Math.PI) / 180, (to * Math.PI) / 180, to < from);
        }
      }
      g.stroke();
    }
  },
};
