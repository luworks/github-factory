import { describe, expect, test } from "bun:test";
import { STYLE_IDS, type WorldNode } from "../src/contracts";
import { declutterLabels, hexSpiral, layoutWorld, mapBounds, pickNode } from "../src/world/layout";
const kinds: WorldNode["kind"][] = ["app", "service", "package", "data", "infra", "docs", "test", "tool", "external"];
const nodes = (count: number): WorldNode[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `arbitrary/${i}`,
    label: `District ${i}`,
    kind: kinds[i % kinds.length],
    path: `src/${i}`,
    description: "",
    evidence: [],
    confidence: "observed",
    status: "unknown",
    language: null,
    size: 1,
  }));
describe("world geometry acceptance", () => {
  for (const style of STYLE_IDS) {
    test(`${style}: stable identities, independent of source ordering`, () => {
      const input = nodes(30),
        before = JSON.stringify(input);
      expect(layoutWorld(input, style)).toEqual(layoutWorld([...input].reverse(), style));
      expect(JSON.stringify(input)).toBe(before);
    });
    test(`${style}: 0–30 districts fit with roof and label clearance, and remain individually selectable`, () => {
      for (let count = 0; count <= 30; count++) {
        const placed = layoutWorld(nodes(count), style),
          b = mapBounds(placed);
        expect(Number.isFinite(b.width) && b.width > 0 && Number.isFinite(b.height) && b.height > 0).toBe(true);
        expect(new Set(placed.map((p) => `${p.x}:${p.y}`)).size).toBe(count);
        for (const p of placed) {
          expect(p.x - 80).toBeGreaterThanOrEqual(b.x);
          expect(p.x + 80).toBeLessThanOrEqual(b.x + b.width);
          expect(p.y - 110).toBeGreaterThanOrEqual(b.y);
          expect(p.y + 58).toBeLessThanOrEqual(b.y + b.height);
          expect(pickNode(placed, p.x, p.y - 20)).toBe(p.node.id);
          for (const q of placed) if (p !== q) expect(Math.hypot((p.x - q.x) / 140, (p.y - q.y) / 90)).toBeGreaterThan(1);
        }
      }
    });
  }
  test("hex spiral does not duplicate axial cells and empty pick is safe", () => {
    const points = hexSpiral(60);
    expect(points).toHaveLength(60);
    expect(new Set(points.map((p) => `${p.x}:${p.y}`)).size).toBe(60);
    expect(hexSpiral(0)).toEqual([]);
    expect(pickNode([], 0, 0)).toBeNull();
  });
});
test("narrow-screen labels preserve selected identity without overlapping other labels", () => {
  const crowded = [
    { id: "a", x: 0, y: 0, width: 90, height: 22 },
    { id: "b", x: 50, y: 10, width: 90, height: 22 },
    { id: "c", x: 160, y: 0, width: 90, height: 22 },
  ];
  expect(declutterLabels(crowded, ["b", null]).map((r) => r.id)).toEqual(["b", "c"]);
  expect(declutterLabels(crowded, [null, null]).map((r) => r.id)).toEqual(["a", "c"]);
});
test("viewport-aware label culling drops offscreen, occluded and over-budget labels but never the selected one", () => {
  const view = { width: 390, height: 600, blocked: [{ id: "zoom", x: 330, y: 400, width: 48, height: 140 }], coverage: 0.03, gap: 8 };
  const labels = [
    { id: "offscreen", x: 370, y: 100, width: 90, height: 22 },
    { id: "occluded", x: 300, y: 450, width: 60, height: 22 },
    { id: "first", x: 40, y: 100, width: 90, height: 22 },
    { id: "second", x: 40, y: 200, width: 90, height: 22 },
    { id: "close", x: 40, y: 126, width: 90, height: 22 },
    { id: "budget", x: 40, y: 300, width: 90, height: 22 },
    { id: "selected", x: 360, y: 420, width: 120, height: 22 },
  ];
  // 390*600*0.03 = 7020 px² budget: selected (2640) + two 90x22 labels (1980 each); a third would exceed it.
  expect(declutterLabels(labels, ["selected", null], view).map((r) => r.id)).toEqual(["selected", "first", "second"]);
  // Without a view the legacy behaviour (overlap-only) is unchanged.
  expect(declutterLabels(labels, [null, null]).map((r) => r.id)).toContain("offscreen");
});
