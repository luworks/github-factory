import { expect, test } from "bun:test";
import { checkpointTransition, prepareHistoricalViewer } from "../src/history/viewer-model";
import { historicSha, oldHistoricPath, syntheticHistoricalWindow } from "./fixtures/historic-viewer";

test("SYNTHETIC historic viewer orders supplied frames by first parent despite reversed author clocks and supplied arrays", () => {
 const model = prepareHistoricalViewer(syntheticHistoricalWindow())!;
 expect(model.checkpoints.map(c => c.commit.sha)).toEqual([1,2].map(historicSha));
 expect(model.checkpoints[0].commit.authorAt! > model.checkpoints[1].commit.authorAt!).toBe(true);
 expect(model.checkpoints[0].scene.nodes.some(n=>n.path===oldHistoricPath)).toBe(true);
 expect(model.checkpoints[0].scene.nodes.some(n=>n.path==="src/new.ts")).toBe(false);
 expect(model.checkpoints[1].scene.nodes.some(n=>n.path===oldHistoricPath)).toBe(false);
});
test("SYNTHETIC only full adjacent forward endpoints yield exact change, backward/partial/missing-intermediate stay gaps", () => {
 const full=prepareHistoricalViewer(syntheticHistoricalWindow())!,change=checkpointTransition(full,0,1)!;
 expect(change.kind).toBe("apply-exact-delta");expect(change.comparison.added.map(e=>e.path)).toEqual(["src/new.ts"]);expect(change.comparison.removed.map(e=>e.path)).toEqual([oldHistoricPath]);expect(change.comparison.renameEvidence).toBe("unavailable");
 expect(checkpointTransition(full,1,0)?.kind).toBe("checkpoint-gap");
 for(const mode of ["partial","gap"]as const)expect(checkpointTransition(prepareHistoricalViewer(syntheticHistoricalWindow(mode))!,0,1)?.kind).toBe("checkpoint-gap");
 expect(checkpointTransition(full,0,99)).toBeNull();expect(checkpointTransition(full,0,0)).toBeNull();
});
test("SYNTHETIC two-frame stable slots do not add future buildings and keep bounded path positions", () => {
 const model=prepareHistoricalViewer(syntheticHistoricalWindow("many"))!;
 expect(model.slots).toHaveLength(60);expect(new Set(model.slots.map(s=>JSON.stringify([s.x,s.y]))).size).toBe(60);
 for(const c of model.checkpoints){expect(c.scene.nodes).toHaveLength(30);expect(c.scene.edges.length).toBeLessThanOrEqual(50);expect(c.scene.nodes.every(n=>model.slots.some(s=>s.id===n.id))).toBe(true);}
 const simple=prepareHistoricalViewer(syntheticHistoricalWindow())!,shared=simple.checkpoints.map(c=>c.scene.nodes.find(n=>n.path==="shared.ts")!.id);
 expect(shared[0]).toBe(shared[1]);expect(simple.slots.filter(s=>s.id===shared[0])).toHaveLength(1);
});
test("SYNTHETIC invalid/missing historic input fails unavailable without a demo/current-world fallback", () => {
 const valid=syntheticHistoricalWindow();for(const invalid of [null,{}, {nodes:[],repo:{}},{...valid,frames:[]},{...valid,frames:[{...valid.frames[0],treeSha:historicSha(999)}]}, {...valid,anchor:{...valid.anchor,generation:"!invalid"}}])expect(prepareHistoricalViewer(invalid)).toBeNull();
 expect(prepareHistoricalViewer(syntheticHistoricalWindow("full","SYNTHETIC_generation_2"))!.identity).not.toBe(prepareHistoricalViewer(valid)!.identity);
});

test("SYNTHETIC observed empty trees render empty historical scenes without fabricated buildings",()=>{
 const window=syntheticHistoricalWindow(),empty={...window,frames:window.frames.map(f=>({...f,entries:[],inputEntryCount:0,omittedInputEntries:0,deduplicatedInputEntries:0,limits:[]}))},model=prepareHistoricalViewer(empty)!;expect(model).not.toBeNull();expect(model.slots).toEqual([]);expect(model.checkpoints.every(c=>c.scene.nodes.length===0&&c.scene.edges.length===0)).toBe(true);
});
