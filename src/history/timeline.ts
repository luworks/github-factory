import type { WorldSnapshot } from "../contracts";
import type { capturedEvidence } from "../evidence/captured";
import { cachedWorldReady, worldIdentity } from "../evidence/captured";
import { codePointCompare, snapshotKey } from "../evidence/contracts";
export interface CapturedCommitMarker { id: string; sha: string; sourceUrl: string; author: string; message: string; authorDate: string; utcAuthorAt: string; authorEpoch: number }
export interface CapturedReplayWindow { snapshotKey: string | null; headSha: string; collectedAt: string; markers: CapturedCommitMarker[]; totalRetained: number; considered: number; duplicateCount: number; rejectedCount: number; conflictingShas: string[]; overflowCount: number }
/** Retained author-time presentation order, never ancestry or topology. No IO. */
export function buildCapturedReplay(world: WorldSnapshot, envelope: Awaited<ReturnType<typeof capturedEvidence>>): CapturedReplayWindow {
  const identity=worldIdentity(world),valid=cachedWorldReady(world),key=identity?snapshotKey(identity):null;
  const result:CapturedReplayWindow={snapshotKey:key,headSha:identity?.headSha??"",collectedAt:identity?.collectedAt??"",markers:[],totalRetained:Array.isArray(world?.commits)?world.commits.length:0,considered:0,duplicateCount:0,rejectedCount:0,conflictingShas:[],overflowCount:0};
  if(!valid||!key||!envelope||snapshotKey(envelope.identity)!==key)return result;
  const retained=[...world.commits].sort((a,b)=>codePointCompare(a.id.toLowerCase(),b.id.toLowerCase())||codePointCompare(JSON.stringify([a.url,a.message,a.author,a.date]),JSON.stringify([b.url,b.message,b.author,b.date]))).slice(0,20);
  result.considered=retained.length;result.overflowCount=result.totalRetained-retained.length;
  const groups=new Map<string,typeof retained>();for(const c of retained){const sha=c.id.toLowerCase(),list=groups.get(sha)??[];list.push(c);groups.set(sha,list);}
  for(const [sha,records]of groups){
    const signatures=new Set(records.map(c=>JSON.stringify([c.url,c.message,c.author,Date.parse(c.date)])));
    if(signatures.size!==1){result.conflictingShas.push(sha);result.rejectedCount+=records.length;continue;}
    const c=records[0],at=Date.parse(c.date),url=`${world.repo.url}/commit/${c.id}`;
    const ref=envelope.evidence.find(e=>e.kind==="commit-marker"&&e.subject.sha===sha&&snapshotKey(e.worldIdentity)===key&&e.sourceUrls.length===1&&e.sourceUrls[0]===url&&e.eventTime?.basis==="author"&&Date.parse(e.eventTime.at)===at);
    if(!/^[a-f0-9]{40}$/.test(sha)||c.url!==url||!Number.isFinite(at)||!c.message.trim()||!ref){result.rejectedCount+=records.length;continue;}
    result.duplicateCount+=records.length-1;
    result.markers.push({id:ref.id,sha,sourceUrl:c.url,author:c.author,message:c.message,authorDate:c.date,utcAuthorAt:new Date(at).toISOString(),authorEpoch:at});
  }
  result.markers.sort((a,b)=>a.authorEpoch-b.authorEpoch||codePointCompare(a.sha,b.sha));result.conflictingShas.sort(codePointCompare);return result;
}
export const sortedMarkerIds=(window:CapturedReplayWindow)=>window.markers.map(m=>m.id);
export const replaySpeeds=[0.5,1,2,4] as const;
export const dwellMilliseconds=(speed:number)=>1000/(replaySpeeds.includes(speed as typeof replaySpeeds[number])?speed:1);
