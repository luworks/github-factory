import { expect, test } from "bun:test";
import type { StyleId } from "../src/contracts";
import {
  buildHeroScene, createParticles, emit, heroDaylight, HERO_THEMES, introLength, PARTICLE_CAP, riseProgress, seeded, spawnAmbient, stepParticles, STILL_TIME,
} from "../src/gallery/hero-scene";

const STYLES: StyleId[] = ["moonshot", "factorio", "red-alert", "red-alert-2", "civilization"];

test("hero scene is deterministic per style and the five themes are visibly distinct", () => {
  for (const style of STYLES) expect(JSON.stringify(buildHeroScene(style))).toBe(JSON.stringify(buildHeroScene(style)));
  const signatures = STYLES.map((style) => { const t = HERO_THEMES[style]; return `${t.grid}|${t.pixel}|${t.sky.day.join()}|${t.accent}|${t.particle}`; });
  expect(new Set(signatures).size).toBe(5);
  const kinds = STYLES.map((style) => [...new Set(buildHeroScene(style).buildings.map((b) => b.kind))].toSorted().join());
  expect(new Set(kinds).size).toBe(5);
  for (const style of STYLES) {
    const scene = buildHeroScene(style);
    expect(scene.buildings.length).toBeGreaterThan(10);
    // The district labels are illustrative fixed names, never repository data.
    expect(scene.buildings.filter((b) => b.label).map((b) => b.label).toSorted()).toEqual(["API gateway", "Agent engine", "Data vault", "Web app"]);
  }
});

test("construction easing starts at zero, settles at one and finishes within the intro", () => {
  expect(riseProgress(0, 0.5)).toBe(0);
  expect(riseProgress(10, 0.5)).toBe(1);
  for (let t = 0; t < 2; t += 0.01) { const r = riseProgress(t, 0.2); expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1.06); }
  const scene = buildHeroScene("factorio");
  expect(scene.buildings.every((b) => riseProgress(introLength(scene), b.delay) === 1)).toBe(true);
});

test("day/night cycle covers night and full day; the reduced-motion still is lit at golden hour", () => {
  const samples = Array.from({ length: 280 }, (_, i) => heroDaylight(i / 10));
  expect(Math.min(...samples.map((s) => s.daylight))).toBe(0);
  expect(Math.max(...samples.map((s) => s.daylight))).toBe(1);
  for (const s of samples) { expect(s.dusk).toBeGreaterThanOrEqual(0); expect(s.dusk).toBeLessThanOrEqual(1); }
  const still = heroDaylight(STILL_TIME);
  expect(still.daylight).toBeGreaterThan(0.1);
  expect(still.daylight).toBeLessThan(0.9);
});

test("particle pool is a fixed-size ring that never grows", () => {
  const pool = createParticles();
  for (let i = 0; i < PARTICLE_CAP * 3; i++) emit(pool, i, i, 0, 0, 1, 1);
  expect(pool.x.length).toBe(PARTICLE_CAP);
  expect(pool.next).toBe(0);
  const scene = buildHeroScene("moonshot"), random = seeded(1);
  for (let i = 0; i < 600; i++) { spawnAmbient(pool, scene, 1 / 60, i / 60, random, () => true); stepParticles(pool, 1 / 60, "dust"); }
  expect(pool.life.length).toBe(PARTICLE_CAP);
  expect([...pool.life].every((life) => Number.isFinite(life))).toBe(true);
});
