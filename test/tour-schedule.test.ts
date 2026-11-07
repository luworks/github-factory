import { expect, test } from "bun:test";
import { STYLE_IDS, type FeaturedProject, type WorldSnapshot } from "../src/contracts";
import {
  BEAT_MS,
  beatIndexAt,
  collectStops,
  createTourClock,
  END_MS,
  INTRO_MS,
  nextBoundary,
  notableDistricts,
  planTour,
  shotAt,
  tourCandidates,
  tourDuration,
  tourProgress,
  type TourStop,
} from "../src/tour/schedule";
import { syntheticWorld } from "./fixtures/browser-world";

/** SYNTHETIC worlds and gallery rows only. */
const world = (fullName: string): WorldSnapshot => {
  const base = syntheticWorld();
  const [owner, name] = fullName.split("/");
  return { ...base, repo: { ...base.repo, owner, name, fullName } };
};
const project = (fullName: string, ready = true, suggestedStyle: FeaturedProject["suggestedStyle"] = "factorio"): FeaturedProject => ({
  fullName, name: fullName, description: "SYNTHETIC", category: "SYNTHETIC", language: null, stars: null, ready, collectedAt: null, suggestedStyle,
});
const stops = (n: number): TourStop[] => Array.from({ length: n }, (_, i) => ({ world: world(`synthetic/repo-${i}`), style: STYLE_IDS[(i + 1) % 5] }));

test("plan: intro, five perspectives on the first world, two per further world, end card", () => {
  const beats = planTour(stops(3));
  expect(beats.map((b) => b.kind)).toEqual(["intro", "repo", "perspective", "perspective", "perspective", "perspective", "repo", "perspective", "repo", "perspective", "end"]);
  expect(beats.slice(1, 6).map((b) => b.style)).toEqual([...STYLE_IDS]);
  expect(beats.slice(1, 6).every((b) => b.stop === 0)).toBe(true);
  // Every further world shows at least two distinct perspectives.
  for (const stop of [1, 2]) expect(new Set(beats.filter((b) => b.stop === stop && b.kind !== "end").map((b) => b.style)).size).toBe(2);
  expect(beats[6].style).toBe(STYLE_IDS[2]);
  // Contiguous timeline inside the 30–45 s showcase budget.
  beats.forEach((b, i) => expect(b.start).toBe(i ? beats[i - 1].start + beats[i - 1].duration : 0));
  expect(tourDuration(beats)).toBe(INTRO_MS + 9 * BEAT_MS + END_MS);
  expect(tourDuration(planTour(stops(3)))).toBeGreaterThanOrEqual(30_000);
  expect(tourDuration(planTour(stops(4)))).toBeLessThanOrEqual(45_000);
});

test("plan: captions stay honest and preserve original GitHub text", () => {
  const s = stops(2);
  s[0].world.repo.description = "Original — GitHub description ✓ <b>kept</b>";
  const beats = planTour(s);
  expect(beats[0].caption.line).toContain("not live telemetry");
  expect(beats[1].caption.title).toBe("synthetic/repo-0");
  expect(beats[1].caption.line).toBe("Original — GitHub description ✓ <b>kept</b>");
  expect(beats[1].caption.meta).toContain("inferred");
  const district = beats.find((b) => b.kind === "perspective")!;
  expect(["observed", "inferred"]).toContain(district.caption.confidence!);
  expect(s[0].world.nodes.map((n) => n.label)).toContain(district.caption.title);
});

test("plan: no stops yields only the end card; reduced motion keeps beats but never flies", () => {
  expect(planTour([]).map((b) => b.kind)).toEqual(["end"]);
  const motion = planTour(stops(3)),
    still = planTour(stops(3), { reducedMotion: true });
  expect(still.map((b) => [b.id, b.start, b.duration])).toEqual(motion.map((b) => [b.id, b.start, b.duration]));
  expect(motion.some((b) => b.shots.length > 1)).toBe(true);
  still.forEach((b, i) => expect(b.shots).toEqual([{ ...motion[i].shots.at(-1)!, at: 0 }]));
});

test("timing: beat lookup, keyframes and the next wake boundary", () => {
  const beats = planTour(stops(1));
  expect(beatIndexAt(beats, 0)).toBe(0);
  expect(beatIndexAt(beats, INTRO_MS - 1)).toBe(0);
  expect(beatIndexAt(beats, INTRO_MS)).toBe(1);
  expect(beatIndexAt(beats, 10 ** 9)).toBe(beats.length - 1);
  expect(shotAt(beats[0], 0).zoom).toBeLessThan(shotAt(beats[0], 1000).zoom);
  expect(nextBoundary(beats, 0)).toBe(beats[0].shots[1].at);
  expect(nextBoundary(beats, beats[0].shots[1].at)).toBe(INTRO_MS);
  expect(nextBoundary(beats, tourDuration(beats))).toBeNull();
  expect(tourProgress(beats, tourDuration(beats) / 2)).toBeCloseTo(0.5);
  expect(tourProgress(beats, -5)).toBe(0);
});

test("clock: pause freezes, play resumes, seek jumps", () => {
  let now = 1000;
  const clock = createTourClock(() => now);
  expect(clock.elapsed()).toBe(0);
  clock.play();
  now += 500;
  expect(clock.elapsed()).toBe(500);
  clock.pause();
  now += 10_000;
  expect(clock.elapsed()).toBe(500);
  expect(clock.playing()).toBe(false);
  clock.play();
  now += 250;
  expect(clock.elapsed()).toBe(750);
  clock.seek(4000);
  now += 100;
  expect(clock.elapsed()).toBe(4100);
  clock.pause();
  clock.seek(-3);
  expect(clock.elapsed()).toBe(0);
});

test("candidates: ready gallery worlds only, showcase order first", () => {
  const list = tourCandidates([
    project("synthetic/zeta"),
    project("react/react"),
    project("synthetic/not-ready", false),
    project("openclaw/openclaw"),
    project("bad name/with space"),
  ]);
  expect(list.map((p) => p.fullName)).toEqual(["openclaw/openclaw", "react/react", "synthetic/zeta"]);
});

test("collect: skips misses and errors, keeps order, stops loading once enough worlds load", async () => {
  const requested: string[] = [];
  const candidates = ["a", "miss", "b", "empty", "c", "d", "e", "f"].map((n) => project(`synthetic/${n}`));
  const found = await collectStops(candidates, async (owner, repo) => {
    requested.push(`${owner}/${repo}`);
    await new Promise((r) => setTimeout(r, repo === "a" ? 5 : 1));
    if (repo === "miss") throw Object.assign(new Error("Not collected"), { status: 404 });
    if (repo === "empty") return { ...world(`${owner}/${repo}`), nodes: [] };
    return world(`${owner}/${repo}`);
  }, 4);
  expect(found.map((s) => s.world.repo.fullName)).toEqual(["synthetic/a", "synthetic/b", "synthetic/c", "synthetic/d"]);
  expect(found[0].style).toBe("factorio");
  // Two misses mean exactly two extra reads beyond the four needed.
  expect(requested).toHaveLength(6);
  expect(await collectStops([], async () => world("x/y"))).toEqual([]);
});

test("districts: guide-named first, no duplicates, externals last resort", () => {
  const w = syntheticWorld();
  w.nodes.push({ ...w.nodes[0], id: "ext", kind: "external", label: "SYNTHETIC external" });
  const picked = notableDistricts(w);
  expect(picked[0].id).toBe("web");
  expect(new Set(picked.map((n) => n.id)).size).toBe(picked.length);
  expect(picked.map((n) => n.id)).not.toContain("ext");
  expect(notableDistricts({ ...w, nodes: [w.nodes.at(-1)!], blueprint: { ...w.blueprint, districts: [] } }).map((n) => n.id)).toEqual(["ext"]);
});
