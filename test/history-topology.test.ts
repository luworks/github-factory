import {expect,test} from "bun:test";
import {TOPOLOGY_LIMITS as L,type ImmutableCommit,type ImmutableTreeFrame,type TopologyResult} from "../src/history/topology-contracts";
import {validateImmutableCommit,coalesceImmutableCommit,immutableCommitPayloadKey,validateTopologyAnchor,firstParentSpine,validateImmutableTreeFrame,coalesceImmutableFrame,topologyBytes,topologyFrameKey,compareTopologyFrames,projectHistoricScene,createTopologyWindow,selectTopologyFrame,planTopologyTransition,topologyPath} from "../src/history/topology";
const repo="synthetic-topology/core",sha=(n:number)=>n.toString(16).padStart(40,"0");
const unwrap=<T>(result:TopologyResult<T>):T=>{if(!result.ok)throw Error(result.code);return result.value;};
const commit=(n:number,parents:number[]|null=[])=>({schemaVersion:1,repoKey:repo,sha:sha(n),treeSha:sha(n+1000),parents:parents?.map(sha)??null,authorAt:"2025-07-01T00:00:00Z" as string|null,committerAt:"2025-07-02T00:00:00Z" as string|null,message:`SYNTHETIC immutable commit ${n}`,provenance:[{sourceUrl:`https://github.com/${repo}/commit/${sha(n)}`,fetchedAt:"2025-08-01T00:00:00Z"}]});
const entry=(path:string,type="blob",n=700)=>({path,type,sha:sha(n)});
const frame=(c:ReturnType<typeof commit>,entries:ReturnType<typeof entry>[],completeness="full",prefix="")=>({schemaVersion:1,repoKey:repo,commitSha:c.sha,treeSha:c.treeSha,scope:{prefix,recursive:true},completeness,sourceOmittedEntries:completeness==="full"?0:null,entries,provenance:[{sourceUrl:`https://api.github.com/repos/${repo}/git/trees/${c.treeSha}?recursive=1`,fetchedAt:"2025-08-01T00:00:00Z"}]});
const anchor=(n:number,generation="SYNTHETIC_anchor_1")=>({repoKey:repo,sha:sha(n),generation});
const cursor=(a:ReturnType<typeof anchor>,f:ImmutableTreeFrame)=>({repoKey:repo,anchorSha:a.sha,generation:a.generation,frameKey:topologyFrameKey(f)});

test("SYNTHETIC immutable commit validates identity/provenance, preserves unknown/raw clocks and freezes only its own copy",()=>{
 const raw=commit(1,[2]);raw.authorAt="clock unknown";raw.committerAt=null;const before=JSON.stringify(raw),c=unwrap(validateImmutableCommit(raw));expect(c.authorAt).toBe("clock unknown");expect(c.committerAt).toBeNull();expect(c.parents).toEqual([sha(2)]);expect(JSON.stringify(raw)).toBe(before);expect(Object.isFrozen(raw.parents)).toBe(false);expect(Object.isFrozen(c.parents)).toBe(true);raw.parents!.push(sha(3));expect(c.parents).toEqual([sha(2)]);
 for(const patch of [{sha:"main"},{treeSha:"HEAD"},{parents:undefined},{parents:["short"]},{repoKey:"other/../repo"},{sha:"A".repeat(40)},{provenance:[{sourceUrl:"https://evil.test/commit",fetchedAt:"2025-08-01T00:00:00Z"}]},{provenance:[{...raw.provenance[0],fetchedAt:"2025-02-30T00:00:00Z"}]},{provenance:[{...raw.provenance[0],fetchedAt:"2025-01-01T00:00:00-00:00"}]}])expect(validateImmutableCommit({...commit(1),...patch}).ok).toBe(false);
 for(const bad of [null,[],{},4,{...commit(1),parents:[sha(1),sha(1)]}])expect(validateImmutableCommit(bad).ok).toBe(false);
 expect(validateTopologyAnchor({...anchor(1),sha:"main"}).ok).toBe(false);expect(validateTopologyAnchor({...anchor(1),generation:""}).ok).toBe(false);
});

test("SYNTHETIC repeated fetchedAt provenance coalesces while immutable SHA payload conflicts fail closed",()=>{
 const a=unwrap(validateImmutableCommit(commit(1))),raw=commit(1);raw.provenance[0].fetchedAt="2025-08-02T00:00:00Z";const b=unwrap(validateImmutableCommit(raw)),joined=unwrap(coalesceImmutableCommit(a,b));expect(joined.provenance).toHaveLength(2);expect(immutableCommitPayloadKey(joined)).toBe(immutableCommitPayloadKey(a));expect(coalesceImmutableCommit(a,unwrap(validateImmutableCommit({...commit(1),treeSha:sha(999)})))).toMatchObject({ok:false,code:"immutable-commit-conflict"});
 const first=unwrap(firstParentSpine(anchor(1),[a,b])),second=unwrap(firstParentSpine(anchor(1),[b,a]));expect(first).toEqual(second);expect(first.commits).toHaveLength(1);expect(first.reachedRoot).toBe(true);
 expect(firstParentSpine(anchor(1),[a,{...b,message:"conflicting payload"}])).toMatchObject({ok:false,code:"immutable-commit-conflict"});
});

test("SYNTHETIC first-parent spine ignores author order and second-parent branches; missing ancestry stays unknown",()=>{
 const root=commit(1),middle=commit(2,[1]),side=commit(4,[1]),head=commit(3,[2,4]);root.authorAt="2025-07-10T00:00:00Z";head.authorAt="2025-07-01T00:00:00Z";side.authorAt="2025-07-05T00:00:00Z";
 const s=unwrap(firstParentSpine(anchor(3),[side,root,head,middle]));expect(s.commits.map(c=>c.sha)).toEqual([sha(3),sha(2),sha(1)]);expect(s.nonSpineShas).toEqual([sha(4)]);expect(s.nonSpineRelationship).toBe("unknown");expect(s.termination).toBe("observed-root");
 const gap=unwrap(firstParentSpine(anchor(3),[head,root,side]));expect(gap.termination).toBe("missing-parent");expect(gap.nextParentSha).toBe(sha(2));expect(gap.reachedRoot).toBeNull();expect(unwrap(firstParentSpine(anchor(9),[root])).termination).toBe("missing-anchor");expect(unwrap(firstParentSpine(anchor(1),[commit(1,null)])).termination).toBe("parents-unobserved");expect(firstParentSpine(anchor(1),[commit(1,[2]),commit(2,[1])])).toMatchObject({ok:false,code:"parent-cycle"});
});

test("SYNTHETIC frame binding rejects branch/head substitution, malformed entry/path/type/scope and inconsistent coverage",()=>{
 const c=commit(1),f=frame(c,[entry("src","tree"),entry("src/原始🚀.ts")]);expect(unwrap(validateImmutableTreeFrame(f,c)).entries[1].path).toBe("src/原始🚀.ts");expect(validateImmutableTreeFrame({...f,commitSha:sha(2)},c).ok).toBe(false);expect(validateImmutableTreeFrame({...f,treeSha:"main"},c).ok).toBe(false);expect(validateImmutableTreeFrame({...f,sourceOmittedEntries:1},c).ok).toBe(false);
 for(const path of ["", ".", "..", "/src", "a//b", "a/../b", "a\\b", "a/%2e%2e/b", "a\u0000b", "\ud800"]){expect(topologyPath(path)).toBe(false);expect(validateImmutableTreeFrame(frame(c,[entry(path)]),c).ok).toBe(false);}
 for(const bad of [null,{path:"a",type:"commit",sha:sha(4)},{path:"a",type:"blob",sha:"short"}])expect(validateImmutableTreeFrame(frame(c,[bad as any]),c).ok).toBe(false);
 expect(validateImmutableTreeFrame(frame(c,[entry("src","blob"),entry("src/child")]),c)).toMatchObject({ok:false,code:"non-directory-parent"});expect(validateImmutableTreeFrame(frame(c,[entry("src"),entry("src","tree")]),c)).toMatchObject({ok:false,code:"conflicting-tree-path"});expect(validateImmutableTreeFrame(frame(c,[entry("other/file")],"full","src"),c)).toMatchObject({ok:false,code:"path-outside-scope"});
});

test("SYNTHETIC frame canonicalization is nonmutating/idempotent and repeated provenance is independent of immutable body",()=>{
 const c=commit(1),raw=frame(c,[entry("z"),entry("a"),entry("a")]),original=JSON.stringify(raw),a=unwrap(validateImmutableTreeFrame(raw,c));expect(a.entries.map(e=>e.path)).toEqual(["a","z"]);expect(a.deduplicatedInputEntries).toBe(1);expect(unwrap(validateImmutableTreeFrame(a,c))).toEqual(a);expect(JSON.stringify(raw)).toBe(original);expect(Object.isFrozen(raw.entries)).toBe(false);
 const later=JSON.parse(JSON.stringify(a));later.provenance[0].fetchedAt="2025-08-02T00:00:00Z";const merged=unwrap(coalesceImmutableFrame(a,later,unwrap(validateImmutableCommit(c))));expect(merged.provenance).toHaveLength(2);expect(merged.entries).toEqual(a.entries);const conflict=JSON.parse(JSON.stringify(a));conflict.entries[0].sha=sha(999);expect(coalesceImmutableFrame(a,conflict,unwrap(validateImmutableCommit(c)))).toMatchObject({ok:false,code:"immutable-frame-conflict"});
});

test("SYNTHETIC complete comparable endpoints give exact entry deltas, count directory hashes and never infer rename",()=>{
 const a=commit(1),b=commit(2,[1]),before=frame(a,[entry("dir","tree",10),entry("dir/changed","blob",11),entry("old-name","blob",12)]),after=frame(b,[entry("dir","tree",20),entry("dir/changed","blob",21),entry("new-name","blob",12)]),d=unwrap(compareTopologyFrames(before,after,a,b));expect(d.continuity).toBe("adjacent-first-parent");expect(d.exactEndpoints).toBe(true);expect(d.added.map(e=>e.path)).toEqual(["new-name"]);expect(d.removed.map(e=>e.path)).toEqual(["old-name"]);expect(d.modifiedEntries).toBe(2);expect(d.changedDirectoryHashes).toBe(1);expect(d.renameEvidence).toBe("unavailable");expect(d).not.toHaveProperty("modifiedFiles");
});

test("SYNTHETIC partial scopes cannot prove additions/deletions; different scopes do not manufacture a comparison",()=>{
 const a=commit(1),b=commit(2,[1]),partial=frame(a,[entry("a"),entry("same","blob",10)],"partial"),full=frame(b,[entry("b"),entry("same","blob",20)]),d=unwrap(compareTopologyFrames(partial,full,a,b));expect(d.exactEndpoints).toBe(false);expect(d.added).toEqual([]);expect(d.removed).toEqual([]);expect(d.absence).toBe("unknown");expect(d.beforeOnlyObserved.map(e=>e.path)).toEqual(["a"]);expect(d.afterOnlyObserved.map(e=>e.path)).toEqual(["b"]);expect(d.modifiedEntries).toBe(1);
 const different=unwrap(compareTopologyFrames(frame(a,[entry("src/a")],"full","src"),frame(b,[entry("docs/a")],"full","docs"),a,b));expect(different.scopeComparable).toBe(false);expect(different.added).toEqual([]);expect(different.modified).toEqual([]);expect(different.absence).toBe("unknown");expect(different.modifiedEntries).toBeNull();
});

test("SYNTHETIC endpoint gap/backward navigation jumps only to known checkpoints; stale anchor/generation cannot select",()=>{
 const a=commit(1),b=commit(2,[1]),c=commit(3,[2]),f1=unwrap(validateImmutableTreeFrame(frame(a,[entry("a")]),a)),f2=unwrap(validateImmutableTreeFrame(frame(b,[entry("b")]),b)),f3=unwrap(validateImmutableTreeFrame(frame(c,[entry("c")]),c)),window=unwrap(createTopologyWindow(anchor(3),[a,b,c],[f1,f3]));
 const p=unwrap(planTopologyTransition(window,cursor(anchor(3),f1),cursor(anchor(3),f3)));expect(p.kind).toBe("checkpoint-gap");expect(p.comparison.exactEndpoints).toBe(true);expect(p.comparison.intermediateSteps).toBe("not-reconstructed");
 const adjacent=unwrap(createTopologyWindow(anchor(2),[a,b],[f1,f2]));expect(unwrap(planTopologyTransition(adjacent,cursor(anchor(2),f1),cursor(anchor(2),f2))).kind).toBe("apply-exact-delta");expect(unwrap(planTopologyTransition(adjacent,cursor(anchor(2),f2),cursor(anchor(2),f1))).kind).toBe("checkpoint-gap");expect(selectTopologyFrame(adjacent,{...cursor(anchor(2),f1),generation:"old"})).toMatchObject({ok:false,code:"stale-anchor-generation"});expect(selectTopologyFrame(adjacent,{...cursor(anchor(2),f1),anchorSha:sha(999)}).ok).toBe(false);expect(selectTopologyFrame(adjacent,{...cursor(anchor(2),f1),frameKey:"unloaded"})).toMatchObject({ok:false,code:"frame-unavailable"});
 const side=commit(4,[1]);expect(createTopologyWindow(anchor(2),[a,b,side],[frame(side,[entry("side")])])).toMatchObject({ok:false,code:"frame-membership-unknown"});
});

test("SYNTHETIC frames cap by stricter bytes/entries with explicit omissions and validate exact byte boundary",()=>{
 const c=commit(1),raw=frame(c,Array.from({length:9000},(_,i)=>entry(`path-${String(i).padStart(5,"0")}`))),f=unwrap(validateImmutableTreeFrame(raw,c));expect(f.entries.length).toBeLessThanOrEqual(L.frameEntries);expect(topologyBytes(f)).toBeLessThanOrEqual(L.frameBytes);expect(f.completeness).toBe("partial");expect(f.limits).toContain("byte-cap");expect(f.omittedInputEntries).toBe(raw.entries.length-f.entries.length);expect(unwrap(validateImmutableTreeFrame(f,c))).toEqual(f);
 const exact=JSON.parse(JSON.stringify(f)),spare=L.frameBytes-topologyBytes(exact);expect(spare).toBeGreaterThan(0);expect(spare).toBeLessThan(450);exact.entries.at(-1).path+="x".repeat(spare);expect(topologyBytes(exact)).toBe(L.frameBytes);expect(validateImmutableTreeFrame(exact,c).ok).toBe(true);exact.entries.at(-1).path+="x";expect(validateImmutableTreeFrame(exact,c)).toMatchObject({ok:false,code:"frame-byte-cap"});
});

test("SYNTHETIC commit event-byte and parent/provenance/window caps are enforced without silent eviction",()=>{
 const raw=commit(1,[2,3,4]);raw.message="";raw.provenance=Array.from({length:8},(_,i)=>({...raw.provenance[0],fetchedAt:`2025-08-01T00:00:0${i}Z`}));const base=unwrap(validateImmutableCommit(raw)),remaining=L.commitBytes-topologyBytes(base);expect(remaining).toBeGreaterThan(0);expect(remaining).toBeLessThanOrEqual(512);raw.message="x".repeat(remaining);expect(topologyBytes(unwrap(validateImmutableCommit(raw)))).toBe(L.commitBytes);raw.message+="x";expect(validateImmutableCommit(raw)).toMatchObject({ok:false,code:"commit-byte-cap"});
 expect(validateImmutableCommit({...commit(1),parents:Array.from({length:17},(_,i)=>sha(i+2))}).ok).toBe(false);expect(validateImmutableCommit({...commit(1),provenance:Array(9).fill(commit(1).provenance[0])}).ok).toBe(false);expect(firstParentSpine(anchor(1),Array(501).fill(commit(1)))).toMatchObject({ok:false,code:"commit-window-cap"});
 const chain=Array.from({length:500},(_,i)=>commit(i+1,i?[i]:[]));const s=unwrap(firstParentSpine(anchor(500),chain));expect(s.commits).toHaveLength(500);expect(s.reachedRoot).toBe(true);
});

test("SYNTHETIC retained working window has at most two decoded frames and stable deterministic selection",()=>{
 const a=commit(1),b=commit(2,[1]),one=frame(a,[entry("a")]),two=frame(b,[entry("b")]),first=unwrap(createTopologyWindow(anchor(2),[a,b],[one,two])),second=unwrap(createTopologyWindow(anchor(2),[b,a],[two,one]));expect(first).toEqual(second);expect(first.frames).toHaveLength(2);expect(topologyBytes(first)).toBeLessThanOrEqual(L.workingBytes);expect(createTopologyWindow(anchor(2),[a,b],[one,two,one])).toMatchObject({ok:false,code:"decoded-frame-cap"});expect(createTopologyWindow(anchor(9),[a,b],[one])).toMatchObject({ok:false,code:"frame-membership-unknown"});
});

test("SYNTHETIC minimal historic scene has stable path IDs, CJK/links metadata, inferred roles/unknown status and no current work",()=>{
 const c=commit(1),raw=frame(c,[entry("源代码","tree"),entry("源代码/模块🚀.ts"),entry("symlink","symlink"),entry("submodule","submodule")]),before=JSON.stringify(raw),scene=unwrap(projectHistoricScene(raw,c)),reverse=unwrap(projectHistoricScene({...raw,entries:[...raw.entries].reverse()},c));expect(scene).toEqual(reverse);expect(scene.nodes.every(n=>n.roleConfidence==="inferred"&&n.status==="unknown")).toBe(true);expect(scene.nodes.find(n=>n.path.includes("🚀"))?.id).toBe("path:"+encodeURIComponent("源代码/模块🚀.ts"));expect(scene.edges).toHaveLength(1);expect(scene.nodes.every(n=>n.sourceUrl.includes(c.sha))).toBe(true);expect(scene).not.toHaveProperty("issues");expect(scene).not.toHaveProperty("workflows");expect(scene).not.toHaveProperty("blueprint");expect(JSON.stringify(raw)).toBe(before);
 const many=unwrap(projectHistoricScene(frame(c,Array.from({length:45},(_,i)=>entry(`file-${String(i).padStart(2,"0")}`))),c));expect(many.nodes).toHaveLength(30);expect(many.edges.length).toBeLessThanOrEqual(50);expect(many.omittedObservedEntries).toBe(15);expect(many.partial).toBe(true);
});


test("SYNTHETIC immutable root-tree conflicts cannot become endpoint changes across commits or same-SHA payloads",()=>{
 const a=commit(1),b={...commit(2,[1]),treeSha:a.treeSha},one=frame(a,[entry("a")]),two=frame(b,[entry("b")]);expect(compareTopologyFrames(one,two,a,b)).toMatchObject({ok:false,code:"immutable-tree-conflict"});expect(createTopologyWindow(anchor(2),[a,b],[one,two])).toMatchObject({ok:false,code:"immutable-tree-conflict"});const changed={...a,treeSha:sha(999)};expect(compareTopologyFrames(one,frame(changed,[entry("b")]),a,changed)).toMatchObject({ok:false,code:"immutable-commit-conflict"});
 const partial=unwrap(validateImmutableTreeFrame(frame(a,[entry("a")],"partial"),a)),full=unwrap(validateImmutableTreeFrame(frame(a,[entry("a"),entry("b")]),a));expect(unwrap(coalesceImmutableFrame(partial,full,unwrap(validateImmutableCommit(a)))).completeness).toBe("full");const other=unwrap(validateImmutableTreeFrame(frame(a,[entry("b")],"partial"),a));expect(coalesceImmutableFrame(partial,other,unwrap(validateImmutableCommit(a)))).toMatchObject({ok:false,code:"partial-observations-unresolved"});
});


test("SYNTHETIC two-frame derived comparison stays within the serialized working-set cap",()=>{
 const a=commit(1),b=commit(2,[1]),entries=Array.from({length:2000},(_,i)=>entry(`${String(i).padStart(5,"0")}-`+"x".repeat(144),"blob",700)),before=frame(a,entries),after=frame(b,entries.map(e=>({...e,sha:sha(701)})));expect(topologyBytes(unwrap(validateImmutableTreeFrame(before,a)))).toBeLessThanOrEqual(L.frameBytes);expect(topologyBytes(unwrap(validateImmutableTreeFrame(after,b)))).toBeLessThanOrEqual(L.frameBytes);expect(compareTopologyFrames(before,after,a,b)).toMatchObject({ok:false,code:"comparison-working-set-byte-cap"});expect(before.entries[0].sha).toBe(sha(700));expect(after.entries[0].sha).toBe(sha(701));
});


test("SYNTHETIC unsupported scope/entry qualifiers cannot be erased into a full all-path deletion proof",()=>{
 const c=commit(1),f=frame(c,[entry("a")]);expect(validateImmutableTreeFrame({...f,scope:{...f.scope,filter:"blobs-only"}},c).ok).toBe(false);expect(validateImmutableTreeFrame({...f,entries:[{...f.entries[0],mode:"120000"}]},c).ok).toBe(false);expect(validateImmutableCommit({...c,parents:[c.sha]}).ok).toBe(false);expect(validateImmutableCommit({...c,parentsComplete:false}).ok).toBe(false);expect(validateTopologyAnchor({...anchor(1),defaultBranch:"main"}).ok).toBe(false);
 const omitted=unwrap(validateImmutableTreeFrame({...f,omittedProvenance:null},c));expect(omitted.omittedProvenance).toBeNull();
});


test("SYNTHETIC unobserved nullable metadata can be refined without inventing a root or a payload conflict",()=>{
 const unknown=unwrap(validateImmutableCommit({...commit(1,null),authorAt:null,committerAt:null})),observed=unwrap(validateImmutableCommit(commit(1))),a=unwrap(coalesceImmutableCommit(unknown,observed)),b=unwrap(coalesceImmutableCommit(observed,unknown));expect(a).toEqual(b);expect(a.parents).toEqual([]);expect(a.authorAt).toBe(observed.authorAt);expect(unwrap(firstParentSpine(anchor(1),[unknown])).reachedRoot).toBeNull();expect(unwrap(firstParentSpine(anchor(1),[unknown,observed])).reachedRoot).toBe(true);expect(coalesceImmutableCommit(unwrap(validateImmutableCommit(commit(1,[2,3]))),unwrap(validateImmutableCommit(commit(1,[3,2]))))).toMatchObject({ok:false,code:"immutable-commit-conflict"});
});
