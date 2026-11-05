import { codePointCompare } from "../evidence/contracts";
import { TOPOLOGY_LIMITS as L, type TopologyResult, type TopologyProvenance, type ImmutableCommit, type ImmutableTreeFrame, type ImmutableTreeEntry, type TreeScope, type TopologyAnchor, type FirstParentSpine, type EndpointComparison, type HistoricScene, type TopologyWindow, type TopologyCursor } from "./topology-contracts";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function onlyKeys(value:Record<string,unknown>,keys:readonly string[]){for(const key in value)if(Object.hasOwn(value,key)&&!keys.includes(key))return false;return true;}
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !/[\uD800-\uDFFF]/u.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const topologyBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const ok = <T>(value: T): TopologyResult<T> => ({ ok: true, value });
const fail = <T = never>(code: string): TopologyResult<T> => ({ ok: false, code });
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const repoKey = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9_.-]{1,100}$/.test(v) && ![".", ".."].includes(v.split("/")[1]);
export function topologyPath(v: unknown): v is string { return text(v, 512) && v.length > 0 && topologyBytes(v) <= 514 && !/[\\\u0000-\u001f\u007f]/.test(v) && !/%(?:2e|2f|5c)/i.test(v) && v.split("/").every(p => p !== "" && p !== "." && p !== ".."); }
function scope(input: unknown): TopologyResult<TreeScope> { return record(input) && onlyKeys(input,["prefix","recursive"]) && (input.prefix === "" || topologyPath(input.prefix)) && input.recursive === true ? ok(freeze({ prefix: input.prefix as string, recursive: true })) : fail("invalid-scope"); }
export const topologyScopeKey = (s: TreeScope) => JSON.stringify([s.prefix, s.recursive]);
/** Preserve original event times, including invalid/unknown values. No clock or
 * fetchedAt is ever substituted for author/committer metadata. */
function recordedInstant(v: string): boolean {
  const m=v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/);
  if(!m||m[7]==="-00:00")return false;const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  return month>=1&&month<=12&&day>=1&&day<=days[month-1]&&hour<=23&&minute<=59&&second<=59&&(!m[8]||Number(m[9])<=14&&Number(m[10])<=59&&(Number(m[9])!==14||Number(m[10])===0))&&Number.isFinite(Date.parse(v));
}
const eventTime = (v: unknown): v is string | null => v === null || text(v, 128);
function provenance(input: unknown, allowed: readonly string[]): TopologyResult<readonly TopologyProvenance[]> {
  if (!Array.isArray(input) || !input.length || input.length > L.provenance) return fail("invalid-provenance");
  const result: TopologyProvenance[] = [];
  for (const p of input) {
    if (!record(p) || !onlyKeys(p,["sourceUrl","fetchedAt"]) || typeof p.sourceUrl !== "string" || !allowed.includes(p.sourceUrl) || !text(p.fetchedAt, 64) || !recordedInstant(p.fetchedAt)) return fail("invalid-provenance");
    if (!result.some(r => r.sourceUrl === p.sourceUrl && r.fetchedAt === p.fetchedAt)) result.push({ sourceUrl: p.sourceUrl, fetchedAt: p.fetchedAt });
  }
  result.sort((a, b) => codePointCompare(a.sourceUrl, b.sourceUrl) || codePointCompare(a.fetchedAt, b.fetchedAt));
  return ok(freeze(result));
}
export function validateImmutableCommit(input: unknown): TopologyResult<ImmutableCommit> {
  if (!record(input) || !onlyKeys(input,["schemaVersion","repoKey","sha","treeSha","parents","authorAt","committerAt","message","provenance","omittedProvenance"]) || input.schemaVersion !== 1 || !repoKey(input.repoKey) || !sha(input.sha) || !sha(input.treeSha)) return fail("invalid-commit-identity");
  if (!(input.parents === null || Array.isArray(input.parents) && input.parents.length <= L.parents && input.parents.every(sha) && new Set(input.parents).size === input.parents.length && !input.parents.includes(input.sha)) || !eventTime(input.authorAt) || !eventTime(input.committerAt) || !text(input.message, 512)) return fail("invalid-commit-payload");
  const p = provenance(input.provenance, [`https://github.com/${input.repoKey}/commit/${input.sha}`, `https://api.github.com/repos/${input.repoKey}/commits/${input.sha}`, `https://api.github.com/repos/${input.repoKey}/git/commits/${input.sha}`]);
  if (!p.ok) return p;
  const omitted = input.omittedProvenance === undefined ? 0 : input.omittedProvenance; if (!(omitted === null || integer(omitted))) return fail("invalid-provenance");
  const value: ImmutableCommit = { schemaVersion: 1, repoKey: input.repoKey, sha: input.sha, treeSha: input.treeSha, parents: input.parents === null ? null : [...input.parents as string[]], authorAt: input.authorAt, committerAt: input.committerAt, message: input.message, provenance: p.value, omittedProvenance: omitted };
  return topologyBytes(value) <= L.commitBytes ? ok(freeze(value)) : fail("commit-byte-cap");
}
export const immutableCommitPayloadKey = (c: ImmutableCommit) => JSON.stringify([c.repoKey, c.sha, c.treeSha, c.parents, c.authorAt, c.committerAt, c.message]);
function mergedProvenance(a: {provenance: readonly TopologyProvenance[]; omittedProvenance: number | null}, b: {provenance: readonly TopologyProvenance[]; omittedProvenance: number | null}) {
  const all = [...a.provenance, ...b.provenance].filter((p,i,arr) => arr.findIndex(q => q.sourceUrl === p.sourceUrl && q.fetchedAt === p.fetchedAt) === i).sort((p,q) => codePointCompare(p.sourceUrl,q.sourceUrl) || codePointCompare(p.fetchedAt,q.fetchedAt));
  return { provenance: all.slice(0,L.provenance), omittedProvenance: a.omittedProvenance!==0||b.omittedProvenance!==0?null:Math.max(0,all.length-L.provenance) };
}
export function coalesceImmutableCommit(a: ImmutableCommit, b: ImmutableCommit): TopologyResult<ImmutableCommit> {
  const left=validateImmutableCommit(a),right=validateImmutableCommit(b);if(!left.ok||!right.ok)return fail("invalid-commit");
  if(left.value.repoKey!==right.value.repoKey||left.value.sha!==right.value.sha)return fail("commit-identity-mismatch");
  const x=left.value,y=right.value;
  if(x.treeSha!==y.treeSha||x.message!==y.message||x.parents!==null&&y.parents!==null&&JSON.stringify(x.parents)!==JSON.stringify(y.parents)||x.authorAt!==null&&y.authorAt!==null&&x.authorAt!==y.authorAt||x.committerAt!==null&&y.committerAt!==null&&x.committerAt!==y.committerAt)return fail("immutable-commit-conflict");
  const value={...x,parents:x.parents??y.parents,authorAt:x.authorAt??y.authorAt,committerAt:x.committerAt??y.committerAt,...mergedProvenance(x,y)};
  while(topologyBytes(value)>L.commitBytes&&value.provenance.length>1){value.provenance.pop();if(value.omittedProvenance!==null)value.omittedProvenance++;}
  return topologyBytes(value)<=L.commitBytes?ok(freeze(value)):fail("commit-byte-cap");
}
export function validateTopologyAnchor(input: unknown): TopologyResult<TopologyAnchor> { return record(input) && onlyKeys(input,["repoKey","sha","generation"]) && repoKey(input.repoKey) && sha(input.sha) && text(input.generation,128) && /^[a-zA-Z0-9_-]{1,128}$/.test(input.generation) ? ok(freeze({repoKey:input.repoKey,sha:input.sha,generation:input.generation})) : fail("invalid-anchor"); }
export function firstParentSpine(anchorInput: unknown, inputs: unknown): TopologyResult<FirstParentSpine> {
  const a=validateTopologyAnchor(anchorInput);if(!a.ok)return a;
  if(!Array.isArray(inputs)||inputs.length>L.commits)return fail("commit-window-cap");
  const index=new Map<string,ImmutableCommit>();
  for(const input of inputs){const parsed=validateImmutableCommit(input);if(!parsed.ok)return parsed;if(parsed.value.repoKey!==a.value.repoKey)return fail("repo-mismatch");const old=index.get(parsed.value.sha);const next=old?coalesceImmutableCommit(old,parsed.value):parsed;if(!next.ok)return next;index.set(parsed.value.sha,next.value);}
  const commits:ImmutableCommit[]=[],seen=new Set<string>();let next:string|null=a.value.sha,termination:FirstParentSpine["termination"]="missing-anchor";
  while(next){if(seen.has(next))return fail("parent-cycle");if(commits.length>=L.commits){termination="window-cap";break;}const c=index.get(next);if(!c){termination=commits.length?"missing-parent":"missing-anchor";break;}seen.add(next);commits.push(c);if(c.parents===null){termination="parents-unobserved";next=null;break;}if(c.parents.length===0){termination="observed-root";next=null;break;}next=c.parents[0];}
  return ok(freeze({anchor:a.value,commits,termination,nextParentSha:next,reachedRoot:termination==="observed-root"?true:null,nonSpineShas:[...index.keys()].filter(s=>!seen.has(s)).sort(codePointCompare),nonSpineRelationship:"unknown"}));
}
function treeEntry(input: unknown): TopologyResult<ImmutableTreeEntry> { return record(input) && onlyKeys(input,["path","type","sha"]) && topologyPath(input.path) && ["blob","tree","symlink","submodule"].includes(input.type as string) && sha(input.sha) ? ok({path:input.path,type:input.type as ImmutableTreeEntry["type"],sha:input.sha}) : fail("invalid-tree-entry"); }
export const topologyFrameKey = (f: ImmutableTreeFrame) => JSON.stringify([f.repoKey,f.commitSha,f.treeSha,topologyScopeKey(f.scope)]);
export function validateImmutableTreeFrame(input: unknown, commitInput: unknown): TopologyResult<ImmutableTreeFrame> {
  const c=validateImmutableCommit(commitInput);if(!c.ok)return c;
  if(!record(input)||!onlyKeys(input,["schemaVersion","repoKey","commitSha","treeSha","scope","completeness","sourceCompleteness","sourceOmittedEntries","entries","inputEntryCount","omittedInputEntries","deduplicatedInputEntries","limits","provenance","omittedProvenance"])||input.schemaVersion!==1||input.repoKey!==c.value.repoKey||input.commitSha!==c.value.sha||input.treeSha!==c.value.treeSha)return fail("frame-commit-binding-mismatch");
  const s=scope(input.scope);if(!s.ok)return s;
  if(!["full","partial"].includes(input.completeness as string)||!(input.sourceOmittedEntries===null||integer(input.sourceOmittedEntries))||input.completeness==="full"&&input.sourceOmittedEntries!==0||!Array.isArray(input.entries))return fail("invalid-frame-coverage");
  const p=provenance(input.provenance,[`https://github.com/${input.repoKey}/tree/${input.commitSha}`,`https://api.github.com/repos/${input.repoKey}/git/trees/${input.treeSha}?recursive=1`]);if(!p.ok)return p;
  const omittedProvenance=input.omittedProvenance===undefined?0:input.omittedProvenance;if(!(omittedProvenance===null||integer(omittedProvenance)))return fail("invalid-provenance");
  const normalized="sourceCompleteness" in input;
  if(!normalized&&["inputEntryCount","omittedInputEntries","deduplicatedInputEntries","limits"].some(k=>Object.hasOwn(input,k)))return fail("invalid-normalized-frame");
  if(normalized&&(!["full","partial"].includes(input.sourceCompleteness as string)||!integer(input.inputEntryCount)||!integer(input.omittedInputEntries)||!integer(input.deduplicatedInputEntries)||input.inputEntryCount!==input.entries.length+input.omittedInputEntries+input.deduplicatedInputEntries||!Array.isArray(input.limits)||input.limits.length>2||new Set(input.limits).size!==input.limits.length||input.limits.some(v=>v!=="entry-cap"&&v!=="byte-cap")||!(input.omittedProvenance===null||integer(input.omittedProvenance))||input.entries.length>L.frameEntries))return fail("invalid-normalized-frame");
  if(normalized&&(input.completeness==="full"&&(input.sourceCompleteness!=="full"||input.omittedInputEntries!==0||(input.limits as unknown[]).length!==0)||input.sourceCompleteness==="full"&&input.sourceOmittedEntries!==0||(input.omittedInputEntries as number)>0&&(input.limits as unknown[]).length===0))return fail("invalid-normalized-frame");
  const entries:ImmutableTreeEntry[]=[],byPath=new Map<string,ImmutableTreeEntry>(),limits:("entry-cap"|"byte-cap")[]=[];let processed=0,duplicate=0;
  const value:ImmutableTreeFrame={schemaVersion:1,repoKey:c.value.repoKey,commitSha:c.value.sha,treeSha:c.value.treeSha,scope:s.value,completeness:input.completeness as "full"|"partial",sourceCompleteness:input.completeness as "full"|"partial",sourceOmittedEntries:input.sourceOmittedEntries,entries,inputEntryCount:input.entries.length,omittedInputEntries:0,deduplicatedInputEntries:0,limits,provenance:p.value,omittedProvenance};
  let used=topologyBytes(value)+256;
  for(let i=0;i<input.entries.length&&i<L.frameEntries;i++){
    const parsed=treeEntry(input.entries[i]);if(!parsed.ok)return parsed;const e=parsed.value;
    if(s.value.prefix&&e.path!==s.value.prefix&&!e.path.startsWith(s.value.prefix+"/"))return fail("path-outside-scope");
    const old=byPath.get(e.path);if(old){if(old.type!==e.type||old.sha!==e.sha)return fail("conflicting-tree-path");duplicate++;processed++;continue;}
    const size=topologyBytes(e)+1;if(!normalized&&used+size>L.frameBytes){limits.push("byte-cap");break;}
    entries.push(e);byPath.set(e.path,e);used+=size;processed++;
  }
  if(processed<L.frameEntries&&processed<input.entries.length&&!limits.length)limits.push("byte-cap");
  if(processed>=L.frameEntries&&processed<input.entries.length)limits.push("entry-cap");
  entries.sort((a,b)=>codePointCompare(a.path,b.path));
  for(const e of entries){const parts=e.path.split("/");for(let i=1;i<parts.length;i++){const parent=byPath.get(parts.slice(0,i).join("/"));if(parent&&parent.type!=="tree")return fail("non-directory-parent");}}
  const final:ImmutableTreeFrame=normalized?{...value,sourceCompleteness:input.sourceCompleteness as "full"|"partial",inputEntryCount:input.inputEntryCount as number,omittedInputEntries:input.omittedInputEntries as number,deduplicatedInputEntries:input.deduplicatedInputEntries as number,limits:[...input.limits as ("entry-cap"|"byte-cap")[]],omittedProvenance:input.omittedProvenance as number|null}:{...value,completeness:limits.length?"partial" as const:value.completeness,omittedInputEntries:input.entries.length-processed,deduplicatedInputEntries:duplicate};
  return topologyBytes(final)<=L.frameBytes?ok(freeze(final)):fail("frame-byte-cap");
}

export const immutableFramePayloadKey = (f: ImmutableTreeFrame) => JSON.stringify([topologyFrameKey(f),f.completeness,f.entries.map(e=>[e.path,e.type,e.sha])]);
function withinScope(scope:TreeScope,path:string){return !scope.prefix||path===scope.prefix||path.startsWith(scope.prefix+"/");}
function conflictingTreeObservations(a:ImmutableTreeFrame,b:ImmutableTreeFrame){
 const left=new Map(a.entries.map(e=>[e.path,e])),right=new Map(b.entries.map(e=>[e.path,e]));
 return a.entries.some(e=>{const other=right.get(e.path);return other&&(other.type!==e.type||other.sha!==e.sha)||!other&&b.completeness==="full"&&withinScope(b.scope,e.path);})||b.entries.some(e=>!left.has(e.path)&&a.completeness==="full"&&withinScope(a.scope,e.path));
}
export function coalesceImmutableFrame(a: ImmutableTreeFrame,b: ImmutableTreeFrame,commit:ImmutableCommit):TopologyResult<ImmutableTreeFrame>{
 const left=validateImmutableTreeFrame(a,commit),right=validateImmutableTreeFrame(b,commit);if(!left.ok||!right.ok)return fail("invalid-frame");
 if(topologyFrameKey(left.value)!==topologyFrameKey(right.value))return fail("frame-identity-mismatch");
 if(conflictingTreeObservations(left.value,right.value))return fail("immutable-frame-conflict");
 if(left.value.completeness==="partial"&&right.value.completeness==="partial"&&immutableFramePayloadKey(left.value)!==immutableFramePayloadKey(right.value))return fail("partial-observations-unresolved");
 const base=left.value.completeness==="full"?left.value:right.value;
 const value={...base,...mergedProvenance(left.value,right.value)};
 while(topologyBytes(value)>L.frameBytes&&value.provenance.length>1){value.provenance.pop();if(value.omittedProvenance!==null)value.omittedProvenance++;}
 return topologyBytes(value)<=L.frameBytes?ok(freeze(value)):fail("frame-byte-cap");
}
/** Exact here always means endpoint differences, not unseen intermediate work.
 * A directory tree-hash change counts as an entry, never a modified file. */
export function compareTopologyFrames(beforeInput:unknown,afterInput:unknown,beforeCommitInput:unknown,afterCommitInput:unknown):TopologyResult<EndpointComparison>{
 const a=validateImmutableTreeFrame(beforeInput,beforeCommitInput),b=validateImmutableTreeFrame(afterInput,afterCommitInput),c=validateImmutableCommit(afterCommitInput),beforeC=validateImmutableCommit(beforeCommitInput);
 if(!a.ok)return a;if(!b.ok)return b;if(!c.ok)return c;if(!beforeC.ok)return beforeC;if(a.value.repoKey!==b.value.repoKey)return fail("repo-mismatch");
 if(beforeC.value.sha===c.value.sha){const joined=coalesceImmutableCommit(beforeC.value,c.value);if(!joined.ok)return joined;}
 if(a.value.treeSha===b.value.treeSha&&conflictingTreeObservations(a.value,b.value))return fail("immutable-tree-conflict");
 const before=a.value,after=b.value,same=topologyScopeKey(before.scope)===topologyScopeKey(after.scope),exact=same&&before.completeness==="full"&&after.completeness==="full";
 const old=new Map(before.entries.map(e=>[e.path,e])),next=new Map(after.entries.map(e=>[e.path,e]));
 const beforeOnly=same?before.entries.filter(e=>!next.has(e.path)):[],afterOnly=same?after.entries.filter(e=>!old.has(e.path)):[];
 const modified=same?before.entries.flatMap(e=>{const n=next.get(e.path);return n&&(n.sha!==e.sha||n.type!==e.type)?[{path:e.path,before:e,after:n}]:[];}):[];
 const comparison:EndpointComparison={beforeKey:topologyFrameKey(before),afterKey:topologyFrameKey(after),continuity:after.commitSha!==before.commitSha&&c.value.parents?.[0]===before.commitSha?"adjacent-first-parent":"endpoint-gap",scopeComparable:same,exactEndpoints:exact,added:exact?afterOnly:[],removed:exact?beforeOnly:[],modified,beforeOnlyObserved:exact?[]:beforeOnly,afterOnlyObserved:exact?[]:afterOnly,absence:exact?"established-at-complete-endpoints":"unknown",modifiedEntries:same?modified.length:null,changedDirectoryHashes:same?modified.filter(e=>e.before.type==="tree"&&e.after.type==="tree"&&e.before.sha!==e.after.sha).length:null,renameEvidence:"unavailable",intermediateSteps:"not-reconstructed"};
 return topologyBytes({before,after,comparison})<=L.workingBytes?ok(freeze(comparison)):fail("comparison-working-set-byte-cap");
}
export function projectHistoricScene(frameInput:unknown,commitInput:unknown):TopologyResult<HistoricScene>{
 const f=validateImmutableTreeFrame(frameInput,commitInput);if(!f.ok)return f;const frame=f.value;
 const chosen=[...frame.entries].sort((a,b)=>(a.type==="tree"?0:1)-(b.type==="tree"?0:1)||codePointCompare(a.path,b.path)).slice(0,L.sceneNodes);
 const id=(path:string)=>"path:"+encodeURIComponent(path),nodes=chosen.map(e=>({id:id(e.path),path:e.path,label:e.path.split("/").at(-1)!,type:e.type,role:e.type==="tree"?"Directory role inferred from captured path":"Role inferred from captured entry type",roleConfidence:"inferred" as const,status:"unknown" as const,sourceUrl:`https://github.com/${frame.repoKey}/${e.type==="blob"||e.type==="symlink"?"blob":"tree"}/${frame.commitSha}/${e.path.split("/").map(encodeURIComponent).join("/")}`}));
 const dirs=new Set(chosen.filter(e=>e.type==="tree").map(e=>e.path)),edges=chosen.flatMap(e=>{const at=e.path.lastIndexOf("/"),parent=at<0?"":e.path.slice(0,at);return dirs.has(parent)?[{id:JSON.stringify([id(parent),id(e.path)]),source:id(parent),target:id(e.path),claim:"captured-path-containment" as const}]:[];}).slice(0,L.sceneEdges);
 return ok(freeze({frameKey:topologyFrameKey(frame),repoKey:frame.repoKey,commitSha:frame.commitSha,treeSha:frame.treeSha,nodes,edges,observedEntries:frame.entries.length,omittedObservedEntries:frame.entries.length-nodes.length,partial:frame.completeness==="partial"||nodes.length<frame.entries.length,sourceOmittedEntries:frame.sourceOmittedEntries,omittedInputEntries:frame.omittedInputEntries}));
}
/** No eviction or implicit loading: callers retain at most two decoded frames.
 * This limit includes the normalized spine/provenance payload in the working set. */
export function createTopologyWindow(anchorInput:unknown,commitInputs:unknown,frameInputs:unknown):TopologyResult<TopologyWindow>{
 const spine=firstParentSpine(anchorInput,commitInputs);if(!spine.ok)return spine;
 if(!Array.isArray(frameInputs)||frameInputs.length>L.decodedFrames)return fail("decoded-frame-cap");
 const frames:ImmutableTreeFrame[]=[];
 for(const input of frameInputs){if(!record(input))return fail("invalid-frame");const commit=spine.value.commits.find(c=>c.sha===input.commitSha);if(!commit)return fail("frame-membership-unknown");const parsed=validateImmutableTreeFrame(input,commit);if(!parsed.ok)return parsed;const prior=frames.findIndex(f=>topologyFrameKey(f)===topologyFrameKey(parsed.value));if(prior<0)frames.push(parsed.value);else{const joined=coalesceImmutableFrame(frames[prior],parsed.value,commit);if(!joined.ok)return joined;frames[prior]=joined.value;}}
 if(frames.length===2&&frames[0].treeSha===frames[1].treeSha&&conflictingTreeObservations(frames[0],frames[1]))return fail("immutable-tree-conflict");
 frames.sort((a,b)=>codePointCompare(topologyFrameKey(a),topologyFrameKey(b)));const value={anchor:spine.value.anchor,spine:spine.value,frames};return topologyBytes(value)<=L.workingBytes?ok(freeze(value)):fail("working-set-byte-cap");
}
export function selectTopologyFrame(window:TopologyWindow,cursor:unknown):TopologyResult<ImmutableTreeFrame>{
 if(!record(cursor)||!onlyKeys(cursor,["repoKey","anchorSha","generation","frameKey"])||cursor.repoKey!==window.anchor.repoKey||cursor.anchorSha!==window.anchor.sha||cursor.generation!==window.anchor.generation)return fail("stale-anchor-generation");
 if(typeof cursor.frameKey!=="string"||cursor.frameKey.length>2048)return fail("invalid-frame-cursor");const frame=window.frames.find(f=>topologyFrameKey(f)===cursor.frameKey);return frame?ok(frame):fail("frame-unavailable");
}
export function planTopologyTransition(window:TopologyWindow,current:TopologyCursor,target:TopologyCursor):TopologyResult<{kind:"apply-exact-delta"|"checkpoint-gap";comparison:EndpointComparison;target:ImmutableTreeFrame}>{
 const a=selectTopologyFrame(window,current),b=selectTopologyFrame(window,target);if(!a.ok)return a;if(!b.ok)return b;const before=window.spine.commits.find(c=>c.sha===a.value.commitSha),after=window.spine.commits.find(c=>c.sha===b.value.commitSha);if(!before||!after)return fail("frame-membership-unknown");const comparison=compareTopologyFrames(a.value,b.value,before,after);if(!comparison.ok)return comparison;
 if(topologyBytes({window,comparison:comparison.value})>L.workingBytes)return fail("transition-working-set-byte-cap");
 return ok(freeze({kind:comparison.value.continuity==="adjacent-first-parent"&&comparison.value.exactEndpoints?"apply-exact-delta":"checkpoint-gap",comparison:comparison.value,target:b.value}));
}
