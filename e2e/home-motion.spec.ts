import { basePath, test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// The hero is an original procedural illustration (no repository data). Frames are
// counted by instrumenting drawImage on the hero canvas, which every frame composites.
async function countHeroFrames(page: Page) {
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.drawImage;
    proto.drawImage = function (...args: [CanvasImageSource, number, number, ...number[]]) {
      if (this.canvas.dataset.testid === "hero-canvas") this.canvas.dataset.frames = String(Number(this.canvas.dataset.frames || 0) + 1);
      return Reflect.apply(original, this, args);
    };
  });
}
const frames = async (page: Page) => Number(await page.getByTestId("hero-canvas").getAttribute("data-frames"));
const pixels = (page: Page) => page.getByTestId("hero-canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());
async function idle(page: Page, ms = 500) {
  await page.waitForTimeout(120);
  const before = await frames(page);
  await page.waitForTimeout(ms);
  expect(await frames(page)).toBe(before);
}

test("hero world animates continuously while visible and stops offscreen and when hidden", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await countHeroFrames(page);
  await page.goto(`${basePath}/`);
  const canvas = page.getByTestId("hero-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => frames(page)).toBeGreaterThan(5);
  const a = await pixels(page);
  await page.waitForTimeout(300);
  expect(await pixels(page)).not.toBe(a);
  const before = await frames(page);
  await page.waitForTimeout(500);
  expect(await frames(page) - before).toBeGreaterThan(10);
  // Construction intro completes and the HUD reports every district.
  await expect(page.getByTestId("hero-built")).toHaveText(/^(\d+)\/\1$/, { timeout: 8000 });

  await page.locator(".site-footer").scrollIntoViewIfNeeded();
  await idle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const resumed = await frames(page);
  await expect.poll(() => frames(page)).toBeGreaterThan(resumed + 2);

  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await idle(page);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  const shown = await frames(page);
  await expect.poll(() => frames(page)).toBeGreaterThan(shown + 2);
});

test("reduced motion paints one finished still frame and five visibly distinct hero styles", async ({ page }) => {
  await countHeroFrames(page);
  await page.goto(`${basePath}/`);
  await expect.poll(() => frames(page)).toBeGreaterThan(0);
  await idle(page);
  const still = await pixels(page);
  await page.waitForTimeout(300);
  expect(await pixels(page)).toBe(still);
  await expect(page.getByTestId("hero-built")).toHaveText(/^(\d+)\/\1$/);
  const chips = page.getByRole("group", { name: "Hero world style" });
  const seen = new Set<string>();
  for (const name of ["Moon Factory", "Factorio", "Red Alert", "Red Alert 2", "Civilization"]) {
    const chip = chips.getByRole("button", { name, exact: true });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".hero-scene-top")).toContainText(name.toUpperCase());
    seen.add(await pixels(page));
    await idle(page, 250);
  }
  expect(seen.size).toBe(5);
});

test("homepage motion layer keeps 320px layout without horizontal overflow", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(`${basePath}/`);
  await page.getByTestId("hero-canvas").scrollIntoViewIfNeeded();
  await expect(page.getByRole("group", { name: "Hero world style" }).getByRole("button")).toHaveCount(5);
  for (const selector of [".worlds-section", ".perspectives-section", ".closing-line"]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // Revealed sections end fully visible.
  await expect(page.locator(".closing-line")).toHaveClass(/is-revealed/);
  await expect.poll(() => page.locator(".closing-line").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

test("gallery card tilts toward the pointer and settles back on leave", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${basePath}/`);
  const shell = page.locator(".project-card-shell").filter({ has: page.getByRole("heading", { name: "SYNTHETIC Atlas", exact: true }) });
  await shell.scrollIntoViewIfNeeded();
  const box = (await shell.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.1, { steps: 4 });
  await expect.poll(() => shell.evaluate((el) => parseFloat(el.style.getPropertyValue("--tilt-y")))).toBeGreaterThan(3);
  await page.mouse.move(2, 2);
  await expect.poll(() => shell.evaluate((el) => parseFloat(el.style.getPropertyValue("--tilt-y")))).toBe(0);
});
