import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURATED_PROJECTS } from "../src/catalog";
import { analyzeCollection } from "../src/server/analysis";
import { GitHubError, type RepoCollection } from "../src/server/github";
import { createWorldService } from "../src/server/service";
import { WorldStore } from "../src/server/store";

const NOW = Date.parse("2026-11-04T18:00:00Z"),
  SHA = "a".repeat(40);
function collection(sources: Record<string, string> = {}): RepoCollection {
  return {
    repo: {
      owner: "example",
      name: "project",
      fullName: "example/project",
      url: "https://github.com/example/project",
      description: "Synthetic repository",
      stars: 1,
      forks: 0,
      openIssues: 0,
      language: "TypeScript",
      defaultBranch: "main",
      pushedAt: new Date(NOW).toISOString(),
      license: "MIT",
      homepage: null,
    },
    headSha: SHA,
    collectedAt: new Date(NOW).toISOString(),
    tree: Object.keys(sources).map((path) => ({ path, type: "blob" as const, sha: SHA })),
    treeState: "full",
    files: Object.entries(sources).map(([path, content]) => ({
      path,
      content,
      url: `https://github.com/example/project/blob/${SHA}/${path}`,
    })),
    issues: [],
    pulls: [],
    workflows: [],
    commits: [],
    languages: { TypeScript: 100 },
    notes: [],
    partial: false,
    rateLimitRemaining: 100,
  };
}
const manifest = (value: object) => JSON.stringify(value);
const dependencies = (world: ReturnType<typeof analyzeCollection>) => world.edges.filter((edge) => edge.kind === "dependency");
const monorepo = () =>
  collection({
    "package.json": manifest({ name: "root", workspaces: ["packages/*"] }),
    "packages/api/package.json": manifest({ name: "@test/api", dependencies: { "@test/core": "workspace:*", react: "^19" } }),
    "packages/core/package.json": manifest({ name: "@test/core" }),
    ".github/workflows/ci.yml": "name: CI\njobs:\n  check:\n    runs-on: ubuntu-latest",
    "docs/readme.md": "docs",
  });

describe("evidence-grounded analysis", () => {
  test("proves workspace membership and explicit local dependencies only", () => {
    const world = analyzeCollection(monorepo());
    expect(dependencies(world).map((edge) => [edge.source, edge.target, edge.label])).toEqual([
      ["repo:root", "path:packages/api", "declared workspace member"],
      ["repo:root", "path:packages/core", "declared workspace member"],
      ["path:packages/api", "path:packages/core", "declared local dependency: @test/core"],
    ]);
    expect(world.edges.every((edge) => edge.confidence === "observed")).toBe(true);
    expect(world.edges.some((edge) => edge.kind === "pipeline")).toBe(false);
    expect(world.nodes.find((node) => node.path === "docs")?.confidence).toBe("inferred");
    expect(world.nodes.every((node) => node.evidence.every((url) => url.startsWith("https://github.com/example/project/")))).toBe(true);
    expect(world.blueprint.generator).toMatchObject({ provider: "rules", costUsd: 0 });
    expect(world.blueprint.districts.map((district) => district.nodeId)).toEqual(world.nodes.map((node) => node.id));
  });
  test("matching external package names cannot prove local dependencies", () => {
    const world = analyzeCollection(
      collection({
        "package.json": manifest({ workspaces: ["packages/*"] }),
        "packages/a/package.json": manifest({ name: "a", dependencies: { b: "^1.0.0" } }),
        "packages/b/package.json": manifest({ name: "b", version: "1.0.0" }),
      }),
    );
    expect(world.edges.some((edge) => edge.source === "path:packages/a")).toBe(false);
  });
  test("workspace protocol without observed membership cannot bind packages", () => {
    const world = analyzeCollection(
      collection({
        "a/package.json": manifest({ name: "a", dependencies: { b: "workspace:*" } }),
        "b/package.json": manifest({ name: "b" }),
      }),
    );
    expect(dependencies(world)).toEqual([]);
  });
  test("workspace exclusions cannot become observed membership", () => {
    const world = analyzeCollection(
      collection({
        "package.json": manifest({ workspaces: ["packages/*", "!packages/private"] }),
        "packages/private/package.json": manifest({ name: "private" }),
      }),
    );
    expect(dependencies(world)).toEqual([]);
  });
  test("file protocol and Cargo path declarations prove local edges", () => {
    const world = analyzeCollection(
      collection({
        "apps/api/package.json": manifest({ name: "api", dependencies: { core: "file:../../packages/core" } }),
        "packages/core/package.json": manifest({ name: "core" }),
        "crates/server/Cargo.toml": '[package]\nname = "server"\n[dependencies]\ncore = { path = "../core" }',
        "crates/core/Cargo.toml": '[package]\nname = "core"',
      }),
    );
    expect(dependencies(world).map((edge) => [edge.source, edge.target])).toEqual([
      ["path:apps/api", "path:packages/core"],
      ["path:crates/server", "path:crates/core"],
    ]);
  });
  test("duplicate package names stay ambiguous", () => {
    const world = analyzeCollection(
      collection({
        "a/package.json": manifest({ name: "a", dependencies: { b: "file:../b" } }),
        "b/package.json": manifest({ name: "b" }),
        "c/package.json": manifest({ name: "b" }),
      }),
    );
    expect(dependencies(world)).toEqual([]);
  });
  test("invalid manifests and workflow filenames do not fabricate edges", () => {
    const world = analyzeCollection(collection({ "package.json": '{"dependencies": {', "ci.yml": "build: deploy" }));
    expect(dependencies(world)).toEqual([]);
    expect(world.coverage.notes.join(" ")).toContain("Invalid manifest package.json");
  });
  test("node cap keeps an explicit collapsed district", () => {
    const world = analyzeCollection(
      collection(Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`packages/p${i}/package.json`, manifest({ name: `p${i}` })]))),
    );
    expect(world.nodes).toHaveLength(30);
    expect(world.nodes.at(-1)?.id).toBe("coverage:collapsed");
    expect(world.coverage.notes.join(" ")).toContain("collapsed");
    expect(new Set(world.nodes.map((node) => node.id)).size).toBe(30);
  });
  test("edge cap omits proven edges with explicit coverage and no dangling IDs", () => {
    const sources: Record<string, string> = { "package.json": manifest({ workspaces: ["packages/*"] }) };
    for (let i = 0; i < 8; i++)
      sources[`packages/p${i}/package.json`] = manifest({
        name: `p${i}`,
        dependencies: Object.fromEntries(Array.from({ length: 8 }, (_, j) => [`p${j}`, "workspace:*"])),
      });
    const world = analyzeCollection(collection(sources));
    expect(world.edges).toHaveLength(50);
    expect(world.coverage.notes.join(" ")).toContain("proven edges omitted");
    const ids = new Set(world.nodes.map((node) => node.id));
    expect(world.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
  });
  test("observed directory containment is not fabricated dependency evidence", () => {
    const data = collection({ "src/index.ts": "export const x=1", "docs/readme.md": "docs" });
    const result = analyzeCollection(data);
    expect(dependencies(result)).toEqual([]);
    expect(result.edges.filter((e) => e.kind === "containment").map((e) => [e.source, e.target, e.confidence])).toEqual([
      ["repo:root", "path:src", "observed"],
      ["repo:root", "path:docs", "observed"],
    ]);
    expect(result.edges.every((e) => result.nodes.some((n) => n.id === e.source) && result.nodes.some((n) => n.id === e.target))).toBe(
      true,
    );
  });
  test("unavailable architecture and CI stay unknown", () => {
    const data = collection();
    data.treeState = "unavailable";
    data.partial = true;
    const world = analyzeCollection(data);
    expect(world.health.github).toBe("partial");
    expect(world.nodes[0]!.status).toBe("unknown");
    expect(world.nodes[0]!.description).toContain("remain unknown");
    expect(world.blueprint.missions[0]!.id).toBe("coverage:tree");
  });
  test("old-head green CI cannot mark current-head CI healthy", () => {
    const data = monorepo();
    data.workflows = [
      {
        id: 1,
        name: "CI",
        url: "https://github.com/example/project/actions/runs/1",
        status: "completed",
        conclusion: "success",
        branch: "main",
        headSha: "b".repeat(40),
        createdAt: data.collectedAt,
        updatedAt: data.collectedAt,
      },
    ];
    expect(analyzeCollection(data).nodes.find((node) => node.path === ".github")!.status).toBe("unknown");
    data.workflows[0]!.headSha = SHA;
    data.workflows[0]!.conclusion = "failure";
    const current = analyzeCollection(data);
    expect(current.nodes.find((node) => node.path === ".github")!.status).toBe("attention");
    expect(current.blueprint.missions[0]!.url).toEndWith("/runs/1");
    expect(current.nodes.find((node) => node.path === "packages/api")!.status).toBe("unknown");
  });
  test("newer successful run supersedes old failure for CI district status", () => {
    const data = monorepo();
    const failed = {
      id: 1,
      name: "CI",
      url: "https://github.com/example/project/actions/runs/1",
      status: "completed",
      conclusion: "failure",
      branch: "main",
      headSha: SHA,
      createdAt: "2026-11-04T17:00:00Z",
      updatedAt: "2026-11-04T17:01:00Z",
    };
    data.workflows = [failed, { ...failed, id: 2, conclusion: "success", createdAt: "2026-11-04T17:30:00Z" }];
    const world = analyzeCollection(data);
    expect(world.nodes.find((node) => node.path === ".github")!.status).toBe("healthy");
    expect(world.blueprint.missions.some((mission) => mission.id === "run:1")).toBe(false);
  });
});

describe("real isolated SQLite cache", () => {
  test("persists across connections and distinguishes exact TTL expiry", () => {
    const directory = mkdtempSync(join(tmpdir(), "moonshot-world-cache-")),
      path = join(directory, "worlds.sqlite");
    try {
      const first = new WorldStore(path);
      first.put(analyzeCollection(monorepo()), 90_000, NOW);
      first.close();
      const second = new WorldStore(path);
      expect(second.get("EXAMPLE/PROJECT", NOW + 89_999)?.fresh).toBe(true);
      expect(second.get("example/project", NOW + 90_000)?.fresh).toBe(false);
      expect(second.get("example/project", NOW + 90_000)?.world.headSha).toBe(SHA);
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test("bounds persisted repository count", () => {
    const store = new WorldStore(":memory:");
    try {
      for (let i = 0; i < 101; i++) {
        const world = analyzeCollection(collection());
        world.repo = { ...world.repo, name: `p${i}`, fullName: `example/p${i}` };
        store.put(world, 90_000, NOW + i);
      }
      expect(store.get("example/p0")).toBeNull();
      expect(store.get("example/p100")).not.toBeNull();
    } finally {
      store.close();
    }
  });
});

describe("service freshness and concurrency", () => {
  test("singleflight merges requests, fresh cache and forced cooldown avoid extra reads", async () => {
    const store = new WorldStore(":memory:");
    let calls = 0;
    let release!: (value: RepoCollection) => void;
    const pending = new Promise<RepoCollection>((resolve) => {
      release = resolve;
    });
    const service = createWorldService({
      store,
      now: () => NOW,
      collector: {
        collect: async () => {
          calls++;
          return pending;
        },
      },
    });
    try {
      const a = service.loadWorld("example/project"),
        b = service.loadWorld("EXAMPLE/PROJECT");
      expect(calls).toBe(1);
      release(monorepo());
      expect((await a).headSha).toBe((await b).headSha);
      await service.loadWorld("example/project");
      await service.loadWorld("example/project", { refresh: true });
      expect(calls).toBe(1);
      expect(service.getCachedWorld("example/project")?.blueprint.generator.provider).toBe("rules");
      expect(calls).toBe(1);
    } finally {
      store.close();
    }
  });
  test("expired refresh failure retains stale facts, capture time and failure code", async () => {
    const store = new WorldStore(":memory:");
    store.put(analyzeCollection(monorepo()), 90_000, NOW);
    let calls = 0;
    const service = createWorldService({
      store,
      now: () => NOW + 90_001,
      collector: {
        collect: async () => {
          calls++;
          throw new GitHubError("GITHUB_FORBIDDEN", 403, "denied");
        },
      },
    });
    try {
      const world = await service.loadWorld("example/project");
      expect(calls).toBe(1);
      expect(world.health.github).toBe("error");
      expect(world.headSha).toBe(SHA);
      expect(world.collectedAt).toBe(new Date(NOW).toISOString());
      expect(world.coverage.notes.join(" ")).toContain("STALE");
      expect(world.coverage.notes.join(" ")).toContain("GITHUB_FORBIDDEN");
      await service.loadWorld("example/project", { refresh: true });
      expect(calls).toBe(1);
      expect(store.get("example/project", NOW + 90_001)?.fresh).toBe(false);
    } finally {
      store.close();
    }
  });
  test("explicit private visibility revokes cached world instead of returning it stale", async () => {
    const store = new WorldStore(":memory:");
    store.put(analyzeCollection(monorepo()), 90_000, NOW);
    const service = createWorldService({
      store,
      now: () => NOW + 90_001,
      collector: {
        collect: async () => {
          throw new GitHubError("PUBLIC_ONLY", 403, "public only");
        },
      },
    });
    try {
      await expect(service.loadWorld("example/project")).rejects.toMatchObject({ code: "PUBLIC_ONLY", status: 403 });
      expect(service.getCachedWorld("example/project")).toBeNull();
    } finally {
      store.close();
    }
  });
  test("successful expired refresh replaces evidence and extends TTL", async () => {
    const store = new WorldStore(":memory:");
    store.put(analyzeCollection(collection()), 90_000, NOW);
    const fresh = monorepo();
    fresh.headSha = "b".repeat(40);
    fresh.collectedAt = new Date(NOW + 90_001).toISOString();
    const service = createWorldService({ store, now: () => NOW + 90_001, collector: { collect: async () => fresh } });
    try {
      const world = await service.loadWorld("example/project");
      expect(world.headSha).toBe(fresh.headSha);
      expect(world.refreshAfter).toBe(NOW + 180_001);
      expect(store.get("example/project", NOW + 90_002)?.fresh).toBe(true);
    } finally {
      store.close();
    }
  });
  test("uncached failures are typed and cooldown avoids repeated collection", async () => {
    const store = new WorldStore(":memory:");
    let calls = 0;
    const service = createWorldService({
      store,
      now: () => NOW,
      collector: {
        collect: async () => {
          calls++;
          throw new GitHubError("REPO_NOT_FOUND", 404, "not found");
        },
      },
    });
    try {
      await expect(service.loadWorld("example/project")).rejects.toMatchObject({ code: "REPO_NOT_FOUND", status: 404 });
      await expect(service.loadWorld("example/project")).rejects.toMatchObject({ code: "REPO_NOT_FOUND", status: 404 });
      expect(calls).toBe(1);
    } finally {
      store.close();
    }
  });
  test("global slots reject overflow without starting extra work", async () => {
    const store = new WorldStore(":memory:");
    let calls = 0;
    let release!: (value: RepoCollection) => void;
    const pending = new Promise<RepoCollection>((resolve) => {
      release = resolve;
    });
    const service = createWorldService({
      store,
      maxConcurrent: 1,
      now: () => NOW,
      collector: {
        collect: async () => {
          calls++;
          return pending;
        },
      },
    });
    try {
      const first = service.loadWorld("example/project");
      await expect(service.loadWorld("example/other")).rejects.toMatchObject({ code: "WORLD_BUSY", status: 429 });
      expect(calls).toBe(1);
      release(collection());
      await first;
    } finally {
      store.close();
    }
  });
  test("featured gallery resolves cached aliases without rewriting canonical source identity or collecting", async () => {
    const store = new WorldStore(":memory:");
    let calls = 0;
    const data = collection();
    data.repo = {
      ...data.repo,
      owner: "facebook",
      name: "react",
      fullName: "facebook/react",
      url: "https://github.com/facebook/react",
      stars: 123,
      description: "Observed description",
    };
    store.put(analyzeCollection(data), 90_000, NOW);
    store.alias("react/react", "facebook/react");
    const service = createWorldService({
      store,
      now: () => NOW + 91_000,
      collector: {
        collect: async () => {
          calls++;
          return data;
        },
      },
    });
    try {
      const featured = await service.listFeatured();
      expect(featured).toHaveLength(19);
      expect(calls).toBe(0);
      expect(featured.find((project) => project.fullName === "react/react")).toMatchObject({
        ready: true,
        stars: 123,
        description: "Observed description",
        collectedAt: data.collectedAt,
      });
      expect(featured.find((project) => project.fullName === "pytorch/pytorch")).toMatchObject({
        ready: false,
        stars: null,
        collectedAt: null,
        language: null,
      });
      expect(service.getCachedWorld("react/react")?.coverage.notes.join(" ")).toContain("STALE");
      expect(service.getCachedWorld("react/react")?.repo.fullName).toBe("facebook/react");
      expect(service.getCachedWorld("facebook/react")?.repo.fullName).toBe("facebook/react");
      expect(calls).toBe(0);
    } finally {
      store.close();
    }
  });
  test("all nineteen gallery cards use only persisted captures, including zero stars and unknown language", async () => {
    const store = new WorldStore(":memory:");
    const service = createWorldService({
      store,
      now: () => NOW + 91_000,
      collector: {
        collect: async () => {
          throw new Error("Gallery must never collect");
        },
      },
    });
    try {
      const expected = CURATED_PROJECTS.map((project, index) => {
        const data = collection();
        const [owner, name] = project.fullName.split("/");
        data.repo = {
          ...data.repo,
          owner: owner!,
          name: name!,
          fullName: project.fullName,
          url: `https://github.com/${project.fullName}`,
          stars: index,
          description: `Captured description ${index}`,
          language: index % 2 === 0 ? null : "TypeScript",
        };
        data.collectedAt = new Date(NOW - index * 1000).toISOString();
        store.put(analyzeCollection(data), 90_000, NOW);
        return {
          ...project,
          description: data.repo.description,
          language: data.repo.language,
          stars: data.repo.stars,
          ready: true,
          collectedAt: data.collectedAt,
        };
      });
      const featured = await service.listFeatured();
      expect(featured).toEqual(expected);
      expect(featured).toHaveLength(19);
      expect(CURATED_PROJECTS.every((project) => project.stars === null && !project.ready && project.collectedAt === null)).toBe(true);
    } finally {
      store.close();
    }
  });
  test("invalid repository is rejected before cache or collector work", async () => {
    let touched = false;
    const service = createWorldService({
      store: {
        get: () => {
          touched = true;
          return null;
        },
        put: () => {
          touched = true;
        },
      },
      collector: {
        collect: async () => {
          touched = true;
          return collection();
        },
      },
    });
    await expect(service.loadWorld("https://127.0.0.1/a/b")).rejects.toMatchObject({ code: "INVALID_REPO", status: 400 });
    expect(touched).toBe(false);
  });
});

test("renamed repository aliases persist without rewriting source identity and revoke together", async () => {
  const dir = mkdtempSync(join(tmpdir(), "moonshot-alias-"));
  const path = join(dir, "worlds.sqlite");
  let store = new WorldStore(path);
  let calls = 0;
  const service = createWorldService({
    store,
    now: () => NOW,
    collector: {
      collect: async () => {
        calls++;
        return collection();
      },
    },
  });
  try {
    const result = await service.loadWorld("former/project");
    expect(result.repo.fullName).toBe("example/project");
    expect((await service.loadWorld("former/project")).repo.fullName).toBe("example/project");
    expect((await service.loadWorld("example/project")).headSha).toBe(SHA);
    expect(calls).toBe(1);
    store.close();
    store = new WorldStore(path);
    expect(store.get("former/project", NOW)?.world.repo.fullName).toBe("example/project");
    store.delete("former/project");
    expect(store.get("example/project", NOW)).toBeNull();
    expect(store.get("former/project", NOW)).toBeNull();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a crowded map retains substantial source districts ahead of hidden configuration", () => {
  const data = collection();
  data.tree = [
    ...Array.from({ length: 40 }, (_, i) => ({ path: `.config-${i}`, type: "tree" as const, sha: SHA })),
    { path: "zzz-core", type: "tree", sha: SHA },
    ...Array.from({ length: 100 }, (_, i) => ({ path: `zzz-core/file${i}.ts`, type: "blob" as const, sha: SHA })),
  ];
  const world = analyzeCollection(data);
  expect(world.nodes).toHaveLength(30);
  expect(world.nodes.some((node) => node.path === "zzz-core")).toBe(true);
  expect(world.nodes.at(-1)?.id).toBe("coverage:collapsed");
  expect(world.coverage.notes.join(" ")).toContain("does not establish runtime importance");
});
