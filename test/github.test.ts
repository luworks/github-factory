import { describe, expect, test } from "bun:test";
import { GITHUB_LIMITS, GitHubClient, GitHubError, parseRepo, type Fetcher } from "../src/server/github";

const SHA = "a".repeat(40),
  TREE = "b".repeat(40);
const NOW = Date.parse("2026-11-04T18:00:00Z");
const response = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers });
function fixture(
  overrides: {
    metadata?: unknown;
    tree?: unknown;
    files?: Record<string, string>;
    intercept?: (url: URL) => Response | undefined;
    now?: () => number;
  } = {},
) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const files = overrides.files || {
    "package.json": JSON.stringify({ name: "test-root", workspaces: ["packages/*"] }),
    "packages/a/package.json": JSON.stringify({ name: "a" }),
    "README.md": "# Public example",
  };
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const custom = overrides.intercept?.(url);
    if (custom) return custom;
    const path = url.pathname;
    if (path === "/repos/example/project")
      return response(
        overrides.metadata ?? {
          private: false,
          visibility: "public",
          license: { spdx_id: "MIT" },
          full_name: "example/project",
          name: "project",
          default_branch: "main",
          language: "TypeScript",
          description: "Synthetic test repo",
          stargazers_count: 12,
        },
      );
    if (path === "/repos/example/project/git/ref/heads/main") return response({ object: { sha: SHA, type: "commit" } });
    if (path === `/repos/example/project/git/commits/${SHA}`) return response({ sha: SHA, tree: { sha: TREE } });
    if (path.includes("/git/trees/"))
      return response(
        overrides.tree ?? {
          tree: Object.entries(files).map(([path, content]) => ({ path, type: "blob", sha: TREE, size: Buffer.byteLength(content) })),
          truncated: false,
        },
      );
    if (path.endsWith("/issues"))
      return response([
        {
          number: 1,
          title: "Bug",
          state: "open",
          user: { login: "tester" },
          updated_at: "2026-11-04T17:00:00Z",
          labels: [{ name: "bug" }],
        },
        { number: 2, pull_request: {} },
      ]);
    if (path.endsWith("/pulls"))
      return response([{ number: 2, title: "Change", draft: true, head: { sha: SHA }, user: { login: "tester" } }]);
    if (path.endsWith("/actions/runs")) return response({ workflow_runs: [] });
    if (path.endsWith("/commits"))
      return response([{ sha: SHA, commit: { message: "Synthetic change", author: { name: "Tester", date: "2026-11-04T17:00:00Z" } } }]);
    if (path.endsWith("/languages")) return response({ TypeScript: 100, JavaScript: 10 });
    if (path.includes("/contents/")) {
      const name = decodeURIComponent(path.split("/contents/")[1]!);
      const content = files[name];
      return content === undefined
        ? response({}, 404)
        : response({
            type: "file",
            encoding: "base64",
            size: Buffer.byteLength(content),
            content: Buffer.from(content).toString("base64"),
          });
    }
    throw new Error(`Unexpected test request ${url}`);
  };
  return { calls, client: new GitHubClient("test-token-not-a-secret", fetcher, overrides.now || (() => NOW)) };
}

describe("repository identity boundary", () => {
  test("accepts canonical roots and strips clone suffix", () => {
    expect(parseRepo("facebook/react")).toEqual({ owner: "facebook", name: "react", fullName: "facebook/react" });
    expect(parseRepo("https://github.com/Example/repo.git/").fullName).toBe("Example/repo");
  });
  test.each([
    "http://github.com/a/b",
    "https://api.github.com/a/b",
    "https://github.com.evil.test/a/b",
    "https://github.com@evil.test/a/b",
    "https://user:pass@github.com/a/b",
    "https://github.com:443/a/b",
    "https://github.com/a/b?token=x",
    "https://github.com/a/b#x",
    "https://github.com/a/b/tree/main",
    "https://github.com/a/%2e%2e/b",
    "https://github.com/a/../b",
    "https://github.com/a\\b",
    "a/b/c",
    "a/..",
    "a/.",
    " a/b",
    "a/b\n",
    "a/.git",
    "file:///etc/passwd",
    "https://127.0.0.1/a/b",
  ])("rejects unsafe input %s", (input) => {
    expect(() => parseRepo(input)).toThrow(GitHubError);
  });
});

describe("bounded GitHub collection", () => {
  test("pins source/tree/commits, bounds windows and builds trusted links", async () => {
    const { client, calls } = fixture();
    const result = await client.collect(parseRepo("example/project"));
    expect(result.headSha).toBe(SHA);
    expect(result.repo.stars).toBe(12);
    expect(result.collectedAt).toBe(new Date(NOW).toISOString());
    expect(result.issues.map((item) => item.number)).toEqual([1]);
    expect(result.pulls[0]!.draft).toBe(true);
    expect(result.commits[0]!.id).toBe(SHA);
    expect(result.treeState).toBe("full");
    expect(result.partial).toBe(false);
    expect(result.files[0]!.url).toContain(`/blob/${SHA}/`);
    expect(result.notes.join(" ")).toContain("CI status is unknown");
    for (const { url, init } of calls) {
      expect(url.origin).toBe("https://api.github.com");
      expect(init?.redirect).toBe(url.pathname === "/repos/example/project" ? "manual" : "error");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token-not-a-secret");
      if (url.pathname.includes("/contents/")) expect(url.searchParams.get("ref")).toBe(SHA);
      if (url.pathname.includes("/git/trees/")) expect(url.pathname).toEndWith(TREE);
    }
    const commits = calls.find(({ url }) => url.pathname.endsWith("/commits"))!.url;
    expect(commits.searchParams.get("sha")).toBe(SHA);
    expect(Number(commits.searchParams.get("per_page"))).toBe(20);
  });
  test.each([true, undefined])("rejects private or unknown visibility before source reads (%s)", async (privateFlag) => {
    const { client, calls } = fixture({ metadata: { private: privateFlag, full_name: "example/project" } });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "PUBLIC_ONLY", status: 403 });
    expect(calls).toHaveLength(1);
  });
  test.each([404, 403])("preserves required metadata denial %s", async (status) => {
    const { client, calls } = fixture({
      intercept: (url) => (url.pathname === "/repos/example/project" ? response({}, status) : undefined),
    });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ status });
    expect(calls).toHaveLength(1);
  });
  test("rate limit fails closed and blocks subsequent network requests", async () => {
    const { client, calls } = fixture({ intercept: () => response({}, 403, { "x-ratelimit-remaining": "0", "retry-after": "60" }) });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({
      code: "GITHUB_RATE_LIMIT",
      status: 429,
      retryAfter: 60,
    });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "GITHUB_RATE_LIMIT" });
    expect(calls).toHaveLength(1);
  });
  test("optional denial retains evidence and records unknown scope", async () => {
    const { client } = fixture({
      intercept: (url) => (url.pathname.endsWith("/actions/runs") || url.pathname.endsWith("/issues") ? response({}, 403) : undefined),
    });
    const world = await client.collect(parseRepo("example/project"));
    expect(world.partial).toBe(true);
    expect(world.tree.length).toBeGreaterThan(0);
    expect(world.workflows).toEqual([]);
    expect(world.notes.join(" ")).toContain("Workflow runs unavailable (GITHUB_FORBIDDEN)");
    expect(world.notes.join(" ")).toContain("Issues unavailable");
  });
  test("malformed optional list is partial rather than a claimed empty window", async () => {
    const { client } = fixture({ intercept: (url) => (url.pathname.endsWith("/pulls") ? response({ surprise: true }) : undefined) });
    const world = await client.collect(parseRepo("example/project"));
    expect(world.partial).toBe(true);
    expect(world.notes.join(" ")).toContain("Pull requests unavailable (GITHUB_INVALID_RESPONSE)");
  });
  test("tree is capped even when upstream does not mark truncation", async () => {
    const { client } = fixture({
      tree: { tree: Array.from({ length: 8_001 }, (_, i) => ({ path: `src/f${i}.ts`, type: "blob", sha: TREE })), truncated: false },
    });
    const result = await client.collect(parseRepo("example/project"));
    expect(result.tree).toHaveLength(8_000);
    expect(result.treeState).toBe("truncated");
    expect(result.partial).toBe(true);
  });
  test("upstream truncation and unavailable tree remain visible", async () => {
    const truncated = fixture({ tree: { tree: [], truncated: true } });
    expect((await truncated.client.collect(parseRepo("example/project"))).treeState).toBe("truncated");
    const missing = fixture({ intercept: (url) => (url.pathname.includes("/git/trees/") ? response({}, 404) : undefined) });
    const result = await missing.client.collect(parseRepo("example/project"));
    expect(result.treeState).toBe("unavailable");
    expect(result.partial).toBe(true);
    expect(result.files).toEqual([]);
  });
  test("manifest/README/workflow budgets and oversized-source skip are enforced", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`packages/p${i}/package.json`, JSON.stringify({ name: `p${i}` })]),
    );
    Object.assign(files, {
      "README.md": "a".repeat(GITHUB_LIMITS.fileBytes + 1),
      ".github/workflows/a.yml": "name: a",
      ".github/workflows/b.yml": "name: b",
      ".github/workflows/c.yml": "name: c",
      ".github/workflows/d.yml": "name: d",
    });
    const { client, calls } = fixture({ files });
    const result = await client.collect(parseRepo("example/project"));
    expect(result.files.filter((file) => file.path.endsWith("package.json"))).toHaveLength(10);
    expect(result.files.filter((file) => file.path.endsWith(".yml"))).toHaveLength(3);
    expect(calls.some(({ url }) => url.pathname.endsWith("README.md"))).toBe(false);
    expect(result.notes.join(" ")).toContain("Manifest coverage capped");
    expect(result.notes.join(" ")).toContain("Skipped oversized source README.md");
  });
  test("actual bytes override a dishonest Content-Length", async () => {
    const { client } = fixture({
      intercept: (url) =>
        url.pathname.includes("/git/trees/")
          ? new Response("x".repeat(GITHUB_LIMITS.jsonBytes + 1), { headers: { "content-length": "1" } })
          : undefined,
    });
    const result = await client.collect(parseRepo("example/project"));
    expect(result.treeState).toBe("unavailable");
    expect(result.notes.join(" ")).toContain("GITHUB_RESPONSE_TOO_LARGE");
  });
  test("oversized declared metadata fails before body consumption", async () => {
    const { client } = fixture({
      intercept: (url) => (url.pathname === "/repos/example/project" ? response({}, 200, { "content-length": "9999999" }) : undefined),
    });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "GITHUB_RESPONSE_TOO_LARGE" });
  });
  test("successful last-quota response is retained and prevents further network reads", async () => {
    const { client, calls } = fixture({
      intercept: (url) =>
        url.pathname.endsWith("/issues")
          ? response([{ number: 7, title: "Last allowed read" }], 200, {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(NOW / 1000 + 60),
            })
          : undefined,
    });
    const data = await client.collect(parseRepo("example/project"));
    expect(data.issues[0]!.number).toBe(7);
    expect(data.partial).toBe(true);
    expect(calls).toHaveLength(5);
    expect(data.rateLimitRemaining).toBe(0);
    expect(data.notes.join(" ")).toContain("GITHUB_RATE_LIMIT");
  });
  test("collection deadline stops subsequent calls instead of multiplying request timeouts", async () => {
    let time = NOW;
    const { client, calls } = fixture({
      now: () => time,
      intercept: (url) => {
        if (url.pathname === "/repos/example/project") time += GITHUB_LIMITS.collectionMs;
        return undefined;
      },
    });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "GITHUB_TIMEOUT" });
    expect(calls).toHaveLength(1);
  });
  test("decoded source bytes are bounded independently of GitHub's size claim", async () => {
    const { client } = fixture({
      intercept: (url) =>
        url.pathname.endsWith("/contents/package.json")
          ? response({
              type: "file",
              encoding: "base64",
              size: 1,
              content: Buffer.from("a".repeat(GITHUB_LIMITS.fileBytes + 1)).toString("base64"),
            })
          : undefined,
    });
    const data = await client.collect(parseRepo("example/project"));
    expect(data.partial).toBe(true);
    expect(data.files.some((file) => file.path === "package.json")).toBe(false);
    expect(data.notes.join(" ")).toContain("GITHUB_RESPONSE_TOO_LARGE");
  });
  test("empty repository has a typed error", async () => {
    const { client } = fixture({ intercept: (url) => (url.pathname.includes("/git/ref/") ? response({}, 409) : undefined) });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "EMPTY_REPO", status: 422 });
  });
  test("network failure and redirect failure do not expose arbitrary error details", async () => {
    const client = new GitHubClient("", async () => {
      throw new Error("internal credential or URL");
    });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({
      code: "GITHUB_UNAVAILABLE",
      message: "Could not reach GitHub.",
    });
  });
});

describe("moved public repositories", () => {
  test("follows a numeric GitHub metadata redirect, then pins all reads to canonical identity", async () => {
    const { client, calls } = fixture({
      intercept: (url) => {
        if (url.pathname === "/repos/former/project")
          return response({}, 301, { location: "https://api.github.com/repositories/10270250" });
        if (url.pathname === "/repositories/10270250")
          return response({ private: false, license: { spdx_id: "MIT" }, full_name: "example/project", default_branch: "main" });
      },
    });
    const result = await client.collect(parseRepo("former/project"));
    expect(result.repo.fullName).toBe("example/project");
    expect(result.repo.url).toBe("https://github.com/example/project");
    expect(result.files.every((file) => file.url.startsWith("https://github.com/example/project/"))).toBe(true);
    expect(calls.slice(0, 2).map((call) => call.url.pathname)).toEqual(["/repos/former/project", "/repositories/10270250"]);
    expect(calls.slice(2).every((call) => call.url.pathname.startsWith("/repos/example/project/"))).toBe(true);
    expect(calls.every((call) => call.url.origin === "https://api.github.com")).toBe(true);
  });
  test.each([
    "https://evil.test/repositories/1",
    "http://api.github.com/repositories/1",
    "https://api.github.com.evil.test/repositories/1",
    "https://user@api.github.com/repositories/1",
    "https://api.github.com:443/repositories/1",
    "https://api.github.com/repositories/1?token=x",
    "https://api.github.com/repositories/1#x",
    "https://api.github.com/repos/example/../project",
    "https://api.github.com/repos/example/%70roject",
    "https://api.github.com/user",
    "",
  ])("rejects unsafe redirect %s before a second authenticated fetch", async (location) => {
    const { client, calls } = fixture({ intercept: () => response({}, 301, { location }) });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "GITHUB_REDIRECT" });
    expect(calls).toHaveLength(1);
  });
  test("redirect loop and excessive hops stop without following forever", async () => {
    const loop = fixture({ intercept: () => response({}, 301, { location: "https://api.github.com/repos/example/project" }) });
    await expect(loop.client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "GITHUB_REDIRECT" });
    expect(loop.calls).toHaveLength(1);
    const hops = fixture({
      intercept: (url) =>
        response({}, 301, { location: `https://api.github.com/repositories/${Number(url.pathname.split("/").at(-1)) + 1 || 1}` }),
    });
    await expect(hops.client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "GITHUB_REDIRECT" });
    expect(hops.calls).toHaveLength(3);
  });
  test("moved metadata must still prove the repository is public", async () => {
    const { client, calls } = fixture({
      intercept: (url) =>
        url.pathname.startsWith("/repos/")
          ? response({}, 301, { location: "https://api.github.com/repositories/1" })
          : response({ private: true, full_name: "example/project", default_branch: "main" }),
    });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "PUBLIC_ONLY" });
    expect(calls).toHaveLength(2);
  });
  test("redirect hops share the original collection deadline", async () => {
    let time = NOW;
    const { client, calls } = fixture({
      now: () => time,
      intercept: () => {
        time += GITHUB_LIMITS.collectionMs;
        return response({}, 301, { location: "https://api.github.com/repositories/1" });
      },
    });
    await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "GITHUB_TIMEOUT" });
    expect(calls).toHaveLength(1);
  });
});

test("bounded recursive sampling retains a later root module after a large early directory", async () => {
  const { client } = fixture({
    tree: {
      tree: [
        ...Array.from({ length: GITHUB_LIMITS.treePaths }, (_, i) => ({ path: `aaa/deep/file${i}.txt`, type: "blob", sha: TREE })),
        { path: "zzz-core", type: "tree", sha: TREE },
        { path: "zzz-core/main.ts", type: "blob", sha: TREE },
      ],
      truncated: false,
    },
  });
  const result = await client.collect(parseRepo("example/project"));
  expect(result.tree).toHaveLength(GITHUB_LIMITS.treePaths);
  expect(result.tree.some((entry) => entry.path === "zzz-core")).toBe(true);
  expect(result.tree.some((entry) => entry.path === "zzz-core/main.ts")).toBe(true);
  expect(result.treeState).toBe("truncated");
});
