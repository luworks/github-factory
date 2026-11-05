import type { WorldNode, WorldEdge } from "../contracts";

/** Cache-only public facts. No model blueprint, issue bodies or runtime configuration. */
export interface RepositoryPreviewData {
  state: "cached" | "stale" | "unknown" | "unavailable";
  reason: "cache-miss" | "source-unverified" | "tree-unavailable" | null;
  fullName: string;
  headSha: string | null;
  collectedAt: string | null;
  refreshAfter: number | null;
  github: "ok" | "partial" | "error" | "unknown";
  tree: "full" | "truncated" | "unavailable";
  nodes: WorldNode[];
  edges: WorldEdge[];
  totalNodes: number;
  totalEdges: number;
  limited: boolean;
}
