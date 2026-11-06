import { basePath, test, expect } from "./fixtures";
import { syntheticWorld } from "../test/fixtures/browser-world";
const atlasPath = basePath + "/atlas", keys = ["synthetic-atlas/alpha", "synthetic-atlas/beta", "synthetic-atlas/missing"];
function captured(key: string, head: string) { let w = syntheticWorld(); const old = w.repo.url, oldHead = w.headSha; w = JSON.parse(JSON.stringify(w).replaceAll(old, `https://github.com/${key}`).replaceAll(oldHead, head)); const [owner, name] = key.split("/"); w.source = "github"; w.repo = { ...w.repo, owner, name, fullName: key, url: `https://github.com/${key}`, description: "SYNTHETIC 原始源码说明 · captured evidence only", license: "NOASSERTION" }; w.nodes[0].label = "SYNTHETIC 源码"; w.nodes[0].path = "packages/源码"; w.nodes[0].evidence = [`${w.repo.url}/tree/${head}/packages/${encodeURIComponent("源码")}`]; return w; }
async function fixture(page: any, api: any) {
    const worlds = [captured(keys[0], "a".repeat(40)), captured(keys[1], "b".repeat(40))];
    api.respond("GET", "/api/gallery", () => ({ body: { projects: keys.map((key, i) => ({ fullName: key, name: `SYNTHETIC ${key.split("/")[1]}`, description: "SYNTHETIC catalog", category: "Editorial region", suggestedStyle: i === 1 ? "factorio" : "moonshot", ready: true, stars: null, language: null, collectedAt: null })) } }));
    for (const [i, key] of keys.entries())
        api.respond("GET", "/api/world/" + key, (route: any) => { expect(new URL(route.request().url()).search).toBe("?mode=cached"); return i < 2 ? { body: worlds[i] } : { status: 404, body: { code: "CACHE_MISS", error: "Not collected. No collection requested." } }; });
    for(const key of keys) api.respond("GET","/api/gallery-preview/"+key,()=>({body:{state:"unknown",reason:"cache-miss",fullName:key,headSha:null,collectedAt:null,refreshAfter:null,github:"unknown",tree:"unavailable",nodes:[],edges:[],totalNodes:0,totalEdges:0,limited:false}}));
    await page.addInitScript(() => {
        const p = CanvasRenderingContext2D.prototype as any, fill = p.fillRect, text = p.fillText;
        p.fillRect = function (...args: any[]) { if (this.canvas.parentElement?.classList.contains("atlas-map") && args[0] === 0 && args[1] === 0 && args[2] >= this.canvas.clientWidth - 1 && args[3] >= this.canvas.clientHeight - 1) {
            this.canvas.__frames = (this.canvas.__frames ?? 0) + 1;
            this.canvas.__labels = [];
        } return fill.apply(this, args); };
        p.fillText = function (...args: any[]) { if (this.canvas.parentElement?.classList.contains("atlas-map"))
            (this.canvas.__labels ??= []).push({ text: args[0], x: args[1], y: args[2] }); return text.apply(this, args); };
    });
    return worlds;
}
async function showList(page: any) { const button = page.getByRole("button", { name: "Repository list", exact: true }); if (await button.isVisible())
    await button.click(); }
function row(page: any, key: string) { return page.locator(".atlas-list-rows").getByRole("button", { name: new RegExp(key) }); }
test("SYNTHETIC Atlas two-repository cached round trips preserve identity/source/styles/view/focus without stars or POST", async ({ page, api }) => {
    const worlds = await fixture(page, api);
    await page.goto(atlasPath);
    await expect(row(page, keys[0])).toContainText("Cached status not checked");
    expect(api.requests.filter((r: any) => r.path.includes("/api/world/"))).toEqual([]);
    for (const [i, key] of keys.slice(0, 2).entries()) {
        await row(page, key).click();
        const card = page.locator(".atlas-card");
        await expect(card.getByText("Discovered on this device · No Exploration star awarded.", { exact: true })).toBeVisible();
        await expect(card.getByRole("link", { name: "GitHub source" })).toHaveAttribute("href", worlds[i].repo.url);
        await expect(card).toContainText("Stale capture · current state unknown");
        await expect(card).toContainText("Historical trees unavailable");
        const cv = page.locator(".atlas-map > canvas");
        await cv.focus();
        await cv.press("=");
        await cv.press("ArrowDown");
        const before = await page.evaluate(() => JSON.parse(sessionStorage.getItem("moonfactory.atlas.session.v1")!));
        await card.getByRole("link", { name: "Enter cached world" }).click();
        await expect(page).toHaveURL(new RegExp(`/world/${key}\\?`));
        await expect(page.locator(".explorer-visit-status")).toContainText("Visited on this device");
        await expect(page.locator(".explorer-visit-status")).toContainText("No Exploration star");
        await page.locator(".district-list").getByRole("button", { name: /SYNTHETIC 源码/ }).click();
        const inspector = page.locator(".inspector");
        await expect(inspector.locator(".path-label")).toHaveText("packages/源码");
        await expect(inspector.getByRole("link", { name: "Inspect on GitHub" })).toHaveAttribute("href", `${worlds[i].repo.url}/tree/${worlds[i].headSha}/packages/${encodeURIComponent("源码")}`);
        for (const name of ["Moon Factory", "Factorio", "Red Alert", "Red Alert 2", "Civilization"]) {
            await page.getByRole("group", { name: "World perspective" }).getByRole("button", { name: new RegExp(name + "$") }).click();
            await expect(inspector.locator(".path-label")).toHaveText("packages/源码");
        }
        await page.getByRole("link", { name: "Back to Atlas", exact: true }).click();
        await expect(page.locator(".atlas-card")).toContainText("Visited on this device");
        await expect(row(page, key)).toBeFocused();
        const after = await page.evaluate(() => JSON.parse(sessionStorage.getItem("moonfactory.atlas.session.v1")!));
        expect(after.centerX).toBeCloseTo(before.centerX, 5);
        expect(after.centerY).toBeCloseTo(before.centerY, 5);
        expect(after.zoomRatio).toBeCloseTo(before.zoomRatio, 6);
    }
    expect(api.requests.filter((r: any) => r.method === "POST" || r.path.includes("blueprint") || r.path.includes("budget"))).toEqual([]);
});
test("SYNTHETIC unchecked, real cache miss and 503 stay separate, with no implicit collection", async ({ page, api }) => {
    await fixture(page, api);
    api.respond("GET", "/api/world/" + keys[1], () => ({ status: 503, body: { code: "WORLD_STORAGE_UNAVAILABLE", error: "SYNTHETIC authoritative store unavailable" } }));
    await page.goto(atlasPath);
    await expect(row(page, keys[2])).toContainText("Cached status not checked");
    await row(page, keys[2]).click();
    await expect(page.locator(".atlas-card .atlas-status")).toHaveText("Not collected");
    await expect(page.getByRole("link", { name: "Enter cached world" })).toHaveCount(0);
    await row(page, keys[1]).click();
    await expect(page.locator(".atlas-card .atlas-status")).toHaveText("Cached facts unavailable");
    await expect(page.locator(".atlas-card")).not.toContainText("Not collected");
    expect(api.requests.every((r: any) => r.method === "GET")).toBe(true);
});
test("SYNTHETIC actual painted map label selects the same repository as its visible list and stays idle", async ({ page, api }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await fixture(page, api);
    await page.goto(atlasPath);
    await row(page, keys[0]).click();
    await expect(page.getByRole("link", { name: "Enter cached world" })).toBeVisible();
    await page.getByRole("button", { name: "Close selected landmark" }).click();
    const cv = page.locator(".atlas-map > canvas");
    await expect.poll(() => cv.evaluate((c: any, key: string) => c.__labels?.some((p: any) => p.text === key), keys[0])).toBe(true);
    const label = await cv.evaluate((c: any, key: string) => c.__labels.find((p: any) => p.text === key), keys[0]), box = (await cv.boundingBox())!;
    await page.mouse.click(box.x + label.x, box.y + label.y);
    await expect(row(page, keys[0])).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".atlas-card")).toContainText("a".repeat(40));
    await page.waitForTimeout(150);
    const before = await cv.evaluate((c: any) => c.__frames);
    await page.waitForTimeout(200);
    expect(await cv.evaluate((c: any) => c.__frames)).toBe(before);
    const dimensions = await cv.evaluate((c: any) => ({ width: c.width, height: c.height, css: c.getBoundingClientRect().width }));
    expect(dimensions.width / dimensions.css).toBeLessThanOrEqual(1.501);
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(4000000);
});
for (const width of [320, 390, 768])
    test(`SYNTHETIC Atlas ${width}px cached identity/source/keyboard remain readable without horizontal overflow`, async ({ page, api }) => {
        await page.setViewportSize({ width, height: 1000 });
        await fixture(page, api);
        await page.goto(atlasPath);
        await showList(page);
        await row(page, keys[0]).focus();
        await page.keyboard.press("ArrowDown");
        await expect(row(page, keys[1])).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.locator(".atlas-card")).toContainText("b".repeat(40));
        await expect(page.locator(".atlas-card").getByRole("link", { name: "GitHub source" })).toHaveAttribute("href", "https://github.com/" + keys[1]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await page.locator(".atlas-card").evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
        await page.getByRole("link", { name: "Enter cached world" }).click();
        await expect(page.locator(".explorer-visit-status")).toContainText("Visited on this device");
        await page.getByRole("link", { name: "Back to Atlas", exact: true }).click();
        await expect(row(page, keys[1])).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
test("SYNTHETIC hidden Atlas map stops drawing, resumes one state-correct frame and never polls", async ({ page, api }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await fixture(page, api);
    await page.goto(atlasPath);
    const cv = page.locator(".atlas-map > canvas");
    await expect.poll(() => cv.evaluate((c: any) => c.__frames ?? 0)).toBeGreaterThan(0);
    await showList(page);
    await page.waitForTimeout(150);
    const frames = await cv.evaluate((c: any) => c.__frames), requests = api.requests.length;
    await page.waitForTimeout(250);
    expect(await cv.evaluate((c: any) => c.__frames)).toBe(frames);
    expect(api.requests.length).toBe(requests);
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect.poll(() => cv.evaluate((c: any) => c.__frames)).toBeGreaterThan(frames);
});
test("SYNTHETIC real two-touch pinch and cancellation never become repository entry or collection", async ({ page, api, context }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await fixture(page, api);
    await page.goto(atlasPath);
    const cv = page.locator(".atlas-map > canvas");
    await expect.poll(() => cv.evaluate((c: any) => c.__frames ?? 0)).toBeGreaterThan(0);
    const b = (await cv.boundingBox())!, cx = b.x + b.width / 2, cy = b.y + b.height / 2, cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 70, y: cy, id: 1 }, { x: cx + 70, y: cy, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("moonfactory.atlas.session.v1")!).zoomRatio)).toBeGreaterThan(1);
    expect(api.requests.filter((r: any) => r.path.includes("/api/world/"))).toEqual([]);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + 35, y: cy + 35, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await cv.focus();
    await cv.press("0");
    await showList(page);
    await row(page, keys[0]).click();
    await expect(page.getByRole("link", { name: "Enter cached world" })).toBeVisible();
    expect(api.requests.every((r: any) => r.method === "GET")).toBe(true);
});

test("SYNTHETIC Atlas light/dark chrome computes readable contrast and mobile entry stays visible", async ({ page, api }, testInfo) => {
    await fixture(page, api);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(basePath + "/");
    await expect(page.getByRole("link", { name: "Explore Atlas", exact: true }).filter({ visible: true })).toBeVisible();
    await page.getByRole("link", { name: "Explore Atlas", exact: true }).filter({ visible: true }).click();
    await showList(page);
    await row(page, keys[0]).click();
    await expect(page.getByRole("link", { name: "Enter cached world" })).toBeVisible();
    const audit = await page.evaluate(() => {
        const rgb = (value: string) => { const a = value.match(/[\d.]+/g)?.map(Number) ?? []; return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 1]; };
        const over = (a: number[], b: number[]) => { const alpha = a[3] + b[3] * (1 - a[3]); return [0, 1, 2].map(i => (a[i] * a[3] + b[i] * b[3] * (1 - a[3])) / (alpha || 1)).concat(alpha); };
        const lum = (a: number[]) => a.slice(0, 3).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
        const failures: unknown[] = [], samples: unknown[] = [];
        for (const el of document.querySelectorAll(".atlas-shell *")) {
            const c = getComputedStyle(el), r = el.getBoundingClientRect();
            if (!r.width || !r.height || c.visibility === "hidden" || el.closest(".sr-only")) continue;
            const text = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
            if (!text) continue;
            const ancestors: Element[] = []; let p: Element | null = el;
            while (p) { ancestors.unshift(p); p = p.parentElement; }
            let bg = [255, 255, 255, 1], opacity = 1;
            for (const ancestor of ancestors) { const style = getComputedStyle(ancestor); bg = over(rgb(style.backgroundColor), bg); opacity *= Number(style.opacity); }
            const foreground = rgb(c.color); foreground[3] *= opacity;
            const a = lum(over(foreground, bg)), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
            const sample = { tag: el.tagName, text: text.slice(0, 100), ratio, size: c.fontSize };
            samples.push(sample);
            if (ratio < (parseFloat(c.fontSize) >= 24 ? 3 : 4.5) || parseFloat(c.fontSize) < 12) failures.push(sample);
        }
        return { samples, failures, width: innerWidth, documentWidth: document.documentElement.scrollWidth };
    });
    expect(audit.failures).toEqual([]);
    expect(audit.samples.length).toBeGreaterThan(15);
    expect(audit.documentWidth).toBe(audit.width);
    await testInfo.attach("computed-contrast-synthetic.json", { body: JSON.stringify(audit, null, 2), contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath("atlas-390-synthetic.png"), fullPage: true });
});
