import { basePath, test, expect, openWorld } from "./fixtures";

test("SYNTHETIC five perspectives preserve selected node, source identity and node data", async ({ page, api }) => {
  await openWorld(page);
  const rows = page.locator(".district-list").getByRole("button");
  const originalLabels = await rows.allTextContents();
  await rows.filter({ hasText: "SYNTHETIC Web" }).click();
  const inspector = page.locator(".inspector");
  const dock = page.getByRole("group", { name: "World perspective" });
  for (const [style, name] of [
    ["moonshot", "Moonshot"],
    ["factorio", "Factorio"],
    ["red-alert", "Red Alert"],
    ["red-alert-2", "Red Alert 2"],
    ["civilization", "Civilization"],
  ]) {
    const button = dock.getByRole("button", { name, exact: false }).filter({ hasText: new RegExp(`${name}$`) });
    await button.click();
    await expect(button).toHaveClass(/active/);
    await expect(page).toHaveURL(new RegExp(`style=${style}$`));
    await expect(inspector.getByRole("heading", { name: "SYNTHETIC Web", exact: true })).toBeVisible();
    await expect(inspector.getByRole("link", { name: "Inspect on GitHub" })).toHaveAttribute(
      "href",
      `${api.world.repo.url}/tree/${api.world.headSha}/apps/web`,
    );
    expect(await rows.allTextContents()).toEqual(originalLabels);
    await expect(page.locator(`.world-canvas-wrap.style-${style}`)).toBeVisible();
  }
  expect(api.requests.filter((r) => r.method === "POST")).toEqual([]);
});

test("SYNTHETIC district search, observed/inferred/unknown and linked source remain distinct", async ({ page, api }) => {
  await openWorld(page);
  const search = page.getByRole("textbox", { name: "Find district" });
  await search.fill("apps/web");
  await expect(page.locator(".district-row")).toHaveCount(1);
  await page.locator(".district-row").click();
  const inspector = page.locator(".inspector");
  await expect(inspector.getByText("SOURCE OBSERVED", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("link", { name: "apps/web/package.json" })).toHaveAttribute(
    "href",
    `${api.world.repo.url}/tree/${api.world.headSha}/apps/web/package.json`,
  );
  await inspector.getByRole("button", { name: /SYNTHETIC API/ }).click();
  await expect(inspector.getByText("STRUCTURE INFERRED", { exact: true })).toBeVisible();
  await expect(inspector.locator(".node-facts").getByText("unknown", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("link", { name: "Inspect on GitHub" })).toHaveAttribute("target", "_blank");
  await expect(inspector.getByRole("link", { name: "Inspect on GitHub" })).toHaveAttribute("rel", /noopener/);
  await search.fill("no-such-synthetic-district");
  await expect(page.getByText("No matching districts.", { exact: true })).toBeVisible();
  await search.clear();
  await page.getByRole("button", { name: "Close district" }).click();
  await expect(inspector.getByText("Path tree partially sampled", { exact: true })).toBeVisible();
  await expect(inspector.getByText(api.world.coverage.notes[0], { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Map legend", exact: true }).click();
  await expect(page.getByText("Moving particles illustrate connections, not runtime traffic.", { exact: true })).toBeVisible();
});

test("SYNTHETIC activity renders success, failure and skipped separately with original links", async ({ page, api }) => {
  await openWorld(page);
  await expect(page.locator(".ci-status")).toHaveText("1 check need attention");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  for (const run of api.world.workflows) {
    const row = page.getByRole("link", { name: new RegExp(run.name) });
    await expect(row).toHaveAttribute("href", run.url);
    await expect(row.locator("em")).toHaveText(run.conclusion!);
    await expect(row.locator(".run-icon")).toHaveClass(
      new RegExp(run.conclusion === "success" ? "good" : run.conclusion === "failure" ? "bad" : "neutral"),
    );
  }
  await expect(page.getByRole("link", { name: /SYNTHETIC draft pull request/ })).toContainText("draft");
  await expect(page.getByRole("link", { name: /SYNTHETIC issue/ })).toHaveAttribute("href", api.world.issues[0].url);
  await expect(page.getByRole("link", { name: /SYNTHETIC commit/ })).toHaveAttribute("href", api.world.commits[0].url);
});

test("SYNTHETIC empty CI evidence is unknown rather than success", async ({ page, api }) => {
  api.world.workflows = [];
  await openWorld(page);
  await expect(page.locator(".ci-status")).toHaveText("No CI evidence");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText("No workflow evidence was returned. An empty window does not mean CI passed.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".run-row")).toHaveCount(0);
});

test("SYNTHETIC skipped CI is not counted as a pass", async ({ page, api }) => {
  api.world.workflows = api.world.workflows.filter((r) => r.conclusion !== "failure");
  await openWorld(page);
  await expect(page.locator(".ci-status")).toHaveText("1 passed · 1 other");
});

test("SYNTHETIC rules fallback notes and guide actions preserve evidence", async ({ page, api }) => {
  api.respond("GET", "/api/budget", () => ({ body: { configured: true, remainingUsd: 1, limitUsd: 1, spentUsd: 0, reservedUsd: 0, calls: 0, provider: "synthetic", model: "synthetic" } }));
  api.respond("POST", "/api/blueprint/synthetic-moonshot/browser-fixture", () => ({ body: api.world }));
  await openWorld(page);
  await page.getByRole("button", { name: "Field guide", exact: true }).click();
  await expect(page.getByText("Evidence-based architecture analysis", { exact: false })).toBeVisible();
  await expect(page.getByText(api.world.blueprint.generator.notes[0], { exact: true })).toBeVisible();
  await expect(page.locator(".mission-card").getByRole("link", { name: "View source" })).toHaveAttribute(
    "href",
    api.world.workflows[1].url,
  );
  await page.getByRole("button", { name: "Generate AI field guide", exact: true }).click();
  await expect.poll(() => api.requests.filter((r) => r.path.startsWith("/api/blueprint/")).length).toBe(1);
  await expect(page.getByText(api.world.blueprint.generator.notes[0], { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /SYNTHETIC web guide/ }).click();
  await expect(page.locator(".inspector").getByRole("heading", { name: "SYNTHETIC Web", exact: true })).toBeVisible();
  await expect(page.getByTestId("world-canvas")).toBeVisible();
});

test("SYNTHETIC unconfigured AI remains disabled with a visible explanation", async ({ page }) => {
  await openWorld(page);
  await page.getByRole("button", { name: "Field guide", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate AI field guide", exact: true })).toBeDisabled();
  await expect(page.getByText("AI guide disabled:", { exact: false })).toBeVisible();
});

test("SYNTHETIC switching between activity and guide starts the new reading view at the top", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await openWorld(page);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.locator(".activity-view").hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.locator(".activity-view").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Field guide", exact: true }).click();
  await expect(page.getByRole("heading", { name: "See the whole. Find your next move." })).toBeVisible();
  expect(await page.locator(".guide-view").evaluate((element) => element.scrollTop)).toBe(0);
});
