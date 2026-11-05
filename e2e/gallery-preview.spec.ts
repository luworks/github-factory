import { basePath, test, expect } from "./fixtures";
import { projectRepositoryPreview } from "../src/server/gallery-preview";
import { syntheticGallery } from "../test/fixtures/browser-world";
import type { StyleId } from "../src/contracts";

const previewApi = "/api/gallery-preview/synthetic-moonshot/browser-fixture";
test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 600 }); });
test("SYNTHETIC unknown gallery worlds cannot navigate to an empty route", async ({ page, api }) => {
  api.respond("GET", "/api/gallery", () => ({ body: { projects: syntheticGallery.map((p) => ({ ...p, ready: false, collectedAt: null })) } }));
  await page.goto(`${basePath}/`);
  const card = page.locator(".project-card").filter({ has: page.getByRole("heading", { name: "SYNTHETIC Atlas", exact: true }) });
  await expect(card).toHaveAttribute("aria-disabled", "true");
  expect(await card.getAttribute("href")).toBeNull();
  await expect(card).toContainText("Map unavailable");
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(page.getByText("Powered by Meta Muse Spark 1.3", { exact: true })).toBeVisible();
  expect(api.requests.filter((r) => r.method === "POST")).toEqual([]);
});
test("SYNTHETIC gallery loads only cache preview on approach and keeps unknown explicit in both languages", async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${basePath}/`);
  const card = page.locator(".project-card").filter({ has: page.getByRole("heading", { name: "SYNTHETIC Atlas", exact: true }) });
  await expect(card).toHaveCount(1);
  expect(api.requests.filter((r) => r.path === previewApi)).toHaveLength(0);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText("Unknown · no cached map");
  await expect(card.locator("canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch language" }).click();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText("未知 · 尚无缓存地图");
  expect(api.requests.filter((r) => r.method === "POST" || r.path.startsWith("/api/world/"))).toEqual([]);
});

test("SYNTHETIC cache world shares the real renderer, preserves source stamp, pauses for reduced motion and offscreen", async ({ page, api }) => {
  const world = structuredClone(api.world);
  world.source = "github"; // SYNTHETIC only: never live evidence.
  api.respond("GET", previewApi, () => ({ body: projectRepositoryPreview(world.repo.fullName, world) }));
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.drawImage;
    proto.drawImage = function (...args: [CanvasImageSource, number, number, ...number[]]) {
      if (this.canvas.dataset.testid === "repository-preview-canvas") this.canvas.dataset.draws = String(Number(this.canvas.dataset.draws || 0) + 1);
      return Reflect.apply(original, this, args);
    };
  });
  await page.goto(`${basePath}/`);
  const card = page.locator(".project-card").filter({ has: page.getByRole("heading", { name: "SYNTHETIC Atlas", exact: true }) });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText("Stale cache");
  await expect(card).toContainText("1234567");
  await expect(card).toContainText("2 observed / 1 inferred");
  await expect(page.getByRole("link", { name: "GitHub source: synthetic-moonshot/browser-fixture", exact: true })).toHaveAttribute("href", "https://github.com/synthetic-moonshot/browser-fixture");
  await expect(card).toContainText("2026-11-04 16:00 UTC");
  const canvas = card.getByTestId("repository-preview-canvas");
  await expect(canvas).toBeVisible();
  await card.screenshot({ path: "artifacts/gallery-preview-synthetic.png" });
  await expect.poll(() => canvas.getAttribute("data-draws")).not.toBeNull();
  // Allow the initial ResizeObserver draw, then verify no animation frames repaint.
  await page.waitForTimeout(150);
  const count = await canvas.getAttribute("data-draws");
  await page.waitForTimeout(250);
  expect(await canvas.getAttribute("data-draws")).toBe(count);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(async () => Number(await canvas.getAttribute("data-draws"))).toBeGreaterThan(Number(count));
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(canvas).toHaveCount(0);
  expect(api.requests.filter((r) => r.method === "POST" || r.path.startsWith("/api/world/"))).toEqual([]);
});

test("SYNTHETIC cache API failure shows unavailable without polling or collection", async ({ page, api }) => {
  api.respond("GET", previewApi, () => ({ status: 503, body: { error: "SYNTHETIC unavailable" } }));
  await page.goto(`${basePath}/`);
  await page.locator(".project-card").filter({ has: page.getByRole("heading", { name: "SYNTHETIC Atlas", exact: true }) }).scrollIntoViewIfNeeded();
  await expect(page.locator(".project-card").filter({ has: page.getByRole("heading", { name: "SYNTHETIC Atlas", exact: true }) })).toContainText("Preview unavailable");
  expect(api.requests.filter((r) => r.path === previewApi)).toHaveLength(1);
  expect(api.requests.filter((r) => r.method === "POST")).toEqual([]);
});

test("SYNTHETIC all five visible cached styles animate without interaction and freeze under reduced motion", async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.clock.install();
  const styles: StyleId[] = ["moonshot", "factorio", "red-alert", "red-alert-2", "civilization"];
  const projects = styles.map((style) => ({ ...syntheticGallery[0], fullName: `synthetic-moonshot/preview-${style}`, name: `SYNTHETIC ${style}`, suggestedStyle: style }));
  api.respond("GET", "/api/gallery", () => ({ body: { projects } }));
  for (const project of projects) {
    const world = structuredClone(api.world);
    world.source = "github"; // Invented fixture facts only; no real upstream.
    world.repo = { ...world.repo, fullName: project.fullName, name: project.fullName.split("/")[1], url: `https://github.com/${project.fullName}` };
    api.respond("GET", `/api/gallery-preview/${project.fullName}`, () => ({ body: projectRepositoryPreview(project.fullName, world) }));
  }
  await page.goto(`${basePath}/`);
  await page.locator(".worlds-section").scrollIntoViewIfNeeded();
  const canvases = page.getByTestId("repository-preview-canvas");
  await expect(canvases).toHaveCount(5);
  await expect(page.getByText("Motion illustrates links · not live activity", { exact: true })).toHaveCount(5);
  const signatures = () => canvases.evaluateAll((elements) => elements.map((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
    return hash >>> 0;
  }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.runFor(350);
  const firstFrames = await signatures();
  const requests = api.requests.length;
  await page.clock.runFor(600);
  const nextFrames = await signatures();
  for (let index = 0; index < styles.length; index++) expect(nextFrames[index], `${styles[index]} must visibly repaint without hover`).not.toBe(firstFrames[index]);
  expect(api.requests).toHaveLength(requests);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.runFor(150);
  const frozen = await signatures();
  await page.clock.runFor(600);
  expect(await signatures()).toEqual(frozen);
  expect(api.requests.filter((r) => r.method === "POST" || r.path.startsWith("/api/world/"))).toEqual([]);
});

test("SYNTHETIC top-right GitHub repository link remains visible and usable in English and Chinese mobile layouts", async ({ page }) => {
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${basePath}/`);
    for (const language of ["English", "Chinese"]) {
      const repository = page.locator(".site-header .header-repo-link");
      await expect(repository).toBeVisible();
      await expect(repository).toHaveText("GitHub");
      await expect(repository).toHaveAttribute("href", "https://github.com/luworks/github-factory");
      await expect(repository).toHaveAttribute("target", "_blank");
      await expect(repository).toHaveAttribute("rel", "noopener noreferrer");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${language} at ${width}px`).toBe(true);
      await page.getByRole("button", { name: "Switch language" }).click();
    }
  }
});
