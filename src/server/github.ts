import type { CommitEvent, RepoIdentity, WorkflowRun, WorkItem } from "../contracts";

export const GITHUB_LIMITS = {
  treePaths: 8_000,
  jsonBytes: 8 * 1024 * 1024,
  files: 10,
  fileBytes: 16 * 1024,
  workflowFiles: 3,
  timeoutMs: 12_000,
  collectionMs: 60_000,
  fallbackRequests: 12,
  fallbackBytes: 512 * 1024,
  fallbackDepth: 3,
  metadataRequests: 6,
  metadataRedirects: 2,
  issues: 30,
  pulls: 30,
  workflows: 20,
  commits: 20,
} as const;
export interface RepoRef {
  owner: string;
  name: string;
  fullName: string;
}
export class GitHubError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public retryAfter?: number,
    public retryable = false,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Parse identity only. Never follow an input URL or allow it to select an API host. */
export function parseRepo(input: string): RepoRef {
  if (typeof input !== "string" || input.length > 300 || input !== input.trim())
    throw new GitHubError("INVALID_REPO", 400, "Use owner/repo or an HTTPS github.com repository URL.");
  let path = input;
  if (input.includes("://")) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new GitHubError("INVALID_REPO", 400, "Invalid repository URL.");
    }
    // Inspect the original path too: URL parsing normalizes dot segments and explicit :443.
    if (
      !/^https:\/\/github\.com\//i.test(input) ||
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /[%\\]/.test(input)
    )
      throw new GitHubError("INVALID_REPO", 400, "Only plain HTTPS github.com repository URLs are supported.");
    path = input.replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "");
  }
  const parts = path.split("/");
  const owner = parts[0] ?? "";
  const name = (parts[1] ?? "").replace(/\.git$/, "");
  if (
    parts.length !== 2 ||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner) ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(name) ||
    name === "." ||
    name === ".."
  )
    throw new GitHubError("INVALID_REPO", 400, "Use a repository root such as facebook/react.");
  return { owner, name, fullName: `${owner}/${name}` };
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}
export interface SourceFile {
  path: string;
  content: string;
  url: string;
}
export interface RepoCollection {
  repo: RepoIdentity;
  headSha: string;
  collectedAt: string;
  tree: TreeEntry[];
  treeState: "full" | "truncated" | "unavailable";
  files: SourceFile[];
  issues: WorkItem[];
  pulls: WorkItem[];
  workflows: WorkflowRun[];
  commits: CommitEvent[];
  languages: Record<string, number>;
  notes: string[];
  partial: boolean;
  rateLimitRemaining: number | null;
}
type Json = Record<string, any>;
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const text = (value: unknown, max = 600): string => (typeof value === "string" ? value.slice(0, max) : "");
const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : []);
const isSha = (value: unknown): value is string => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
export const sourceUrl = (ref: RepoRef, sha: string, path = "") =>
  `https://github.com/${ref.fullName}/${path ? "blob" : "tree"}/${sha}${path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : ""}`;
const manifestName = /(?:^|\/)(?:package\.json|Cargo\.toml|pyproject\.toml|go\.mod)$/;
const safePath = (path: unknown): path is string =>
  typeof path === "string" &&
  path.length <= 700 &&
  !/[\x00-\x1f\\]/.test(path) &&
  path.split("/").every((part) => part && part !== "." && part !== "..");
const fallbackContainers = [
  "apps",
  "packages",
  "services",
  "modules",
  "crates",
  "src",
  "lib",
  ".github",
  "cmd",
  "internal",
  "extensions",
  "plugins",
  "components",
  "client",
  "server",
];
type RequestBudget = { remaining: number };
class MetadataRedirect extends Error {
  constructor(public location: string) {
    super("GitHub repository metadata moved");
  }
}

/** Shared existing admission policy; license never grants or denies access. */
export function isPublicRepositoryMetadata(value: unknown): boolean {
  const metadata = value as { private?: unknown; visibility?: unknown } | null;
  return Boolean(metadata && metadata.private === false && (!metadata.visibility || metadata.visibility === "public"));
}

/** One bounded collection; fetch is injected in tests. Redirects cannot move credentials. */
export class GitHubClient {
  private blockedUntil = 0;
  private rateRemaining: number | null = null;
  constructor(
    private token = "",
    private fetcher: Fetcher = fetch,
    private now: () => number = Date.now,
  ) {}

  private async request(
    path: string,
    maxBytes: number = GITHUB_LIMITS.jsonBytes,
    deadline = Infinity,
    budget?: RequestBudget,
    metadata = false,
  ): Promise<any> {
    // All requests are fixed-host, idempotent GETs. Retry transport failures and transient
    // server errors once, sharing the original collection deadline and fallback budget.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce(path, maxBytes, deadline, budget, metadata);
      } catch (error) {
        if (attempt || !(error instanceof GitHubError) || !error.retryable) throw error;
      }
    }
  }

  private async requestOnce(path: string, maxBytes: number, deadline: number, budget?: RequestBudget, metadata = false): Promise<any> {
    const timeoutMs = Math.min(GITHUB_LIMITS.timeoutMs, deadline - this.now());
    if (timeoutMs <= 0) throw new GitHubError("GITHUB_TIMEOUT", 502, "GitHub collection exceeded its time limit.");
    if (this.blockedUntil > this.now())
      throw new GitHubError(
        "GITHUB_RATE_LIMIT",
        429,
        "GitHub rate limit is cooling down.",
        Math.ceil((this.blockedUntil - this.now()) / 1000),
      );
    if ((!path.startsWith("/repos/") && !(metadata && /^\/repositories\/[1-9]\d{0,19}$/.test(path))) || path.includes("#"))
      throw new GitHubError("INVALID_API_PATH", 500, "Invalid GitHub API path.");
    if (budget && budget.remaining <= 0) throw new GitHubError("GITHUB_REQUEST_BUDGET", 502, "GitHub request budget exhausted.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (budget) budget.remaining--;
      const response = await this.fetcher(`https://api.github.com${path}`, {
        signal: controller.signal,
        redirect: metadata ? "manual" : "error",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Moonshot-Repo-Worlds",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
      if (metadata && [301, 302, 307, 308].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        throw new MetadataRedirect(response.headers.get("location") || "");
      }
      const remaining = response.headers.get("x-ratelimit-remaining");
      this.rateRemaining = remaining !== null && /^\d+$/.test(remaining) ? Number(remaining) : null;
      const reset = Number(response.headers.get("x-ratelimit-reset") || 0) * 1000;
      if (response.status === 429 || (response.status === 403 && (this.rateRemaining === 0 || response.headers.has("retry-after")))) {
        const retryHeader = response.headers.get("retry-after");
        const retry = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : 60;
        this.blockedUntil = Math.max(this.now() + Math.min(86_400, Math.max(1, retry)) * 1000, Math.min(this.now() + 86_400_000, reset));
        await response.body?.cancel().catch(() => {});
        throw new GitHubError(
          "GITHUB_RATE_LIMIT",
          429,
          "GitHub rate limit reached; retry later.",
          Math.ceil((this.blockedUntil - this.now()) / 1000),
        );
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const code =
          response.status === 404
            ? "REPO_NOT_FOUND"
            : response.status === 403
              ? "GITHUB_FORBIDDEN"
              : response.status === 409
                ? "EMPTY_REPO"
                : "GITHUB_UNAVAILABLE";
        throw new GitHubError(
          code,
          response.status === 404 ? 404 : response.status === 403 ? 403 : response.status === 409 ? 422 : 502,
          response.status === 404 ? "Public repository or resource not found." : `GitHub request failed (${response.status}).`,
          undefined,
          [500, 502, 503, 504].includes(response.status),
        );
      }
      if (this.rateRemaining === 0)
        this.blockedUntil = Math.max(this.now() + 1_000, Math.min(this.now() + 86_400_000, reset || this.now() + 60_000));
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > maxBytes) {
        await response.body?.cancel().catch(() => {});
        throw new GitHubError("GITHUB_RESPONSE_TOO_LARGE", 502, "GitHub response exceeded the read limit.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new GitHubError("GITHUB_INVALID_RESPONSE", 502, "GitHub returned an empty response.");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new GitHubError("GITHUB_RESPONSE_TOO_LARGE", 502, "GitHub response exceeded the read limit.");
        }
        chunks.push(chunk.value);
      }
      if (controller.signal.aborted || this.now() >= deadline)
        throw new GitHubError("GITHUB_TIMEOUT", 502, "GitHub collection exceeded its time limit.");
      const buffer = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        return JSON.parse(new TextDecoder().decode(buffer));
      } catch {
        throw new GitHubError("GITHUB_INVALID_RESPONSE", 502, "GitHub returned invalid JSON.");
      }
    } catch (error) {
      if (error instanceof GitHubError || error instanceof MetadataRedirect) throw error;
      throw new GitHubError(
        controller.signal.aborted ? "GITHUB_TIMEOUT" : "GITHUB_UNAVAILABLE",
        502,
        controller.signal.aborted ? "GitHub request timed out." : "Could not reach GitHub.",
        undefined,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async metadata(ref: RepoRef, deadline: number): Promise<Json> {
    let path = `/repos/${ref.owner}/${ref.name}`;
    const seen = new Set<string>();
    const budget = { remaining: GITHUB_LIMITS.metadataRequests };
    for (let hops = 0; ; hops++) {
      if (seen.has(path)) throw new GitHubError("GITHUB_REDIRECT", 502, "GitHub repository redirect loop.");
      seen.add(path);
      try {
        return await this.request(path, 128 * 1024, deadline, budget, true);
      } catch (error) {
        if (!(error instanceof MetadataRedirect)) throw error;
        // Only repository metadata can redirect, and credentials never leave this exact origin.
        // Reject ports, userinfo, encodings, dot segments, queries and arbitrary API resources.
        if (
          hops >= GITHUB_LIMITS.metadataRedirects ||
          !/^https:\/\/api\.github\.com\/(?:repositories\/[1-9]\d{0,19}|repos\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)$/.test(error.location)
        )
          throw new GitHubError("GITHUB_REDIRECT", 502, "Unsupported GitHub repository redirect.");
        path = new URL(error.location).pathname;
        if (path.startsWith("/repos/")) parseRepo(path.slice(7));
      }
    }
  }

  async collect(ref: RepoRef): Promise<RepoCollection> {
    // Revalidate even if an untyped caller supplied a RepoRef object.
    ref = parseRepo(ref.fullName);
    const deadline = this.now() + GITHUB_LIMITS.collectionMs;
    const read = (path: string, maxBytes?: number) => this.request(path, maxBytes, deadline);
    const metadata = await this.metadata(ref, deadline);
    if (!isPublicRepositoryMetadata(metadata))
      throw new GitHubError("PUBLIC_ONLY", 403, "Only public repositories can be analyzed.");

    const canonical = parseRepo(text(metadata.full_name, 150));
    const root = `/repos/${canonical.owner}/${canonical.name}`;
    const branch = text(metadata.default_branch, 200);
    if (!branch) throw new GitHubError("EMPTY_REPO", 422, "Repository has no default branch.");
    let head: Json;
    try {
      const reference = await read(`${root}/git/ref/heads/${encodeURIComponent(branch)}`, 32 * 1024);
      if (!isSha(reference?.object?.sha) || reference.object.type !== "commit")
        throw new GitHubError("GITHUB_INVALID_RESPONSE", 502, "GitHub did not return a commit reference.");
      head = await read(`${root}/git/commits/${reference.object.sha}`, 128 * 1024);
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 404 || error.code === "EMPTY_REPO"))
        throw new GitHubError("EMPTY_REPO", 422, "Repository has no readable default-branch commit.");
      throw error;
    }
    if (!isSha(head.sha) || !isSha(head.tree?.sha))
      throw new GitHubError("GITHUB_INVALID_RESPONSE", 502, "GitHub did not return a valid commit identity.");
    const headSha = head.sha;
    const result: RepoCollection = {
      repo: {
        owner: canonical.owner,
        name: canonical.name,
        fullName: canonical.fullName,
        url: `https://github.com/${canonical.fullName}`,
        description: text(metadata.description),
        stars: number(metadata.stargazers_count),
        forks: number(metadata.forks_count),
        openIssues: number(metadata.open_issues_count),
        language: text(metadata.language, 50) || null,
        defaultBranch: branch,
        pushedAt: text(metadata.pushed_at, 50),
        license: text(metadata.license?.spdx_id, 80) || null,
        homepage: /^https?:\/\//.test(text(metadata.homepage)) ? text(metadata.homepage) : null,
      },
      headSha,
      collectedAt: new Date(this.now()).toISOString(),
      tree: [],
      treeState: "unavailable",
      files: [],
      issues: [],
      pulls: [],
      workflows: [],
      commits: [],
      languages: {},
      notes: [],
      partial: false,
      rateLimitRemaining: this.rateRemaining,
    };
    const optional = async <T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await read();
      } catch (error) {
        result.partial = true;
        result.notes.push(
          `${label} unavailable (${error instanceof GitHubError ? error.code : "UNKNOWN"}); absence is not evidence of zero activity.`,
        );
        return fallback;
      }
    };
    const tree = await optional<Json | null>(
      "Recursive tree",
      async () => {
        const value = await read(`${root}/git/trees/${head.tree.sha}?recursive=1`);
        if (!value || !Array.isArray(value.tree) || (value.sha !== undefined && value.sha !== head.tree.sha))
          throw new GitHubError("GITHUB_INVALID_RESPONSE", 502, "GitHub tree response did not match the requested tree.");
        return value;
      },
      null,
    );
    if (tree) {
      const entries = list(tree.tree).filter(
        (entry) => safePath(entry.path) && isSha(entry.sha) && (entry.type === "blob" || entry.type === "tree"),
      );
      // GitHub returns a depth-first tree. Taking its first 8000 paths can hide
      // an entire later root module behind one large early directory.
      if (entries.length > GITHUB_LIMITS.treePaths) {
        entries.sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
      }
      result.tree = entries.slice(0, GITHUB_LIMITS.treePaths).map((entry) => ({
        path: entry.path,
        type: entry.type,
        size: typeof entry.size === "number" ? entry.size : undefined,
        sha: text(entry.sha, 64),
      }));
      result.treeState =
        tree.truncated || entries.length > GITHUB_LIMITS.treePaths || entries.length !== tree.tree.length ? "truncated" : "full";
      if (result.treeState === "truncated") {
        result.partial = true;
        result.notes.push(`Tree is truncated to ${result.tree.length} returned paths; missing files and dependencies remain unknown.`);
      }
    } else await this.collectShallowTree(root, head.tree.sha, deadline, result);
    // Sequential optional reads bound concurrency and stop spending requests after a rate response.
    const readArray = async (path: string, maxBytes: number) => {
      const value = await read(path, maxBytes);
      if (!Array.isArray(value)) throw new GitHubError("GITHUB_INVALID_RESPONSE", 502, "GitHub list response was invalid.");
      return value;
    };
    const rawIssues = await optional(
      "Issues",
      () => readArray(`${root}/issues?state=open&sort=updated&direction=desc&per_page=${GITHUB_LIMITS.issues}`, 512 * 1024),
      [],
    );
    result.issues = list(rawIssues)
      .filter((item) => !item.pull_request)
      .slice(0, GITHUB_LIMITS.issues)
      .map((item) => this.workItem(item, "issue", canonical));
    if (list(rawIssues).some((item) => item.pull_request))
      result.notes.push(
        "The GitHub issues window includes pull requests; the issue list is a filtered bounded window, not a complete issue count.",
      );
    const rawPulls = await optional(
      "Pull requests",
      () => readArray(`${root}/pulls?state=open&sort=updated&direction=desc&per_page=${GITHUB_LIMITS.pulls}`, 1024 * 1024),
      [],
    );
    result.pulls = list(rawPulls)
      .slice(0, GITHUB_LIMITS.pulls)
      .map((item) => this.workItem(item, "pull", canonical));
    const rawRuns = await optional(
      "Workflow runs",
      async () => {
        const value = await read(`${root}/actions/runs?per_page=${GITHUB_LIMITS.workflows}`, 1024 * 1024);
        if (!value || !Array.isArray(value.workflow_runs))
          throw new GitHubError("GITHUB_INVALID_RESPONSE", 502, "GitHub workflow response was invalid.");
        return value;
      },
      null,
    );
    result.workflows = list(rawRuns?.workflow_runs)
      .slice(0, GITHUB_LIMITS.workflows)
      .map((run) => ({
        id: number(run.id),
        name: text(run.name, 180),
        url: `https://github.com/${canonical.fullName}/actions/runs/${number(run.id)}`,
        status: text(run.status, 40),
        conclusion: text(run.conclusion, 40) || null,
        branch: text(run.head_branch, 200),
        headSha: isSha(run.head_sha) ? run.head_sha : "",
        createdAt: text(run.created_at, 50),
        updatedAt: text(run.updated_at, 50),
      }));
    if (!result.workflows.length)
      result.notes.push("CI status is unknown: no workflow runs were observed in the bounded window. This is not a passing pipeline.");
    else if (!result.workflows.some((run) => run.headSha === headSha))
      result.notes.push("No workflow run for the collected head was observed; head CI remains unknown.");
    const rawCommits = await optional(
      "Commits",
      () => readArray(`${root}/commits?sha=${headSha}&per_page=${GITHUB_LIMITS.commits}`, 1024 * 1024),
      [],
    );
    result.commits = list(rawCommits)
      .slice(0, GITHUB_LIMITS.commits)
      .filter((item) => isSha(item.sha))
      .map((item) => ({
        id: item.sha,
        message: text(item.commit?.message, 500),
        url: `https://github.com/${canonical.fullName}/commit/${item.sha}`,
        author: text(item.author?.login || item.commit?.author?.name, 100),
        date: text(item.commit?.author?.date, 50),
      }));
    const languages = await optional<Json>(
      "Languages",
      async () => {
        const value = await read(`${root}/languages`, 32 * 1024);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new GitHubError("GITHUB_INVALID_RESPONSE", 502, "GitHub language response was invalid.");
        return value;
      },
      {},
    );
    result.languages = Object.fromEntries(
      Object.entries(languages || {})
        .filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value >= 0)
        .slice(0, 50),
    );
    const blobs = result.tree.filter((entry) => entry.type === "blob");
    const manifests = blobs
      .filter((entry) => manifestName.test(entry.path))
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
    if (manifests.length > GITHUB_LIMITS.files)
      result.notes.push(`Manifest coverage capped at ${GITHUB_LIMITS.files} of ${manifests.length} discovered manifests.`);
    const readme = blobs.find((entry) => /^readme(?:\.(?:md|mdx|rst|txt))?$/i.test(entry.path));
    const workflows = blobs.filter((entry) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(entry.path));
    const targets = [
      ...manifests.slice(0, GITHUB_LIMITS.files),
      ...(readme ? [readme] : []),
      ...workflows.slice(0, GITHUB_LIMITS.workflowFiles),
    ];
    if (workflows.length > GITHUB_LIMITS.workflowFiles)
      result.notes.push(`Workflow source coverage capped at ${GITHUB_LIMITS.workflowFiles} of ${workflows.length} discovered workflows.`);
    for (const entry of targets) {
      if (entry.size !== undefined && entry.size > GITHUB_LIMITS.fileBytes) {
        result.partial = true;
        result.notes.push(`Skipped oversized source ${entry.path} (limit ${GITHUB_LIMITS.fileBytes} bytes).`);
        continue;
      }
      const file = await optional(
        `Source ${entry.path}`,
        async () => {
          const raw = await read(`${root}/contents/${entry.path.split("/").map(encodeURIComponent).join("/")}?ref=${headSha}`, 40 * 1024);
          if (
            raw.type !== "file" ||
            raw.encoding !== "base64" ||
            typeof raw.content !== "string" ||
            raw.size > GITHUB_LIMITS.fileBytes ||
            raw.content.length > 24 * 1024
          )
            throw new GitHubError("GITHUB_INVALID_SOURCE", 502, "Source content exceeded bounds or was not a file.");
          const buffer = Buffer.from(raw.content, "base64");
          if (buffer.length > GITHUB_LIMITS.fileBytes)
            throw new GitHubError("GITHUB_RESPONSE_TOO_LARGE", 502, "Source content exceeded the read limit.");
          return { path: entry.path, content: buffer.toString("utf8"), url: sourceUrl(canonical, headSha, entry.path) };
        },
        null,
      );
      if (file) result.files.push(file);
    }
    result.notes.push(
      `Captured at ${result.collectedAt}; tree, source and commits are pinned to ${headSha}. Issues, pull requests, languages and run windows are independently observed current API facts, not an atomic historical snapshot.`,
      `Windows: up to ${GITHUB_LIMITS.issues} issue endpoint entries, ${GITHUB_LIMITS.pulls} open pull requests, ${GITHUB_LIMITS.workflows} workflow runs and ${GITHUB_LIMITS.commits} commits; no pagination beyond these windows.`,
      "Repository openIssues is GitHub open_issues_count and includes open pull requests; activity windows are not exhaustive totals.",
      "Workflow windows do not establish required-check completeness, deployment or release status; these remain unknown.",
      "Architecture status does not assert runtime health, deployment, or real traffic.",
    );
    result.rateLimitRemaining = this.rateRemaining;
    return result;
  }

  private async collectShallowTree(root: string, rootSha: string, deadline: number, result: RepoCollection): Promise<void> {
    const budget = { remaining: GITHUB_LIMITS.fallbackRequests };
    const queue = [{ path: "", sha: rootSha, depth: 0 }];
    const seen = new Set<string>();
    const observed: string[] = [];
    const priority = (path: string) => {
      const rank = fallbackContainers.indexOf(path);
      return rank < 0 ? fallbackContainers.length : rank;
    };
    result.partial = true;
    // Shallow names are relative to the requested tree. Validate entry SHAs and
    // preserve the prefix; never follow a returned URL or assert full coverage.
    for (let index = 0; index < queue.length && budget.remaining > 0 && result.tree.length < GITHUB_LIMITS.treePaths; index++) {
      if (this.now() >= deadline || this.blockedUntil > this.now()) break;
      const current = queue[index]!;
      let value: Json;
      try {
        value = await this.request(`${root}/git/trees/${current.sha}`, GITHUB_LIMITS.fallbackBytes, deadline, budget);
        if (!value || value.sha !== current.sha || !Array.isArray(value.tree))
          throw new GitHubError("GITHUB_INVALID_RESPONSE", 502, "GitHub shallow tree did not match its requested SHA.");
      } catch (error) {
        result.notes.push(
          `Shallow tree ${current.path || "root"} unavailable (${error instanceof GitHubError ? error.code : "UNKNOWN"}); descendants remain unknown.`,
        );
        if (
          error instanceof GitHubError &&
          ["GITHUB_RATE_LIMIT", "GITHUB_FORBIDDEN", "GITHUB_TIMEOUT", "GITHUB_REQUEST_BUDGET"].includes(error.code)
        )
          break;
        continue;
      }
      observed.push(current.path || "root");
      result.treeState = "truncated";
      const children: { path: string; sha: string; depth: number }[] = [];
      let invalid = 0;
      for (const entry of value.tree) {
        if (
          !entry ||
          !safePath(entry.path) ||
          entry.path.includes("/") ||
          !isSha(entry.sha) ||
          (entry.type !== "blob" && entry.type !== "tree")
        ) {
          invalid++;
          continue;
        }
        const path = current.path ? `${current.path}/${entry.path}` : entry.path;
        if (!safePath(path) || seen.has(path)) {
          invalid++;
          continue;
        }
        seen.add(path);
        result.tree.push({
          path,
          type: entry.type,
          sha: entry.sha,
          size: typeof entry.size === "number" && Number.isFinite(entry.size) && entry.size >= 0 ? entry.size : undefined,
        });
        if (
          entry.type === "tree" &&
          current.depth + 1 < GITHUB_LIMITS.fallbackDepth &&
          (current.depth > 0 || fallbackContainers.includes(entry.path))
        )
          children.push({ path, sha: entry.sha, depth: current.depth + 1 });
        if (result.tree.length >= GITHUB_LIMITS.treePaths) break;
      }
      children.sort((a, b) => priority(a.path.split("/").at(-1)!) - priority(b.path.split("/").at(-1)!) || a.path.localeCompare(b.path));
      queue.push(...children);
      if (invalid) result.notes.push(`Shallow tree ${current.path || "root"} omitted ${invalid} invalid or unsupported entries.`);
      if (value.truncated)
        result.notes.push(`GitHub also truncated shallow tree ${current.path || "root"}; its missing entries remain unknown.`);
    }
    result.notes.push(
      `Bounded shallow-tree fallback: ${GITHUB_LIMITS.fallbackRequests - budget.remaining}/${GITHUB_LIMITS.fallbackRequests} extra requests including retries, at most ${GITHUB_LIMITS.fallbackBytes} bytes per response and ${GITHUB_LIMITS.fallbackDepth} path segments. Observed trees: ${observed.join(", ") || "none"}.`,
      `Tree coverage ${result.treeState}: ${result.tree.length}/${GITHUB_LIMITS.treePaths} paths retained; unvisited directories, missing files and dependencies remain unknown.`,
    );
  }

  private workItem(item: Json, kind: "issue" | "pull", ref: RepoRef): WorkItem {
    return {
      number: number(item.number),
      title: text(item.title, 300),
      url: `https://github.com/${ref.fullName}/${kind === "pull" ? "pull" : "issues"}/${number(item.number)}`,
      state: item.state === "closed" ? "closed" : "open",
      author: text(item.user?.login, 100),
      updatedAt: text(item.updated_at, 50),
      labels: list(item.labels)
        .slice(0, 20)
        .map((label) => text(label.name, 80)),
      kind,
      ...(kind === "pull" ? { draft: item.draft === true, headSha: isSha(item.head?.sha) ? item.head.sha : undefined } : {}),
    };
  }
}
