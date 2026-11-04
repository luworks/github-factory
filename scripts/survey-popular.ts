import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { loadWorld } from "../src/server/service";
import { enrichWorld, createAiService, getBudgetStatus } from "../src/server/ai";
import { getConfig } from "../src/server/config";
import type { WorldSnapshot } from "../src/contracts";

// A deliberately varied popular-project sample, not a claim to be GitHub's top-20 ranking.
export const REPOSITORIES = [
  "openclaw/openclaw",
  "pingdotgg/t3code",
  "react/react",
  "pytorch/pytorch",
  "facebookresearch/segment-anything",
  "meta-llama/llama-models",
  "microsoft/vscode",
  "torvalds/linux",
  "kubernetes/kubernetes",
  "huggingface/transformers",
  "rust-lang/rust",
  "golang/go",
  "python/cpython",
  "denoland/deno",
  "oven-sh/bun",
  "vercel/next.js",
  "sveltejs/svelte",
  "vuejs/core",
  "supabase/supabase",
  "TanStack/router",
];
const arg = (name: string) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const out = resolve(arg("--out-dir") || "artifacts/popular-survey");
const deadline = arg("--deadline") ? Date.parse(arg("--deadline")!) : Infinity;
const stop = () => {
  if (Date.now() >= deadline) throw new Error("Authorized work deadline reached");
};
await mkdir(join(out, "worlds"), { recursive: true });
const report: any = {
  startedAt: new Date().toISOString(),
  selection: "20 varied popular public projects; not a global rank",
  before: getBudgetStatus(),
  worlds: [],
  benchmarks: [],
};
const save = () => Bun.write(join(out, "report.json"), JSON.stringify({ ...report, budget: getBudgetStatus() }, null, 2));
try {
  for (const requested of REPOSITORIES) {
    stop();
    const start = performance.now();
    try {
      const world = await enrichWorld(await loadWorld(requested));
      const file = join(out, "worlds", requested.replaceAll("/", "--").toLowerCase() + ".json");
      await Bun.write(file, JSON.stringify(world, null, 2));
      const row = {
        requested,
        repo: world.repo.fullName,
        head: world.headSha,
        nodes: world.nodes.length,
        edges: world.edges.length,
        tree: world.coverage.tree,
        provider: world.blueprint.generator.provider,
        model: world.blueprint.generator.model,
        missions: world.blueprint.missions.length,
        collectedAt: world.collectedAt,
        durationMs: Math.round(performance.now() - start),
        generatorNotes: world.blueprint.generator.notes,
        file,
      };
      report.worlds.push(row);
      console.log(JSON.stringify({ kind: "world", ...row }));
    } catch (error) {
      const row = {
        requested,
        error: error instanceof Error ? error.message : "unknown",
        durationMs: Math.round(performance.now() - start),
      };
      report.worlds.push(row);
      console.log(JSON.stringify({ kind: "world", ...row }));
    }
    await save();
  }
  if (process.argv.includes("--compare")) {
    const config = getConfig();
    for (const repo of ["react/react", "facebookresearch/segment-anything", "pingdotgg/t3code"]) {
      const world: WorldSnapshot = await Bun.file(join(out, "worlds", repo.replaceAll("/", "--") + ".json")).json();
      const fingerprint = createHash("sha256").update(JSON.stringify(world)).digest("hex");
      for (const model of ["muse-spark-1.3", "muse-spark-1.2", "muse-wonder-1.0"]) {
        stop();
        const before = getBudgetStatus();
        const start = performance.now();
        const result = await createAiService({
          config: { ...config, provider: "muse", model, baseUrl: "https://api.meta.ai/v1" },
        }).enrichWorld(world, { force: true });
        const after = getBudgetStatus();
        const row = {
          repo,
          head: world.headSha,
          inputSha256: fingerprint,
          model,
          durationMs: Math.round(performance.now() - start),
          validGuide: result.blueprint.generator.provider === "muse",
          districts: result.blueprint.districts.length,
          knownNodes: world.nodes.length,
          missions: result.blueprint.missions.length,
          spentDeltaUsd: after.spentUsd - before.spentUsd,
          callDelta: after.calls - before.calls,
          notes: result.blueprint.generator.notes,
        };
        report.benchmarks.push(row);
        await Bun.write(join(out, `benchmark-${repo.replaceAll("/", "--")}-${model}.json`), JSON.stringify(result.blueprint, null, 2));
        console.log(JSON.stringify({ kind: "benchmark", ...row }));
        await save();
      }
    }
  }
  report.completedAt = new Date().toISOString();
} catch (error) {
  report.stopped = error instanceof Error ? error.message : "unknown";
  process.exitCode = 1;
} finally {
  await save();
  console.log(
    JSON.stringify({
      kind: "summary",
      completedAt: report.completedAt,
      stopped: report.stopped,
      worlds: report.worlds.length,
      successfulWorlds: report.worlds.filter((w: any) => !w.error).length,
      validGuides: report.worlds.filter((w: any) => w.provider === "muse").length,
      benchmarks: report.benchmarks.length,
      budget: getBudgetStatus(),
    }),
  );
}
