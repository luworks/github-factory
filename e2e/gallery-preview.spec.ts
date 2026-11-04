import { basePath, test, expect } from "./fixtures";
import { projectRepositoryPreview } from "../src/server/gallery-preview";
import { syntheticGallery } from "../test/fixtures/browser-world";

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
