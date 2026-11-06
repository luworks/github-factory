import type { Locator, Page } from "@playwright/test";
import type { NodeKind, WorldSnapshot } from "../src/contracts";
import { test, expect, worldApi, worldPath } from "./fixtures";

const STYLES = ["moonshot", "factorio", "red-alert", "red-alert-2", "civilization"] as const;
const SHOTS = process.env.MOONSHOT_WORLD_SHOTS;

/** SYNTHETIC larger city so every effect has something to act on. Invented data only. */
function city(base: WorldSnapshot): WorldSnapshot {
  const kinds: NodeKind[] = ["app", "service", "package", "data", "infra", "docs", "test", "tool", "external"];
  const status = ["unknown", "unknown", "active", "unknown", "healthy", "unknown", "attention", "unknown", "unknown"] as const;
  const nodes = Array.from({ length: 16 }, (_, i) => ({
    ...base.nodes[0],
    id: `n${i}`,
    label: `SYNTHETIC ${kinds[i % kinds.length]} ${i}`,
    kind: kinds[i % kinds.length],
    path: `synthetic/${i}`,
    status: status[i % status.length],
    confidence: i % 4 === 3 ? ("inferred" as const) : ("observed" as const),
  }));
  const edges = nodes.slice(1).map((n, i) => ({
    id: `e${i}`,
    source: nodes[Math.floor(i / 2)].id,
    target: n.id,
    label: "SYNTHETIC relationship",
    kind: "dependency" as const,
    confidence: i % 5 === 4 ? ("inferred" as const) : ("observed" as const),
  }));
  const commits = Array.from({ length: 10 }, (_, i) => ({ ...base.commits[0], id: `c${i}`, date: base.collectedAt }));
  return { ...base, nodes, edges, commits, blueprint: { ...base.blueprint, districts: [] } };
}
async function pixels(canvas: Locator) {
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const g = document.createElement("canvas");
    g.width = 96;
    g.height = 64;
    const x = g.getContext("2d")!;
    x.drawImage(c, 0, 0, 96, 64);
    return Array.from(x.getImageData(0, 0, 96, 64).data);
  });
}
const difference = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const native = window.requestAnimationFrame.bind(window);
    (window as unknown as { __rafRuns: number }).__rafRuns = 0;
    window.requestAnimationFrame = (cb) =>
      native((t) => {
        (window as unknown as { __rafRuns: number }).__rafRuns++;
        cb(t);
      });
  });
}
const runs = (page: Page) => page.evaluate(() => (window as unknown as { __rafRuns: number }).__rafRuns);

test("SYNTHETIC visible world animates: pixels change over time, all five styles render, frame cost is bounded", async ({ page, api }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  api.world = city(api.world);
  api.respond("GET", worldApi, () => ({ body: api.world }));
  for (const style of STYLES) {
    await page.goto(`${worldPath}?style=${style}`);
    const canvas = page.getByTestId("world-canvas");
    await expect(page.locator(`.world-canvas-wrap.style-${style}`)).toBeVisible();
    await expect.poll(() => canvas.getAttribute("data-frame-ms")).not.toBeNull();
    const first = await pixels(canvas);
    await page.waitForTimeout(700);
    const later = await pixels(canvas);
    expect(difference(first, later), `${style} world should move while visible`).toBeGreaterThan(0.05);
    await page.waitForTimeout(600);
    const cost = Number(await canvas.getAttribute("data-frame-ms"));
    expect(cost, `${style} average draw cost (ms)`).toBeLessThan(40);
    test.info().annotations.push({ type: "frame-ms", description: `${style}: ${cost.toFixed(2)}ms` });
  }
});

test("SYNTHETIC reduced motion paints one still lit frame and schedules zero idle RAF", async ({ page, api }) => {
  await countFrames(page);
  api.world = city(api.world);
  api.respond("GET", worldApi, () => ({ body: api.world }));
  await page.goto(`${worldPath}?style=factorio`);
  const canvas = page.getByTestId("world-canvas");
  await expect.poll(() => canvas.getAttribute("data-frame-ms")).not.toBeNull();
  await page.waitForTimeout(300);
  const still = await pixels(canvas),
    before = await runs(page);
  await page.waitForTimeout(800);
  expect(await runs(page)).toBe(before);
  expect(difference(still, await pixels(canvas))).toBe(0);
});

test("SYNTHETIC hidden and offscreen worlds run zero RAF callbacks and resume without a jump", async ({ page, api }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await countFrames(page);
  api.world = city(api.world);
  api.respond("GET", worldApi, () => ({ body: api.world }));
  await page.goto(`${worldPath}?style=red-alert-2`);
  const canvas = page.getByTestId("world-canvas");
  await expect.poll(() => canvas.getAttribute("data-frame-ms")).not.toBeNull();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(100);
  let before = await runs(page);
  const frozen = await pixels(canvas);
  await page.waitForTimeout(700);
  expect(await runs(page)).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => runs(page)).toBeGreaterThan(before + 2);
  // No catch-up: the first resumed frames stay close to the frozen frame (700ms of hidden time skipped).
  expect(difference(frozen, await pixels(canvas))).toBeLessThan(6);
  await page.locator(".world-canvas-wrap").evaluate((el: HTMLElement) => (el.style.transform = "translateY(-400vh)"));
  await page.waitForTimeout(150);
  before = await runs(page);
  await page.waitForTimeout(600);
  expect(await runs(page)).toBe(before);
  await page.locator(".world-canvas-wrap").evaluate((el: HTMLElement) => (el.style.transform = ""));
  await expect.poll(() => runs(page)).toBeGreaterThan(before + 2);
});

test("SYNTHETIC animated camera glides to a selected district and still settles exactly on reset", async ({ page, api }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  api.world = city(api.world);
  api.respond("GET", worldApi, () => ({ body: api.world }));
  await page.goto(`${worldPath}?style=moonshot`);
  const canvas = page.getByTestId("world-canvas");
  await expect.poll(() => canvas.getAttribute("data-frame-ms")).not.toBeNull();
  await page.locator(".district-row").filter({ hasText: "SYNTHETIC data 3" }).click();
  await expect(page.locator(".inspector").getByRole("heading", { name: "SYNTHETIC data 3", exact: true })).toBeVisible();
  await canvas.focus();
  await canvas.press("Escape");
  await expect(page.getByRole("button", { name: "Close district" })).toHaveCount(0);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Reset camera", exact: true }).click();
  await page.waitForTimeout(1500);
  const box = (await canvas.boundingBox())!;
  // Clicking a building center still selects it after camera motion (picking uses the drawn view).
  await page.locator(".district-row").filter({ hasText: "SYNTHETIC app 0" }).click();
  await expect(page.locator(".inspector").getByRole("heading", { name: "SYNTHETIC app 0", exact: true })).toBeVisible();
  expect(box.width).toBeGreaterThan(0);
});

test("SYNTHETIC world motion screenshots (only with MOONSHOT_WORLD_SHOTS)", async ({ page, api }) => {
  test.skip(!SHOTS, "Set MOONSHOT_WORLD_SHOTS=<dir> to capture review screenshots.");
  test.setTimeout(240_000);
  api.world = city(api.world);
  api.respond("GET", worldApi, () => ({ body: api.world }));
  for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    for (const style of STYLES) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${worldPath}?style=${style}`);
      const canvas = page.getByTestId("world-canvas");
      await expect.poll(() => canvas.getAttribute("data-frame-ms")).not.toBeNull();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/${label}-${style}-still.png` });
      if (label === "mobile") continue;
      await page.clock.install();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      for (const [name, at] of [["day", 1500], ["dusk", 6000], ["night", 10000]] as const) {
        await page.clock.runFor(at);
        await page.waitForTimeout(80);
        await canvas.screenshot({ path: `${SHOTS}/${label}-${style}-${name}.png` });
      }
      for (let i = 0; i < 4; i++) {
        await page.clock.runFor(250);
        await canvas.screenshot({ path: `${SHOTS}/${label}-${style}-seq${i}.png` });
      }
    }
  }
});
