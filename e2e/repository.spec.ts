import { basePath, test, expect, deferredReply, openWorld, worldApi, worldPath } from "./fixtures";

test("SYNTHETIC repository form: empty guard, pending state, explicit failure, retry and navigation", async ({ page, api }) => {
  const pending = deferredReply();
  let attempts = 0;
  api.respond("POST", "/api/worlds", async () => (++attempts === 1 ? pending.promise : { body: api.world }));
  await page.goto(`${basePath}/`);
  await expect(page).toHaveTitle("Moon Factory — Your codebase, a living world");
  await expect(page.getByRole("link", { name: "Moon Factory home", exact: true }).first()).toBeVisible();
  const input = page.getByRole("textbox", { name: "GitHub repository URL" });
  const generate = page.getByRole("button", { name: "Generate world", exact: true });
  await expect(generate).toBeDisabled();
  await input.fill("https://github.com/synthetic-moonshot/browser-fixture");
  await generate.click();
  await expect(page.getByRole("status")).toContainText("Surveying public source");
  await expect(input).toBeDisabled();
  await expect(page.getByRole("button", { name: "Mapping", exact: true })).toBeDisabled();
  pending.release({ status: 503, body: { error: "SYNTHETIC temporary upstream failure", code: "TEST_UNAVAILABLE" } });
  await expect(page.getByRole("alert")).toHaveText("SYNTHETIC temporary upstream failure");
  await expect(input).toBeEnabled();
  await generate.click();
  await expect(page).toHaveURL(new RegExp(`${worldPath}\\?style=moonshot$`));
  await expect(page.getByRole("heading", { name: "browser-fixture" }).first()).toBeVisible();
  expect(api.requests.filter((r) => r.path === "/api/worlds")).toEqual([
    { method: "POST", path: "/api/worlds", body: { repo: "https://github.com/synthetic-moonshot/browser-fixture", enrich: false } },
    { method: "POST", path: "/api/worlds", body: { repo: "https://github.com/synthetic-moonshot/browser-fixture", enrich: false } },
  ]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("SYNTHETIC gallery opens the fixture world with its suggested perspective", async ({ page, api }) => {
  await page.goto(`${basePath}/`);
  const card = page.getByRole("link").filter({ has: page.getByRole("heading", { name: "SYNTHETIC Atlas", exact: true }) });
  await expect(card).toContainText("SYNTHETIC UI FIXTURE");
  await expect(card).toHaveAttribute("href", `${worldPath}?style=civilization`);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${worldPath}\\?style=civilization$`));
  await expect(page.getByRole("group", { name: "World perspective" }).getByRole("button", { name: "Civilization" })).toHaveClass(/active/);
  expect(api.requests.filter((r) => r.method === "POST")).toEqual([]);
});

test("SYNTHETIC explorer loading and failed collection can recover through retry", async ({ page, api }) => {
  const pending = deferredReply();
  let calls = 0;
  api.respond("GET", worldApi, () => (++calls === 1 ? pending.promise : { body: api.world }));
  await page.goto(worldPath);
  await expect(page.getByRole("heading", { name: "Surveying your world." })).toBeVisible();
  pending.release({ status: 502, body: { error: "SYNTHETIC collection unavailable", code: "TEST_COLLECTION" } });
  await expect(page.getByRole("alert")).toContainText("SYNTHETIC collection unavailable");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(calls).toBe(2);
});

test("SYNTHETIC refresh preserves existing evidence on failure and does not request enrichment", async ({ page, api }) => {
  const pending = deferredReply();
  api.respond("POST", worldApi, () => pending.promise);
  await openWorld(page);
  const refresh = page.getByRole("button", { name: "Refresh GitHub data" });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  pending.release({ status: 429, body: { error: "SYNTHETIC rate limit; cached evidence retained", code: "TEST_RATE_LIMIT" } });
  await expect(page.getByRole("alert")).toContainText("cached evidence retained");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect(refresh).toBeEnabled();
  expect(api.requests.filter((r) => r.method === "POST")).toEqual([{ method: "POST", path: worldApi, body: { refresh: true } }]);
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
