import type { NodeKind, StyleId } from "../contracts";
import { block, cylinder, dome, ellipse, flag, gear, line, panel, poly, type Pen } from "./primitives";
function windows(g: Pen, x: number, y: number, n: number, color: string) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = "#263e48";
    g.fillRect(x + i * 10, y, 6, 8);
    g.fillStyle = color;
    g.fillRect(x + i * 10, y + 5, 6, 2);
  }
}
function dish(g: Pen, x: number, y: number, color: string) {
  line(
    g,
    [
      [x, y + 24],
      [x, y],
    ],
    "#b6c4bd",
    3,
  );
  poly(
    g,
    [
      [x - 19, y - 9],
      [x - 10, y + 9],
      [x + 9, y + 14],
      [x + 22, y - 1],
    ],
    color,
    "#dce5d7",
  );
  line(
    g,
    [
      [x + 3, y + 6],
      [x + 10, y - 15],
    ],
    "#dde6ce",
    2,
  );
  ellipse(g, x + 10, y - 15, 2, 2, "#f0ac6c");
}
function arch(g: Pen, x: number, y: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.fillRect(x - w / 2, y - h * 0.6, w, h * 0.6);
  g.beginPath();
  g.ellipse(x, y - h * 0.6, w / 2, h * 0.4, 0, Math.PI, Math.PI * 2);
  g.fill();
}
function hangar(g: Pen, x: number, y: number, military: boolean) {
  poly(
    g,
    [
      [x - 42, y],
      [x - 42, y - 25],
      [x - 25, y - 43],
      [x + 26, y - 43],
      [x + 45, y - 25],
      [x + 45, y],
    ],
    military ? "#8f987b" : "#91a8ad",
    "#263c3b",
  );
  poly(
    g,
    [
      [x + 45, y],
      [x + 58, y - 17],
      [x + 58, y - 42],
      [x + 26, y - 43],
      [x + 45, y - 25],
    ],
    military ? "#626e57" : "#597e8b",
  );
  arch(g, x, y, 60, 33, "#2b4246");
  for (let j = 0; j < 5; j++)
    line(
      g,
      [
        [x - 27, y - j * 5],
        [x + 27, y - j * 5],
      ],
      "#74877d",
      1,
    );
  g.fillStyle = military ? "#db7554" : "#76c9e0";
  g.fillRect(x - 32, y - 34, 64, 4);
}
function airlock(g: Pen, x: number, y: number) {
  cylinder(g, x, y, 5, 16, "#6d9295", "#d0ddcb");
  line(
    g,
    [
      [x - 5, y - 8],
      [x + 5, y - 8],
    ],
    "#efb06c",
    2,
  );
}
function lunar(g: Pen, k: NodeKind, t: number) {
  // A pressurized colony: each source kind has its own architectural silhouette.
  ellipse(g, 0, 8, 65, 27, "#1b2b38");
  ellipse(g, 0, 3, 63, 26, "#61777e", "#9eb5b2");
  ellipse(g, 0, 0, 57, 22, "#93a6a3");
  for (let i = -2; i <= 2; i++)
    line(
      g,
      [
        [i * 20 - 20, 7],
        [i * 20 + 4, -4],
      ],
      "#617b7b",
      1,
    );
  if (k === "app") {
    cylinder(g, -5, -3, 35, 24, "#9caeac", "#e0e4d3");
    dome(g, -5, -27, 35, "#9cd7d9");
    block(g, 32, 2, 30, 20, 18, "#e5debf", "#99aaa4", "#6b8384");
    windows(g, 22, -10, 2, "#f2ba6c");
  }
  if (k === "service") {
    block(g, -9, 0, 77, 39, 38, "#d8e0cd", "#a5b7ae", "#5b7d83");
    cylinder(g, -20, -38, 13, 21, "#758f90", "#c6d9ce");
    dish(g, 20, -65, "#9fc9c7");
    windows(g, -31, -20, 4, "#efb06d");
  }
  if (k === "data") {
    for (let i = 0; i < 3; i++) {
      cylinder(g, -30 + i * 28, (-i % 2) * 5, 12, 52 + (i % 2) * 10, "#5d828b", "#c0d3c8");
      ellipse(g, -30 + i * 28, -28 - (i % 2) * 5, 12, 5, "#e2b16a");
    }
    line(
      g,
      [
        [-44, 8],
        [-44, 17],
        [39, 17],
        [39, -10],
      ],
      "#a4c8be",
      4,
    );
  }
  if (k === "package") {
    for (let i = 0; i < 3; i++) {
      block(g, -29 + i * 27, 7 - i * 8, 35, 24, 26, "#dce0c7", "#a7b4a5", "#647f7e");
      line(
        g,
        [
          [-40 + i * 27, -17 - i * 8],
          [-17 + i * 27, -17 - i * 8],
        ],
        "#e4aa68",
        3,
      );
    }
    panel(g, -40, -50, 40);
  }
  if (k === "infra") {
    block(g, -20, 4, 43, 29, 22, "#d2d7bd", "#9eafa4", "#65827f");
    panel(g, 7, -19, 38);
    panel(g, 7, -47, 38);
    line(
      g,
      [
        [-20, -15],
        [-20, -77],
      ],
      "#a9c3b9",
      3,
    );
    ellipse(g, -20, -79, 5, 5, "#eeb67a");
    for (let i = 0; i < 3; i++)
      line(
        g,
        [
          [-33, -49 - i * 10],
          [-7, -49 - i * 10],
        ],
        "#b2c8bd",
      );
  }
  if (k === "docs") {
    block(g, -7, 0, 76, 38, 32, "#e2e5d1", "#a7b8ad", "#607f85");
    dome(g, -9, -33, 24, "#b8dac9");
    windows(g, -30, -17, 5, "#a5dcd3");
    block(g, 37, 7, 18, 16, 17, "#f0b576", "#9b9f8b", "#6b817e");
  }
  if (k === "test") {
    cylinder(g, -12, 0, 26, 31, "#89a6aa", "#dce4d4");
    dome(g, -12, -31, 25, "#a5d5bb");
    block(g, 30, 7, 28, 22, 29, "#dbdbc1", "#a4b2a3", "#668382");
    for (let i = 0; i < 3; i++) ellipse(g, 26, -16 + i * 7, 2, 2, "#bce0ca");
  }
  if (k === "tool") {
    hangar(g, -5, 2, false);
    line(
      g,
      [
        [24, 6],
        [40, 12],
        [44, 1],
      ],
      "#d7a365",
      5,
    );
    gear(g, -25, -52, 12, "#c3d6c6");
  }
  if (k === "external") {
    block(g, -15, 4, 50, 29, 22, "#b8c8bc", "#94a89f", "#557780");
    dish(g, 9, -52, "#c5d9ce");
    panel(g, -48, -43, 27);
  }
  airlock(g, -47, 4);
  line(
    g,
    [
      [-37, 11],
      [-22, 16],
      [-11, 12],
    ],
    "#cfddc2",
    2,
  );
  for (let i = 0; i < 3; i++) {
    g.fillStyle = "#d7dac2";
    g.fillRect(36 + i * 5, 9 - i * 2, 3, 2);
  }
  // Architectural illumination, not an activity signal.
  for (const x of [-48, 48]) ellipse(g, x, 6, 2, 2, "#c2e6dd");
  if (t > 0) {
    g.globalAlpha = 0.12 + 0.03 * Math.sin(t * 0.7);
    ellipse(g, 0, -3, 54, 18, "#a6e2df");
    g.globalAlpha = 1;
  }
}
function industrial(g: Pen, k: NodeKind, t: number) {
  block(g, 0, 8, 133, 67, 6, "#59604f", "#333c35", "#263331");
  for (let i = -3; i <= 3; i++)
    line(
      g,
      [
        [i * 16 - 5, 19],
        [i * 16 + 4, 14],
      ],
      "#ddb04f",
      4,
    );
  if (k === "data" || k === "external") {
    for (let i = 0; i < 3; i++) {
      cylinder(g, -32 + i * 29, (-i % 2) * 8, 13, k === "data" ? 62 : 39, "#646e61", "#a9b3a1");
      ellipse(g, -32 + i * 29, -21, 13, 5, "#9c8152");
    }
    line(
      g,
      [
        [-45, 8],
        [-45, 22],
        [44, 22],
        [44, -34],
      ],
      "#c6a66b",
      6,
    );
    line(
      g,
      [
        [-45, 8],
        [-45, 22],
        [44, 22],
        [44, -34],
      ],
      "#8a8970",
      2,
    );
  } else if (k === "infra") {
    for (let i = 0; i < 3; i++) {
      block(g, -31 + i * 29, 3 - (i % 2) * 10, 23, 30, 28, "#8c9a86", "#606e62", "#3a4a47");
      gear(g, -31 + i * 29, -33 - (i % 2) * 10, 11, "#d7ae5a");
    }
    line(
      g,
      [
        [0, -15],
        [0, -90],
      ],
      "#776747",
      4,
    );
    line(
      g,
      [
        [-24, -75],
        [24, -75],
        [-18, -57],
        [18, -57],
      ],
      "#aaa079",
      2,
    );
  } else if (k === "docs" || k === "package") {
    for (let i = 0; i < 3; i++) {
      block(g, -30 + i * 29, 1 - (i % 2) * 10, 32, 28, 34, "#b19a66", "#8c7854", "#5c6048");
      line(
        g,
        [
          [-40 + i * 29, -19 - (i % 2) * 10],
          [-18 + i * 29, -19 - (i % 2) * 10],
        ],
        "#d6bd79",
        2,
      );
    }
    block(g, -8, -13, 37, 25, 42, "#849384", "#53695e", "#3c514c");
  } else {
    block(g, -9, 4, 83, 46, 41, "#a0a78d", "#7e8873", "#465950");
    block(g, -11, -38, 61, 29, 13, "#667c74", "#465e58", "#2e4543");
    gear(g, -13, -56, 21, "#c49b56", k === "tool" ? 0 : 0.25);
    gear(g, 18, -48, 12, "#b3b995");
    windows(g, -34, -23, 4, "#eec169");
    if (k === "service" || k === "app") {
      cylinder(g, 39, -2, 9, 77, "#655f51", "#a99c7d");
      g.fillStyle = "#b38552";
      g.fillRect(30, -68, 18, 7);
      for (let i = 0; i < 4; i++) {
        g.globalAlpha = 0.12 - i * 0.025;
        ellipse(g, 41 + Math.sin(t * 0.4 + i) * 6 + i * 3, -91 - i * 13, 10 + i * 4, 7 + i * 3, "#c5b994");
      }
      g.globalAlpha = 1;
    }
    if (k === "test") {
      cylinder(g, 36, 2, 12, 43, "#68816d", "#a8bc9b");
      ellipse(g, 36, -42, 7, 3, "#dfbc64");
    }
  }
  // Fixed inserter arms and output crates are scenery, not throughput telemetry.
  line(
    g,
    [
      [48, 8],
      [51, -13],
      [37, -23],
    ],
    "#292f28",
    7,
  );
  line(
    g,
    [
      [48, 8],
      [51, -13],
      [37, -23],
    ],
    "#d2ab55",
    4,
  );
  gear(g, 51, -13, 5, "#d4c18a");
  line(
    g,
    [
      [32, -24],
      [37, -23],
      [35, -18],
    ],
    "#d7bd70",
    2,
  );
  block(g, -39, 7, 14, 12, 10, "#c6a267", "#947851", "#645d45");
  // Local pipes, rivets and disconnected storage are decorative industrial scenery.
  for (let i = 0; i < 3; i++) {
    g.fillStyle = "#bdc3a3";
    g.fillRect(-54 + i * 9, 6, 3, 3);
  }
  line(
    g,
    [
      [-54, -5],
      [-54, -24],
      [-35, -24],
    ],
    "#cba85d",
    4,
  );
}
function military(g: Pen, k: NodeKind, allied: boolean) {
  const roof = allied ? "#d8e0ce" : "#b6b697",
    wall = allied ? "#a5bfc0" : "#8a9673",
    side = allied ? "#587d8b" : "#5c6b53",
    accent = allied ? "#6fbfe4" : "#bf6050";
  if (allied) block(g, 0, 8, 137, 70, 5, "#9aa995", "#6c8379", "#4a6e68");
  else {
    g.fillStyle = "#82866b";
    g.fillRect(-63, -20, 126, 44);
    g.strokeStyle = "#b3b093";
    g.lineWidth = 2;
    g.strokeRect(-63, -20, 126, 44);
    for (let i = -2; i <= 2; i++)
      line(
        g,
        [
          [i * 23, -20],
          [i * 23, 23],
        ],
        "#666d56",
      );
  }
  if (k === "app" || k === "tool") {
    hangar(g, -8, 1, !allied);
    if (allied) {
      block(g, 38, -16, 24, 24, 53, roof, wall, side);
      flag(g, 38, -75, accent);
    } else {
      for (let i = 0; i < 3; i++)
        line(
          g,
          [
            [-41 + i * 19, -12],
            [-41 + i * 19, -30],
          ],
          "#d4c9a1",
          2,
        );
    }
  }
  if (k === "service") {
    block(g, -12, 1, 76, 43, 44, roof, wall, side);
    block(g, 15, -22, 40, 28, 43, roof, wall, side);
    windows(g, -36, -25, 4, accent);
    dish(g, 20, -77, allied ? "#c4dde0" : "#b3bba0");
  }
  if (k === "data") {
    for (let i = 0; i < 3; i++) {
      cylinder(g, -30 + i * 28, (-i % 2) * 10, 12, 48 + (i % 2) * 9, side, roof);
      line(
        g,
        [
          [-42 + i * 28, -27 - (i % 2) * 10],
          [-18 + i * 28, -27 - (i % 2) * 10],
        ],
        accent,
        4,
      );
    }
    line(
      g,
      [
        [-44, 10],
        [42, 10],
      ],
      "#b1b89c",
      3,
    );
  }
  if (k === "infra") {
    for (let i = 0; i < 2; i++) {
      block(g, -26 + i * 47, 1, 38, 32, 32, roof, wall, side);
      cylinder(g, -26 + i * 47, -30, 13, 25, side, roof);
      poly(
        g,
        [
          [-36 + i * 47, -55],
          [-26 + i * 47, -69],
          [-16 + i * 47, -55],
        ],
        accent,
      );
    }
  }
  if (k === "docs") {
    block(g, 0, 1, 95, 49, 37, roof, wall, side);
    poly(
      g,
      [
        [-49, -37],
        [0, -68],
        [49, -37],
        [0, -16],
      ],
      allied ? "#789cad" : "#737d5f",
      "#d0d2b4",
    );
    windows(g, -39, -17, 7, accent);
  }
  if (k === "package") {
    for (let i = 0; i < 3; i++) {
      block(g, -30 + i * 29, 7 - (i % 2) * 15, 34, 27, 25, roof, wall, side);
      line(
        g,
        [
          [-41 + i * 29, -12 - (i % 2) * 15],
          [-19 + i * 29, -12 - (i % 2) * 15],
        ],
        accent,
        3,
      );
    }
    block(g, -16, -11, 39, 27, 23, roof, wall, side);
  }
  if (k === "test") {
    block(g, -8, 1, 81, 44, 35, roof, wall, side);
    cylinder(g, -15, -35, 22, 9, side, roof);
    dome(g, -15, -44, 22, allied ? "#a9d9df" : "#c2c4a5");
    block(g, 35, 0, 23, 24, 54, roof, wall, side);
    windows(g, 27, -38, 2, accent);
  }
  if (k === "external") {
    block(g, -12, 2, 64, 36, 29, roof, wall, side);
    dish(g, 10, -51, allied ? "#c7e1e0" : "#c4c9aa");
    line(
      g,
      [
        [-38, 2],
        [-38, -60],
      ],
      "#c8c6a2",
      2,
    );
    line(
      g,
      [
        [-49, -49],
        [-27, -49],
      ],
      accent,
      3,
    );
  }
  if (k === "service" || k === "docs") {
    for (let i = 0; i < 3; i++) {
      line(
        g,
        [
          [6 + i * 9, -14 - i * 4],
          [6 + i * 9, -4 - i * 4],
        ],
        "#dce0bc77",
      );
    }
  }
  if (allied) {
    block(g, -47, 6, 17, 13, 13, "#d1d8bd", "#a0b3a2", "#547a7d");
    line(
      g,
      [
        [-51, -4],
        [-43, -4],
      ],
      accent,
      2,
    );
  }
  if (!allied) {
    for (let i = 0; i < 3; i++) {
      ellipse(g, 43 - i * 10, 15 + (i % 2) * 4, 7, 3, "#c3b28a", "#7b7d5e");
    }
    flag(g, 52, -45, accent);
  } else {
    for (let i = 0; i < 3; i++)
      line(
        g,
        [
          [34 + i * 5, 15 - i * 2],
          [42 + i * 5, 19 - i * 2],
        ],
        "#dde3c5",
        2,
      );
  }
}
function civilization(g: Pen, k: NodeKind) {
  ellipse(g, 0, 5, 63, 26, "#7c885a55");
  const stone = "#ddc99b",
    wall = "#bda06f",
    side = "#8d7753",
    roof = "#a75d42";
  if (k === "app" || k === "service") {
    block(g, -6, 2, 79, 45, 30, stone, wall, side);
    for (const x of [-35, 27]) {
      block(g, x, -5, 22, 23, 58, stone, wall, side);
      poly(
        g,
        [
          [x - 16, -63],
          [x, -83],
          [x + 16, -63],
          [x, -55],
        ],
        roof,
        "#775441",
      );
    }
    block(g, -6, -18, 34, 27, 48, stone, wall, side);
    poly(
      g,
      [
        [-28, -66],
        [-6, -88],
        [17, -66],
        [-6, -53],
      ],
      roof,
    );
    arch(g, -6, 12, 15, 27, "#635b43");
    for (const x of [-35, 27]) {
      arch(g, x, -23, 6, 12, "#6a654e");
      arch(g, x, -43, 5, 10, "#6a654e");
    }
    line(
      g,
      [
        [-40, -6],
        [-15, 5],
      ],
      "#e2c793",
      2,
    );
    flag(g, -6, -89, "#d0a44e");
  } else if (k === "docs" || k === "test") {
    block(g, 0, 6, 99, 52, 8, stone, wall, side);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = stone;
      g.fillRect(-34 + i * 17, -39, 7, 40);
      g.fillStyle = "#f4dfb4";
      g.fillRect(-36 + i * 17, -42, 11, 5);
    }
    poly(
      g,
      [
        [-51, -44],
        [0, -80],
        [51, -44],
        [0, -24],
      ],
      k === "docs" ? roof : "#708f88",
      "#6f6048",
    );
    poly(
      g,
      [
        [-47, -45],
        [0, -68],
        [45, -45],
        [0, -33],
      ],
      "#d3b883",
    );
    for (let i = 0; i < 3; i++)
      line(
        g,
        [
          [-38 - i * 4, 12 + i * 4],
          [35 + i * 4, 12 + i * 4],
        ],
        "#e5d2a1",
        3,
      );
  } else if (k === "data") {
    for (let i = 0; i < 3; i++) {
      cylinder(g, -29 + i * 28, 3 - (i % 2) * 7, 12, 42, wall, stone);
      poly(
        g,
        [
          [-44 + i * 28, -39 - (i % 2) * 7],
          [-29 + i * 28, -62 - (i % 2) * 7],
          [-14 + i * 28, -39 - (i % 2) * 7],
        ],
        roof,
      );
    }
    for (let i = 0; i < 3; i++) ellipse(g, -43 + i * 14, 17, 8, 5, "#ceac61", "#9c8049");
  } else if (k === "infra") {
    block(g, -8, 0, 55, 36, 40, stone, wall, side);
    poly(
      g,
      [
        [-40, -41],
        [-8, -69],
        [24, -41],
      ],
      roof,
    );
    line(
      g,
      [
        [-8, -45],
        [-8, -95],
      ],
      "#594c38",
      3,
    );
    for (let i = 0; i < 4; i++) {
      g.save();
      g.translate(-8, -68);
      g.rotate((i * Math.PI) / 2 + 0.35);
      poly(
        g,
        [
          [0, 0],
          [6, -5],
          [31, -4],
          [28, 5],
          [9, 6],
        ],
        "#e4d8af",
        "#8d7952",
      );
      g.restore();
    }
  } else if (k === "package") {
    for (let i = 0; i < 3; i++) {
      block(g, -31 + i * 30, 5 - (i % 2) * 18, 32, 28, 29, stone, wall, side);
      poly(
        g,
        [
          [-50 + i * 30, -24 - (i % 2) * 18],
          [-31 + i * 30, -45 - (i % 2) * 18],
          [-12 + i * 30, -24 - (i % 2) * 18],
        ],
        roof,
      );
      arch(g, -31 + i * 30, 10 - (i % 2) * 18, 9, 17, "#776447");
    }
  } else if (k === "tool") {
    block(g, -8, 2, 70, 41, 27, stone, wall, side);
    poly(
      g,
      [
        [-48, -29],
        [-8, -54],
        [32, -29],
      ],
      roof,
    );
    gear(g, 32, -18, 23, "#a28251");
    cylinder(g, -34, -27, 7, 34, "#8b7a59", "#b1a17c");
  } else if (k === "external") {
    block(g, 0, 2, 42, 34, 65, stone, wall, side);
    arch(g, 0, 16, 15, 31, "#6e6148");
    for (let i = 0; i < 3; i++) block(g, -15 + i * 15, -64, 10, 11, 12, stone, wall, side);
    flag(g, 1, -79, "#668f9b");
  }
  // Gardens and wall stones give the settlements a human scale.
  for (let i = 0; i < 3; i++) {
    line(
      g,
      [
        [29 + i * 6, 11],
        [42 + i * 6, 16],
      ],
      "#c8b77c",
      2,
    );
  }
  for (let i = 0; i < 3; i++) {
    g.fillStyle = "#9ea575";
    g.fillRect(-51 + i * 9, 17, 5, 3);
  }
}
export function drawArchitecture(g: Pen, kind: NodeKind, style: StyleId, t: number) {
  if (style === "moonshot") lunar(g, kind, t);
  else if (style === "factorio") industrial(g, kind, t);
  else if (style === "civilization") civilization(g, kind);
  else military(g, kind, style === "red-alert-2");
}
