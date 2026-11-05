/** Explicit synthetic topology, never imported by production defaults. */
import { createTopologyWindow } from "../../src/history/topology";
import type { ImmutableCommit, TopologyWindow } from "../../src/history/topology-contracts";
export const historicSha = (n: number) => n.toString(16).padStart(40, "0");
export const historicRepo = "synthetic-history/viewer-source-with-long-public-name";
export const oldHistoricPath = "src/旧版本真实来源路径仅用于合成验证且不会成为产品默认数据.ts";
export function syntheticHistoricalWindow(mode: "full" | "partial" | "gap" | "many" = "full", generation = "SYNTHETIC_generation_1"): TopologyWindow {
  const count = mode === "gap" ? 3 : 2;
  const commits: ImmutableCommit[] = Array.from({ length: count }, (_, i) => ({ schemaVersion: 1, repoKey: historicRepo, sha: historicSha(i + 1), treeSha: historicSha(i + 101), parents: i ? [historicSha(i)] : [], authorAt: i ? "2025-01-01T00:00:00Z" : "2025-09-01T00:00:00Z", committerAt: i ? null : "2025-09-02T00:00:00Z", message: `SYNTHETIC captured checkpoint ${i + 1}`, provenance: [{ sourceUrl: `https://github.com/${historicRepo}/commit/${historicSha(i + 1)}`, fetchedAt: "2026-11-04T12:00:00Z" }], omittedProvenance: 0 }));
  const frames = [1, count].map((n, i) => ({ schemaVersion: 1, repoKey: historicRepo, commitSha: historicSha(n), treeSha: historicSha(n + 100), scope: { prefix: "", recursive: true }, completeness: mode === "partial" && i ? "partial" : "full", sourceOmittedEntries: mode === "partial" && i ? null : 0, entries: mode === "many" ? Array.from({ length: 30 }, (_, j) => ({ path: `${i ? "new" : "old"}-${j}.ts`, type: "blob", sha: historicSha(j + 600 + i * 50) })) : [{ path: "src", type: "tree", sha: historicSha(n + 500) }, { path: "shared.ts", type: "blob", sha: historicSha(700) }, { path: i ? "src/new.ts" : oldHistoricPath, type: "blob", sha: historicSha(n + 710) }], provenance: [{ sourceUrl: `https://api.github.com/repos/${historicRepo}/git/trees/${historicSha(n + 100)}?recursive=1`, fetchedAt: "2026-11-04T12:00:01Z" }] }));
  const checked = createTopologyWindow({ repoKey: historicRepo, sha: historicSha(count), generation }, [...commits].reverse(), frames.reverse());
  if (!checked.ok) throw new Error(checked.code);
  return checked.value;
}
