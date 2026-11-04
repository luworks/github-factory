import { loadWorld, listFeatured } from "../src/server/service";
import { enrichWorld, getBudgetStatus } from "../src/server/ai";
const ai = process.argv.includes("--enrich");
const refresh = process.argv.includes("--refresh");
const entries = await listFeatured();
for (const p of entries) {
  try {
    const started = performance.now();
    let w = await loadWorld(p.fullName, { refresh });
    if (ai) w = await enrichWorld(w);
    console.log(
      JSON.stringify({
        repo: p.fullName,
        head: w.headSha,
        nodes: w.nodes.length,
        edges: w.edges.length,
        provider: w.blueprint.generator.provider,
        collectedAt: w.collectedAt,
        coverage: w.coverage.tree,
        durationMs: Math.round(performance.now() - started),
        ...(w.blueprint.generator.provider === "rules" ? { notes: w.blueprint.generator.notes } : {}),
      }),
    );
  } catch (e) {
    console.log(JSON.stringify({ repo: p.fullName, error: e instanceof Error ? e.message : "unknown" }));
  }
}
console.log(JSON.stringify({ budget: getBudgetStatus() }));
