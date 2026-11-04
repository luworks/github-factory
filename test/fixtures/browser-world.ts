import type { BudgetStatus, FeaturedProject, WorldSnapshot } from "../../src/contracts";

/** SYNTHETIC UI evidence only. This repository, activity and budget are invented. */
export function syntheticWorld(): WorldSnapshot {
  const timestamp = "2026-11-04T16:00:00Z";
  const repoUrl = "https://github.com/synthetic-moonshot/browser-fixture";
  const headSha = "1234567890abcdef1234567890abcdef12345678";
  return {
    schemaVersion: 1,
    repo: {
      owner: "synthetic-moonshot",
      name: "browser-fixture",
      fullName: "synthetic-moonshot/browser-fixture",
      url: repoUrl,
      description: "SYNTHETIC browser fixture — never live GitHub evidence.",
      stars: 42,
      forks: 3,
      openIssues: 1,
      language: "TypeScript",
      defaultBranch: "main",
      pushedAt: timestamp,
      license: "MIT",
      homepage: null,
    },
    headSha,
    collectedAt: timestamp,
    refreshAfter: Date.parse("2026-11-04T12:02:00Z"),
    source: "demo",
    nodes: [
      {
        id: "web",
        label: "SYNTHETIC Web",
        kind: "app",
        path: "apps/web",
        description: "Synthetic observed UI module.",
        evidence: ["apps/web/package.json"],
        confidence: "observed",
        status: "active",
        language: "TypeScript",
        size: 12,
      },
      {
        id: "api",
        label: "SYNTHETIC API",
        kind: "service",
        path: "services/api",
        description: "Synthetic inferred service role.",
        evidence: ["services/api"],
        confidence: "inferred",
        status: "unknown",
        language: null,
        size: 8,
      },
      {
        id: "checks",
        label: "SYNTHETIC Checks",
        kind: "test",
        path: "test",
        description: "Synthetic check district.",
        evidence: ["test"],
        confidence: "observed",
        status: "attention",
        language: "TypeScript",
        size: 4,
      },
    ],
    edges: [
      { id: "web-api", source: "web", target: "api", label: "SYNTHETIC inferred relationship", kind: "inferred", confidence: "inferred" },
    ],
    issues: [
      {
        number: 7,
        title: "SYNTHETIC issue",
        url: `${repoUrl}/issues/7`,
        state: "open",
        author: "fixture-author",
        updatedAt: timestamp,
        labels: ["fixture"],
        kind: "issue",
      },
    ],
    pulls: [
      {
        number: 8,
        title: "SYNTHETIC draft pull request",
        url: `${repoUrl}/pull/8`,
        state: "open",
        author: "fixture-author",
        updatedAt: timestamp,
        labels: [],
        kind: "pull",
        draft: true,
        headSha,
      },
    ],
    workflows: ["success", "failure", "skipped"].map((conclusion, i) => ({
      id: i + 1,
      name: `SYNTHETIC CI ${conclusion}`,
      url: `${repoUrl}/actions/runs/${i + 1}`,
      status: "completed",
      conclusion,
      branch: "main",
      headSha,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    commits: [
      {
        id: headSha,
        message: "SYNTHETIC commit\nDetails are not a second event",
        url: `${repoUrl}/commit/${headSha}`,
        author: "fixture-author",
        date: timestamp,
      },
    ],
    languages: { TypeScript: 100, CSS: 20 },
    coverage: {
      tree: "truncated",
      issueWindow: 1,
      pullWindow: 1,
      workflowWindow: 3,
      notes: ["SYNTHETIC: partial path tree; no real GitHub data collected."],
    },
    health: { github: "partial", rateLimitRemaining: null },
    blueprint: {
      summary: "SYNTHETIC architecture summary.",
      narrative: "SYNTHETIC rules guide, not a model result.",
      districts: [{ nodeId: "web", title: "SYNTHETIC web guide", purpose: "SYNTHETIC observed UI module." }],
      missions: [
        {
          id: "inspect-check",
          title: "SYNTHETIC inspect failing check",
          description: "A fixture suggestion grounded in the fixture failure.",
          priority: "high",
          evidence: [`${repoUrl}/actions/runs/2`],
          url: `${repoUrl}/actions/runs/2`,
          nodeIds: ["checks"],
        },
      ],
      generator: {
        provider: "rules",
        model: "synthetic-rules",
        generatedAt: timestamp,
        costUsd: 0,
        notes: ["SYNTHETIC fallback: model unavailable; no paid API was called."],
      },
    },
  };
}

export const syntheticBudget: BudgetStatus = {
  limitUsd: 50,
  spentUsd: 0,
  reservedUsd: 0,
  remainingUsd: 50,
  calls: 0,
  provider: "rules",
  model: "synthetic-rules",
  configured: false,
};

export const syntheticGallery: FeaturedProject[] = [
  {
    fullName: "synthetic-moonshot/browser-fixture",
    name: "SYNTHETIC Atlas",
    description: "SYNTHETIC gallery item, not a live featured project.",
    category: "SYNTHETIC UI FIXTURE",
    language: "TypeScript",
    stars: 42,
    ready: true,
    collectedAt: "2026-11-04T16:00:00Z",
    suggestedStyle: "civilization",
  },
];
