import { dwellMilliseconds, replaySpeeds } from "./timeline";
export interface ReplayState { snapshotKey: string; generation: number; markerIds: string[]; index: number; elapsedMs: number; speed: number; playing: boolean; ended: boolean }
export type ReplayCommand = ({type:"play"|"pause"|"previous"|"next"}|{type:"seek";index:number}|{type:"speed";speed:number}|{type:"tick";elapsedMs:number});
export type ReplayAction = ReplayCommand & { generation: number };
export function initReplay(snapshotKey:string,markerIds:string[],generation:number):ReplayState{return{snapshotKey,generation,markerIds:[...markerIds].slice(0,20),index:markerIds.length?0:-1,elapsedMs:0,speed:1,playing:false,ended:false};}
export function reduceReplay(s:ReplayState,a:ReplayAction):ReplayState{
 if(a.generation!==s.generation)return s;
 const last=s.markerIds.length-1;
 if(a.type==="pause")return{...s,playing:false};
 if(a.type==="play")return last<0?s:{...s,playing:s.index<last,ended:s.index===last};
 if(a.type==="speed")return !Number.isFinite(a.speed)?s:{...s,speed:replaySpeeds.reduce<number>((best,v)=>Math.abs(v-a.speed)<Math.abs(best-a.speed)?v:best,0.5),elapsedMs:0};
 if(a.type==="seek"||a.type==="previous"||a.type==="next"){
  const target=a.type==="seek"?a.index:s.index+(a.type==="previous"?-1:1);if(!Number.isFinite(target)||last<0)return s;
  const index=Math.max(0,Math.min(last,Math.floor(target)));return{...s,index,elapsedMs:0,playing:false,ended:index===last};
 }
 if(a.type!=="tick"||!s.playing||!Number.isFinite(a.elapsedMs)||a.elapsedMs<0||last<0)return s;
 const elapsed=s.elapsedMs+Math.min(a.elapsedMs,60_000),dwell=dwellMilliseconds(s.speed),steps=Math.floor(elapsed/dwell),index=Math.min(last,s.index+steps),ended=index===last;
 return{...s,index,elapsedMs:ended?0:elapsed%dwell,playing:!ended,ended};
}
/** Exactly one cancellable next tick; visibility pauses discard elapsed time. */
export function scheduleReplayTick<Handle>(schedule:(fn:()=>void,delay:number)=>Handle,cancel:(id:Handle)=>void,now:()=>number,onTick:(elapsed:number)=>void,eligible:()=>boolean,delay=100){
 if(!eligible())return()=>{};const started=now();let active=true;
 const id=schedule(()=>{if(!active)return;active=false;if(eligible())onTick(Math.max(0,now()-started));},Math.max(1,Math.min(100,delay)));
 return()=>{if(active){active=false;cancel(id);}};
}
