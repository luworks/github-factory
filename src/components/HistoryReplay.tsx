import { useEffect, useRef, useState } from "react";
import type { WorldSnapshot } from "../contracts";
import { capturedEvidence,worldIdentity } from "../evidence/captured";
import { snapshotKey } from "../evidence/contracts";
import { buildCapturedReplay,replaySpeeds,sortedMarkerIds,type CapturedReplayWindow } from "../history/timeline";
import { initReplay,reduceReplay,scheduleReplayTick,type ReplayState,type ReplayCommand } from "../history/reducer";
import "../history/replay.css";
export function HistoryReplay({world,available}:{world:WorldSnapshot;available:boolean}){
 const [captureWindow,setWindow]=useState<CapturedReplayWindow|null>(null),[state,setState]=useState<ReplayState|null>(null),[visible,setVisible]=useState(false),[documentVisible,setDocumentVisible]=useState(true),[failure,setFailure]=useState(false),panel=useRef<HTMLElement>(null),generation=useRef(0),panelVisible=useRef(false);
 const identity=worldIdentity(world),key=identity?snapshotKey(identity):"invalid",liveSource=useRef({key,available});liveSource.current={key,available};
 const window=captureWindow?.snapshotKey===key?captureWindow:null;
 useEffect(()=>{const current=++generation.current;setWindow(null);setState(null);setFailure(false);if(available)void capturedEvidence(world).then(envelope=>{if(current!==generation.current||liveSource.current.key!==key||!liveSource.current.available)return;const value=buildCapturedReplay(world,envelope);setWindow(value);setState(initReplay(value.snapshotKey??"invalid",sortedMarkerIds(value),current));}).catch(()=>{if(current===generation.current)setFailure(true);});return()=>{++generation.current;};},[world,key,available]);
 useEffect(()=>{const el=panel.current;if(!el)return;const visibility=()=>{const shown=!document.hidden;setDocumentVisible(shown);if(!shown)setState(s=>s?reduceReplay(s,{type:"pause",generation:s.generation}):s);};const observer=new IntersectionObserver(entries=>{const shown=entries[0]?.isIntersecting??false;panelVisible.current=shown;setVisible(shown);if(!shown)setState(s=>s?reduceReplay(s,{type:"pause",generation:s.generation}):s);});observer.observe(el);document.addEventListener("visibilitychange",visibility);visibility();return()=>{observer.disconnect();document.removeEventListener("visibilitychange",visibility);};},[]);
 useEffect(()=>{if(!state?.playing||!visible||!documentVisible||!available)return;const current=state.generation;return scheduleReplayTick((fn,delay)=>globalThis.setTimeout(fn,delay),id=>clearTimeout(id),()=>performance.now(),elapsed=>setState(s=>s?reduceReplay(s,{type:"tick",generation:current,elapsedMs:elapsed}):s),()=>panelVisible.current&&!document.hidden&&current===generation.current&&liveSource.current.key===key&&liveSource.current.available);},[state,visible,documentVisible,available]);
 const dispatch=(action:ReplayCommand)=>setState(s=>s?reduceReplay(s,{...action,generation:s.generation}):s),marker=state&&window?window.markers[state.index]:null;
 return <section ref={panel} className="history-replay" aria-label="Captured commit replay" data-playback={state?.snapshotKey===key&&state.playing?"playing":"paused"}>
  <h2>Replay captured commits</h2><p className="history-structure">Captured structure at <code>{world.headSha}</code></p><p>Historical topology unavailable. The map stays at its captured head; the timeline does not change buildings.</p>
  <p>Author-time presentation order · ancestry and merge status unknown. Presentation pacing; not elapsed project time. Playback awards no Exploration stars.</p>
  {!available||failure?<p role="status">Replay unavailable: current captured source cannot be verified.</p>:!window?<p>Checking retained commit markers…</p>:<>
   <p>Captured at {window.collectedAt} · {window.markers.length} eligible / {window.totalRetained} retained commits. {window.rejectedCount} rejected · {window.duplicateCount} duplicates · {window.overflowCount} outside this bounded slice.</p>
   {!!window.conflictingShas.length&&<p>Conflicting retained SHA records excluded: {window.conflictingShas.join(", ")}</p>}
   <p>Complete history and issue/PR lifecycle events are not loaded. Current issues and pull requests remain capture observations.</p>
   {!marker?<p role="status">No captured commit markers; history not loaded. This does not mean no repository activity.</p>:<>
    <article className="history-marker" aria-live="polite" aria-atomic="true"><strong>{marker.message}</strong><p>{marker.author} · UTC author timestamp: <time dateTime={marker.utcAuthorAt}>{marker.utcAuthorAt}</time></p><p>Retained author date: {marker.authorDate}</p><a href={marker.sourceUrl} target="_blank" rel="noreferrer">Commit source <code>{marker.sha}</code></a><p>{state?.ended?"End of captured window":state?.playing?"Playing captured markers":"Paused"} · Marker {(state?.index??0)+1} / {window.markers.length} · Location in captured structure unknown.</p></article>
    <div className="history-controls"><button disabled={(state?.index??0)<=0} onClick={()=>dispatch({type:"previous"})}>Previous captured commit</button><button disabled={window.markers.length<2||state?.ended} onClick={()=>dispatch({type:state?.playing?"pause":"play"})}>{state?.playing?"Pause commit replay":"Play commit replay"}</button><button disabled={(state?.index??0)>=window.markers.length-1} onClick={()=>dispatch({type:"next"})}>Next captured commit</button></div>
    <label>Seek captured commit<input type="range" min={0} max={window.markers.length-1} value={state?.index??0} onChange={e=>dispatch({type:"seek",index:Number(e.target.value)})}/></label><label>Playback speed<select value={state?.speed??1} onChange={e=>dispatch({type:"speed",speed:Number(e.target.value)})}>{replaySpeeds.map(speed=><option value={speed} key={speed}>{speed}×</option>)}</select></label>
   </>}
  </>}
 </section>;
}
