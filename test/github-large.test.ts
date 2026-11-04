import { describe, expect, test } from "bun:test";
import { GITHUB_LIMITS, GitHubClient, parseRepo, type Fetcher } from "../src/server/github";

const HEAD = "a".repeat(40);
const ROOT = "b".repeat(40);
const APPS = "c".repeat(40);
const WEB = "d".repeat(40);
const GITHUB = "e".repeat(40);
const WORKFLOWS = "f".repeat(40);
const NOW = Date.parse("2026-11-04T18:00:00Z");
const BASE = "/repos/example/large";
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers });
const blob = (path: string, sha = HEAD) => ({ path, sha, type: "blob", size: 10 });
const directory = (path: string, sha: string) => ({ path, sha, type: "tree" });
const tooLarge = () => json({}, 200, { "content-length": String(8 * 1024 * 1024 + 1) });
type Call = { url: URL; init?: RequestInit };

function fixture(
  options: {
    trees?: Record<string, unknown[]>;
    files?: Record<string, string>;
    intercept?: (url: URL) => Response | undefined | Promise<Response | undefined>;
    now?: () => number;
  } = {},
) {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const custom = await options.intercept?.(url);
    if (custom) return custom;
    const path = url.pathname;
    if (path === BASE) return json({ private: false, visibility: "public", full_name: "example/large", default_branch: "main" });
    if (path === `${BASE}/git/ref/heads/main`) return json({ object: { type: "commit", sha: HEAD } });
    if (path === `${BASE}/git/commits/${HEAD}`) return json({ sha: HEAD, tree: { sha: ROOT } });
    if (path.includes("/git/trees/")) {
      if (url.searchParams.has("recursive")) return tooLarge();
      const sha = path.split("/").at(-1)!;
      return options.trees?.[sha] ? json({ sha, tree: options.trees[sha], truncated: false }) : json({}, 404);
    }
    if (path.includes("/contents/")) {
      const content = options.files?.[decodeURIComponent(path.split("/contents/")[1]!)];
      return content === undefined
        ? json({}, 404)
        : json({
            type: "file",
            encoding: "base64",
            size: Buffer.byteLength(content),
            content: Buffer.from(content).toString("base64"),
          });
    }
    if (path.endsWith("/languages")) return json({ TypeScript: 100 });
    if (path.endsWith("/actions/runs")) return json({ workflow_runs: [] });
    if (path.endsWith("/issues") || path.endsWith("/pulls") || path.endsWith("/commits")) return json([]);
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  };
  return { calls, client: new GitHubClient("", fetcher, options.now ?? (() => NOW)) };
}
const collect = (client: GitHubClient) => client.collect(parseRepo("example/large"));
const treeCalls = (calls: Call[]) => calls.filter(({ url }) => url.pathname.includes("/git/trees/"));
const shallowCalls = (calls: Call[]) => treeCalls(calls).filter(({ url }) => !url.searchParams.has("recursive"));

describe("large-repository shallow fallback", () => {
  test("oversized recursive tree retains root and prefixed app paths, scans all observed manifests and workflow sources", async () => {
    const files = {
      "package.json": '{"name":"root"}',
      "README.md": "# Root",
      "apps/web/package.json": '{"name":"web"}',
      ".github/workflows/ci.yml": "name: CI",
    };
    const { client, calls } = fixture({
      files,
      trees: {
        [ROOT]: [blob("package.json"), blob("README.md"), directory("apps", APPS), directory(".github", GITHUB), directory("docs", HEAD)],
        [APPS]: [directory("web", WEB)],
        [WEB]: [blob("package.json"), directory("src", HEAD)],
        [GITHUB]: [directory("workflows", WORKFLOWS)],
        [WORKFLOWS]: [blob("ci.yml")],
      },
    });
    const result = await collect(client);
    expect(result.treeState).toBe("truncated");
    expect(result.partial).toBe(true);
    expect(result.tree.map((entry) => entry.path)).toContain("apps/web/package.json");
    expect(result.tree.map((entry) => entry.path)).toContain("apps/web/src");
    expect(result.tree.find((entry) => entry.path === "apps/web")?.sha).toBe(WEB);
    expect(result.files.map((file) => file.path).sort()).toEqual(Object.keys(files).sort());
    expect(result.notes.join(" ")).toContain("GITHUB_RESPONSE_TOO_LARGE");
    expect(result.notes.join(" ")).toContain("Observed trees: root, apps, .github, apps/web, .github/workflows");
    expect(result.notes.join(" ")).toContain("unvisited directories");
    expect(treeCalls(calls)).toHaveLength(6);
    expect(shallowCalls(calls).some(({ url }) => url.pathname.endsWith(HEAD))).toBe(false);
    for (const { url, init } of calls) {
      expect(url.origin).toBe("https://api.github.com");
      expect(init?.redirect).toBe(url.pathname === "/repos/example/large" ? "manual" : "error");
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      if (url.pathname.includes("/contents/")) expect(url.searchParams.get("ref")).toBe(HEAD);
    }
    expect(result.files.every((file) => file.url.startsWith(`https://github.com/example/large/blob/${HEAD}/`))).toBe(true);
  });

  test("streamed recursive bytes still enforce 8 MiB, then use a small shallow root", async () => {
    let cancelled = false;
    const { client } = fixture({
      trees: { [ROOT]: [directory("src", APPS)], [APPS]: [blob("main.ts")] },
      intercept: (url) => {
        if (!url.searchParams.has("recursive")) return;
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-length": "1" } },
        );
      },
    });
    const result = await collect(client);
    expect(cancelled).toBe(true);
    expect(result.tree.map((entry) => entry.path)).toEqual(["src", "src/main.ts"]);
    expect(result.treeState).toBe("truncated");
  });

  test.each([404, 503])("an unavailable recursive endpoint (%s) can still use shallow trees", async (status) => {
    const { client, calls } = fixture({
      trees: { [ROOT]: [blob("README.md")] },
      intercept: (url) => (url.searchParams.has("recursive") ? json({}, status) : undefined),
    });
    const result = await collect(client);
    expect(result.tree.map((entry) => entry.path)).toEqual(["README.md"]);
    expect(result.treeState).toBe("truncated");
    expect(treeCalls(calls).filter(({ url }) => url.searchParams.has("recursive"))).toHaveLength(status === 503 ? 2 : 1);
  });

  test("all tree failures remain unavailable, with no invented entries", async () => {
    const { client, calls } = fixture();
    const result = await collect(client);
    expect(result.treeState).toBe("unavailable");
    expect(result.tree).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.partial).toBe(true);
    expect(shallowCalls(calls)).toHaveLength(1);
    expect(result.notes.join(" ")).toContain("Observed trees: none");
  });

  test.each([403, 429])("rate response %s blocks fallback and all later network calls", async (status) => {
    const { client, calls } = fixture({
      intercept: (url) =>
        url.searchParams.has("recursive") ? json({}, status, { "retry-after": "60", "x-ratelimit-remaining": "0" }) : undefined,
    });
    const result = await collect(client);
    expect(result.treeState).toBe("unavailable");
    expect(result.partial).toBe(true);
    expect(calls).toHaveLength(4);
    expect(shallowCalls(calls)).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("GITHUB_RATE_LIMIT");
    await expect(collect(client)).rejects.toMatchObject({ code: "GITHUB_RATE_LIMIT" });
    expect(calls).toHaveLength(4);
  });

  test("rate limit during fallback retains only previously observed paths", async () => {
    const { client, calls } = fixture({
      trees: { [ROOT]: [directory("apps", APPS), directory("src", WEB)] },
      intercept: (url) => (url.pathname.endsWith(APPS) ? json({}, 429, { "retry-after": "60" }) : undefined),
    });
    const result = await collect(client);
    expect(result.treeState).toBe("truncated");
    expect(result.tree.map((entry) => entry.path)).toEqual(["apps", "src"]);
    expect(shallowCalls(calls)).toHaveLength(2);
    expect(calls).toHaveLength(6);
  });

  test("a successful last-quota root is retained without spending further network calls", async () => {
    const { client, calls } = fixture({
      intercept: (url) =>
        url.pathname.endsWith(ROOT) && !url.search
          ? json({ sha: ROOT, tree: [directory("apps", APPS)] }, 200, { "x-ratelimit-remaining": "0" })
          : undefined,
    });
    const result = await collect(client);
    expect(result.tree.map((entry) => entry.path)).toEqual(["apps"]);
    expect(result.treeState).toBe("truncated");
    expect(result.rateLimitRemaining).toBe(0);
    expect(calls).toHaveLength(5);
  });

  test("rejects malformed entry paths and SHAs before following any subtree", async () => {
    const { client, calls } = fixture({
      trees: {
        [ROOT]: [
          directory("apps", APPS),
          directory("src", "not-a-sha"),
          directory("../packages", WEB),
          directory("/services", WEB),
          directory("modules/nested", WEB),
          directory("lib\\nested", WEB),
          directory("crates\u0000", WEB),
          directory("services", "1".repeat(41)),
          blob("README.md"),
        ],
        [APPS]: [directory("web", WEB), blob("../escape"), blob("evil/child"), blob("bad-sha", "https://evil.example/tree")],
        [WEB]: [blob("package.json"), blob("package.json"), null],
      },
    });
    const result = await collect(client);
    expect(result.tree.map((entry) => entry.path)).toEqual(["apps", "README.md", "apps/web", "apps/web/package.json"]);
    expect(shallowCalls(calls).map(({ url }) => url.pathname.split("/").at(-1))).toEqual([ROOT, APPS, WEB]);
    expect(result.notes.join(" ")).toContain("invalid or unsupported entries");
  });

  test.each(["mismatch", "missing", "invalid"])("%s shallow response SHA is not adopted", async (kind) => {
    const { client, calls } = fixture({
      intercept: (url) =>
        url.pathname.endsWith(ROOT) && !url.search
          ? json({ sha: kind === "mismatch" ? APPS : kind === "missing" ? undefined : "invalid", tree: [directory("apps", APPS)] })
          : undefined,
    });
    const result = await collect(client);
    expect(result.tree).toEqual([]);
    expect(result.treeState).toBe("unavailable");
    expect(shallowCalls(calls)).toHaveLength(1);
    expect(result.notes.join(" ")).toContain("GITHUB_INVALID_RESPONSE");
  });

  test("a mismatched child response cannot supply forged prefixed entries", async () => {
    const { client } = fixture({
      trees: { [ROOT]: [directory("apps", APPS)] },
      intercept: (url) => (url.pathname.endsWith(APPS) ? json({ sha: WEB, tree: [blob("forged.ts")] }) : undefined),
    });
    const result = await collect(client);
    expect(result.tree.map((entry) => entry.path)).toEqual(["apps"]);
    expect(result.treeState).toBe("truncated");
  });

  test("uses breadth-first traversal and stops at three path segments", async () => {
    const DEEP = "1".repeat(40);
    const { client, calls } = fixture({
      trees: {
        [ROOT]: [directory("apps", APPS), directory("packages", GITHUB)],
        [APPS]: [directory("web", WEB)],
        [GITHUB]: [directory("shared", WORKFLOWS)],
        [WEB]: [directory("src", DEEP), blob("package.json")],
        [WORKFLOWS]: [blob("Cargo.toml")],
        [DEEP]: [blob("never-read.ts")],
      },
    });
    const result = await collect(client);
    expect(shallowCalls(calls).map(({ url }) => url.pathname.split("/").at(-1))).toEqual([ROOT, APPS, GITHUB, WEB, WORKFLOWS]);
    expect(result.tree.map((entry) => entry.path)).toContain("apps/web/src");
    expect(result.tree.some((entry) => entry.path.split("/").length > 3)).toBe(false);
    expect(result.tree.some((entry) => entry.path.endsWith("never-read.ts"))).toBe(false);
  });

  test("root plus selected subtrees has a hard total of twelve extra requests", async () => {
    const children = Array.from({ length: 20 }, (_, index) => ({
      path: `p${String(index).padStart(2, "0")}`,
      sha: (index + 1).toString(16).padStart(40, "0"),
      type: "tree",
    }));
    const trees = Object.fromEntries(children.map((entry) => [entry.sha, [blob("index.ts")]]));
    Object.assign(trees, { [ROOT]: [directory("packages", APPS)], [APPS]: children });
    const { client, calls } = fixture({ trees });
    const result = await collect(client);
    expect(shallowCalls(calls)).toHaveLength(12);
    expect(result.tree.filter((entry) => entry.path.endsWith("index.ts"))).toHaveLength(10);
    expect(result.treeState).toBe("truncated");
    expect(result.notes.join(" ")).toContain("12/12 extra requests including retries");
  });

  test("transient retries consume the same twelve-request fallback budget", async () => {
    const children = Array.from({ length: 20 }, (_, index) => directory(`p${index}`, (index + 1).toString(16).padStart(40, "0")));
    const { client, calls } = fixture({
      trees: { [ROOT]: [directory("packages", APPS)], [APPS]: children },
      intercept: (url) => {
        if (children.some((entry) => url.pathname.endsWith(entry.sha))) throw new TypeError("temporary network failure");
      },
    });
    const result = await collect(client);
    expect(shallowCalls(calls)).toHaveLength(12);
    expect(result.tree).toHaveLength(21);
    expect(result.treeState).toBe("truncated");
  });

  test("retains at most 8000 paths across multiple small shallow responses", async () => {
    const { client, calls } = fixture({
      trees: {
        [ROOT]: [directory("src", APPS), ...Array.from({ length: 3999 }, (_, index) => blob(`f${index}`))],
        [APPS]: Array.from({ length: 4001 }, (_, index) => blob(`s${index}`)),
      },
    });
    const result = await collect(client);
    expect(result.tree).toHaveLength(8000);
    expect(result.tree.some((entry) => entry.path === "src/s3999")).toBe(true);
    expect(result.tree.some((entry) => entry.path === "src/s4000")).toBe(false);
    expect(shallowCalls(calls)).toHaveLength(2);
    expect(result.treeState).toBe("truncated");
  });

  test.each(["declared", "streamed"])("shallow responses enforce a smaller 512 KiB read bound (%s)", async (kind) => {
    const { client, calls } = fixture({
      intercept: (url) => {
        if (url.pathname.endsWith(ROOT) && !url.search)
          return kind === "declared"
            ? json({}, 200, { "content-length": String(512 * 1024 + 1) })
            : new Response("x".repeat(512 * 1024 + 1), { headers: { "content-length": "1" } });
      },
    });
    const result = await collect(client);
    expect(result.treeState).toBe("unavailable");
    expect(shallowCalls(calls)).toHaveLength(1);
    expect(result.notes.join(" ")).toContain("Shallow tree root unavailable (GITHUB_RESPONSE_TOO_LARGE)");
  });

  test("a shallow upstream truncation remains explicit even when few entries were returned", async () => {
    const { client } = fixture({
      intercept: (url) =>
        url.pathname.endsWith(ROOT) && !url.search ? json({ sha: ROOT, truncated: true, tree: [directory("src", APPS)] }) : undefined,
    });
    const result = await collect(client);
    expect(result.treeState).toBe("truncated");
    expect(result.notes.join(" ")).toContain("GitHub also truncated shallow tree root");
  });

  test("no fallback or activity requests start after the shared collection deadline", async () => {
    let clock = NOW;
    const { client, calls } = fixture({
      now: () => clock,
      intercept: (url) => {
        if (url.searchParams.has("recursive")) {
          clock += 60_000;
          return tooLarge();
        }
      },
    });
    const result = await collect(client);
    expect(result.treeState).toBe("unavailable");
    expect(calls).toHaveLength(4);
    expect(shallowCalls(calls)).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("GITHUB_TIMEOUT");
  });

  test("a shallow response arriving at the deadline is not adopted or followed", async () => {
    let clock = NOW;
    const { client, calls } = fixture({
      now: () => clock,
      trees: { [ROOT]: [directory("apps", APPS), directory("src", WEB)] },
      intercept: (url) => {
        if (url.pathname.endsWith(APPS)) {
          clock += 60_000;
          return json({ sha: APPS, tree: [blob("late.ts")] });
        }
      },
    });
    const result = await collect(client);
    expect(result.tree.map((entry) => entry.path)).toEqual(["apps", "src"]);
    expect(shallowCalls(calls)).toHaveLength(2);
    expect(calls).toHaveLength(6);
    expect(result.notes.join(" ")).toContain("GITHUB_TIMEOUT");
  });
});

describe("bounded idempotent GET retry", () => {
  test("one transient transport failure can recover on the original endpoint", async () => {
    let attempts = 0;
    const { client, calls } = fixture({
      trees: { [ROOT]: [blob("README.md")] },
      intercept: (url) => {
        if (url.pathname === BASE && attempts++ === 0) throw new TypeError("temporary DNS failure");
      },
    });
    const result = await collect(client);
    expect(result.repo.fullName).toBe("example/large");
    expect(calls.filter(({ url }) => url.pathname === BASE)).toHaveLength(2);
  });

  test("a transient shallow read retries once and preserves its relative prefix", async () => {
    let attempts = 0;
    const { client, calls } = fixture({
      trees: { [ROOT]: [directory("apps", APPS)], [APPS]: [blob("index.ts")] },
      intercept: (url) => {
        if (url.pathname.endsWith(APPS) && attempts++ === 0) throw new TypeError("temporary network failure");
      },
    });
    const result = await collect(client);
    expect(result.tree.map((entry) => entry.path)).toEqual(["apps", "apps/index.ts"]);
    expect(shallowCalls(calls)).toHaveLength(3);
  });

  test("persistent transport failure is attempted exactly twice without error detail leakage", async () => {
    let attempts = 0;
    const client = new GitHubClient("", async () => {
      attempts++;
      throw new TypeError("internal secret detail");
    });
    await expect(collect(client)).rejects.toMatchObject({ code: "GITHUB_UNAVAILABLE", message: "Could not reach GitHub." });
    expect(attempts).toBe(2);
  });

  test.each([401, 403, 404, 409, 422, 429])("HTTP %s is not retried", async (status) => {
    const { client, calls } = fixture({ intercept: () => json({}, status) });
    await expect(collect(client)).rejects.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  test.each(["json", "oversize"])("%s response failures are not retried", async (kind) => {
    const { client, calls } = fixture({
      intercept: (url) => (url.pathname === BASE ? (kind === "json" ? new Response("invalid JSON") : tooLarge()) : undefined),
    });
    await expect(collect(client)).rejects.toMatchObject({
      code: kind === "json" ? "GITHUB_INVALID_RESPONSE" : "GITHUB_RESPONSE_TOO_LARGE",
    });
    expect(calls).toHaveLength(1);
  });

  test.each(["forbidden", "oversize"])("body cancellation failure cannot turn %s into a retry", async (kind) => {
    let attempts = 0;
    const client = new GitHubClient("", async () => {
      attempts++;
      return new Response(
        new ReadableStream({
          cancel() {
            throw new TypeError("cancel failed");
          },
        }),
        {
          status: kind === "forbidden" ? 403 : 200,
          headers: kind === "oversize" ? { "content-length": String(8 * 1024 * 1024 + 1) } : {},
        },
      );
    });
    await expect(collect(client)).rejects.toMatchObject({ code: kind === "forbidden" ? "GITHUB_FORBIDDEN" : "GITHUB_RESPONSE_TOO_LARGE" });
    expect(attempts).toBe(1);
  });

  test("retry cannot extend the original collection deadline", async () => {
    let clock = NOW;
    const { client, calls } = fixture({
      now: () => clock,
      intercept: () => {
        clock += 60_000;
        throw new TypeError("temporary failure after deadline");
      },
    });
    await expect(collect(client)).rejects.toMatchObject({ code: "GITHUB_TIMEOUT" });
    expect(calls).toHaveLength(1);
  });

  test("the original recursive reader and collection limits are unchanged", () => {
    expect(GITHUB_LIMITS.jsonBytes).toBe(8 * 1024 * 1024);
    expect(GITHUB_LIMITS.treePaths).toBe(8000);
    expect(GITHUB_LIMITS.collectionMs).toBe(60_000);
  });
});
