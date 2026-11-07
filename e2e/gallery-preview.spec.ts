import { basePath, test, expect } from "./fixtures";
import { projectRepositoryPreview } from "../src/server/gallery-preview";
import { syntheticGallery } from "../test/fixtures/browser-world";
import type { StyleId } from "../src/contracts";

const previewApi = "/api/gallery-preview/synthetic-moonshot/browser-fixture";
test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 600 }); });
test("SYNTHETIC unknown gallery worlds hand the repository to the explicit generate form without navigating", async ({ page, api }) => {
  api.respond("GET", "/api/gallery", () => ({ body: { projects: syntheticGallery.map((p) => ({ ...p, ready: false, collectedAt: null })) } }));
  await page.goto(`${basePath}/`);
  const card = page.locator(".project-card").filter({ has: page.getByRole("heading", { name: "SYNTHETIC Atlas", exact: true }) });
  await expect(card).toHaveAttribute("data-ready", "false");
  expect(await card.getAttribute("href")).toBeNull();
  await expect(card).toContainText("Build this world");
  const before = page.url();
  await card.click();
  expect(page.url()).toBe(before);
  const fullName = syntheticGallery.find((p) => p.name === "SYNTHETIC Atlas")!.fullName;
  await expect(page.locator("#repository")).toHaveValue(`https://github.com/${fullName}`);
  await expect(page.locator("#repository")).toBeFocused();
  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await expect(page.getByText("Powered by Meta Muse Spark 1.3", { exact: true })).toBeVisible();
  expect(api.requests.filter((r) => r.method === "POST")).toEqual([]);
});
test("SYNTHETIC gallery loads only cache preview on approach and keeps unknown explicit in English", async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${basePath}/`);
  const card = page.locator(".project-card").filter({ has: page.getByRole("heading", { name: "SYNTHETIC Atlas", exact: true }) });
  await expect(card).toHaveCount(1);
  expect(api.requests.filter((r) => r.path === previewApi)).toHaveLength(0);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText("Unknown · no cached map");
  await expect(card.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Switch language" })).toHaveCount(0);
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
  // Calm summary on the art; the full capture record sits one keyboard press away.
  const shell = page.locator(".project-card-shell").filter({ has: card });
  const chip = shell.locator(".card-provenance .provenance-trigger");
  await expect(chip).toContainText("Stale snapshot");
  await expect(chip).toContainText("districts");
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  const record = shell.getByRole("group", { name: "Capture details for synthetic-moonshot/browser-fixture", includeHidden: true });
  await expect(record).toBeHidden();
  await expect(record).toContainText("Stale cache");
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(record).toBeVisible();
  await expect(record).toContainText("Stale cache · current state unknown");
  await expect(record).toContainText("1234567");
  await expect(record).toContainText("2 observed / 1 inferred");
  await expect(record).toContainText("2026-11-04 16:00 UTC");
  await expect(record).toContainText("Motion illustrates links · not live activity");
  await page.keyboard.press("Escape");
  await expect(record).toBeHidden();
  await expect(chip).toBeFocused();
  await expect(page.getByRole("link", { name: "GitHub source: synthetic-moonshot/browser-fixture", exact: true })).toHaveAttribute("href", "https://github.com/synthetic-moonshot/browser-fixture");
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
  // Every card keeps the "not live activity" note in its provenance record (disclosed on demand).
  await expect(page.locator(".card-provenance .provenance-panel").getByText("Motion illustrates links · not live activity", { exact: true })).toHaveCount(5);
  await expect(page.locator(".card-provenance .provenance-trigger")).toHaveCount(5);
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

test("SYNTHETIC top-right GitHub repository link remains visible in English mobile layouts", async ({ page }) => {
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(`${basePath}/`);
    const repository = page.locator(".site-header .header-repo-link");
    await expect(repository).toBeVisible(); await expect(repository).toHaveText("GitHub");
    await expect(repository).toHaveAttribute("href", "https://github.com/luworks/github-factory");
    await expect(repository).toHaveAttribute("target", "_blank"); await expect(repository).toHaveAttribute("rel", "noopener noreferrer");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.getByRole("button", { name: "Switch language" })).toHaveCount(0);
  }
});
