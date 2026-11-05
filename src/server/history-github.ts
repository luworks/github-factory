import { GITHUB_LIMITS, GitHubError, isPublicRepositoryMetadata, parseRepo, type Fetcher } from "./github";
import type { PublicGitHubQuota } from "./public-quota";
import { TOPOLOGY_LIMITS, type ImmutableCommit, type ImmutableTreeFrame, type TopologyAnchor } from "../history/topology-contracts";
import { createTopologyWindow, firstParentSpine, topologyBytes, topologyPath, validateImmutableCommit, validateImmutableTreeFrame, validateTopologyAnchor } from "../history/topology";

export const HISTORY_READ_LIMITS = Object.freeze({ attempts: 8, commitSteps: 4, frames: 2, responseBytes: 2 * 1024 * 1024, actionBytes: 8 * 1024 * 1024, requestMs: Math.min(12_000,GITHUB_LIMITS.timeoutMs), actionMs: 45_000 });
type Limits = {-readonly [K in keyof typeof HISTORY_READ_LIMITS]:number};
export interface HistoryCursorHandle { id:string;repoKey:string;anchorSha:string;generation:string }
/** A trusted future server store must resolve this handle. Client payloads may
 * never supply these commits/nextParentSha. C1 independently checks the chain. */
export interface HistoryCursorProof { anchor:TopologyAnchor;commits:readonly ImmutableCommit[];nextParentSha:string|null }
export interface HistoryReadRequest { repo:string;anchorSha:string;generation:string;action:"walk"|"frames";frameShas?:readonly string[];cursor?:HistoryCursorHandle }
export interface HistoryReadError { code:string;status:number;stage:string;retryAfter?:number }
export interface HistoryReadResult {
 outcome:"ok"|"partial"|"rejected";anchor:TopologyAnchor|null;publicRepository:{repoKey:string;licenseSpdx:string|null}|null;
 commits:ImmutableCommit[];frames:ImmutableTreeFrame[];persistence:"not-persisted";
 coverage:{attempts:number;networkRequests:number;bytesObserved:number;bytesRetained:number;commitSteps:number;newCommits:number;reachedRoot:true|null;nextParentSha:string|null;stopReason:string;completeHistory:false;errors:HistoryReadError[];trees:{commitSha:string;sourceTruncated:boolean|null;rawEntries:number;rejectedEntries:number;uninspectedEntries:number}[]};
 nextCursor:{repoKey:string;anchorSha:string;generation:string;nextParentSha:string;needsServerBinding:true}|null;
}
export interface HistoryReaderDependencies {
 fetcher:Fetcher;
 /** Reuse the existing authority, not a new history allowance. Supply raw fetch;
  * do not also wrap it in PublicGitHubQuota.wrap or charge twice. */
 quota:Pick<PublicGitHubQuota,"take">;
 admitRequest:()=>void|Promise<void>;admitCollection:()=>void|Promise<void>;
 monotonicNow?:()=>number;wallNow?:()=>string;limits?:Partial<Limits>;
 resolveCursor?:(handle:HistoryCursorHandle)=>HistoryCursorProof|null|Promise<HistoryCursorProof|null>;
}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:readonly string[])=>{for(const k in v)if(Object.hasOwn(v,k)&&!allowed.includes(k))return false;return true;};
const sha=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{40}$/.test(v);
const busy=new WeakSet<object>();
const cooling=new WeakMap<object,{until:number;clock:()=>number}>();
const defaultClock=()=>performance.now();
class Stop extends Error { constructor(readonly code:string,readonly status=502,readonly retryAfter?:number){super(code);} }
function parseRequest(input:unknown):{anchor:TopologyAnchor;action:"walk"|"frames";frameShas:string[];cursor?:HistoryCursorHandle}{
 if(!object(input)||!keys(input,["repo","anchorSha","generation","action","frameShas","cursor"])||typeof input.repo!=="string"||!["walk","frames"].includes(input.action))throw new Stop("HISTORY_INVALID_REQUEST",400);
 const repo=parseRepo(input.repo).fullName.toLowerCase(),anchor=validateTopologyAnchor({repoKey:repo,sha:input.anchorSha,generation:input.generation});if(!anchor.ok)throw new Stop("HISTORY_INVALID_ANCHOR",400);
 const frameShas=input.frameShas===undefined?[]:input.frameShas;if(!Array.isArray(frameShas)||frameShas.length>2||!frameShas.every(sha)||new Set(frameShas).size!==frameShas.length)throw new Stop("HISTORY_INVALID_FRAME_SELECTION",400);
 let cursor:HistoryCursorHandle|undefined;
 if(input.cursor!==undefined){const c=input.cursor;if(!object(c)||!keys(c,["id","repoKey","anchorSha","generation"])||typeof c.id!=="string"||!/^[a-zA-Z0-9_-]{1,128}$/.test(c.id)||c.repoKey!==repo||c.anchorSha!==anchor.value.sha||c.generation!==anchor.value.generation)throw new Stop("HISTORY_INVALID_CURSOR",400);cursor={id:c.id,repoKey:repo,anchorSha:c.anchorSha,generation:c.generation};}
 return{anchor:anchor.value,action:input.action,frameShas:[...frameShas],cursor};
}
function errorInfo(error:unknown,stage:string):HistoryReadError{const e=error as {code?:unknown;status?:unknown;retryAfter?:unknown};const code=typeof e?.code==="string"&&/^[A-Z][A-Z0-9_]{0,79}$/.test(e.code)?e.code:"HISTORY_UNAVAILABLE";return{code,status:typeof e?.status==="number"&&e.status>=400&&e.status<=599?e.status:502,stage,...(typeof e?.retryAfter==="number"&&Number.isFinite(e.retryAfter)?{retryAfter:Math.max(1,Math.min(86400,Math.ceil(e.retryAfter)))}:{})};}
/** Offline-injectable bounded reader only; no route, store, credentials, retries,
 * Link following or default-branch lookup. Every invocation is an explicit action. */
export class HistoryGitHubReader {
 private clock:()=>number;private wall:()=>string;private limits:Limits;
 constructor(private deps:HistoryReaderDependencies){if(!deps||!deps.quota||typeof deps.quota.take!=="function"||typeof deps.fetcher!=="function"||typeof deps.admitRequest!=="function"||typeof deps.admitCollection!=="function")throw new Stop("HISTORY_INVALID_DEPENDENCY",400);this.clock=deps.monotonicNow??defaultClock;this.wall=deps.wallNow??(()=>new Date().toISOString());this.limits={...HISTORY_READ_LIMITS};for(const k of Object.keys(this.limits)as(keyof Limits)[]){const n=deps.limits?.[k];if(n!==undefined){if(!Number.isFinite(n)||n<0)throw new Stop("HISTORY_INVALID_LIMIT",400);this.limits[k]=Math.min(this.limits[k],Math.floor(n));}}}
 async read(input:unknown):Promise<HistoryReadResult>{
  const result:HistoryReadResult={outcome:"rejected",anchor:null,publicRepository:null,commits:[],frames:[],persistence:"not-persisted",coverage:{attempts:0,networkRequests:0,bytesObserved:0,bytesRetained:0,commitSteps:0,newCommits:0,reachedRoot:null,nextParentSha:null,stopReason:"UNKNOWN",completeHistory:false,errors:[],trees:[]},nextCursor:null};
  let plan:ReturnType<typeof parseRequest>;try{plan=parseRequest(input);result.anchor=plan.anchor;}catch(e){const info=errorInfo(e,"request");result.coverage.errors.push(info);result.coverage.stopReason=info.code;return result;}
  const authority=this.deps.quota as object;if(busy.has(authority)){result.coverage.errors.push({code:"HISTORY_BUSY",status:409,stage:"admission"});result.coverage.stopReason="HISTORY_BUSY";return result;}busy.add(authority);
  const action=new AbortController(),pending=new Set<Promise<unknown>>();let finished=false,last=NaN,stage="admission";try{last=this.clock();}catch{}
  const started=last,end=started+this.limits.actionMs;
  const check=()=>{let n:number;try{n=this.clock();}catch{throw new Stop("HISTORY_CLOCK_INVALID",503);}if(!Number.isFinite(started)||!Number.isFinite(n)||n<last)throw new Stop("HISTORY_CLOCK_INVALID",503);last=n;if(action.signal.aborted)throw action.signal.reason;if(n>=end)throw new Stop("HISTORY_ACTION_TIMEOUT",504);return n;};
  const release=()=>{if(finished&&pending.size===0)busy.delete(authority);};
  const track=<T>(p:Promise<T>)=>{pending.add(p);p.then(()=>{pending.delete(p);release();},()=>{pending.delete(p);release();});return p;};
  const wait=<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>=>new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason instanceof Stop?signal.reason:new Stop("HISTORY_REQUEST_TIMEOUT",504));if(signal.aborted){abort();return;}signal.addEventListener("abort",abort,{once:true});promise.then(v=>{signal.removeEventListener("abort",abort);resolve(v);},e=>{signal.removeEventListener("abort",abort);reject(e);});});
  const actionTimer=setTimeout(()=>action.abort(new Stop("HISTORY_ACTION_TIMEOUT",504)),this.limits.actionMs);
  const retry=(response:Response)=>{const value=response.headers.get("retry-after"),wall=Date.parse(this.wall());let seconds=value&&/^\d+$/.test(value)?Number(value):value&&Number.isFinite(Date.parse(value))?Math.ceil((Date.parse(value)-wall)/1000):60;const reset=Number(response.headers.get("x-ratelimit-reset"))*1000;if(Number.isFinite(reset)&&reset>wall)seconds=Math.max(seconds,Math.ceil((reset-wall)/1000));return Math.max(1,Math.min(86400,Number.isFinite(seconds)?seconds:60));};
  const request=async(path:string):Promise<{body:any;fetchedAt:string;url:string}>=>{
   const now=check(),cooldown=cooling.get(authority);if(cooldown){if(cooldown.clock!==this.clock)throw new Stop("HISTORY_COOLDOWN_CLOCK_UNKNOWN",503);if(cooldown.until>now)throw new Stop("GITHUB_RATE_LIMIT",429,Math.ceil((cooldown.until-now)/1000));cooling.delete(authority);}
   if(result.coverage.attempts>=this.limits.attempts)throw new Stop("HISTORY_ATTEMPT_CAP",429);if(result.coverage.bytesObserved>=this.limits.actionBytes)throw new Stop("HISTORY_ACTION_BYTE_CAP",502);
   if(!new RegExp(`^/repos/${plan.anchor.repoKey.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?:$|/git/commits/[a-f0-9]{40}$|/git/trees/[a-f0-9]{40}\\?recursive=1$)`).test(path))throw new Stop("HISTORY_INVALID_API_PATH",400);
   await wait(Promise.resolve().then(()=>this.deps.quota.take()),action.signal);result.coverage.attempts++;check();
   const controller=new AbortController(),duration=Math.min(this.limits.requestMs,end-this.clock()),requestEnd=this.clock()+duration,signal=AbortSignal.any([action.signal,controller.signal]);const timer=setTimeout(()=>controller.abort(new Stop("HISTORY_REQUEST_TIMEOUT",504)),duration);
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined,cancelling=false;
   // Cancellation can outlive a timed-out read. Retain the same authority until
   // the actual underlying cleanup settles; starting it twice is not cleanup.
   const cancelBody=(received=response)=>{if(cancelling||!received?.body)return;cancelling=true;try{track(Promise.resolve(reader?reader.cancel():received.body.cancel()));}catch(error){track(Promise.reject(error));}};
   try{
    result.coverage.networkRequests++;const url=`https://api.github.com${path}`;
    const transport=track(Promise.resolve().then(()=>this.deps.fetcher(url,{method:"GET",redirect:"error",signal,headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"Moon-Factory-History"}})).then(received=>{if(signal.aborted)cancelBody(received);return received;}));response=await wait(transport,signal);
    check();if(this.clock()>=requestEnd)throw new Stop("HISTORY_REQUEST_TIMEOUT",504);
    if(response.redirected||response.status>=300&&response.status<400||response.url&&response.url!==url){throw new Stop("GITHUB_REDIRECT",502);}
    if(response.status===429||response.status===403&&(response.headers.get("x-ratelimit-remaining")==="0"||response.headers.has("retry-after"))){const seconds=retry(response);cooling.set(authority,{until:this.clock()+seconds*1000,clock:this.clock});throw new Stop("GITHUB_RATE_LIMIT",429,seconds);}
    if(!response.ok){throw new Stop(response.status===403?"GITHUB_FORBIDDEN":response.status===404?"REPO_NOT_FOUND":"GITHUB_UNAVAILABLE",response.status===403?403:response.status===404?404:502);}
    if(response.headers.get("x-ratelimit-remaining")==="0")cooling.set(authority,{until:this.clock()+retry(response)*1000,clock:this.clock});
    const cap=Math.min(this.limits.responseBytes,this.limits.actionBytes-result.coverage.bytesObserved),declared=response.headers.get("content-length");if(declared&&/^\d+$/.test(declared)&&Number(declared)>cap){throw new Stop("HISTORY_RESPONSE_BYTE_CAP",502);}
    reader=response.body?.getReader();if(!reader)throw new Stop("GITHUB_INVALID_RESPONSE",502);const chunks:Uint8Array[]=[];let count=0;
    for(;;){const chunk=await wait(track(reader.read()),signal);check();if(this.clock()>=requestEnd)throw new Stop("HISTORY_REQUEST_TIMEOUT",504);if(chunk.done)break;result.coverage.bytesObserved+=chunk.value.byteLength;count+=chunk.value.byteLength;if(count>this.limits.responseBytes)throw new Stop("HISTORY_RESPONSE_BYTE_CAP",502);if(result.coverage.bytesObserved>this.limits.actionBytes)throw new Stop("HISTORY_ACTION_BYTE_CAP",502);chunks.push(chunk.value);result.coverage.bytesRetained+=chunk.value.byteLength;}
    const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}let body:any;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Stop("GITHUB_INVALID_RESPONSE",502);}check();if(this.clock()>=requestEnd)throw new Stop("HISTORY_REQUEST_TIMEOUT",504);return{body,fetchedAt:this.wall(),url};
   }catch(e){if(e instanceof Stop||e instanceof GitHubError)throw e;if(signal.aborted)throw signal.reason;throw new Stop("GITHUB_UNAVAILABLE",502);}finally{clearTimeout(timer);controller.abort();cancelBody();}
  };
  const update=()=>{const spine=firstParentSpine(plan.anchor,result.commits);if(!spine.ok)throw new Stop("HISTORY_IMMUTABLE_COMMIT_CONFLICT",502);result.commits=[...spine.value.commits];result.coverage.reachedRoot=spine.value.reachedRoot;result.coverage.nextParentSha=spine.value.commits.length?spine.value.nextParentSha:null;return spine.value;};
  try{
   check();await wait(Promise.resolve().then(()=>this.deps.admitRequest()),action.signal);check();let next:string|null=plan.anchor.sha,verifiedContext:ImmutableCommit[]=[];
   if(plan.cursor){stage="cursor";if(!this.deps.resolveCursor)throw new Stop("HISTORY_CURSOR_PROOF_REQUIRED",409);const proof=await wait(Promise.resolve().then(()=>this.deps.resolveCursor!(plan.cursor!)),action.signal);check();if(!proof||!object(proof.anchor)||proof.anchor.repoKey!==plan.anchor.repoKey||proof.anchor.sha!==plan.anchor.sha||proof.anchor.generation!==plan.anchor.generation)throw new Stop("HISTORY_CURSOR_STALE",409);const spine=firstParentSpine(plan.anchor,proof.commits);if(!spine.ok||!spine.value.commits.length||spine.value.nextParentSha!==proof.nextParentSha)throw new Stop("HISTORY_CURSOR_UNVERIFIED",409);verifiedContext=[...spine.value.commits];next=spine.value.nextParentSha;if(plan.action==="walk"&&!next)throw new Stop("HISTORY_CURSOR_UNRESOLVED",409);}
   stage="admission";await wait(Promise.resolve().then(()=>this.deps.admitCollection()),action.signal);check();stage="metadata";const metadata=await request(`/repos/${plan.anchor.repoKey}`);if(!object(metadata.body)||!isPublicRepositoryMetadata(metadata.body))throw new Stop("PUBLIC_ONLY",403);if(typeof metadata.body.full_name!=="string"||parseRepo(metadata.body.full_name).fullName.toLowerCase()!==plan.anchor.repoKey)throw new Stop("HISTORY_REPOSITORY_CHANGED",409);const license=metadata.body.license?.spdx_id;result.publicRepository={repoKey:plan.anchor.repoKey,licenseSpdx:typeof license==="string"&&license.length<=256?license:null};result.commits=verifiedContext;update();
   const steps=plan.action==="frames"&&result.commits.length?0:plan.action==="frames"?Math.min(1,this.limits.commitSteps):this.limits.commitSteps;
   for(let i=0;i<steps&&next;i++){
    stage="commit";if(result.commits.length>=TOPOLOGY_LIMITS.commits&&!result.commits.some(c=>c.sha===next))throw new Stop("HISTORY_COMMIT_WINDOW_CAP",429);const selected=next;const received=await request(`/repos/${plan.anchor.repoKey}/git/commits/${selected}`),body=received.body;
    if(!object(body)||body.sha!==selected||!object(body.tree)||!sha(body.tree.sha)||body.parents!==undefined&&body.parents!==null&&(!Array.isArray(body.parents)||body.parents.length>TOPOLOGY_LIMITS.parents||!body.parents.every((p:any)=>object(p)&&sha(p.sha)))||typeof body.message!=="string")throw new Stop("HISTORY_COMMIT_INVALID",502);
    const author=body.author?.date??null,committer=body.committer?.date??null;
    const parsed=validateImmutableCommit({schemaVersion:1,repoKey:plan.anchor.repoKey,sha:selected,treeSha:body.tree.sha,parents:body.parents==null?null:body.parents.map((p:any)=>p.sha),authorAt:author,committerAt:committer,message:body.message,provenance:[{sourceUrl:received.url,fetchedAt:received.fetchedAt}]});if(!parsed.ok)throw new Stop(parsed.code.includes("cap")?"HISTORY_COMMIT_RECORD_CAP":"HISTORY_COMMIT_INVALID",502);
    const candidate=firstParentSpine(plan.anchor,[...result.commits,parsed.value]);if(!candidate.ok)throw new Stop("HISTORY_IMMUTABLE_COMMIT_CONFLICT",502);const fresh=!result.commits.some(c=>c.sha===selected);result.commits=[...candidate.value.commits];result.coverage.commitSteps++;if(fresh)result.coverage.newCommits++;const spine=update();next=spine.nextParentSha;if(spine.termination==="parents-unobserved")throw new Stop("HISTORY_PARENTS_UNOBSERVED",502);
   }
   for(const selected of plan.frameShas){stage="tree";if(result.frames.length>=this.limits.frames)throw new Stop("HISTORY_FRAME_CAP",429);const commit=result.commits.find(c=>c.sha===selected);if(!commit)throw new Stop("HISTORY_FRAME_NOT_VERIFIED",409);const received=await request(`/repos/${plan.anchor.repoKey}/git/trees/${commit.treeSha}?recursive=1`),body=received.body;if(!object(body)||body.sha!==commit.treeSha||!Array.isArray(body.tree))throw new Stop("HISTORY_TREE_IDENTITY_INVALID",502);
    const entries:{path:string;type:string;sha:string}[]=[];let rejected=0;const inspected=Math.min(body.tree.length,TOPOLOGY_LIMITS.frameEntries);
    for(let i=0;i<inspected;i++){const e=body.tree[i];let type:string|null=null;if(object(e)){if(e.type==="tree"&&e.mode==="040000")type="tree";else if(e.type==="blob"&&["100644","100755"].includes(e.mode))type="blob";else if(e.type==="blob"&&e.mode==="120000")type="symlink";else if(e.type==="commit"&&e.mode==="160000")type="submodule";}if(!type||!topologyPath(e?.path)||!sha(e?.sha)){rejected++;continue;}entries.push({path:e.path,type,sha:e.sha});}
    const partial=body.truncated!==false||rejected>0||body.tree.length>inspected;const parsed=validateImmutableTreeFrame({schemaVersion:1,repoKey:plan.anchor.repoKey,commitSha:selected,treeSha:commit.treeSha,scope:{prefix:"",recursive:true},completeness:partial?"partial":"full",sourceOmittedEntries:partial?null:0,entries,provenance:[{sourceUrl:received.url,fetchedAt:received.fetchedAt}]},commit);if(!parsed.ok)throw new Stop("HISTORY_TREE_INVALID",502);
    const window=createTopologyWindow(plan.anchor,result.commits,[...result.frames,parsed.value]);if(!window.ok)throw new Stop("HISTORY_IMMUTABLE_TREE_CONFLICT",502);if(topologyBytes({commits:result.commits,frames:window.value.frames})>TOPOLOGY_LIMITS.workingBytes)throw new Stop("HISTORY_WORKING_SET_CAP",502);result.frames=[...window.value.frames];result.coverage.trees.push({commitSha:selected,sourceTruncated:typeof body.truncated==="boolean"?body.truncated:null,rawEntries:body.tree.length,rejectedEntries:rejected,uninspectedEntries:body.tree.length-inspected});if(rejected||typeof body.truncated!=="boolean")throw new Stop("HISTORY_TREE_PARTIAL_INVALID",502);if(body.tree.length>inspected)throw new Stop("HISTORY_TREE_ENTRY_CAP",502);if(parsed.value.limits.length)throw new Stop("HISTORY_TREE_FRAME_CAP",502);
   }
   const spine=update();result.coverage.stopReason=spine.reachedRoot?"OBSERVED_ROOT":plan.action==="frames"?"REQUESTED_FRAMES_LOADED":"STEP_CAP";result.outcome=spine.reachedRoot&&result.frames.every(f=>f.completeness==="full")?"ok":"partial";
  }catch(e){const info=errorInfo(e,stage);result.coverage.errors.push(info);result.coverage.stopReason=info.code;result.outcome=result.commits.length||result.frames.length||result.publicRepository?"partial":"rejected";}
  finally{finished=true;clearTimeout(actionTimer);action.abort(new Stop("HISTORY_ACTION_FINISHED",499));release();}
  if(result.coverage.nextParentSha)result.nextCursor={repoKey:plan.anchor.repoKey,anchorSha:plan.anchor.sha,generation:plan.anchor.generation,nextParentSha:result.coverage.nextParentSha,needsServerBinding:true};
  return result;
 }
}
