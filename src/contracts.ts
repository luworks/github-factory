/** Shared domain. No server configuration or credentials may enter this file. */
export const STYLE_IDS = ["moonshot", "factorio", "red-alert", "red-alert-2", "civilization"] as const;
export type StyleId = (typeof STYLE_IDS)[number];
export type Lang = "en" | "zh";
export type NodeKind = "app" | "service" | "package" | "data" | "infra" | "docs" | "test" | "tool" | "external";
export type EvidenceLevel = "observed" | "inferred";
export interface WorldNode {
  id: string;
  label: string;
  kind: NodeKind;
  path: string;
  description: string;
  evidence: string[];
  confidence: EvidenceLevel;
  status: "healthy" | "active" | "attention" | "unknown";
  language: string | null;
  size: number;
}
export interface WorldEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: "dependency" | "pipeline" | "containment" | "inferred";
  confidence: EvidenceLevel;
}
export interface RepoIdentity {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  defaultBranch: string;
  pushedAt: string;
  license: string | null;
  homepage: string | null;
}
export interface WorkItem {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  author: string;
  updatedAt: string;
  labels: string[];
  kind: "issue" | "pull";
  draft?: boolean;
  headSha?: string;
}
export interface WorkflowRun {
  id: number;
  name: string;
  url: string;
  status: string;
  conclusion: string | null;
  branch: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
}
export interface CommitEvent {
  id: string;
  message: string;
  url: string;
  author: string;
  date: string;
}
export interface Mission {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  evidence: string[];
  url: string | null;
  nodeIds: string[];
}
export interface AiBlueprint {
  summary: string;
  narrative: string;
  districts: { nodeId: string; title: string; purpose: string }[];
  missions: Mission[];
  generator: {
    provider: "rules" | "openai" | "muse";
    model: string;
    generatedAt: string;
    costUsd: number;
    notes: string[];
  };
}
export interface WorldSnapshot {
  schemaVersion: 1;
  repo: RepoIdentity;
  headSha: string;
  collectedAt: string;
  /** Absolute epoch milliseconds when the cached facts should be refreshed. */
  refreshAfter: number;
  source: "github" | "demo";
  nodes: WorldNode[];
  edges: WorldEdge[];
  issues: WorkItem[];
  pulls: WorkItem[];
  workflows: WorkflowRun[];
  commits: CommitEvent[];
  languages: Record<string, number>;
  coverage: {
    tree: "full" | "truncated" | "unavailable";
    issueWindow: number;
    pullWindow: number;
    workflowWindow: number;
    notes: string[];
  };
  health: {
    github: "ok" | "partial" | "error";
    rateLimitRemaining: number | null;
  };
  blueprint: AiBlueprint;
}
export interface FeaturedProject {
  fullName: string;
  name: string;
  description: string;
  category: string;
  language: string | null;
  stars: number | null;
  ready: boolean;
  collectedAt: string | null;
  suggestedStyle: StyleId;
}
export interface ApiError {
  error: string;
  code: string;
  retryAfter?: number;
}
export interface BudgetStatus {
  limitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  calls: number;
  provider: string;
  model: string;
  configured: boolean;
}
