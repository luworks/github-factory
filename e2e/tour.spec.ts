import type { Page, Route } from "@playwright/test";
import type { FeaturedProject, NodeKind, WorldSnapshot } from "../src/contracts";
import { basePath, test, expect, type ApiReply } from "./fixtures";

const SHOTS = process.env.MOONSHOT_TOUR_SHOTS;
const tourPath = `${basePath}/tour`;
const STYLES = ["moonshot", "factorio", "red-alert", "red-alert-2", "civilization"];
type Api = { world: WorldSnapshot; respond: (method: string, path: string, handler: (route: Route) => ApiReply | Promise<ApiReply>) => void };

/** SYNTHETIC city: invented districts and links, never live GitHub evidence. */
function city(base: WorldSnapshot, owner: string, name: string, size = 14): WorldSnapshot {
  const kinds: NodeKind[] = ["app", "service", "package", "data", "infra", "docs", "test", "tool", "service", "package"];
  const words = ["web", "gateway", "core", "storage", "deploy", "docs", "checks", "cli", "worker", "sdk", "search", "auth", "billing", "ui"];
  const fullName = `${owner}/${name}`,
    url = `https://github.com/${fullName}`;
  const nodes = Array.from({ length: size }, (_, i) => ({
    ...base.nodes[0],
    id: `n${i}`,
    label: words[i % words.length],
    kind: kinds[i % kinds.length],
    path: `${["apps", "services", "packages", "data", "infra", "docs", "test", "tools"][i % 8]}/${words[i % words.length]}`,
    size: 40 - i,
    status: (["active", "unknown", "healthy", "attention"] as const)[i % 4],
    confidence: i % 3 === 2 ? ("inferred" as const) : ("observed" as const),
  }));
  const edges = nodes.slice(1).map((n, i) => ({
    id: `e${i}`, source: nodes[Math.floor(i / 2)].id, target: n.id, label: "SYNTHETIC relationship", kind: "dependency" as const, confidence: "inferred" as const,
  }));
  return {
    ...base,
    source: "github",
    repo: { ...base.repo, owner, name, fullName, url, description: `SYNTHETIC ${name} fixture — invented architecture for UI tests.` },
    nodes,
    edges,
    commits: Array.from({ length: 10 }, (_, i) => ({ ...base.commits[0], id: `c${i}` })),
    blueprint: { ...base.blueprint, districts: [{ nodeId: "n1", title: "SYNTHETIC", purpose: "SYNTHETIC" }] },
  };
}
const row = (fullName: string, ready: boolean, suggestedStyle: FeaturedProject["suggestedStyle"]): FeaturedProject => ({
  fullName, name: `SYNTHETIC ${fullName}`, description: "SYNTHETIC gallery row.", category: "SYNTHETIC", language: "TypeScript", stars: 1, ready, collectedAt: ready ? "2026-11-04T16:00:00Z" : null, suggestedStyle,
});

/** Gallery: two cached worlds, one ready-but-missing cache, one not ready (must never be read). */
function tourApi(api: Api, options: { allMissing?: boolean } = {}) {
  const worlds = new Map([
    ["synthetic-tour/harbor", city(api.world, "synthetic-tour", "harbor")],
    ["synthetic-tour/observatory", city(api.world, "synthetic-tour", "observatory", 11)],
  ]);
  const gallery = [
    row("synthetic-tour/harbor", true, "civilization"),
    row("synthetic-tour/missing", true, "factorio"),
    row("synthetic-tour/observatory", true, "red-alert"),
    row("synthetic-tour/not-ready", false, "moonshot"),
  ];
  const queries: string[] = [];
  api.respond("GET", "/api/gallery", () => ({ body: { projects: gallery } }));
  for (const p of gallery) {
    api.respond("GET", `/api/gallery-preview/${p.fullName}`, () => ({ body: { state: "unknown", reason: "cache-miss", fullName: p.fullName, headSha: null, collectedAt: null, refreshAfter: null, github: "unknown", tree: "unavailable", nodes: [], edges: [], totalNodes: 0, totalEdges: 0, limited: false } }));
    if (!p.ready) continue;
    api.respond("GET", `/api/world/${p.fullName}`, (route) => {
      queries.push(`${p.fullName}${new URL(route.request().url()).search}`);
      const world = options.allMissing ? undefined : worlds.get(p.fullName);
      return world ? { body: world } : { status: 404, body: { error: "Not collected. No collection was requested.", code: "CACHE_MISS" } };
    });
  }
  return { queries };
}
async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const native = window.requestAnimationFrame.bind(window);
    const w = window as unknown as { __raf: { requested: number; ran: number; pending: number } };
    w.__raf = { requested: 0, ran: 0, pending: 0 };
    const cancel = window.cancelAnimationFrame.bind(window), live = new Set<number>();
    window.requestAnimationFrame = (cb) => {
      w.__raf.requested++;
      const id = native((t) => { live.delete(id); w.__raf.ran++; cb(t); });
      live.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => { live.delete(id); cancel(id); };
    setInterval(() => { w.__raf.pending = live.size; }, 20);
  });
}
const frames = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __raf: { requested: number; ran: number } }).__raf }));
async function expectNoFrames(page: Page, duration = 800) {
  await page.waitForTimeout(150);
  const before = await frames(page);
  await page.waitForTimeout(duration);
  const after = await frames(page);
  expect(after.requested, "no requestAnimationFrame work may be scheduled").toBe(before.requested);
}
const tour = (page: Page) => page.getByTestId("tour");

test("SYNTHETIC tour starts from the homepage, advances beats, switches styles, skips misses and only GETs the cache", async ({ page, api }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const { queries } = tourApi(api);
  await page.goto(`${basePath}/`);
  await page.getByRole("link", { name: "Take the tour" }).click();
  await expect(page).toHaveURL(new RegExp(`${tourPath}$`));
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
  await expect(tour(page)).toHaveAttribute("data-mode", "motion");
  await expect(tour(page)).toHaveAttribute("data-beat", "0");
  await expect(page.locator(".tour-caption h1")).toHaveText("Every codebase. A world of its own.");
  await expect(page.getByRole("progressbar", { name: "Tour progress" })).toHaveAttribute("aria-valuetext", /Beat 1 of 9/);
  // Hands-free: the intro advances on its own.
  await expect(tour(page)).toHaveAttribute("data-beat", "1", { timeout: 7000 });
  await expect(page.locator(".tour-caption h1")).toHaveText("synthetic-tour/harbor");
  await expect(page.locator(".tour-caption p")).toHaveText("SYNTHETIC harbor fixture — invented architecture for UI tests.");
  // Same code, different worlds: five perspectives on the first world.
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    const style = (await tour(page).getAttribute("data-style"))!;
    seen.push(style);
    await expect(page.locator(`.tour-stage .world-canvas-wrap.style-${style}`)).toBeVisible();
    await expect(tour(page)).toHaveAttribute("data-repo", "synthetic-tour/harbor");
    await page.keyboard.press("ArrowRight");
    await expect(tour(page)).toHaveAttribute("data-beat", String(i + 2));
  }
  expect(seen).toEqual(STYLES);
  await expect(page.locator(".tour-fade")).toHaveClass(/is-fading/);
  // The missing cache is skipped without breaking the tour; the next world is the third row.
  await expect(tour(page)).toHaveAttribute("data-repo", "synthetic-tour/observatory");
  await expect(tour(page)).toHaveAttribute("data-style", "red-alert");
  await page.keyboard.press("ArrowRight");
  await expect(tour(page)).toHaveAttribute("data-style", "civilization");
  await expect(page.locator(".tour-caption .evidence-badge")).toHaveText(/SOURCE OBSERVED|STRUCTURE INFERRED/);
  await page.keyboard.press("ArrowLeft");
  await expect(tour(page)).toHaveAttribute("data-beat", "6");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(tour(page)).toHaveAttribute("data-beat-kind", "end");
  await expect(page.getByRole("link", { name: "Build your world" })).toHaveAttribute("href", `${basePath}/#launch`);
  await expect(page.getByRole("link", { name: "Explore Atlas" })).toHaveAttribute("href", `${basePath}/atlas`);
  expect(queries.sort()).toEqual(["synthetic-tour/harbor?mode=cached", "synthetic-tour/missing?mode=cached", "synthetic-tour/observatory?mode=cached"]);
  expect(api.requests.every((r) => r.method === "GET"), "the tour must never POST").toBe(true);
  expect(api.requests.some((r) => r.path.includes("blueprint") || r.path.includes("budget") || r.path.includes("not-ready"))).toBe(false);
  // Esc exits to the homepage.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`${basePath}/$`));
});

test("SYNTHETIC Space pauses, Skip jumps to the end card, Replay restarts, close exits", async ({ page, api }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  tourApi(api);
  await page.goto(tourPath);
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("Space");
  await expect(tour(page)).toHaveAttribute("data-state", "paused");
  await expect(page.getByRole("button", { name: "Play tour" })).toBeVisible();
  await page.waitForTimeout(4200);
  await expect(tour(page)).toHaveAttribute("data-beat", "0");
  await page.keyboard.press("Space");
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(tour(page)).toHaveAttribute("data-beat-kind", "end");
  await expect(page.getByRole("heading", { name: "Build your world." })).toBeVisible();
  await expect(page.getByRole("list", { name: "Worlds in this tour" }).getByRole("link")).toHaveText(["synthetic-tour/harbor", "synthetic-tour/observatory"]);
  await expect(tour(page)).toHaveAttribute("data-state", "ended", { timeout: 7000 });
  await page.getByRole("button", { name: "Replay tour" }).click();
  await expect(tour(page)).toHaveAttribute("data-beat", "0");
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
  await page.getByRole("button", { name: "Close tour" }).click();
  await expect(page).toHaveURL(new RegExp(`${basePath}/$`));
  expect(api.requests.every((r) => r.method === "GET")).toBe(true);
});

test("SYNTHETIC reduced motion plays a stepped slideshow with no camera flight or idle frames", async ({ page, api }) => {
  await countFrames(page);
  tourApi(api);
  await page.goto(tourPath);
  await expect(tour(page)).toHaveAttribute("data-mode", "slideshow");
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
  await expect.poll(async () => (await frames(page)).ran).toBeGreaterThan(0);
  await expect(page.locator(".tour-fade")).toBeHidden();
  await expectNoFrames(page);
  for (const beat of ["1", "2", "3"]) {
    await page.keyboard.press("ArrowRight");
    await expect(tour(page)).toHaveAttribute("data-beat", beat);
    // A slide is one still repaint, then nothing: the camera snaps instead of flying.
    await expectNoFrames(page, 500);
  }
  await expect(page.locator(".tour-stage .world-canvas-wrap.style-red-alert")).toBeVisible();
  // Still hands-free: the slideshow advances by itself.
  await expect(tour(page)).toHaveAttribute("data-beat", "4", { timeout: 6000 });
});

test("SYNTHETIC hidden page runs zero requestAnimationFrame work and resumes when visible", async ({ page, api }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await countFrames(page);
  tourApi(api);
  await page.goto(tourPath);
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
  const start = await frames(page);
  await page.waitForTimeout(600);
  expect((await frames(page)).ran - start.ran, "the visible tour animates").toBeGreaterThan(10);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(tour(page)).toHaveAttribute("data-state", "paused");
  await expectNoFrames(page, 1500);
  const beat = await tour(page).getAttribute("data-beat");
  await page.waitForTimeout(3000);
  await expect(tour(page)).toHaveAttribute("data-beat", beat!);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
  const resumed = await frames(page);
  await expect.poll(async () => (await frames(page)).ran).toBeGreaterThan(resumed.ran + 5);
});

test("SYNTHETIC ?record=1 hides cursor and controls and loops", async ({ page, api }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  tourApi(api);
  await page.goto(`${tourPath}?record=1`);
  await expect(tour(page)).toHaveAttribute("data-record", "1");
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
  await expect(page.getByRole("group", { name: "Tour controls" })).toBeHidden();
  expect(await tour(page).evaluate((el) => getComputedStyle(el).cursor)).toBe("none");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  await expect(tour(page)).toHaveAttribute("data-beat-kind", "end");
  // Instead of stopping on the end card, the recording loops back to the intro.
  await expect(tour(page)).toHaveAttribute("data-beat", "0", { timeout: 8000 });
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
});

test("SYNTHETIC tour with no cached worlds shows the end card instead of breaking", async ({ page, api }) => {
  tourApi(api, { allMissing: true });
  await page.goto(tourPath);
  await expect(tour(page)).toHaveAttribute("data-state", "empty");
  await expect(page.getByText("NO CACHED WORLDS YET")).toBeVisible();
  await expect(page.getByRole("link", { name: "Build your world" })).toBeVisible();
  await expect(page.getByTestId("world-canvas")).toHaveCount(0);
  expect(api.requests.every((r) => r.method === "GET")).toBe(true);
});

test("SYNTHETIC tour screenshots (only with MOONSHOT_TOUR_SHOTS)", async ({ page, api }) => {
  test.skip(!SHOTS, "Set MOONSHOT_TOUR_SHOTS=<dir> to capture review screenshots.");
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  tourApi(api);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(tourPath);
  await expect(tour(page)).toHaveAttribute("data-state", "playing");
  // Real-time pass: two frames per beat (just after the cut, then settled).
  for (let beat = 0; beat < 9; beat++) {
    await expect(tour(page)).toHaveAttribute("data-beat", String(beat), { timeout: 8000 });
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${SHOTS}/desktop-${String(beat).padStart(2, "0")}a.png` });
    await page.waitForTimeout(1900);
    await page.screenshot({ path: `${SHOTS}/desktop-${String(beat).padStart(2, "0")}b.png` });
  }
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${SHOTS}/desktop-end.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(tourPath);
  await expect(tour(page)).toHaveAttribute("data-beat", "1", { timeout: 8000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/mobile-390-beat1.png` });
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOTS}/mobile-390-beat2.png` });
  await page.getByRole("button", { name: "Skip tour" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/mobile-390-end.png` });
});
