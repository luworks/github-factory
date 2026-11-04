import { posix } from "node:path";
import type { AiBlueprint, NodeKind, WorldEdge, WorldNode, WorldSnapshot } from "../contracts";
import { sourceUrl, type RepoCollection, type SourceFile } from "./github";

const MAX_NODES = 30;
const MAX_EDGES = 50;
const dirname = (path: string) => (posix.dirname(path) === "." ? "" : posix.dirname(path));
const nodeId = (path: string) => (path ? `path:${path}` : "repo:root");
const isWithin = (path: string, root: string) => !root || path === root || path.startsWith(`${root}/`);
const MANIFEST = /(?:^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod)$/;
interface Manifest {
  file: SourceFile;
  path: string;
  name: string;
  language: string | null;
  dependencies: [string, string][];
  workspacePatterns: string[];
  pathDependencies: string[];
}
function parseManifest(file: SourceFile): Manifest {
  const result: Manifest = {
    file,
    path: dirname(file.path),
    name: "",
    language: null,
    dependencies: [],
    workspacePatterns: [],
    pathDependencies: [],
  };
  if (file.path.endsWith("package.json")) {
    result.language = "JavaScript/TypeScript";
    try {
      const json = JSON.parse(file.content);
      result.name = typeof json.name === "string" ? json.name.slice(0, 160) : "";
      const groups = [json.dependencies, json.devDependencies, json.peerDependencies, json.optionalDependencies];
      result.dependencies = groups
        .flatMap((group) =>
          group && typeof group === "object" && !Array.isArray(group)
            ? Object.entries(group).filter((entry): entry is [string, string] => typeof entry[1] === "string")
            : [],
        )
        .slice(0, 600);
      const workspace = Array.isArray(json.workspaces) ? json.workspaces : json.workspaces?.packages;
      result.workspacePatterns =
        Array.isArray(workspace) &&
        workspace.length <= 100 &&
        workspace.every((value: unknown) => typeof value === "string" && !value.startsWith("!"))
          ? workspace
          : [];
    } catch {
      /* Invalid manifests cannot prove dependencies. */
    }
  } else if (file.path.endsWith("Cargo.toml")) {
    result.language = "Rust";
    let section = "";
    for (const line of file.content.split(/\r?\n/)) {
      const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
      if (header) {
        section = header[1]!;
        continue;
      }
      if (section === "package") result.name ||= line.match(/^\s*name\s*=\s*"([^"]+)"/)?.[1] ?? "";
      if (/^(?:dependencies|dev-dependencies|build-dependencies)$/.test(section)) {
        const match = line.match(/^\s*[\w-]+\s*=\s*\{[^}]*\bpath\s*=\s*"([^"]+)"/);
        if (match) result.pathDependencies.push(match[1]!);
      }
    }
  } else if (file.path.endsWith("pyproject.toml")) {
    result.language = "Python";
    // TOML names are display metadata only; TOML dependency parsing is intentionally not guessed.
    result.name = file.content.match(/\[project\]\s*\n(?:[^\[]*?)\bname\s*=\s*"([^"]+)"/)?.[1] ?? "";
  } else if (file.path.endsWith("go.mod")) {
    result.language = "Go";
    result.name = file.content.match(/^module\s+(\S+)/m)?.[1] ?? "";
  }
  return result;
}
function kindFor(path: string): NodeKind {
  if (/(?:^|\/)(?:docs?|website|examples?)(?:\/|$)/i.test(path)) return "docs";
  if (/(?:^|\/)(?:tests?|__tests__|e2e)(?:\/|$)/i.test(path)) return "test";
  if (/(?:^|\/)(?:infra|deploy|\.github|docker|k8s)(?:\/|$)/i.test(path)) return "infra";
  if (/(?:^|\/)(?:data|datasets?|models?)(?:\/|$)/i.test(path)) return "data";
  if (/(?:^|\/)(?:scripts?|tools?|bin)(?:\/|$)/i.test(path)) return "tool";
  if (/(?:^|\/)(?:apps?|web|frontend)(?:\/|$)/i.test(path)) return "app";
  if (/(?:^|\/)(?:services?|server|backend|api)(?:\/|$)/i.test(path)) return "service";
  return "package";
}
function workspaceMatches(pattern: string, relative: string): boolean {
  // Conservative package.json workspace subset: literal segments and one-segment '*'.
  if (pattern.startsWith("!") || pattern.includes("**") || /[{}[\]\\]/.test(pattern)) return false;
  const parts = pattern.replace(/^\.\//, "").replace(/\/$/, "").split("/");
  const values = relative.split("/");
  return parts.length === values.length && parts.every((part, i) => part === "*" || part === values[i]);
}

/** Deterministic graph grounded in bounded tree and manifest evidence. Never executes source. */
export function analyzeCollection(collection: RepoCollection): WorldSnapshot {
  const notes = [...collection.notes];
  const manifests = collection.files.filter((file) => MANIFEST.test(file.path)).map(parseManifest);
  for (const file of collection.files.filter((file) => file.path.endsWith("package.json"))) {
    try {
      const json = JSON.parse(file.content);
      if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error();
    } catch {
      notes.push(`Invalid manifest ${file.path}; no dependency edges inferred from its text.`);
    }
  }
  const paths = new Set<string>();
  paths.add("");
  for (const manifest of manifests) paths.add(manifest.path);
  // Prefer districts under common monorepo containers, then standalone top-level districts.
  const containers = new Set(["apps", "packages", "services", "crates", "modules"]);
  for (const entry of collection.tree) {
    const parts = entry.path.split("/");
    if (parts.length >= 2 && containers.has(parts[0]!) && !/^(?:node_modules|vendor|dist|build)$/.test(parts[1]!))
      paths.add(parts.slice(0, 2).join("/"));
  }
  for (const entry of collection.tree) {
    const first = entry.path.split("/")[0]!;
    if (entry.type !== "tree" && !entry.path.includes("/")) continue;
    if (/^(?:node_modules|vendor|dist|build|\.git)$/.test(first)) continue;
    if (containers.has(first) && [...paths].some((path) => path.startsWith(`${first}/`))) continue;
    paths.add(first);
  }
  const candidates = [...paths];
  const overflow = Math.max(0, candidates.length - MAX_NODES);
  if (overflow) {
    const manifestPaths = new Set(manifests.map((manifest) => manifest.path));
    const counts = new Map(
      candidates.map((path) => [path, collection.tree.filter((entry) => entry.type === "blob" && isWithin(entry.path, path)).length]),
    );
    const priority = (path: string) => (!path ? 0 : manifestPaths.has(path) ? 1 : path.startsWith(".") && path !== ".github" ? 3 : 2);
    candidates.sort((a, b) => priority(a) - priority(b) || counts.get(b)! - counts.get(a)! || a.localeCompare(b));
    notes.push(
      "At the district cap, manifest-backed districts and larger sampled directories are prioritized; hidden configuration directories rank later. Sample size does not establish runtime importance.",
    );
  }
  const shownPaths = candidates.slice(0, overflow ? MAX_NODES - 1 : MAX_NODES);
  const pathToNode = new Map<string, WorldNode>();
  for (const path of shownPaths) {
    const manifest = manifests.find((candidate) => candidate.path === path);
    const files = collection.tree.filter((entry) => entry.type === "blob" && isWithin(entry.path, path));
    const directoryLink = path
      ? `https://github.com/${collection.repo.fullName}/tree/${collection.headSha}/${path.split("/").map(encodeURIComponent).join("/")}`
      : sourceUrl(collection.repo, collection.headSha);
    const node: WorldNode = {
      id: nodeId(path),
      label: (manifest?.name || path.split("/").at(-1) || collection.repo.name).slice(0, 160),
      kind: !path ? "app" : kindFor(path),
      path: path || ".",
      description: manifest
        ? `Manifest observed at ${manifest.file.path}. District role is inferred from repository structure; runtime behavior is unknown.`
        : `Directory observed in the captured tree. District role is inferred from its path; runtime behavior is unknown.`,
      evidence: [directoryLink, ...(manifest ? [manifest.file.url] : [])],
      confidence: manifest ? "observed" : "inferred",
      status: "unknown",
      language: manifest?.language || (!path ? collection.repo.language : null),
      size: Math.max(1, Math.min(100, Math.ceil(Math.sqrt(files.length || 1) * 4))),
    };
    if (!path && collection.treeState === "unavailable") {
      node.confidence = "inferred";
      node.description = "Repository identity and head observed; tree and district architecture remain unknown.";
    }
    pathToNode.set(path, node);
  }
  const nodes = [...pathToNode.values()];
  if (overflow) {
    const omitted = candidates.length - shownPaths.length;
    nodes.push({
      id: "coverage:collapsed",
      label: `${omitted} more districts`,
      kind: "package",
      path: ".",
      description: `${omitted} discovered district candidates are collapsed at the ${MAX_NODES}-node limit. Their internal dependencies are not rendered.`,
      evidence: [sourceUrl(collection.repo, collection.headSha)],
      confidence: "inferred",
      status: "unknown",
      language: null,
      size: 12,
    });
    notes.push(`${omitted} of ${candidates.length} district candidates collapsed to respect the ${MAX_NODES}-node cap.`);
  }
  const edges: WorldEdge[] = [];
  const edgeKeys = new Set<string>();
  let droppedEdges = 0;
  const addEdge = (from: string, to: string, label: string) => {
    const source = pathToNode.get(from),
      target = pathToNode.get(to);
    if (!source || !target || source.id === target.id) return;
    const key = `${source.id}>${target.id}:${label}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    if (edges.length === MAX_EDGES) {
      droppedEdges++;
      return;
    }
    edges.push({
      id: `edge:${edges.length}:${source.id}:${target.id}`,
      source: source.id,
      target: target.id,
      label,
      kind: "dependency",
      confidence: "observed",
    });
  };
  const named = new Map<string, Manifest[]>();
  for (const manifest of manifests.filter((item) => !!item.name)) named.set(manifest.name, [...(named.get(manifest.name) || []), manifest]);
  for (const manifest of manifests) {
    for (const [dependency, specifier] of manifest.dependencies) {
      const targets = named.get(dependency)?.filter((item) => item.file.path.endsWith("package.json"));
      // Equal names alone are ambiguous when several manifests declare the same package.
      if (targets?.length === 1) {
        const target = targets[0]!;
        const relativePath = /^(?:file:|link:)/.test(specifier)
          ? posix.normalize(posix.join(manifest.path, specifier.replace(/^(?:file:|link:)/, "")))
          : null;
        const sameWorkspace = manifests.some((root) =>
          [manifest, target].every(
            (child) =>
              child.path === root.path ||
              (isWithin(child.path, root.path) &&
                root.workspacePatterns.some((pattern) =>
                  workspaceMatches(pattern, root.path ? child.path.slice(root.path.length + 1) : child.path),
                )),
          ),
        );
        if ((specifier.startsWith("workspace:") && sameWorkspace) || relativePath === target.path)
          addEdge(manifest.path, target.path, `declared local dependency: ${dependency}`);
      }
    }
    for (const relative of manifest.pathDependencies) {
      const target = posix.normalize(posix.join(manifest.path, relative));
      if (!target.startsWith("../") && !posix.isAbsolute(target) && manifests.some((item) => item.path === target))
        addEdge(manifest.path, target, "declared Cargo path dependency");
    }
    for (const child of manifests) {
      if (child.path === manifest.path || !isWithin(child.path, manifest.path)) continue;
      const relative = manifest.path ? child.path.slice(manifest.path.length + 1) : child.path;
      if (manifest.workspacePatterns.some((pattern) => workspaceMatches(pattern, relative)))
        addEdge(manifest.path, child.path, "declared workspace member");
    }
  }
  // Directory containment is a different observed relationship from a dependency.
  // It makes non-workspace repositories navigable without inventing runtime calls.
  for (const [path, node] of pathToNode) {
    if (!path || collection.treeState === "unavailable") continue;
    const ancestors = [...pathToNode.entries()]
      .filter(([candidate]) => candidate !== path && isWithin(path, candidate))
      .sort((a, b) => b[0].length - a[0].length);
    const parent = ancestors[0]?.[1];
    if (!parent || edges.some((e) => e.source === parent.id && e.target === node.id)) continue;
    if (edges.length >= MAX_EDGES) {
      droppedEdges++;
      continue;
    }
    edges.push({
      id: `contains:${parent.id}:${node.id}`,
      source: parent.id,
      target: node.id,
      label: "observed directory containment",
      kind: "containment",
      confidence: "observed",
    });
  }
  if (droppedEdges) notes.push(`${droppedEdges} proven edges omitted at the ${MAX_EDGES}-edge cap.`);
  notes.push(
    "Dependencies are observed manifest declarations; containment links show observed directory membership. Neither proves runtime calls. Unsampled imports, external dependencies and pipeline edges remain unknown; filenames do not prove a dependency.",
  );
  // A workflow district can summarize exact-head CI, but it never implies application health.
  const ciNode = pathToNode.get(".github");
  const headRuns = collection.workflows
    .filter((run) => run.headSha === collection.headSha)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestByName = headRuns.filter((run, index) => headRuns.findIndex((candidate) => candidate.name === run.name) === index);
  if (ciNode && latestByName.length) {
    ciNode.status = latestByName.some((run) =>
      ["failure", "timed_out", "action_required", "startup_failure"].includes(run.conclusion || ""),
    )
      ? "attention"
      : latestByName.some((run) => run.status !== "completed")
        ? "active"
        : latestByName.every((run) => run.conclusion === "success")
          ? "healthy"
          : "unknown";
    ciNode.description =
      "Status summarizes only the latest observed runs by workflow name for the collected head in a bounded window. Required checks, deployment and application runtime health remain unknown.";
    ciNode.evidence.push(...latestByName.slice(0, 5).map((run) => run.url));
  }
  const blueprint: AiBlueprint = {
    summary: `${collection.repo.fullName} becomes a world of ${nodes.length} districts and ${edges.length} source-backed relationships.`,
    narrative: `${collection.repo.description || "A public repository"} Explore the captured structure and follow evidence links. This deterministic field guide uses bounded GitHub facts; district roles are inferred and runtime traffic is not measured.`,
    districts: nodes.map((node) => ({ nodeId: node.id, title: node.label, purpose: node.description })),
    missions: [
      ...latestByName
        .filter((run) => ["failure", "timed_out", "action_required"].includes(run.conclusion || ""))
        .slice(0, 2)
        .map((run) => ({
          id: `run:${run.id}`,
          title: `Inspect ${run.name}`,
          description: `Observed ${run.conclusion} run for the captured head. Read its logs before deciding a fix.`,
          priority: "high" as const,
          evidence: [run.url],
          url: run.url,
          nodeIds: ciNode ? [ciNode.id] : [],
        })),
      ...collection.issues.slice(0, 3).map((issue) => ({
        id: `issue:${issue.number}`,
        title: issue.title,
        description: "Review this observed open issue; its relevance, ownership and implementation scope need human confirmation.",
        priority: "medium" as const,
        evidence: [issue.url],
        url: issue.url,
        nodeIds: [],
      })),
      ...(collection.treeState !== "full"
        ? [
            {
              id: "coverage:tree",
              title: "Inspect architecture coverage",
              description: "The tree is unavailable or truncated; follow the repository source before treating this map as complete.",
              priority: "medium" as const,
              evidence: [collection.repo.url],
              url: collection.repo.url,
              nodeIds: [],
            },
          ]
        : []),
    ].slice(0, 6),
    generator: {
      provider: "rules",
      model: "manifest-rules-v1",
      generatedAt: collection.collectedAt,
      costUsd: 0,
      notes: [
        "No paid model request was made. Roles are inferred; relationships require parsed manifest evidence.",
        "Input is untrusted repository data. This guide does not authorize code execution or business actions.",
      ],
    },
  };
  return {
    schemaVersion: 1,
    repo: collection.repo,
    headSha: collection.headSha,
    collectedAt: collection.collectedAt,
    refreshAfter: Date.parse(collection.collectedAt) + 90_000,
    source: "github",
    nodes,
    edges,
    issues: collection.issues,
    pulls: collection.pulls,
    workflows: collection.workflows,
    commits: collection.commits,
    languages: collection.languages,
    coverage: {
      tree: collection.treeState,
      issueWindow: collection.issues.length,
      pullWindow: collection.pulls.length,
      workflowWindow: collection.workflows.length,
      notes,
    },
    health: { github: collection.partial ? "partial" : "ok", rateLimitRemaining: collection.rateLimitRemaining },
    blueprint,
  };
}
