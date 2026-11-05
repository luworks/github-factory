import { expect, test } from "bun:test";
import { worldReadMode, readCachedWorld } from "../src/server/cached-world";
import { createWorldService } from "../src/server/service";
import { capturedEvidence, cachedWorldReady, worldIdentity } from "../src/evidence/captured";
import { snapshotKey } from "../src/evidence/contracts";
import { getCachedWorld, getWorld } from "../src/client/api";
import { syntheticWorld } from "./fixtures/browser-world";
import { WorldStore } from "../src/server/store";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const captured = () => { const w=syntheticWorld();w.source="github";w.nodes[0].evidence=[`${w.repo.url}/tree/${w.headSha}/${w.nodes[0].path}`];return w; };
test("SYNTHETIC cache intent rejects duplicates/unknown/conflicts before reading anything", () => {
  for(const query of ["mode=unknown","mode=cached&mode=cached","mode=cached&refresh=true","mode=cached&enrich=false","mode=cached&x=1"])
    expect(()=>worldReadMode("https://example.test/api/world/a/b?"+query)).toThrow("exactly one");
  expect(worldReadMode("https://example.test/api/world/a/b?mode=cached")).toBe("cached");
  expect(worldReadMode("https://example.test/api/world/a/b")).toBe("legacy");
});
test("SYNTHETIC cache miss cannot join concurrent collection and never writes aliases",async()=>{
  let collects=0,writes=0;let reject!:(e:Error)=>void;
  const pending=new Promise<never>((_,r)=>reject=r);
  const svc=createWorldService({store:{get:()=>null,put:()=>{writes++},alias:()=>{writes++}},collector:{collect:()=>{collects++;return pending}}});
  const legacy=svc.loadWorld("synthetic/repo").catch(()=>{});await Promise.resolve();
  await expect(readCachedWorld("synthetic/repo",svc.getCachedWorld)).rejects.toMatchObject({status:404,code:"CACHE_MISS"});
  expect(collects).toBe(1);expect(writes).toBe(0);reject(new Error("SYNTHETIC collector stopped"));await legacy;
});
test("SYNTHETIC cache hit keeps stale capture and storage failure cannot become miss/collection",async()=>{
  const w=captured();const svc=createWorldService({store:{get:()=>({world:w,expiresAt:1,fresh:false}),put:()=>{throw Error("write forbidden")}},collector:{collect:async()=>{throw Error("collector forbidden")}}});
  const hit=await readCachedWorld(w.repo.fullName,svc.getCachedWorld);expect(hit.headSha).toBe(w.headSha);expect(hit.collectedAt).toBe(w.collectedAt);expect(hit.refreshAfter).toBe(w.refreshAfter);
  await expect(readCachedWorld(w.repo.fullName,async()=>{throw Error("SYNTHETIC storage failed")})).rejects.toMatchObject({status:503,code:"WORLD_STORAGE_UNAVAILABLE"});
  for(const mutate of [(x:any)=>delete x.coverage,(x:any)=>x.refreshAfter=NaN,(x:any)=>x.source="demo"]){const invalid=structuredClone(w);mutate(invalid);expect(cachedWorldReady(invalid)).toBe(false);await expect(readCachedWorld(w.repo.fullName,async()=>invalid)).rejects.toMatchObject({status:503,code:"WORLD_STORAGE_UNAVAILABLE"});}
});
test("SYNTHETIC readonly invalid cache never deletes or repairs the stored row",()=>{
 const dir=mkdtempSync(join(tmpdir(),"factory-cache-readonly-")),path=join(dir,"worlds.sqlite"),store=new WorldStore(path),db=new Database(path);
 try{db.query("INSERT INTO worlds VALUES(?,?,?,?)").run("synthetic/repo","corrupt",1,0);expect(()=>store.get("synthetic/repo",2,{readOnly:true})).toThrow();expect((db.query("SELECT COUNT(*) n FROM worlds").get()as any).n).toBe(1);}finally{db.close();store.close();rmSync(dir,{recursive:true,force:true})}
});
test("SYNTHETIC client cache-only pending URL is isolated from legacy collecting GET",async()=>{
 const original=globalThis.fetch;const calls:string[]=[];let release!:(r:Response)=>void;
 globalThis.fetch=(async(url:any)=>{calls.push(String(url));return String(url).includes("mode=cached")?Response.json({error:"Not collected",code:"CACHE_MISS"},{status:404}):new Promise<Response>(r=>release=r)})as typeof fetch;
 try{const legacy=getWorld("synthetic","isolation");const cache=getCachedWorld("synthetic","isolation");expect(cache).not.toBe(legacy);expect(getWorld("synthetic","isolation")).toBe(legacy);await expect(cache).rejects.toMatchObject({code:"CACHE_MISS"});expect(calls.length).toBe(2);release(Response.json(captured()));await legacy;}finally{globalThis.fetch=original}
});
test("SYNTHETIC evidence is deterministic, narrow and never reconstructs missing source or merge proof",async()=>{
 const w=captured();w.nodes[0].label="真实源码 @scope/monorepo";const first=(await capturedEvidence(w))!;const reversed=structuredClone(w);reversed.nodes.reverse();reversed.edges.reverse();
 expect((await capturedEvidence(reversed))!.evidence).toEqual(first.evidence);expect(first.identity).toEqual(worldIdentity(w)!);expect(snapshotKey(first.identity)).toBe(JSON.stringify([w.repo.fullName,w.headSha,w.collectedAt,"github"]));
 expect(first.history).toEqual({availability:"unavailable",timeRange:null});expect(first.evidence.filter(e=>e.kind==="node-link")).toHaveLength(1);expect(first.evidence.find(e=>e.kind==="edge-record")!.sourceUrls).toEqual([]);
 w.nodes[0].evidence=[];expect((await capturedEvidence(w))!.evidence.some(e=>e.kind==="node-link")).toBe(false);
 const commit=w.commits[0];commit.id="f".repeat(40);commit.url=`${w.repo.url}/commit/${commit.id}`;commit.message="Merge #123 合并 — source text only";
 const marker=(await capturedEvidence(w))!.evidence.find(e=>e.kind==="commit-marker")!;expect(marker.subject.sha).toBe(commit.id);expect(marker.eventTime?.basis).toBe("author");expect(marker.limitations.join(" ")).toContain("Merge");
});
