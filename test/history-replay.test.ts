import { expect,test } from "bun:test";
import { syntheticWorld } from "./fixtures/browser-world";
import { capturedEvidence } from "../src/evidence/captured";
import { buildCapturedReplay, sortedMarkerIds, dwellMilliseconds } from "../src/history/timeline";
import { initReplay,reduceReplay,scheduleReplayTick } from "../src/history/reducer";
const capture=()=>{const w=syntheticWorld();w.source="github";w.headSha="f".repeat(40);w.commits=[];return w;};
const commit=(w:ReturnType<typeof capture>,letter:string,date:string,message="SYNTHETIC source commit")=>({id:letter.repeat(40),url:`${w.repo.url}/commit/${letter.repeat(40)}`,date,message,author:"SYNTHETIC author"});
const replay=async(w:ReturnType<typeof capture>)=>buildCapturedReplay(w,await capturedEvidence(w));
test("SYNTHETIC replay orders author instants and full SHA ties, preserves original facts/capture and never implies topology/merge",async()=>{
 const w=capture();w.commits=[commit(w,"c","2025-07-03T00:00:00Z"),commit(w,"b","2025-07-01T01:00:00+01:00"),commit(w,"a","2025-07-01T00:00:00Z","初始模块 / original source")];const before=JSON.stringify(w),a=await replay(w),b=await replay({...w,commits:[...w.commits].reverse()});expect(a).toEqual(b);expect(a.markers.map(m=>m.sha[0])).toEqual(["a","b","c"]);expect(a.markers[1].utcAuthorAt).toBe("2025-07-01T00:00:00.000Z");expect(a.headSha).toBe(w.headSha);expect(a.markers[0].sha).not.toBe(a.headSha);expect(a.collectedAt).toBe(w.collectedAt);expect(JSON.stringify(w)).toBe(before);expect(sortedMarkerIds(a)).toHaveLength(3);
 w.issues[0].state="closed";w.issues[0].updatedAt="2025-01-01T00:00:00Z";expect((await replay(w)).markers).toEqual(a.markers);
});
test("SYNTHETIC duplicates collapse while same-SHA conflicts, invalid/foreign/undated records remain excluded",async()=>{
 const w=capture(),c=commit(w,"a","2025-07-01T00:00:00Z");w.commits=[c,{...c}];expect(await replay(w)).toMatchObject({duplicateCount:1,rejectedCount:0});expect((await replay(w)).markers).toHaveLength(1);
 w.commits=[c,{...c,date:"2025-07-02T00:00:00Z"}];expect(await replay(w)).toMatchObject({markers:[],rejectedCount:2,conflictingShas:[c.id]});w.commits.reverse();expect((await replay(w)).markers).toEqual([]);
 for(const invalid of [{...c,date:"invalid",message:"Merge pull request #123"},{...c,url:`https://github.com/synthetic/other/commit/${c.id}`},{...c,id:"short"}]){w.commits=[invalid];expect((await replay(w)).markers).toEqual([]);}
 w.commits=[c];const envelope=(await capturedEvidence(w))!;envelope.identity.headSha="d".repeat(40);expect(buildCapturedReplay(w,envelope).markers).toEqual([]);w.source="demo";expect((await replay(w)).markers).toEqual([]);
});
test("SYNTHETIC 0/1 markers, bounded source window and unrelated current map head are explicit",async()=>{
 const w=capture();expect((await replay(w)).markers).toEqual([]);w.commits=[commit(w,"a","2025-01-01T00:00:00Z")];const one=await replay(w);expect(one.markers).toHaveLength(1);const init=initReplay(one.snapshotKey!,sortedMarkerIds(one),2);expect(reduceReplay(init,{type:"play",generation:2})).toMatchObject({playing:false,ended:true,index:0});
 w.commits=Array.from({length:25},(_,i)=>({...commit(w,"a","2025-01-01T00:00:00Z"),id:i.toString(16).padStart(40,"0"),url:`${w.repo.url}/commit/${i.toString(16).padStart(40,"0")}`}));const bounded=await replay(w);expect(bounded.markers.length).toBeLessThanOrEqual(20);expect(bounded.totalRetained).toBe(25);expect(bounded.overflowCount).toBe(5);expect(bounded.headSha).toBe(w.headSha);
});
test("SYNTHETIC reducer finite playback, four speeds, no repeat, seek/keyboard parity and stale-generation rejection",()=>{
 const initial=initReplay("capture-key",["a","b","c"],3);expect(initial.playing).toBe(false);let state=reduceReplay(initial,{type:"play",generation:3});state=reduceReplay(state,{type:"tick",generation:3,elapsedMs:1000});expect(state.index).toBe(1);state=reduceReplay(state,{type:"tick",generation:3,elapsedMs:1000});expect(state).toMatchObject({index:2,ended:true,playing:false});expect(reduceReplay(state,{type:"play",generation:3})).toMatchObject({index:2,playing:false});
 for(const speed of [.5,1,2,4]){let s=reduceReplay(initial,{type:"speed",generation:3,speed});s=reduceReplay(s,{type:"play",generation:3});expect(reduceReplay(s,{type:"tick",generation:3,elapsedMs:dwellMilliseconds(speed)}).index).toBe(1);}
 expect(reduceReplay(initial,{type:"next",generation:3})).toEqual(reduceReplay(initial,{type:"seek",generation:3,index:1}));expect(reduceReplay(initial,{type:"seek",generation:3,index:100})).toMatchObject({index:2,playing:false});expect(reduceReplay(initial,{type:"seek",generation:3,index:-100}).index).toBe(0);expect(reduceReplay(initial,{type:"tick",generation:2,elapsedMs:60_000})).toBe(initial);expect(reduceReplay(initial,{type:"speed",generation:3,speed:NaN})).toBe(initial);expect(reduceReplay(initReplay("empty",[],4),{type:"play",generation:4}).index).toBe(-1);
});
test("SYNTHETIC replay owns one timer, cancellation/hidden eligibility prevents callbacks and no catch-up uses old elapsed",()=>{
 const tasks=new Map<number,()=>void>();let next=0,now=100,steps:number[]=[];const schedule=(fn:()=>void,_delay:number)=>{tasks.set(++next,fn);return next;},cancel=(id:number)=>{tasks.delete(id);};let visible=true;
 const stop=scheduleReplayTick(schedule,cancel,()=>now,delta=>steps.push(delta),()=>visible);expect(tasks.size).toBe(1);stop();expect(tasks.size).toBe(0);const skip=scheduleReplayTick(schedule,cancel,()=>now,delta=>steps.push(delta),()=>false);expect(tasks.size).toBe(0);skip();
 scheduleReplayTick(schedule,cancel,()=>now,delta=>steps.push(delta),()=>visible);visible=false;now=10000;tasks.get(next)!();expect(steps).toEqual([]);tasks.clear();visible=true;scheduleReplayTick(schedule,cancel,()=>now,delta=>steps.push(delta),()=>visible);now+=100;tasks.get(next)!();expect(steps).toEqual([100]);
});
