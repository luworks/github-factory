import type { Locator, Page } from "@playwright/test";
import { basePath, test, expect, openWorld } from "./fixtures";

type Camera = { scale: number; x: number; y: number };
type CameraSample = Camera & { frame: number };

// Observe standard canvas drawing calls, rather than copying layout/camera algorithms
// or comparing fixed screenshots. This probe never changes transforms or app state.
async function observeCamera(page: Page) {
  await page.addInitScript(() => {
    const observed = new WeakMap<HTMLCanvasElement, { scale: number; x: number; y: number; frame: number }>();
    Object.assign(window, { __syntheticCameraProbe: observed });
    const original = CanvasRenderingContext2D.prototype.setTransform;
    CanvasRenderingContext2D.prototype.setTransform = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (args.length === 6 && args.every((v) => typeof v === "number")) {
        const [a, b, c, d, x, y] = args as number[];
        if (a === d && b === 0 && c === 0 && (x !== 0 || y !== 0)) {
          observed.set(this.canvas, { scale: a, x, y, frame: (observed.get(this.canvas)?.frame ?? 0) + 1 });
        }
      }
      Reflect.apply(original, this, args);
    } as typeof original;
  });
}

async function camera(canvas: Locator): Promise<Camera> {
  return canvas.evaluate((element) => {
    const probe = (window as unknown as { __syntheticCameraProbe: WeakMap<HTMLCanvasElement, CameraSample> }).__syntheticCameraProbe;
    const value = probe.get(element as HTMLCanvasElement);
    if (!value) throw new Error("Canvas has not rendered a camera transform yet");
    return { scale: value.scale, x: value.x, y: value.y };
  });
}

async function nextDraw(canvas: Locator) {
  const frame = () =>
    canvas.evaluate(
      (element) =>
        (window as unknown as { __syntheticCameraProbe: WeakMap<HTMLCanvasElement, CameraSample> }).__syntheticCameraProbe.get(
          element as HTMLCanvasElement,
        )?.frame ?? 0,
    );
  const previous = await frame();
  await expect.poll(frame).toBeGreaterThan(previous);
}

test("SYNTHETIC keyboard navigation, zoom controls, reset and Escape remain usable", async ({ page }) => {
  await observeCamera(page);
  await openWorld(page);
  const canvas = page.getByTestId("world-canvas");
  await expect
    .poll(async () =>
      canvas.evaluate((element) =>
        (window as unknown as { __syntheticCameraProbe: WeakMap<HTMLCanvasElement, Camera> }).__syntheticCameraProbe.has(
          element as HTMLCanvasElement,
        ),
      ),
    )
    .toBe(true);
  const baseline = await camera(canvas);
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await canvas.press("ArrowRight");
  await expect.poll(async () => (await camera(canvas)).x).toBeLessThan(baseline.x);
  await canvas.press("+");
  await expect.poll(async () => (await camera(canvas)).scale).toBeGreaterThan(baseline.scale);
  await canvas.press("0");
  await expect.poll(() => camera(canvas)).toEqual(baseline);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(async () => (await camera(canvas)).scale).toBeGreaterThan(baseline.scale);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect.poll(async () => (await camera(canvas)).scale).toBeLessThan(baseline.scale);
  await page.getByRole("button", { name: "Reset camera", exact: true }).click();
  await expect.poll(() => camera(canvas)).toEqual(baseline);
  const district = page.locator(".district-row").filter({ hasText: "SYNTHETIC Web" });
  await district.focus();
  await district.press("Enter");
  await expect(page.getByRole("button", { name: "Close district" })).toBeVisible();
  await canvas.focus();
  await canvas.press("Escape");
  await expect(page.getByRole("button", { name: "Close district" })).toHaveCount(0);
});

test("SYNTHETIC pointer pan, wheel zoom, pointer cancel and lost capture recover without a stuck drag", async ({ page }) => {
  await observeCamera(page);
  await openWorld(page);
  const canvas = page.getByTestId("world-canvas");
  await expect
    .poll(async () =>
      canvas.evaluate((element) =>
        (window as unknown as { __syntheticCameraProbe: WeakMap<HTMLCanvasElement, Camera> }).__syntheticCameraProbe.has(
          element as HTMLCanvasElement,
        ),
      ),
    )
    .toBe(true);
  const bounds = (await canvas.boundingBox())!;
  const start = { x: bounds.x + bounds.width * 0.6, y: bounds.y + bounds.height * 0.65 };
  const initial = await camera(canvas);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await camera(canvas)).x).toBeGreaterThan(initial.x);
  await expect(page.getByRole("button", { name: "Close district" })).toHaveCount(0);
  const panned = await camera(canvas);
  await page.mouse.wheel(0, -180);
  await expect.poll(async () => (await camera(canvas)).scale).toBeGreaterThan(panned.scale);
  for (const eventName of ["pointercancel", "lostpointercapture"]) {
    await canvas.evaluate((element) => {
      element.addEventListener(
        "pointerdown",
        (event) => element.setAttribute("data-test-pointer-id", String((event as PointerEvent).pointerId)),
        { once: true },
      );
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 25, start.y + 10, { steps: 2 });
    const pointerId = Number(await canvas.getAttribute("data-test-pointer-id"));
    await canvas.dispatchEvent(eventName, { pointerId, pointerType: "mouse", bubbles: true });
    await page.mouse.up();
    await nextDraw(canvas);
    const cancelled = await camera(canvas);
    await page.mouse.move(start.x + 90, start.y + 40, { steps: 4 });
    await nextDraw(canvas);
    expect(await camera(canvas)).toEqual(cancelled);
    await page.mouse.down();
    await page.mouse.move(start.x + 130, start.y + 40, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await camera(canvas)).x).toBeGreaterThan(cancelled.x);
  }
  await page.getByRole("button", { name: "Reset camera", exact: true }).click();
  await expect.poll(() => camera(canvas)).toEqual(initial);
  await page.locator(".district-row").filter({ hasText: "SYNTHETIC API" }).click();
  await expect(page.locator(".inspector").getByRole("heading", { name: "SYNTHETIC API", exact: true })).toBeVisible();
});

test("SYNTHETIC denied clipboard offers a share fallback without losing the world", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("SYNTHETIC denied clipboard", "NotAllowedError");
        },
      },
    });
  });
  await openWorld(page);
  await page.getByRole("button", { name: "Share world", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Copy the browser URL to share this world.");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const width of [390, 768]) {
  test(`SYNTHETIC English landing/explorer ignore legacy zh preference at ${width}px`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("moonshot.lang", "zh"));
    await page.setViewportSize({ width, height: 844 }); await page.goto(`${basePath}/`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every codebase.");
    await expect(page.getByRole("button", { name: "Switch language" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await openWorld(page); await expect(page.getByRole("button", { name: "Activity", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Every change leaves a mark.", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("SYNTHETIC mobile generate and share controls keep accessible names", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${basePath}/`);
  await expect(page.locator(".repo-form button[type=submit]")).toHaveAccessibleName(/Generate world/i);
});

test("SYNTHETIC facts refresh preserves the user's camera and selected district", async ({ page, api }) => {
  await observeCamera(page);
  const refreshed = structuredClone(api.world);
  refreshed.headSha = "d".repeat(40);
  refreshed.collectedAt = new Date(Date.now()).toISOString();
  api.respond("POST", "/api/world/synthetic-moonshot/browser-fixture", () => ({ body: refreshed }));
  await openWorld(page);
  await page.locator(".district-row").filter({ hasText: "SYNTHETIC Web" }).click();
  const canvas = page.getByTestId("world-canvas");
  await nextDraw(canvas);
  await canvas.focus();
  const initial = await camera(canvas);
  await canvas.press("ArrowRight");
  await expect.poll(async () => (await camera(canvas)).x).toBeLessThan(initial.x);
  const panned = await camera(canvas);
  await canvas.press("+");
  await expect.poll(async () => (await camera(canvas)).scale).toBeGreaterThan(panned.scale);
  const viewpoint = await camera(canvas);
  await page.getByRole("button", { name: "Refresh GitHub data" }).click();
  await expect(page.locator(".world-source-stamp code")).toHaveText("ddddddd");
  await nextDraw(canvas);
  expect(await camera(canvas)).toEqual(viewpoint);
  await expect(page.locator(".inspector").getByRole("heading", { name: "SYNTHETIC Web", exact: true })).toBeVisible();
  expect(api.requests.filter((request) => request.path.startsWith("/api/blueprint/"))).toEqual([]);
});
