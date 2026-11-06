import {expect,test} from "bun:test";
import {HistoryGitHubReader,HISTORY_READ_LIMITS,observeHistoryReaderSettlement,waitForHistoryReaderIdle,type HistoryReaderDependencies,type HistoryCursorProof} from "../src/server/history-github";
import {GitHubError,isPublicRepositoryMetadata,type Fetcher} from "../src/server/github";
import {validateImmutableCommit} from "../src/history/topology";
const repo="synthetic-history/reader",sha=(n:number)=>n.toString(16).padStart(40,"0"),wall="2025-08-01T00:00:00Z";
const request=()=>({repo:`https://github.com/${repo}`,anchorSha:sha(4),generation:"SYNTHETIC_generation_1",action:"walk" as const,frameShas:[sha(4),sha(2)]});
const metadata=()=>({private:false,visibility:"public",full_name:repo,default_branch:"IGNORED-BRANCH",license:{spdx_id:"NOASSERTION"}});
const commit=(n:number)=>({sha:sha(n),tree:{sha:sha(n+100)},parents:n>1?[{sha:sha(n-1)}]:[],author:{date:n===4?"2025-07-01T00:00:00Z":"2025-07-10T00:00:00Z"},committer:{date:"2025-07-11T00:00:00Z"},message:`SYNTHETIC source commit ${n}`});
const tree=(n:number)=>({sha:sha(n),truncated:false,tree:[{path:"src",type:"tree",mode:"040000",sha:sha(500)},{path:"src/源代码.ts",type:"blob",mode:"100644",sha:sha(501)},{path:"link",type:"blob",mode:"120000",sha:sha(502)},{path:"module",type:"commit",mode:"160000",sha:sha(503)}]});
const json=(value:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers});
function fixture(options:{intercept?:(url:URL,init:RequestInit)=>Response|undefined|Promise<Response|undefined>;limits?:HistoryReaderDependencies["limits"];quotaLimit?:number;resolveCursor?:HistoryReaderDependencies["resolveCursor"]}={}){
 let now=0,taken=0,requestAdmits=0,collectionAdmits=0,active=0,maxActive=0;const calls:{url:string;init:RequestInit}[]=[],events:string[]=[];
 const quota={take(){events.push("quota");if(taken>=(options.quotaLimit??100))throw new GitHubError("PUBLIC_RATE_LIMIT",429,"SYNTHETIC quota",9);taken++;}};
 const fetcher:Fetcher=async(input,init={})=>{events.push("fetch");calls.push({url:String(input),init});active++;maxActive=Math.max(active,maxActive);try{const url=new URL(String(input)),custom=await options.intercept?.(url,init);if(custom)return custom;if(url.pathname===`/repos/${repo}`)return json(metadata());const c=url.pathname.match(/\/git\/commits\/([a-f0-9]{40})$/);if(c)return json(commit(parseInt(c[1],16)));const t=url.pathname.match(/\/git\/trees\/([a-f0-9]{40})$/);if(t)return json(tree(parseInt(t[1],16)));throw Error("SYNTHETIC unexpected URL");}finally{active--;}};
 const deps:HistoryReaderDependencies={fetcher,quota,admitRequest:()=>{events.push("request-admission");requestAdmits++;},admitCollection:()=>{events.push("collection-admission");collectionAdmits++;},monotonicNow:()=>now,wallNow:()=>wall,limits:options.limits,resolveCursor:options.resolveCursor};
 return {reader:new HistoryGitHubReader(deps),deps,calls,events,get taken(){return taken;},get requestAdmits(){return requestAdmits;},get collectionAdmits(){return collectionAdmits;},get maxActive(){return maxActive;},advance:(n:number)=>{now+=n;},setClock:(n:number)=>{now=n;}};
}
function proofRoot(unknown=false):HistoryCursorProof{const raw=commit(4),parsed=validateImmutableCommit({schemaVersion:1,repoKey:repo,sha:raw.sha,treeSha:raw.tree.sha,parents:unknown?null:raw.parents.map(p=>p.sha),authorAt:raw.author.date,committerAt:raw.committer.date,message:raw.message,provenance:[{sourceUrl:`https://api.github.com/repos/${repo}/git/commits/${raw.sha}`,fetchedAt:wall}]});if(!parsed.ok)throw Error(parsed.code);return{anchor:{repoKey:repo,sha:sha(4),generation:request().generation},commits:[parsed.value],nextParentSha:unknown?null:sha(3)};}
const handle=()=>({id:"SYNTHETIC_cursor_1",repoKey:repo,anchorSha:sha(4),generation:request().generation});

test("SYNTHETIC physical observer before/during/after actions never unlocks another authority or a later action",async()=>{
 let release!:(r:Response)=>void,once=true;const f=fixture({intercept:()=>once?(once=false,new Promise<Response>(r=>release=r)):undefined});
 expect(observeHistoryReaderSettlement(f.deps.quota).idle).toBe(true);await waitForHistoryReaderIdle(f.deps.quota);
 const action=f.reader.read(request());await Bun.sleep(0);const a=observeHistoryReaderSettlement(f.deps.quota),b=waitForHistoryReaderIdle(f.deps.quota);let observed=0;a.settled.then(()=>observed++);b.then(()=>observed++);
 expect(a.idle).toBe(false);expect(observeHistoryReaderSettlement({take(){}}).idle).toBe(true);expect(observed).toBe(0);
 release(json(metadata()));expect((await action).outcome).toBe("ok");await Promise.all([a.settled,b]);expect(observed).toBe(2);expect(observeHistoryReaderSettlement(f.deps.quota).idle).toBe(true);
 once=true;const next=f.reader.read(request());await Bun.sleep(0);const later=observeHistoryReaderSettlement(f.deps.quota);expect(later.idle).toBe(false);
 await a.settled;await b;expect((await new HistoryGitHubReader(f.deps).read(request())).coverage.stopReason).toBe("HISTORY_BUSY");
 release(json(metadata()));expect((await next).outcome).toBe("ok");await later.settled;expect(observeHistoryReaderSettlement(f.deps.quota).idle).toBe(true);
 expect((await f.reader.read(request())).outcome).toBe("ok");expect(observeHistoryReaderSettlement(f.deps.quota).idle).toBe(true);
});

test("SYNTHETIC observer has no idle gap between late transport and pending cancellation, including rejected cleanup",async()=>{
 for(const rejected of [false,true]){
  let response!:(r:Response)=>void,settle!:()=>void,once=true,cancelled=0;const cleanup=new Promise<void>((resolve,reject)=>settle=()=>rejected?reject(new Error("SYNTHETIC cleanup rejection")):resolve());
  const f=fixture({limits:{requestMs:5,actionMs:50},intercept:()=>once?(once=false,new Promise<Response>(r=>response=r)):undefined});
  expect((await f.reader.read(request())).coverage.stopReason).toBe("HISTORY_REQUEST_TIMEOUT");let idle=false;const observed=waitForHistoryReaderIdle(f.deps.quota).then(()=>{idle=true;});
  response(new Response(new ReadableStream({cancel(){cancelled++;return cleanup;}})));await Bun.sleep(0);expect(cancelled).toBe(1);expect(idle).toBe(false);expect(observeHistoryReaderSettlement(f.deps.quota).idle).toBe(false);
  expect((await f.reader.read(request())).coverage.stopReason).toBe("HISTORY_BUSY");settle();await observed;expect(idle).toBe(true);expect(observeHistoryReaderSettlement(f.deps.quota).idle).toBe(true);expect((await f.reader.read(request())).outcome).toBe("ok");
 }
});

test("SYNTHETIC bounded history succeeds with one metadata gate, four first-parent details and two pinned trees",async()=>{
 const f=fixture(),r=await f.reader.read(request());expect(r.outcome).toBe("ok");expect(r.commits.map(c=>c.sha)).toEqual([4,3,2,1].map(sha));expect(r.frames.map(t=>t.commitSha)).toEqual([sha(2),sha(4)]);expect(r.frames.every(t=>t.completeness==="full")).toBe(true);expect(r.frames[0].entries.map(e=>e.type)).toContain("symlink");expect(r.frames[0].entries.map(e=>e.type)).toContain("submodule");expect(r.publicRepository?.licenseSpdx).toBe("NOASSERTION");expect(r.coverage).toMatchObject({attempts:7,networkRequests:7,commitSteps:4,newCommits:4,reachedRoot:true,nextParentSha:null,completeHistory:false,errors:[]});expect(f.taken).toBe(7);expect(f.requestAdmits).toBe(1);expect(f.collectionAdmits).toBe(1);expect(f.maxActive).toBe(1);expect(f.events.slice(0,4)).toEqual(["request-admission","collection-admission","quota","fetch"]);for(const call of f.calls){expect(new URL(call.url).origin).toBe("https://api.github.com");expect(call.init.redirect).toBe("error");expect(call.init.method).toBe("GET");expect(new Headers(call.init.headers).has("authorization")).toBe(false);}expect(f.calls.some(c=>/ref\/heads|contents|issues|pulls/.test(c.url))).toBe(false);expect(r.persistence).toBe("not-persisted");
});

test("SYNTHETIC first parent beats clocks/side branch; missing parent fields never invent observed root",async()=>{
 const f=fixture({intercept:url=>url.pathname.endsWith(`/commits/${sha(4)}`)?json({...commit(4),parents:[{sha:sha(3)},{sha:sha(99)}]}):undefined}),r=await f.reader.read(request());expect(r.commits.map(c=>c.sha)).toEqual([4,3,2,1].map(sha));expect(f.calls.some(c=>c.url.endsWith(sha(99)))).toBe(false);expect(r.commits[0].authorAt).toBe("2025-07-01T00:00:00Z");
 const missing=fixture({intercept:url=>url.pathname.endsWith(`/commits/${sha(4)}`)?json({...commit(4),parents:undefined}):undefined}),m=await missing.reader.read(request());expect(m.commits).toHaveLength(1);expect(m.coverage.reachedRoot).toBeNull();expect(m.coverage.nextParentSha).toBeNull();expect(m.coverage.stopReason).toBe("HISTORY_PARENTS_UNOBSERVED");expect(missing.calls).toHaveLength(2);
});

test("SYNTHETIC public metadata gate uses existing policy and never gates on license",async()=>{
 for(const patch of [{private:true},{private:undefined},{visibility:"private"},{full_name:"synthetic/other"}]){const f=fixture({intercept:url=>url.pathname===`/repos/${repo}`?json({...metadata(),...patch}):undefined}),r=await f.reader.read(request());expect(r.outcome).toBe("rejected");expect(r.commits).toEqual([]);expect(r.frames).toEqual([]);expect(f.calls).toHaveLength(1);}
 for(const license of [null,{spdx_id:"NOASSERTION"},{spdx_id:"Llama-custom"},{spdx_id:"CC-BY-NC-4.0"}]){const f=fixture({intercept:url=>url.pathname===`/repos/${repo}`?json({...metadata(),visibility:undefined,license}):undefined}),r=await f.reader.read({...request(),frameShas:[]});expect(r.outcome).toBe("ok");expect(r.publicRepository?.licenseSpdx).toBe(license?.spdx_id??null);}
});

test("SYNTHETIC invalid/offhost/extra-field/branch/cursor inputs have no admission, quota or network",async()=>{
 for(const input of [{...request(),repo:"https://evil.test/a/b"},{...request(),repo:"https://github.com/a/%2e%2e/b"},{...request(),anchorSha:"main"},{...request(),prompt:"write arbitrary code"},{...request(),sql:"SELECT *"},{...request(),frameShas:[sha(4),sha(4)]},{...request(),cursor:{...handle(),nextParentSha:sha(99)}},{...request(),cursor:{...handle(),anchorSha:sha(3)}}]){const f=fixture(),r=await f.reader.read(input);expect(r.outcome).toBe("rejected");expect(f.calls).toHaveLength(0);expect(f.taken).toBe(0);expect(f.requestAdmits).toBe(0);}
});

test("SYNTHETIC redirects, forged final origin and transport errors stop once without following/retrying",async()=>{
 for(const response of [()=>json({},302,{location:"https://evil.test/steal"}),()=>{const r=json(metadata());Object.defineProperty(r,"url",{value:"https://evil.test/metadata"});return r;}]){const f=fixture({intercept:()=>response()}),r=await f.reader.read(request());expect(r.coverage.stopReason).toBe("GITHUB_REDIRECT");expect(f.calls).toHaveLength(1);expect(f.taken).toBe(1);}
 const f=fixture({intercept:()=>{throw Error("SYNTHETIC transport failure");}});expect((await f.reader.read(request())).coverage.stopReason).toBe("GITHUB_UNAVAILABLE");expect(f.calls).toHaveLength(1);
});

test("SYNTHETIC 403/429 stop immediately, retain prior observations and honor cooldown/Retry-After with same quota",async()=>{
 for(const [status,headers,code]of [[403,{},"GITHUB_FORBIDDEN"],[429,{"retry-after":"7"},"GITHUB_RATE_LIMIT"],[403,{"retry-after":"7","x-ratelimit-remaining":"0"},"GITHUB_RATE_LIMIT"]]as const){const f=fixture({intercept:url=>url.pathname.endsWith(`/commits/${sha(3)}`)?json({},status,headers):undefined}),r=await f.reader.read(request());expect(r.coverage.stopReason).toBe(code);expect(r.commits.map(c=>c.sha)).toEqual([sha(4)]);expect(r.coverage.nextParentSha).toBe(sha(3));expect(r.coverage.reachedRoot).toBeNull();expect(r.nextCursor?.needsServerBinding).toBe(true);expect(f.calls).toHaveLength(3);if(code==="GITHUB_RATE_LIMIT"){expect(r.coverage.errors[0].retryAfter).toBe(7);const next=await new HistoryGitHubReader(f.deps).read(request());expect(next.coverage.stopReason).toBe("GITHUB_RATE_LIMIT");expect(f.calls).toHaveLength(3);}}
});

test("SYNTHETIC original request/collection/quota denials and stricter attempt/step bounds are not new history allowances",async()=>{
 for(const admission of ["admitRequest","admitCollection"]as const){const f=fixture();f.deps[admission]=()=>{throw Object.assign(Error("SYNTHETIC original IP quota"),{code:"IP_RATE_LIMIT",status:429,retryAfter:11});};const r=await new HistoryGitHubReader(f.deps).read(request());expect(r.coverage.stopReason).toBe("IP_RATE_LIMIT");expect(f.calls).toHaveLength(0);expect(f.taken).toBe(0);}
 for(const [options,code]of [[{quotaLimit:2},"PUBLIC_RATE_LIMIT"],[{limits:{attempts:2}},"HISTORY_ATTEMPT_CAP"]]as const){const f=fixture(options),r=await f.reader.read(request());expect(r.coverage.stopReason).toBe(code);expect(f.calls).toHaveLength(2);expect(f.taken).toBe(2);expect(r.commits).toHaveLength(1);}
 const f=fixture({limits:{commitSteps:0}}),r=await f.reader.read({...request(),action:"frames",frameShas:[sha(4)]});expect(r.commits).toEqual([]);expect(f.calls).toHaveLength(1);expect(HISTORY_READ_LIMITS.attempts).toBe(8);
});

test("SYNTHETIC streamed actual bytes and total bytes stop before JSON parsing or any next fetch",async()=>{
 let cancelled=0;const f=fixture({limits:{responseBytes:64},intercept:()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(65));},cancel(){cancelled++;}}))}),r=await f.reader.read(request());expect(r.coverage.stopReason).toBe("HISTORY_RESPONSE_BYTE_CAP");expect(r.coverage.bytesObserved).toBe(65);expect(r.coverage.bytesRetained).toBe(0);expect(cancelled).toBeGreaterThan(0);expect(f.calls).toHaveLength(1);
 const cap=Buffer.byteLength(JSON.stringify(metadata()))+Buffer.byteLength(JSON.stringify(commit(4)))+Buffer.byteLength(JSON.stringify(commit(3)))-1,g=fixture({limits:{actionBytes:cap}}),partial=await g.reader.read(request());expect(partial.coverage.stopReason).toBe("HISTORY_ACTION_BYTE_CAP");expect(partial.coverage.bytesRetained).toBeLessThanOrEqual(cap);expect(partial.commits).toHaveLength(1);expect(g.calls).toHaveLength(3);
});

test("SYNTHETIC per-request abort is bounded even if fetch ignores signal; shared authority remains busy until late response settles",async()=>{
 let release!:(r:Response)=>void,cancelled=0;const f=fixture({limits:{requestMs:5,actionMs:50},intercept:()=>new Promise<Response>(r=>release=r)}),r=await f.reader.read(request()),snapshot=JSON.stringify(r);expect(r.coverage.stopReason).toBe("HISTORY_REQUEST_TIMEOUT");expect(f.calls[0].init.signal?.aborted).toBe(true);expect((await new HistoryGitHubReader(f.deps).read(request())).coverage.stopReason).toBe("HISTORY_BUSY");release(new Response(new ReadableStream({cancel(){cancelled++;}})));await Bun.sleep(0);expect(cancelled).toBe(1);expect(JSON.stringify(r)).toBe(snapshot);expect(f.calls).toHaveLength(1);
});

test("SYNTHETIC action deadline/rewinding clock/slow body stop with earlier facts retained",async()=>{
 let f:ReturnType<typeof fixture>;f=fixture({intercept:()=>{f.advance(10_000);return undefined;}});const r=await f.reader.read(request());expect(r.coverage.stopReason).toBe("HISTORY_ACTION_TIMEOUT");expect(r.commits.map(c=>c.sha)).toEqual([4,3,2].map(sha));expect(r.coverage.reachedRoot).toBeNull();expect(f.calls).toHaveLength(5);
 let g:ReturnType<typeof fixture>;g=fixture({intercept:()=>{g.setClock(-1);return undefined;}});expect((await g.reader.read(request())).coverage.stopReason).toBe("HISTORY_CLOCK_INVALID");expect(g.calls).toHaveLength(1);
 const invalidInitial=fixture();let initial=true;invalidInitial.deps.monotonicNow=()=>initial?(initial=false,NaN):0;expect((await new HistoryGitHubReader(invalidInitial.deps).read(request())).coverage.stopReason).toBe("HISTORY_CLOCK_INVALID");expect(invalidInitial.calls).toHaveLength(0);
 let cancelled=0;const stalled=fixture({limits:{requestMs:5,actionMs:50},intercept:()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}}))});expect((await stalled.reader.read(request())).coverage.stopReason).toBe("HISTORY_REQUEST_TIMEOUT");expect(cancelled).toBe(1);
});

test("SYNTHETIC concurrent readers sharing original quota run only one physical request stream",async()=>{
 let release!:(r:Response)=>void;let once=true;const f=fixture({intercept:url=>url.pathname===`/repos/${repo}`&&once?(once=false,new Promise<Response>(r=>release=r)):undefined});const first=f.reader.read(request());await Bun.sleep(0);expect(f.calls).toHaveLength(1);const second=await new HistoryGitHubReader(f.deps).read(request());expect(second.coverage.stopReason).toBe("HISTORY_BUSY");expect(f.calls).toHaveLength(1);release(json(metadata()));expect((await first).outcome).toBe("ok");expect(f.maxActive).toBe(1);
});

test("SYNTHETIC trusted cursor proof must bind anchor/generation and an actual first-parent continuation",async()=>{
 const proof=proofRoot(),f=fixture({resolveCursor:()=>proof}),r=await f.reader.read({...request(),cursor:handle()});expect(r.commits.map(c=>c.sha)).toEqual([4,3,2,1].map(sha));expect(r.coverage.newCommits).toBe(3);expect(f.calls).toHaveLength(6);
 for(const bad of [{...proof,anchor:{...proof.anchor,sha:sha(3)}},{...proof,nextParentSha:sha(99)},{...proof,commits:[]}]){const g=fixture({resolveCursor:()=>bad});expect((await g.reader.read({...request(),cursor:handle()})).outcome).toBe("rejected");expect(g.calls).toHaveLength(0);}
 const noProof=fixture();expect((await noProof.reader.read({...request(),cursor:handle()})).coverage.stopReason).toBe("HISTORY_CURSOR_PROOF_REQUIRED");expect(noProof.calls).toHaveLength(0);
 const privateNow=fixture({resolveCursor:()=>proof,intercept:url=>url.pathname===`/repos/${repo}`?json({...metadata(),private:true}):undefined});const rejected=await privateNow.reader.read({...request(),cursor:handle()});expect(rejected.commits).toEqual([]);expect(rejected.outcome).toBe("rejected");
});

test("SYNTHETIC unsupported tree/modes and cap/truncation retain only positive partial facts without following links",async()=>{
 const f=fixture({intercept:url=>url.pathname.includes("/git/trees/")?json({...tree(104),truncated:true,tree:[...tree(104).tree,{path:"bad",type:"blob",mode:"999999",sha:sha(99)}]}):undefined}),r=await f.reader.read({...request(),frameShas:[sha(4)]});expect(r.frames).toHaveLength(1);expect(r.frames[0].completeness).toBe("partial");expect(r.frames[0].sourceOmittedEntries).toBeNull();expect(r.coverage.stopReason).toBe("HISTORY_TREE_PARTIAL_INVALID");expect(r.coverage.trees[0].rejectedEntries).toBe(1);expect(f.calls.some(c=>/contents|submodule|\/git\/trees\/(?:0{37}5(?:02|03))/.test(c.url))).toBe(false);
 const big=fixture({intercept:url=>url.pathname.includes("/git/trees/")?json({...tree(104),tree:Array.from({length:9000},(_,i)=>({path:`file-${i}`,type:"blob",mode:"100644",sha:sha(500)}))}):undefined}),capped=await big.reader.read(request());expect(capped.frames[0].entries.length).toBeLessThanOrEqual(8000);expect(capped.frames[0].completeness).toBe("partial");expect(capped.coverage.trees[0].uninspectedEntries).toBe(1000);expect(capped.coverage.stopReason).toBe("HISTORY_TREE_ENTRY_CAP");expect(capped.frames).toHaveLength(1);expect(big.calls).toHaveLength(6);
 const byteFrame=fixture({intercept:url=>url.pathname.includes("/git/trees/")?json({...tree(104),tree:Array.from({length:4000},(_,i)=>({path:`${"x".repeat(120)}/${i}`,type:"blob",mode:"100644",sha:sha(500)}))}):undefined}),bounded=await byteFrame.reader.read(request());expect(bounded.frames).toHaveLength(1);expect(bounded.frames[0].limits).toContain("byte-cap");expect(bounded.coverage.stopReason).toBe("HISTORY_TREE_FRAME_CAP");expect(byteFrame.calls).toHaveLength(6);
});

test("SYNTHETIC no side-branch tree or immutable conflict is silently adopted; previous verified observations survive",async()=>{
 const f=fixture(),side=await f.reader.read({...request(),frameShas:[sha(99)]});expect(side.coverage.stopReason).toBe("HISTORY_FRAME_NOT_VERIFIED");expect(f.calls.some(c=>c.url.includes(`/git/trees/${sha(199)}`))).toBe(false);expect(side.commits).toHaveLength(4);
 let trees=0;const g=fixture({intercept:url=>url.pathname.includes("/git/commits/")?json({...commit(parseInt(url.pathname.split("/").at(-1)!,16)),tree:{sha:sha(104)}}):url.pathname.includes("/git/trees/")?json({...tree(104),tree:[{path:trees++?"dir/child":"dir",type:"blob",mode:"100644",sha:sha(700)}]}):undefined}),conflict=await g.reader.read(request());expect(conflict.coverage.stopReason).toBe("HISTORY_IMMUTABLE_TREE_CONFLICT");expect(conflict.frames).toHaveLength(1);expect(conflict.frames[0].entries[0].path).toBe("dir");
});

test("SYNTHETIC pending body cancellation retains original authority after timeout, resolves/rejects safely and leaves other authorities usable",async()=>{
 for(const rejectCleanup of [false,true]){
  let settle!:(error?:Error)=>void,cancelled=0,once=true;const cleanup=new Promise<void>((resolve,reject)=>settle=error=>error?reject(error):resolve()),unhandled:unknown[]=[];
  const onUnhandled=(reason:unknown)=>{unhandled.push(reason);};process.on("unhandledRejection",onUnhandled);
  try{
   const f=fixture({limits:{requestMs:10,actionMs:100},intercept:()=>once?(once=false,new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;return cleanup;}}))):undefined}),first=await f.reader.read(request()),snapshot=JSON.stringify(first);
   expect(first.coverage.stopReason).toBe("HISTORY_REQUEST_TIMEOUT");expect(cancelled).toBe(1);expect((await new HistoryGitHubReader(f.deps).read(request())).coverage.stopReason).toBe("HISTORY_BUSY");expect(f.calls).toHaveLength(1);
   expect((await fixture().reader.read(request())).outcome).toBe("ok");settle(rejectCleanup?new Error("SYNTHETIC cancellation rejected"):undefined);await Bun.sleep(0);
   expect((await new HistoryGitHubReader(f.deps).read(request())).outcome).toBe("ok");expect(f.calls).toHaveLength(8);expect(cancelled).toBe(1);expect(JSON.stringify(first)).toBe(snapshot);await Bun.sleep(0);expect(unhandled).toEqual([]);
  }finally{settle();process.off("unhandledRejection",onUnhandled);}
 }
});

test("SYNTHETIC redirect/error/rate-limit/declared-byte early responses retain their one cancellation lifecycle",async()=>{
 for(const variant of [{status:302,headers:{location:"https://evil.test/redirect"},code:"GITHUB_REDIRECT"},{status:403,headers:{},code:"GITHUB_FORBIDDEN"},{status:429,headers:{"retry-after":"1"},code:"GITHUB_RATE_LIMIT"},{status:200,headers:{"content-length":String(HISTORY_READ_LIMITS.responseBytes+1)},code:"HISTORY_RESPONSE_BYTE_CAP"}]){
  let settle!:()=>void,cancelled=0,once=true;const cleanup=new Promise<void>(resolve=>settle=resolve),f=fixture({intercept:()=>once?(once=false,new Response(new ReadableStream({cancel(){cancelled++;return cleanup;}}),{status:variant.status,headers:variant.headers as Record<string,string>})):undefined}),first=await f.reader.read(request()),snapshot=JSON.stringify(first);
  expect(first.coverage.stopReason).toBe(variant.code);expect(cancelled).toBe(1);expect((await new HistoryGitHubReader(f.deps).read(request())).coverage.stopReason).toBe("HISTORY_BUSY");expect(f.calls).toHaveLength(1);settle();await Bun.sleep(0);f.advance(2000);
  expect((await f.reader.read(request())).outcome).toBe("ok");expect(f.calls).toHaveLength(8);expect(cancelled).toBe(1);expect(JSON.stringify(first)).toBe(snapshot);
 }
});

test("SYNTHETIC abort-ignoring late response transfers authority ownership directly into pending cancellation",async()=>{
 let receive!:(response:Response)=>void,settle!:()=>void,cancelled=0,once=true;const transport=new Promise<Response>(resolve=>receive=resolve),cleanup=new Promise<void>(resolve=>settle=resolve),f=fixture({limits:{requestMs:10,actionMs:100},intercept:()=>once?(once=false,transport):undefined}),first=await f.reader.read(request()),snapshot=JSON.stringify(first);
 expect(first.coverage.stopReason).toBe("HISTORY_REQUEST_TIMEOUT");expect((await f.reader.read(request())).coverage.stopReason).toBe("HISTORY_BUSY");receive(new Response(new ReadableStream({cancel(){cancelled++;return cleanup;}})));await Bun.sleep(0);
 expect(cancelled).toBe(1);expect((await new HistoryGitHubReader(f.deps).read(request())).coverage.stopReason).toBe("HISTORY_BUSY");expect(f.calls).toHaveLength(1);settle();await Bun.sleep(0);expect((await f.reader.read(request())).outcome).toBe("ok");expect(cancelled).toBe(1);expect(JSON.stringify(first)).toBe(snapshot);
});

test("SYNTHETIC fully consumed ordinary bodies permit sequential requests and subsequent actions without a stale busy lock",async()=>{
 const f=fixture();expect((await f.reader.read(request())).outcome).toBe("ok");expect((await new HistoryGitHubReader(f.deps).read(request())).outcome).toBe("ok");expect(f.calls).toHaveLength(14);expect(f.maxActive).toBe(1);
});

test("SYNTHETIC all started asynchronous admission/cursor/quota dependencies hold authority after timeout until resolve or reject",async()=>{
 for(const kind of ["admitRequest","admitCollection","resolveCursor","quota"]as const)for(const rejectPending of [false,true]){
  let settle!:(error?:Error)=>void,invocations=0;const pending=new Promise<void>((resolve,reject)=>settle=error=>error?reject(error):resolve()),f=fixture({limits:{actionMs:15,requestMs:10}}),input=kind==="resolveCursor"?{...request(),cursor:handle()}:request();
  const start=()=>{invocations++;return invocations===1?pending:undefined;};if(kind==="quota")f.deps.quota.take=start;else if(kind==="resolveCursor")f.deps.resolveCursor=async()=>{await start();return proofRoot();};else f.deps[kind]=start;
  const first=await new HistoryGitHubReader(f.deps).read(input),snapshot=JSON.stringify(first);expect(first.coverage.stopReason).toBe("HISTORY_ACTION_TIMEOUT");expect((await new HistoryGitHubReader(f.deps).read(input)).coverage.stopReason).toBe("HISTORY_BUSY");expect(invocations).toBe(1);expect(f.calls).toHaveLength(0);
  settle(rejectPending?new Error("SYNTHETIC dependency rejected"):undefined);await Bun.sleep(0);expect((await new HistoryGitHubReader(f.deps).read(input)).outcome).toBe("ok");expect(JSON.stringify(first)).toBe(snapshot);
 }
});

test("SYNTHETIC delivered chunks count before deadline rejection, while reads delivered only after return cannot mutate accounting",async()=>{
 for(const delivery of [11999,12000,12001]){
  let f:ReturnType<typeof fixture>;f=fixture({intercept:()=>new Response(new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(65));f.setClock(delivery);controller.close();}},{highWaterMark:0}))});const r=await f.reader.read(request());expect(r.coverage.bytesObserved).toBe(65);expect(r.coverage.bytesRetained).toBe(delivery<12000?65:0);expect(r.coverage.stopReason).toBe(delivery<12000?"GITHUB_INVALID_RESPONSE":"HISTORY_REQUEST_TIMEOUT");expect(f.calls).toHaveLength(1);
 }
 let deliver!:(chunk:ReadableStreamReadResult<Uint8Array>)=>void;const pending=new Promise<ReadableStreamReadResult<Uint8Array>>(resolve=>deliver=resolve),late=fixture({limits:{requestMs:5,actionMs:50},intercept:()=>{const response=json(metadata());Object.defineProperty(response.body!,"getReader",{value:()=>({read:()=>pending,cancel:()=>Promise.resolve()})});return response;}}),r=await late.reader.read(request()),snapshot=JSON.stringify(r);expect(r.coverage.stopReason).toBe("HISTORY_REQUEST_TIMEOUT");expect(r.coverage.bytesObserved).toBe(0);deliver({done:false,value:new Uint8Array(65)});await Bun.sleep(0);expect(JSON.stringify(r)).toBe(snapshot);
});

test("SYNTHETIC each final tree normalization/publication/finalization boundary observes the same action deadline",async()=>{
 for(let boundary=1;boundary<=11;boundary++){
  let stamps=0,afterTree=false,checks=0;const f=fixture();f.deps.wallNow=()=>{if(++stamps===3)afterTree=true;return wall;};f.deps.monotonicNow=()=>afterTree&&++checks>=boundary?45000:0;
  const r=await new HistoryGitHubReader(f.deps).read({...request(),anchorSha:sha(1),frameShas:[sha(1)]});expect(r.coverage.stopReason).toBe("HISTORY_ACTION_TIMEOUT");expect(r.outcome).toBe("partial");expect(r.commits.map(c=>c.sha)).toEqual([sha(1)]);expect(r.frames).toHaveLength(boundary<=7?0:1);expect(r.nextCursor).toBeNull();expect(f.calls).toHaveLength(3);
 }
 const valid=fixture();expect((await valid.reader.read({...request(),anchorSha:sha(1),frameShas:[sha(1)]})).outcome).toBe("ok");
});

test("SYNTHETIC fatal UTF8 rejects malformed bytes without certifying replacement facts and preserves legitimate split Unicode",async()=>{
 for(const invalid of [[255],[195],[192,175],[128]]){
  const f=fixture({intercept:url=>{if(!url.pathname.includes("/git/trees/"))return;const bytes=new TextEncoder().encode(JSON.stringify({...tree(104),tree:[{...tree(104).tree[0],path:"X"}]})),at=Buffer.from(bytes).indexOf('"path":"X"')+8;return new Response(new Uint8Array([...bytes.slice(0,at),...invalid,...bytes.slice(at+1)]));}}),r=await f.reader.read({...request(),frameShas:[sha(4)]});expect(r.coverage.stopReason).toBe("GITHUB_INVALID_RESPONSE");expect(r.frames).toEqual([]);expect(r.commits).toHaveLength(4);expect(f.calls).toHaveLength(6);
 }
 const path="合法/�😀.ts",f=fixture({intercept:url=>{if(!url.pathname.includes("/git/trees/"))return;const bytes=new TextEncoder().encode(JSON.stringify({...tree(104),tree:[{path,type:"blob",mode:"100644",sha:sha(501)}]}));let at=0;return new Response(new ReadableStream<Uint8Array>({pull(controller){if(at===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(at,++at));}},{highWaterMark:0}));}}),r=await f.reader.read({...request(),frameShas:[sha(4)]});expect(r.outcome).toBe("ok");expect(r.frames[0].entries[0].path).toBe(path);expect(r.frames[0].completeness).toBe("full");
});
