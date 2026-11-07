import { test, expect, openWorld } from "./fixtures";

test("SYNTHETIC world provenance is a calm chip whose full record opens by keyboard", async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorld(page);
  const chip = page.locator(".world-provenance .provenance-trigger");
  // The fixture is an illustration (source "demo"); the summary must still say so.
  await expect(chip).toContainText("Illustration");
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  const record = page.getByRole("group", { name: "Snapshot provenance", includeHidden: true });
  await expect(record).toBeHidden();
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(record).toBeVisible();
  await expect(record).toContainText("ILLUSTRATION");
  await expect(record).toContainText(/\d+ observed \/ \d+ inferred/);
  await expect(record).toContainText(/\d+ unknown/);
  await expect(record).toContainText("not runtime telemetry");
  await expect(record).toContainText("motion illustrates connections");
  await expect(record.getByRole("link", { name: new RegExp(api.world.headSha.slice(0, 7)) })).toHaveAttribute(
    "href",
    `${api.world.repo.url}/commit/${api.world.headSha}`,
  );
  await page.keyboard.press("Escape");
  await expect(record).toBeHidden();
  await expect(chip).toBeFocused();
  expect(api.requests.filter((r) => r.method === "POST")).toEqual([]);
});

test("SYNTHETIC stale world keeps the stale state reachable inside the disclosure", async ({ page, api }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  api.world.source = "github"; // SYNTHETIC only: invented facts, never live evidence.
  api.world.refreshAfter = Date.parse("2026-11-04T17:00:00Z"); // already elapsed -> stale
  await openWorld(page);
  const chip = page.locator(".world-provenance .provenance-trigger");
  await expect(chip).toContainText("Stale snapshot");
  await chip.click();
  const record = page.getByRole("group", { name: "Snapshot provenance" });
  await expect(record).toBeVisible();
  await expect(record.locator(".provenance-status")).toHaveText("STALE CACHE · CURRENT STATE UNKNOWN");
  // Outside pointerdown closes: empty topline space between the chip and the tabs.
  const chipBox = (await chip.boundingBox())!;
  await page.mouse.click(chipBox.x + chipBox.width + 40, chipBox.y + chipBox.height / 2);
  await expect(record).toBeHidden();
  // Mobile keeps the same record behind the shorter "Stale" chip.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chip).toContainText("Stale");
  await chip.click();
  await expect(record).toBeInViewport();
  await expect(record).toContainText("STALE CACHE · CURRENT STATE UNKNOWN");
});

for (const width of [320, 390, 768]) {
  test(`SYNTHETIC world page fits ${width}px: no page overflow, one-row topline, every style reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openWorld(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    const topline = await page.locator(".world-topline").boundingBox();
    expect(topline!.height).toBeLessThanOrEqual(60);
    for (const selector of [".world-tabs", ".world-provenance", ".world-source-stamp"]) {
      const box = (await page.locator(`.world-topline > ${selector}`).boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(topline!.y + topline!.height + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await expect(page.getByRole("button", { name: "Refresh GitHub data" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Map legend", exact: true })).toBeVisible();
    const dock = page.getByRole("group", { name: "World perspective" });
    const dockBox = (await dock.boundingBox())!;
    expect(dockBox.x).toBeGreaterThanOrEqual(0);
    expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(width);
    const civilization = dock.getByRole("button").filter({ hasText: /Civilization$/ });
    await civilization.click();
    await expect(civilization).toHaveClass(/active/);
    await expect(civilization).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });
}
