import { expect, test } from "bun:test";
import { projectRepositoryPreview, readRepositoryPreview } from "../src/server/gallery-preview";
import { syntheticWorld } from "./fixtures/browser-world";

const now = Date.parse("2026-11-04T17:00:00Z");
function fixture() {
  const world = syntheticWorld();
  // SYNTHETIC test-only source flag, never persisted or used as live evidence.
  world.source = "github";
  world.refreshAfter = now + 60_000;
  return world;
}
test("SYNTHETIC cache miss performs exactly one cache lookup and returns no invented map", () => {
  let reads = 0;
  const result = readRepositoryPreview("owner/repo", () => { reads++; return null; }, now);
  expect(reads).toBe(1);
  expect(result).toMatchObject({ state: "unknown", reason: "cache-miss", nodes: [], edges: [], headSha: null });
});
test("SYNTHETIC demo, mismatched identity, custom Llama and unknown licenses fail closed", () => {
  const world = fixture();
  expect(projectRepositoryPreview(world.repo.fullName, syntheticWorld(), now).reason).toBe("source-unverified");
  expect(projectRepositoryPreview("other/repo", world, now).reason).toBe("source-unverified");
  for (const license of [null, "NOASSERTION", "Llama-3.1", "LicenseRef-Llama-3", "CC-BY-NC-4.0"]) {
    world.repo.license = license;
    expect(projectRepositoryPreview(world.repo.fullName, world, now)).toMatchObject({ reason: "license-unverified", nodes: [], headSha: null });
  }
});
test("SYNTHETIC projection retains exact evidence states/head/time, strips model content and marks expiry", () => {
  const world = fixture();
  const result = projectRepositoryPreview(world.repo.fullName, world, now);
  expect(result).toMatchObject({ state: "cached", headSha: world.headSha, collectedAt: world.collectedAt, tree: "truncated", github: "partial" });
  expect(result.nodes.map((n) => [n.id, n.confidence, n.status])).toEqual(world.nodes.map((n) => [n.id, n.confidence, n.status]));
  expect(JSON.stringify(result)).not.toContain("architecture summary");
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC issue");
  expect(projectRepositoryPreview(world.repo.fullName, world, now + 60_001).state).toBe("stale");
  world.coverage.notes.push("STALE cache");
  expect(projectRepositoryPreview(world.repo.fullName, world, now).state).toBe("stale");
  world.coverage.tree = "unavailable";
  expect(projectRepositoryPreview(world.repo.fullName, world, now)).toMatchObject({ state: "unavailable", nodes: [] });
});
test("SYNTHETIC preview graph is bounded, with no dangling edges", () => {
  const world = fixture();
  world.nodes = Array.from({ length: 100 }, (_, i) => ({ ...world.nodes[0], id: `n${i}` }));
  world.edges = Array.from({ length: 200 }, (_, i) => ({ ...world.edges[0], id: `e${i}`, source: `n${i % 100}`, target: "n1" }));
  const result = projectRepositoryPreview(world.repo.fullName, world, now);
  expect(result.nodes).toHaveLength(30);
  expect(result.edges.length).toBeLessThanOrEqual(96);
  expect(result).toMatchObject({ totalNodes: 100, totalEdges: 200, limited: true });
  expect(result.edges.every((edge) => result.nodes.some((n) => n.id === edge.source) && result.nodes.some((n) => n.id === edge.target))).toBe(true);
});
