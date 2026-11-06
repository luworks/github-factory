import { expect, test } from "bun:test";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { Database } from "bun:sqlite";
import { WorldStore } from "../src/server/store";
import { createWorldService } from "../src/server/service";
import { readCachedWorld } from "../src/server/cached-world";
import { readRepositoryPreviewAsync, projectRepositoryPreview } from "../src/server/gallery-preview";
import { syntheticWorld } from "./fixtures/browser-world";
import { cachedWorldReady,worldIdentity,recordedNodeSource,capturedEvidence } from "../src/evidence/captured";
import { isRenderableWorld } from "../src/server/world-readiness";
import { factsFromWorld } from "../src/atlas/model";
import { ProgressStore } from "../src/progression/progress-store";
import { deriveChallenge,startAttempt,conclusionAnswers } from "../src/progression/rules";
const capture=()=>{const w=syntheticWorld();w.source="github";w.nodes[0].evidence=[`${w.repo.url}/tree/${w.headSha}/${w.nodes[0].path}`];return w;};
const correct=(c:any)=>({...startAttempt(c,0),selectedEvidenceId:c.evidence[0].id,selectedSubjectId:c.target.subjectId,answerCodes:conclusionAnswers(c.variant,c.choices.conclusion[0].code)});
test("F1 SYNTHETIC actual cached route applies request admission to hit/miss without collection or AI",()=>{
 for(const limit of ["0","10"]){const dir=mkdtempSync(join(tmpdir(),"factory-review-admission-"));try{const result=Bun.spawnSync([process.execPath,"--no-env-file","--preload",resolve("test/fixtures/offline-runtime.ts"),resolve("test/fixtures/cached-route-admission.ts")],{cwd:dir,env:{PATH:process.env.PATH,MOONSHOT_OFFLINE_FIXTURE:"1",MOONSHOT_DATA_DIR:dir,MOONSHOT_IP_REQUESTS_PER_MINUTE:limit,MOONSHOT_GITHUB_REQUESTS_PER_HOUR:"0",MOONSHOT_BUDGET_USD:"0"}});expect(result.exitCode).toBe(0);const output=JSON.parse(result.stdout.toString());expect(output.results.map((r:any)=>r.status)).toEqual(limit==="0"?[429,429,429]:[200,404]);expect(output.results.map((r:any)=>r.code)).toEqual(limit==="0"?["IP_RATE_LIMIT","IP_RATE_LIMIT","IP_RATE_LIMIT"]:[null,"CACHE_MISS"]);expect(output.upstreamQuotaCreated).toBe(false);expect(output.buckets.every((r:any)=>r.bucket==="request")).toBe(true);}finally{rmSync(dir,{recursive:true,force:true});}}
});
test("F2 SYNTHETIC catalog, direct cached and preview reads retain corrupt row bytes and aliases",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"factory-review-catalog-")),path=join(dir,"worlds.sqlite"),store=new WorldStore(path),db=new Database(path);const raw="not-json \u0000 retained";
 db.query("INSERT INTO worlds VALUES(?,?,?,?)").run("openclaw/openclaw",raw,1,0);db.query("INSERT INTO world_aliases VALUES(?,?)").run("synthetic/alias","openclaw/openclaw");
 let collections=0;const svc=createWorldService({store,collector:{collect:async()=>{collections++;throw Error("No collection");}}});
 try{for(let i=0;i<2;i++){await expect(readCachedWorld("synthetic/alias",svc.getCachedWorld)).rejects.toMatchObject({status:503});await expect(svc.listFeatured()).rejects.toMatchObject({status:503});await expect(readRepositoryPreviewAsync("openclaw/openclaw",svc.getCachedWorld)).rejects.toMatchObject({status:503});}expect(db.query("SELECT snapshot FROM worlds").get()).toEqual({snapshot:raw});expect(db.query("SELECT * FROM world_aliases").all()).toEqual([{alias:"synthetic/alias",canonical:"openclaw/openclaw"}]);expect(collections).toBe(0);}finally{db.close();store.close();rmSync(dir,{recursive:true,force:true});}
 const options:any[]=[];const fallback=createWorldService({store:{get:(_key,_now,o)=>{options.push(o);throw Object.assign(Error("Retained"),{status:503});},put:()=>{}},collector:{collect:async()=>{throw Error("No collection");}}});await expect(fallback.listFeatured()).rejects.toMatchObject({status:503});expect(options.every(o=>o?.readOnly===true)).toBe(true);
});
test("F3 SYNTHETIC repeated rejected session completion/visit/discovery and record bytes leave state unchanged",async()=>{
 const s=new ProgressStore(undefined);for(let i=0;i<100;i++){const w=capture();w.repo={...w.repo,fullName:`synthetic-cap/repo${i}`,owner:"synthetic-cap",name:`repo${i}`,url:`https://github.com/synthetic-cap/repo${i}`};w.nodes[0].evidence=[`${w.repo.url}/tree/${w.headSha}/${w.nodes[0].path}`];const c=await deriveChallenge(w);await s.complete(c,correct(c),c.identity);}
 const before=await s.read();for(let i=100;i<104;i++){const w=capture();w.repo={...w.repo,fullName:`synthetic-cap/repo${i}`,owner:"synthetic-cap",name:`repo${i}`,url:`https://github.com/synthetic-cap/repo${i}`};w.nodes[0].evidence=[`${w.repo.url}/tree/${w.headSha}/${w.nodes[0].path}`];const c=await deriveChallenge(w);await expect(s.complete(c,correct(c),c.identity)).rejects.toThrow("capacity");for(const event of ["discovered","visited"]as const)await expect(s.note(c.identity!,event)).rejects.toThrow("capacity");expect(await s.read()).toEqual(before);}
 const empty=new ProgressStore(undefined),w=capture();w.collectedAt=" ".repeat(3000)+"2025-11-04";const c=await deriveChallenge(w),baseline=await empty.read();for(let i=0;i<3;i++){await expect(empty.complete(c,correct(c),c.identity)).rejects.toThrow("capacity");expect(await empty.read()).toEqual(baseline);}
});
test("F5 SYNTHETIC malformed required shape consistently fails cache, catalog, Atlas and preview without exceptions",async()=>{
 const mutations=[(w:any)=>w.nodes[1]=null,(w:any)=>w.nodes[0].label=4,(w:any)=>w.nodes[0].evidence={},(w:any)=>w.edges[0]=null,(w:any)=>w.blueprint={},(w:any)=>w.blueprint.missions=[null],(w:any)=>w.blueprint.generator.notes=null,(w:any)=>w.commits=[null],(w:any)=>w.issues=[null],(w:any)=>w.workflows=[null],(w:any)=>w.languages=null,(w:any)=>w.coverage.notes=null,(w:any)=>w.health=null,(w:any)=>w.repo.stars="many",(w:any)=>w.nodes=Array(101).fill(w.nodes[0]),(w:any)=>w.edges=Array(257).fill(w.edges[0])];
 for(const mutate of mutations){const w=capture();mutate(w);expect(cachedWorldReady(w)).toBe(false);expect(isRenderableWorld(w)).toBe(false);expect(factsFromWorld(w)).toBeNull();expect(await capturedEvidence(w)).toBeNull();await expect(readCachedWorld(w.repo.fullName,async()=>w)).rejects.toMatchObject({status:503,code:"WORLD_STORAGE_UNAVAILABLE"});expect(()=>projectRepositoryPreview(w.repo.fullName,w)).toThrow();}
 for(const bad of [null,{},[],{repo:{fullName:4}}, {schemaVersion:1,source:"github",repo:{fullName:"a/b",url:"https://github.com/a/b"},headSha:Symbol()}]){expect(()=>worldIdentity(bad as any)).not.toThrow();expect(worldIdentity(bad as any)).toBeNull();expect(()=>recordedNodeSource(bad as any,null as any)).not.toThrow();}
 const good=capture();good.repo.description="真实源内容";good.refreshAfter=1;good.coverage.tree="truncated";good.health.github="partial";expect(cachedWorldReady(good)).toBe(true);expect(factsFromWorld(good)?.description).toBe("真实源内容");
});

test("F2/F5 SYNTHETIC malformed graph retained byte-for-byte is never catalog-ready or admitted by preview/cache",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"factory-review-shape-")),path=join(dir,"worlds.sqlite"),store=new WorldStore(path),db=new Database(path),w=capture();w.repo={...w.repo,owner:"openclaw",name:"openclaw",fullName:"openclaw/openclaw",url:"https://github.com/openclaw/openclaw"};(w.nodes as any[])[1]=null;const raw=JSON.stringify(w);db.query("INSERT INTO worlds VALUES(?,?,?,?)").run(w.repo.fullName,raw,Date.now()+60_000,0);db.query("INSERT INTO world_aliases VALUES(?,?)").run("synthetic/alias",w.repo.fullName);const svc=createWorldService({store,collector:{collect:async()=>{throw Error("Collector forbidden");}}});
 try{expect((await svc.listFeatured()).find(p=>p.fullName===w.repo.fullName)?.ready).toBe(false);await expect(readCachedWorld(w.repo.fullName,svc.getCachedWorld)).rejects.toMatchObject({status:503});await expect(readRepositoryPreviewAsync(w.repo.fullName,svc.getCachedWorld)).rejects.toMatchObject({status:503});expect(db.query("SELECT snapshot FROM worlds").get()).toEqual({snapshot:raw});expect(db.query("SELECT COUNT(*) n FROM world_aliases").get()).toEqual({n:1});}finally{db.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
