import { worldShapeValid } from "../evidence/world-shape";
import { WorldStorageError } from "./world-storage";
import type { WorldSnapshot } from "../contracts";
import type { RepositoryPreviewData } from "../gallery/contracts";
import { parseRepo } from "./github";


export function projectRepositoryPreview(input: string, world: WorldSnapshot | null, now = Date.now()): RepositoryPreviewData {
  const fullName = parseRepo(input).fullName;
  const empty: RepositoryPreviewData = {
    state: "unknown", reason: "cache-miss", fullName, headSha: null, collectedAt: null, refreshAfter: null,
    github: "unknown", tree: "unavailable", nodes: [], edges: [], totalNodes: 0, totalEdges: 0, limited: false,
  };
  if (!world) return empty;
  if (world.source !== "github" || typeof world.repo?.fullName !== "string" || world.repo.fullName.toLowerCase() !== fullName.toLowerCase())
    return { ...empty, reason: "source-unverified" };
  if (!worldShapeValid(world)) throw new WorldStorageError();
  const captured = Date.parse(world.collectedAt);
  const validTime = Number.isFinite(captured) && captured <= now && Number.isFinite(world.refreshAfter);
  const stale = !validTime || world.refreshAfter <= now || world.coverage.notes.some((note) => /\bSTALE\b/.test(note));
  const nodes = world.nodes.slice(0, 30).map((n) => ({
    id: n.id, kind: n.kind, confidence: n.confidence, status: n.status, language: n.language, size: n.size,
    label: n.label.slice(0, 100), path: n.path.slice(0, 240), description: "", evidence: [],
  }));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = world.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).slice(0, 96).map((e) => ({ id: e.id, source: e.source, target: e.target, kind: e.kind, confidence: e.confidence, label: e.label.slice(0, 100) }));
  const unavailable = world.coverage.tree === "unavailable" || nodes.length === 0;
  return {
    state: unavailable ? "unavailable" : !validTime ? "unknown" : stale ? "stale" : "cached",
    reason: unavailable ? "tree-unavailable" : null, fullName: world.repo.fullName,
    headSha: /^[a-f0-9]{40}$/i.test(world.headSha) ? world.headSha : null,
    collectedAt: validTime ? world.collectedAt : null, refreshAfter: validTime ? world.refreshAfter : null,
    github: world.health.github, tree: world.coverage.tree,
    nodes: unavailable ? [] : nodes, edges: unavailable ? [] : edges,
    totalNodes: world.nodes.length, totalEdges: world.edges.length,
    limited: nodes.length < world.nodes.length || edges.length < world.edges.length,
  };
}
/** Dependency injection proves a gallery miss never starts collection or model calls. */
export function readRepositoryPreview(input: string, getCached: (input: string) => WorldSnapshot | null, now = Date.now()) {
  parseRepo(input);
  return projectRepositoryPreview(input, getCached(input), now);
}
export async function readRepositoryPreviewAsync(input: string, getCached: (input: string) => Promise<WorldSnapshot | null>, now = Date.now()) {
  parseRepo(input);
  return projectRepositoryPreview(input, await getCached(input), now);
}
