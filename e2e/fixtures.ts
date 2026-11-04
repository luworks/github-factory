import { test as base, expect, type Page, type Route } from "@playwright/test";
import { syntheticBudget, syntheticGallery, syntheticWorld } from "../test/fixtures/browser-world";
import type { WorldSnapshot } from "../src/contracts";

export const basePath = new URL(process.env.MOONSHOT_E2E_URL ?? "http://127.0.0.1:4177/github-factory/").pathname.replace(/\/$/, "");
export const worldPath = `${basePath}/world/synthetic-moonshot/browser-fixture`;
export const worldApi = "/api/world/synthetic-moonshot/browser-fixture";
export type ApiReply = { status?: number; body: unknown };
type ReplyHandler = (route: Route) => ApiReply | Promise<ApiReply>;
type FixtureApi = {
  world: WorldSnapshot;
  requests: { method: string; path: string; body: unknown }[];
  respond: (method: string, path: string, handler: ReplyHandler) => void;
};

export const test = base.extend<{ api: FixtureApi; runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use();
      expect(errors, "The browser must not throw uncaught application errors").toEqual([]);
    },
    { auto: true },
  ],
  api: [
    async ({ context, baseURL }, use) => {
      const origin = new URL(baseURL!).origin;
      const world = syntheticWorld();
      const requests: FixtureApi["requests"] = [];
      const unexpected: string[] = [];
      const handlers = new Map<string, ReplyHandler>();
      const respond = (method: string, path: string, handler: ReplyHandler) => handlers.set(`${method} ${path}`, handler);
      respond("GET", "/api/gallery", () => ({ body: { projects: syntheticGallery } }));
      respond("GET", "/api/gallery-preview/synthetic-moonshot/browser-fixture", () => ({ body: { state: "unknown", reason: "cache-miss", fullName: world.repo.fullName, headSha: null, collectedAt: null, refreshAfter: null, github: "unknown", tree: "unavailable", nodes: [], edges: [], totalNodes: 0, totalEdges: 0, limited: false } }));
      respond("GET", "/api/budget", () => ({ body: syntheticBudget }));
      respond("GET", worldApi, () => ({ body: world }));
      // Creation/enrichment/refresh must be explicitly opted into by each test.
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        // Deliberately use local fallback fonts: no network dependency or font pixel oracle.
        if (url.origin === "https://fonts.googleapis.com" && url.pathname === "/css2") {
          return route.fulfill({ status: 200, contentType: "text/css", body: "/* Offline UI fixture: system fonts. */" });
        }
        if (url.origin !== origin) {
          unexpected.push(`External request blocked: ${request.method()} ${url.origin}${url.pathname}`);
          await route.abort("blockedbyclient");
          return;
        }
        const logicalPath = url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : url.pathname;
        if (!logicalPath.startsWith("/api/")) return route.continue();
        const key = `${request.method()} ${logicalPath}`;
        requests.push({ method: request.method(), path: logicalPath, body: request.postData() ? request.postDataJSON() : null });
        const handler = handlers.get(key);
        if (!handler) {
          unexpected.push(`Undeclared API request blocked: ${key}`);
          await route.fulfill({
            status: 501,
            json: { error: "SYNTHETIC fixture did not authorize this request", code: "TEST_UNDECLARED_ROUTE" },
          });
          return;
        }
        const reply = await handler(route);
        await route.fulfill({ status: reply.status ?? 200, json: reply.body });
      });
      await use({ world, requests, respond });
      expect(unexpected, "Only explicitly declared synthetic APIs may be requested").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function openWorld(page: Page) {
  await page.goto(worldPath);
  await expect(page.getByRole("heading", { name: "browser-fixture" }).first()).toBeVisible();
}

export function deferredReply() {
  let release!: (reply: ApiReply) => void;
  const promise = new Promise<ApiReply>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
