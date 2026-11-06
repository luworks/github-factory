import { expect, test } from "bun:test";
import { constrain, fit, pan, project, resizeCamera, unproject, wheelFactor, zoomAt, SCENE } from "../src/atlas/camera";
import { factsFromWorld, homeBounds, layoutLandmarks, visibleGroups, statusText } from "../src/atlas/model";
import { readAtlasSession, saveAtlasSession, validateSession, validatedReturnToken, atlasBackHref, type AtlasSession } from "../src/atlas/session";
import { selectionLoader } from "../src/atlas/loader";
import { CURATED_PROJECTS } from "../src/catalog";
import type { FeaturedProject } from "../src/contracts";
import { syntheticWorld } from "./fixtures/browser-world";
const size = { width: 1000, height: 700 };
test("SYNTHETIC camera projection/inverse, pointer zoom and pan preserve coordinates before bounds", () => {
    const camera = { centerX: 4096, centerY: 3072, zoom: .5 }, point = { x: 325, y: 220 }, world = unproject(point, camera, size);
    expect(project(world, camera, size)).toEqual(point);
    const zoomed = zoomAt(camera, 1.2, point, size), after = project(world, zoomed, size);
    expect(after.x).toBeCloseTo(point.x, 8);
    expect(after.y).toBeCloseTo(point.y, 8);
    const moved = project(world, pan(camera, 70, -30, size), size);
    expect(moved.x - point.x).toBeCloseTo(70);
    expect(moved.y - point.y).toBeCloseTo(-30);
    expect(wheelFactor(3, 1, 700)).toBeCloseTo(wheelFactor(48, 0, 700));
    expect(wheelFactor(1, 2, 700)).toBe(wheelFactor(240, 0, 700));
});
test("SYNTHETIC camera finite bounds and resize retain center/relative home zoom, including very wide view", () => {
    const points = layoutLandmarks(CURATED_PROJECTS, []), home = homeBounds(points), camera = constrain(fit(home, size), size), next = { width: 1200, height: 900 }, resized = resizeCamera(camera, size, next, home);
    expect(resized.centerX).toBeCloseTo(camera.centerX, 8);
    expect(resized.centerY).toBeCloseTo(camera.centerY, 8);
    expect(resized.zoom / fit(home, next).zoom).toBeCloseTo(camera.zoom / fit(home, size).zoom, 8);
    for (const input of [{ centerX: NaN, centerY: Infinity, zoom: -1 }, { centerX: 1e90, centerY: -1e90, zoom: 100 }]) {
        const c = constrain(input, size);
        expect([c.centerX, c.centerY, c.zoom].every(Number.isFinite)).toBe(true);
        expect(c.centerX).toBeGreaterThanOrEqual(SCENE.left);
        expect(c.centerX).toBeLessThanOrEqual(SCENE.right);
        expect(c.zoom).toBeLessThanOrEqual(2.5);
    }
});
test("SYNTHETIC stable editorial/import slots ignore response order, heads, metadata and later imports", () => {
    const a = layoutLandmarks(CURATED_PROJECTS, ["synthetic/first"]), b = layoutLandmarks([...CURATED_PROJECTS].reverse().map(p => ({ ...p, stars: 12345, collectedAt: "different" })), ["synthetic/first", "synthetic/second"]);
    for (const p of a)
        expect(b.find(x => x.repoKey === p.repoKey)).toEqual(p);
    expect(a).toHaveLength(CURATED_PROJECTS.length + 1);
});
for (const population of [0, 19, 100, 500, 2000])
    test(`SYNTHETIC atlas density ${population} retains every visible identity through bounded clusters`, () => {
        const projects: FeaturedProject[] = Array.from({ length: population }, (_, i) => ({ fullName: `synthetic/repo-${i}`, name: `Repo ${i}`, description: "SYNTHETIC", category: "Editorial region", language: null, stars: null, ready: false, collectedAt: null, suggestedStyle: "moonshot" }));
        const landmarks = layoutLandmarks(projects, []), camera = fit(SCENE, size), groups = visibleGroups(landmarks, camera, size, landmarks[0]?.repoKey ?? null), keys = groups.flatMap(g => g.keys);
        expect(new Set(keys).size).toBe(population);
        expect(keys.length).toBe(population);
        expect(groups.filter(g => g.keys.length === 1).length).toBeLessThanOrEqual(80);
        expect(groups.filter(g => g.keys.length > 1).length).toBeLessThanOrEqual(32);
        if (population)
            expect(groups.some(g => g.keys.length === 1 && g.keys[0] === landmarks[0].repoKey)).toBe(true);
    });
test("SYNTHETIC unchecked/miss/storage failure remain separate and history cannot block a stale real capture", () => {
    expect(statusText()).toBe("Cached status not checked");
    expect(statusText({ state: "miss" })).toBe("Not collected");
    expect(statusText({ state: "unavailable" })).toBe("Cached facts unavailable");
    const w = syntheticWorld();
    w.source = "github";
    w.repo.license = "NOASSERTION";
    const facts = factsFromWorld(w, w.repo.fullName.toLowerCase());
    expect(facts?.identity.headSha).toBe(w.headSha);
    expect(facts?.license).toBe("NOASSERTION");
    expect(factsFromWorld(w, "wrong/repository")).toBe(null);
});
test("SYNTHETIC session restoration rejects corrupt numbers/oversize input and only local exact return tokens restore", () => {
    const session: AtlasSession = { layoutVersion: 1, centerX: 1400, centerY: 1000, zoomRatio: 1, selectedRepoKey: "synthetic/repo", focusOrigin: "list", listScroll: 25, importedRepoKeys: [], returnToken: "11111111-1111-4111-8111-111111111111" };
    let text = "";
    expect(saveAtlasSession(session, { setItem: (_k, v) => text = v })).toBe(true);
    expect(readAtlasSession({ getItem: () => text }).value).toEqual(session);
    expect(validateSession({ ...session, centerX: NaN })).toBe(false);
    expect(validateSession({ ...session, zoomRatio: -1 })).toBe(false);
    expect(readAtlasSession({ getItem: () => "x".repeat(32769) }).saved).toBe(false);
    expect(saveAtlasSession(session, { setItem: () => { throw Error("SYNTHETIC denied"); } })).toBe(false);
    expect(validatedReturnToken(`?mode=cached&from=atlas&atlasReturn=${session.returnToken}`, session)).toBe(session.returnToken);
    expect(validatedReturnToken(`?mode=cached&mode=cached&from=atlas&atlasReturn=${session.returnToken}`, session)).toBe(null);
    expect(atlasBackHref("?mode=cached&from=https://evil.test&atlasReturn=bad", session)).toMatch(/\/atlas\?home=1$/);
});
test("SYNTHETIC selection loader caps concurrency at two, replaces queued work and discards late identities", async () => {
    const releases = new Map<string, (value: string) => void>(), calls: string[] = [], accepted: string[] = [], errors: unknown[] = [];
    let active = 0, peak = 0;
    const loader = selectionLoader((key: string) => { calls.push(key); active++; peak = Math.max(peak, active); return new Promise<string>(resolve => releases.set(key, v => { active--; resolve(v); })); });
    for (const key of ["a", "b", "c", "d"])
        loader.select(key, v => accepted.push(v), e => errors.push(e));
    expect(calls).toEqual(["a", "b"]);
    releases.get("a")!("old a");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toEqual(["a", "b", "d"]);
    releases.get("b")!("old b");
    releases.get("d")!("selected d");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(accepted).toEqual(["selected d"]);
    expect(errors).toEqual([]);
    expect(peak).toBe(2);
    loader.select("e", v => accepted.push(v), e => errors.push(e));
    loader.cancel();
    releases.get("e")!("cancelled");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(accepted).toEqual(["selected d"]);
});
