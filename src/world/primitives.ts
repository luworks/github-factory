/** Original vector game art. Coordinates are map units, never repository telemetry. */
export type Pen = CanvasRenderingContext2D;
export function poly(g: Pen, points: number[][], fill: string, stroke?: string) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 1;
    g.stroke();
  }
}
export function ellipse(g: Pen, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 1;
    g.stroke();
  }
}
export function line(g: Pen, points: number[][], color: string, width = 1) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}
export function block(g: Pen, x: number, y: number, w: number, d: number, h: number, roof: string, left: string, right: string) {
  poly(
    g,
    [
      [x - w / 2, y],
      [x, y + d / 2],
      [x, y + d / 2 - h],
      [x - w / 2, y - h],
    ],
    left,
    "#16262755",
  );
  poly(
    g,
    [
      [x, y + d / 2],
      [x + w / 2, y],
      [x + w / 2, y - h],
      [x, y + d / 2 - h],
    ],
    right,
    "#16262755",
  );
  poly(
    g,
    [
      [x - w / 2, y - h],
      [x, y - d / 2 - h],
      [x + w / 2, y - h],
      [x, y + d / 2 - h],
    ],
    roof,
    "#e9f0d933",
  );
}
export function cylinder(g: Pen, x: number, y: number, r: number, h: number, wall: string, roof: string) {
  const shade = g.createLinearGradient(x - r, 0, x + r, 0);
  shade.addColorStop(0, wall);
  shade.addColorStop(0.45, roof);
  shade.addColorStop(1, wall);
  g.fillStyle = shade;
  g.fillRect(x - r, y - h, r * 2, h);
  ellipse(g, x, y, r, r * 0.43, wall);
  ellipse(g, x, y - h, r, r * 0.43, roof, "#e3e7ce66");
  line(
    g,
    [
      [x - r, y - h],
      [x - r, y],
      [x + r, y],
      [x + r, y - h],
    ],
    "#16252755",
  );
}
export function dome(g: Pen, x: number, y: number, r: number, color: string) {
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.6, 1, x, y, r);
  grad.addColorStop(0, "#f0f8e4");
  grad.addColorStop(0.3, color);
  grad.addColorStop(1, "#3e747c");
  g.beginPath();
  g.ellipse(x, y, r, r * 0.8, 0, Math.PI, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  ellipse(g, x, y, r, r * 0.3, "#527b7c", "#c0e3d3");
  line(
    g,
    [
      [x, y - r * 0.8],
      [x, y],
    ],
    "#d7efe6aa",
    1.5,
  );
  g.beginPath();
  g.ellipse(x, y, r * 0.52, r * 0.8, 0, Math.PI, Math.PI * 2);
  g.strokeStyle = "#d7efe68a";
  g.stroke();
}
export function tree(g: Pen, x: number, y: number, s: number, pine = true) {
  ellipse(g, x + 3 * s, y + 3 * s, 10 * s, 4 * s, "#122b2533");
  g.fillStyle = "#5e5d3d";
  g.fillRect(x - 1.5 * s, y - 10 * s, 3 * s, 12 * s);
  if (pine)
    for (let i = 0; i < 3; i++)
      poly(
        g,
        [
          [x - (11 - i * 2) * s, y - i * 7 * s],
          [x, y - (23 + i * 5) * s],
          [x + (11 - i * 2) * s, y - i * 7 * s],
        ],
        i % 2 ? "#315849" : "#456f4e",
      );
  else {
    ellipse(g, x, y - 15 * s, 11 * s, 10 * s, "#4c7653");
    ellipse(g, x - 3 * s, y - 19 * s, 8 * s, 7 * s, "#76915b");
  }
}
export function gear(g: Pen, x: number, y: number, r: number, color: string, rotation = 0) {
  g.save();
  g.translate(x, y);
  g.scale(1, 0.65);
  g.rotate(rotation);
  poly(
    g,
    Array.from({ length: 32 }, (_, i) => {
      const a = (i * Math.PI) / 16;
      const z = i % 4 < 2 ? r : r * 0.78;
      return [Math.cos(a) * z, Math.sin(a) * z];
    }),
    color,
    "#253332",
  );
  ellipse(g, 0, 0, r * 0.5, r * 0.5, "#354347", "#9eafa0");
  ellipse(g, 0, 0, r * 0.16, r * 0.16, "#d1b77a");
  g.restore();
}
export function panel(g: Pen, x: number, y: number, w = 33) {
  poly(
    g,
    [
      [x, y],
      [x + w, y - 10],
      [x + w + 9, y + 5],
      [x + 9, y + 15],
    ],
    "#294e66",
    "#97afb0",
  );
  for (let i = 1; i < 4; i++)
    line(
      g,
      [
        [x + (i * w) / 4, y - i * 2.5],
        [x + 9 + (i * w) / 4, y + 15 - i * 2.5],
      ],
      "#6f9aa3",
    );
  line(
    g,
    [
      [x + 4, y + 7],
      [x + w + 4, y - 3],
    ],
    "#6f9aa3",
  );
  line(
    g,
    [
      [x + w / 2 + 5, y + 11],
      [x + w / 2 + 5, y + 21],
    ],
    "#87958f",
    2,
  );
}
export function flag(g: Pen, x: number, y: number, color: string) {
  line(
    g,
    [
      [x, y + 29],
      [x, y - 15],
    ],
    "#d1d3b4",
    2,
  );
  poly(
    g,
    [
      [x, y - 15],
      [x + 20, y - 10],
      [x + 17, y],
      [x, y - 3],
    ],
    color,
    "#1b303533",
  );
}
