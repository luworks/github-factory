import { basePath, test, expect } from "./fixtures";
import { syntheticWorld } from "../test/fixtures/browser-world";
const keyA="synthetic-progress/alpha",keyB="synthetic-progress/beta";
function capture(key=keyA,head="a".repeat(40)) {let w=syntheticWorld();const old=w.repo.url,oldHead=w.headSha;w=JSON.parse(JSON.stringify(w).replaceAll(old,`https://github.com/${key}`).replaceAll(oldHead,head));const [owner,name]=key.split("/");w.source="github";w.repo={...w.repo,owner,name,fullName:key,url:`https://github.com/${key}`,description:"SYNTHETIC captured fixture"};w.nodes[0].evidence=[`${w.repo.url}/tree/${head}/${w.nodes[0].path}`];return w;}
async function fixtures(api:any,worlds=[capture(),capture(keyB,"b".repeat(40))]) {api.respond("GET","/api/gallery",()=>({body:{projects:worlds.map(w=>({fullName:w.repo.fullName,name:w.repo.name,description:"SYNTHETIC",category:"SYNTHETIC",suggestedStyle:"moonshot",ready:true}))}}));for(const w of worlds)api.respond("GET","/api/world/"+w.repo.fullName,(r:any)=>{expect(new URL(r.request().url()).search).toBe("?mode=cached");return {body:w};});}
const challenge=(page:any)=>page.getByRole("region",{name:"Source challenge",exact:true});
async function answer(page:any,wrong=false){const section=challenge(page);await section.getByRole("button",{name:/^(Start|Practice) source challenge$/}).click();await section.getByRole("group",{name:"Choose the matching captured source"}).getByRole("radio").first().check();await section.getByRole("radio",{name:wrong?"This proves the service is healthy in production.":"The map records this directory source; its role is inferred and runtime behavior is unknown.",exact:true}).check();await section.getByRole("button",{name:"Submit source answers",exact:true}).click();}
async function receipts(page:any){return page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("moon-factory-exploration",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise<any[]>((resolve,reject)=>{const t=db.transaction("completions"),r=t.objectStore("completions").getAll();r.onsuccess=()=>{db.close();resolve(r.result);};r.onerror=()=>reject(r.error);});});}
async function harness(page:any){const result=await Bun.build({entrypoints:["./e2e/progression-harness.ts"],target:"browser",format:"iife"});if(!result.success)throw Error("Offline harness build failed");await page.addScriptTag({content:await result.outputs[0].text()});}

test("SYNTHETIC two-repo source challenge loop: wrong answer, Saved receipt, Atlas lamp/back/focus, reload and repeat retain one slot",async({page,api})=>{
 await fixtures(api);await page.goto(basePath+"/atlas");
 for(const key of [keyA,keyB]){
  const row=page.locator(".atlas-list-rows").getByRole("button",{name:new RegExp(key)});await row.click();await expect(page).toHaveURL(new RegExp(`/world/${key}\\?`));
  await expect(page.locator(".explorer-visit-status")).toContainText("No Exploration star awarded for entry");
  await answer(page,true);await expect(challenge(page).getByRole("status")).toContainText("Try again");expect((await receipts(page)).filter((r:any)=>r.completedIdentity.repoKey===key)).toHaveLength(0);
  for (const name of ["Moon Factory","Factorio","Red Alert","Red Alert 2","Civilization"]) { await page.getByRole("group",{name:"World perspective"}).getByRole("button",{name:new RegExp(name+"$")}).click();await expect(challenge(page).getByRole("radio",{name:"This proves the service is healthy in production.",exact:true})).toBeChecked(); }
  await challenge(page).getByRole("radio",{name:"The map records this directory source; its role is inferred and runtime behavior is unknown.",exact:true}).check();await challenge(page).getByRole("button",{name:"Submit source answers"}).click();await expect(challenge(page).getByRole("status")).toHaveText("Exploration star earned. Saved on this device.");
  const first=(await receipts(page)).find((r:any)=>r.completedIdentity.repoKey===key);await page.reload();await expect(challenge(page).locator(".exploration-receipt")).toContainText("Completed on this device");await answer(page);await expect(challenge(page).getByRole("status")).toContainText("No additional Exploration star");expect((await receipts(page)).find((r:any)=>r.completedIdentity.repoKey===key)).toEqual(first);
  await page.getByRole("link",{name:"Back to Atlas",exact:true}).click();await expect(page.locator(".atlas-lantern")).toContainText("Lantern lit · 1 Exploration star");await expect(page.locator(".atlas-list-rows").getByRole("button",{name:new RegExp(key)})).toBeFocused();
 }
 expect(await receipts(page)).toHaveLength(2);expect(api.requests.some((r:any)=>r.method!=="GET"||r.path.includes("budget")||r.path.includes("blueprint"))).toBe(false);
});

test("SYNTHETIC real IndexedDB two-connection atomic completion, reset generation and changed head/rules",async({page,api})=>{
 await fixtures(api);await page.goto(basePath+"/atlas");await harness(page);
 const result=await page.evaluate(async(w:any)=>{
  const {ProgressStore,deriveChallenge,startAttempt,conclusionAnswers}=(window as any).__progressHarness;
  const a=new ProgressStore(indexedDB),b=new ProgressStore(indexedDB),c=await deriveChallenge(w);
  const correct=(ch:any,g=0)=>({...startAttempt(ch,g),selectedEvidenceId:ch.evidence[0].id,selectedSubjectId:ch.target.subjectId,answerCodes:conclusionAnswers(ch.variant,ch.choices.conclusion[0].code)});
  const frozen=JSON.stringify(w),r=await Promise.all([a.complete(c,correct(c),c.identity),b.complete(c,correct(c),c.identity)]);const before=await a.read();let lateRejected=false;try{await a.complete(c,correct(c),c.identity,()=>false);}catch(e){lateRejected=(e as Error).message.includes("Snapshot changed");}
  const other=structuredClone(w);other.headSha="d".repeat(40);other.nodes[0].evidence=[`${other.repo.url}/tree/${other.headSha}/${other.nodes[0].path}`];const v2=await deriveChallenge(other,Date.now(),2),again=await b.complete(v2,correct(v2),v2.identity);
  await b.reset();let resetRejected=false;try{await a.complete(c,correct(c),c.identity);}catch(e){resetRejected=(e as Error).message.includes("reset");}
  const after=await a.read();await a.complete(c,correct(c,after.generation),c.identity);const saved=await a.read();a.close();b.close();
  return {existing:r.map((x:any)=>x.existing).sort(),count:before.completions.length,first:r[0].receipt,again:again.receipt,resetRejected,empty:after.completions.length,generation:after.generation,resaved:saved.completions.length,lateRejected,unchanged:frozen===JSON.stringify(w)};
 },capture());
 expect(result.existing).toEqual([false,true]);expect(result.count).toBe(1);expect(result.first).toEqual(result.again);expect(result.resetRejected).toBe(true);expect(result.empty).toBe(0);expect(result.generation).toBe(1);expect(result.resaved).toBe(1);expect(result.unchanged).toBe(true);expect(result.lateRejected).toBe(true);
});

test("SYNTHETIC two tabs reconcile completion and reset without resurrecting a pending attempt",async({page,context,api})=>{
 await fixtures(api);await page.goto(`${basePath}/world/${keyA}?mode=cached`);const second=await context.newPage();await second.goto(`${basePath}/world/${keyA}?mode=cached`);
 await challenge(page).getByRole("button",{name:"Start source challenge"}).click();await challenge(page).getByRole("group",{name:"Choose the matching captured source"}).getByRole("radio").first().check();await challenge(page).getByRole("radio",{name:/^The map records this directory source/}).check();
 await answer(second);await expect(challenge(second).getByRole("status")).toContainText("Saved on this device");await expect(challenge(page).locator(".exploration-receipt")).toContainText("1 Exploration star");
 await second.getByRole("link",{name:"Back to Atlas",exact:true}).click();await second.getByRole("button",{name:"Clear exploration progress",exact:true}).click();await second.getByRole("button",{name:"Confirm clear exploration progress",exact:true}).click();
 await expect(challenge(page).getByRole("status")).toHaveText("Progress was reset. Start again.");await expect(challenge(page).getByRole("button",{name:"Submit source answers"})).toHaveCount(0);expect(await receipts(page)).toHaveLength(0);await second.close();
});

test("SYNTHETIC source unavailability/commit fallback and blocked storage remain explicit session-only",async({page,api})=>{
 const w=capture();for(const n of w.nodes)n.evidence=[];const commit=w.commits[0];commit.id="e".repeat(40);commit.url=`${w.repo.url}/commit/${commit.id}`;commit.message="Merge #123 原始信息";await fixtures(api,[w]);
 await page.addInitScript(()=>Object.defineProperty(window,"indexedDB",{get:()=>undefined}));await page.goto(`${basePath}/world/${keyA}?mode=cached`);
 const panel=challenge(page);await panel.getByRole("button",{name:"Start source challenge"}).click();await expect(panel).toContainText("Author timestamp");await expect(panel).toContainText("Merge #123 原始信息");await panel.getByRole("group",{name:"Choose the matching captured source"}).getByRole("radio").first().check();await panel.getByRole("radio",{name:"This is an author timestamp; a merged pull request is not established.",exact:true}).check();await panel.getByRole("button",{name:"Submit source answers"}).click();await expect(panel.getByRole("status")).toContainText("Session progress — not saved");await expect(panel).toContainText("Durable progress count is unknown");
 w.commits=[];await page.reload();await expect(challenge(page)).toContainText("Source challenge unavailable");await expect(challenge(page).getByRole("button",{name:"Start source challenge"})).toHaveCount(0);
});

test("SYNTHETIC narrow-screen keyboard challenge controls remain reachable, pause preserves source facts and local reward",async({page,api})=>{
 await page.setViewportSize({width:360,height:1000});await page.emulateMedia({reducedMotion:"no-preference"});await fixtures(api);await page.goto(`${basePath}/world/${keyA}?mode=cached`);await page.getByRole("button",{name:"Pause motion",exact:true}).click();await expect(page.getByRole("button",{name:"Resume motion"})).toHaveAttribute("aria-pressed","true");await page.waitForTimeout(150);const pixels=await page.getByTestId("world-canvas").evaluate((c:HTMLCanvasElement)=>c.toDataURL());await page.waitForTimeout(200);expect(await page.getByTestId("world-canvas").evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(pixels);
 await page.getByRole("button",{name:"Show source challenge",exact:true}).click();const panel=challenge(page);const start=panel.getByRole("button",{name:"Start source challenge"});await start.focus();await page.keyboard.press("Enter");await panel.getByRole("group",{name:"Choose the matching captured source"}).getByRole("radio").first().focus();await page.keyboard.press("Space");await panel.getByRole("radio",{name:/^The map records this directory source/}).focus();await page.keyboard.press("Space");await panel.getByRole("button",{name:"Submit source answers"}).focus();await page.keyboard.press("Enter");await expect(panel.getByRole("status")).toContainText("Saved on this device");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await panel.evaluate((e: HTMLElement)=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await expect(page.getByRole("link",{name:"Back to Atlas",exact:true})).toBeVisible();
});

test("SYNTHETIC real IDB caps, corrupt records, aborted save and newer schema retain data with honest session fallback",async({page,api})=>{
 await fixtures(api);await page.goto(basePath+"/atlas");await harness(page);
 const result=await page.evaluate(async(w:any)=>{
  const {ProgressStore,deriveChallenge,startAttempt,conclusionAnswers}=(window as any).__progressHarness;
  const c=await deriveChallenge(w),s=new ProgressStore(indexedDB),a={...startAttempt(c,0),selectedEvidenceId:c.evidence[0].id,selectedSubjectId:c.target.subjectId,answerCodes:conclusionAnswers(c.variant,c.choices.conclusion[0].code)};
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("moon-factory-exploration",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const write=(run:(tx:IDBTransaction)=>void)=>new Promise<void>((resolve,reject)=>{const t=db.transaction(["repoProgress","completions","metadata"],"readwrite");t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);run(t);});
  await write(t=>{for(let i=0;i<100;i++)t.objectStore("repoProgress").put({schemaVersion:1,repoKey:`synthetic-limit/repo${i}`,discovered:true,visited:false});});
  const cap=await s.complete(c,a,c.identity);
  const count=(name:string)=>new Promise<number>((resolve)=>{const r=db.transaction(name).objectStore(name).count();r.onsuccess=()=>resolve(r.result);});const capRepos=await count("repoProgress"),capCompletions=await count("completions");
  await write(t=>{t.objectStore("repoProgress").clear();t.objectStore("repoProgress").put({schemaVersion:1,repoKey:"synthetic-corrupt/retained",discovered:true,visited:false,extra:"x".repeat(2049)});});
  const corrupt=await s.read();let retained=0;await new Promise<void>((resolve)=>{const r=db.transaction("repoProgress").objectStore("repoProgress").count();r.onsuccess=()=>{retained=r.result;resolve();};});
  await write(t=>t.objectStore("repoProgress").clear());
  const original=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(){throw new DOMException("SYNTHETIC quota failure","QuotaExceededError");};
  const aborted=await s.complete(c,a,c.identity);IDBObjectStore.prototype.add=original;const durableCount=await count("completions");const recovered=await s.complete(c,a,c.identity),recoveredCount=await count("completions");
  s.close();db.close();const higher=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("moon-factory-exploration",2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});higher.close();
  const unsupported=await new ProgressStore(indexedDB).read();
  return {cap:cap.receipt.persistence,capRepos,capCompletions,corrupt:corrupt.persistence,retained,aborted:aborted.receipt.persistence,durableCount,recovered:recovered.receipt.persistence,recoveredCount,recoveredOriginal:recovered.receipt.completedAt===cap.receipt.completedAt,unsupported:unsupported.persistence,unknown:unsupported.durableCountKnown};
 },capture());
 expect(result).toEqual({cap:"session",capRepos:100,capCompletions:0,corrupt:"session",retained:1,aborted:"session",durableCount:0,recovered:"device",recoveredCount:1,recoveredOriginal:true,unsupported:"session",unknown:false});
});

test("F4 SYNTHETIC confirmed clear removes corrupt v1 rows atomically but rejects unknown metadata/generation",async({page,api})=>{
 await fixtures(api);await page.goto(basePath+"/atlas");await harness(page);
 const r=await page.evaluate(async(w:any)=>{
  const {ProgressStore,deriveChallenge,startAttempt,conclusionAnswers}=(window as any).__progressHarness,s=new ProgressStore(indexedDB),c=await deriveChallenge(w),a={...startAttempt(c,0),selectedEvidenceId:c.evidence[0].id,selectedSubjectId:c.target.subjectId,answerCodes:conclusionAnswers(c.variant,c.choices.conclusion[0].code)};
  await s.read();const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("moon-factory-exploration",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const write=(f:(t:IDBTransaction)=>void)=>new Promise<void>((resolve,reject)=>{const t=db.transaction(["repoProgress","metadata"],"readwrite");t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);f(t);});
  await write(t=>t.objectStore("repoProgress").put({schemaVersion:99,repoKey:"synthetic/corrupt",discovered:true,visited:false}));const bad=await s.read(),cleared=await s.reset();let stale=false;try{await s.complete(c,a,c.identity);}catch(e){stale=(e as Error).message.includes("reset");}
  await write(t=>{t.objectStore("repoProgress").put({schemaVersion:99,repoKey:"synthetic/retained"});t.objectStore("metadata").put("foreign","unknown");});let metadataRejected=false;try{await s.reset();}catch{metadataRejected=true;}
  await write(t=>{t.objectStore("metadata").delete("unknown");t.objectStore("metadata").put(null,"generation");});let generationRejected=false;try{await s.reset();}catch{generationRejected=true;}
  const retained=await new Promise<number>(resolve=>{const r=db.transaction("repoProgress").objectStore("repoProgress").count();r.onsuccess=()=>resolve(r.result);});db.close();s.close();return {warning:bad.warning,empty:cleared.repos.length,generation:cleared.generation,stale,metadataRejected,generationRejected,retained};
 },capture());
 expect(r.warning).toContain("invalid or unsupported");expect(r.warning).not.toContain("capacity");expect(r).toMatchObject({empty:0,generation:1,stale:true,metadataRejected:true,generationRejected:true,retained:1});
 // The explicit UI recovery follows the same reset protocol; no database deletion.
 await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("moon-factory-exploration",1);r.onsuccess=()=>resolve(r.result);});await new Promise<void>(resolve=>{const t=db.transaction("metadata","readwrite");t.objectStore("metadata").put(1,"generation");t.oncomplete=()=>resolve();});db.close();});
 await page.getByRole("button",{name:"Reload local progress"}).click();await page.getByRole("button",{name:"Clear exploration progress",exact:true}).click();await page.getByRole("button",{name:"Confirm clear exploration progress",exact:true}).click();await expect(page.getByRole("alertdialog")).toHaveCount(0);await expect(page.locator(".atlas-progress-controls")).toContainText("0 saved Exploration stars");
});

test("F6 SYNTHETIC unsaved receipt stays session-only after Back/read, recovery saves original once and reload drops only unsaved",async({page,api})=>{
 await fixtures(api);await page.addInitScript(()=>{const original=IDBObjectStore.prototype.add;let fail=true;IDBObjectStore.prototype.add=function(...args:any[]){if(this.name==="completions"&&fail){fail=false;throw new DOMException("SYNTHETIC save failure","QuotaExceededError");}return original.apply(this,args as any);};});
 await page.goto(basePath+"/atlas");await page.locator(".atlas-list-rows").getByRole("button",{name:new RegExp(keyA)}).click();await answer(page);await expect(challenge(page).getByRole("status")).toContainText("Session progress — not saved");expect(await receipts(page)).toHaveLength(0);
 await page.getByRole("link",{name:"Back to Atlas",exact:true}).click();await expect(page.locator(".atlas-progress-controls")).toContainText("0 saved Exploration stars · 1 session Exploration stars — not saved");await page.getByRole("button",{name:"Reload local progress"}).click();await expect(page.locator(".atlas-progress-controls")).toContainText("0 saved Exploration stars · 1 session");
 await page.getByRole("link",{name:"Enter cached world"}).click();await answer(page);await expect(challenge(page).getByRole("status")).toContainText("Saved on this device");const saved=await receipts(page);expect(saved).toHaveLength(1);await answer(page);expect(await receipts(page)).toEqual(saved);
 await page.getByRole("link",{name:"Back to Atlas",exact:true}).click();await expect(page.locator(".atlas-progress-controls")).toContainText("1 saved Exploration stars · 0 session");await page.reload();await expect(page.locator(".atlas-progress-controls")).toContainText("1 saved Exploration stars · 0 session");
});

test("F6 SYNTHETIC unsaved discovery/visit are labelled session-only and disappear after reload",async({page,api})=>{
 await fixtures(api);await page.addInitScript(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==="repoProgress")throw new DOMException("SYNTHETIC flag save failure","QuotaExceededError");return original.apply(this,args as any);};});await page.goto(basePath+"/atlas");await page.locator(".atlas-list-rows").getByRole("button",{name:new RegExp(keyA)}).click();await expect(page.locator(".explorer-visit-status")).toContainText("Visited this session — not saved");await answer(page);await expect(challenge(page).getByRole("status")).toContainText("Session progress — not saved");await page.getByRole("link",{name:"Back to Atlas",exact:true}).click();await expect(page.locator(".atlas-progress-controls")).toContainText("0 saved Exploration stars · 1 session");await expect(page.locator(".atlas-observation")).toContainText("Visited this session");await page.reload();await expect(page.locator(".atlas-progress-controls")).toContainText("Saved Exploration star count unknown · 0 session");expect(await receipts(page)).toHaveLength(0);
});

test("F5 SYNTHETIC malformed cached graph is unavailable in Atlas and Explorer without an error boundary",async({page,api})=>{
 const bad=capture();(bad.nodes as any[])[1]=null;await fixtures(api,[bad]);await page.goto(basePath+"/atlas");await page.locator(".atlas-list-rows").getByRole("button",{name:new RegExp(keyA)}).click();await expect(page.locator(".atlas-status")).toHaveText("Cached facts unavailable");await expect(page.getByRole("link",{name:"Enter cached world"})).toHaveCount(0);await page.goto(`${basePath}/world/${keyA}?mode=cached`);await expect(page.getByRole("alert")).toContainText("cannot be verified");await expect(page.getByText("Signal interrupted.",{exact:true})).toHaveCount(0);await expect(page.getByTestId("world-canvas")).toHaveCount(0);
});
