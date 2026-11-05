import { expect, test } from "bun:test";
import { syntheticWorld } from "./fixtures/browser-world";
import { deriveChallenge, startAttempt, validateAttempt, conclusionAnswers } from "../src/progression/rules";
import { ProgressStore, StaleProgress } from "../src/progression/progress-store";
import { snapshotKey } from "../src/evidence/contracts";
const capture = () => { const w=syntheticWorld();w.source="github";w.nodes[0].evidence=[`${w.repo.url}/tree/${w.headSha}/${w.nodes[0].path}`];return w; };
function correct(c: Awaited<ReturnType<typeof deriveChallenge>>, generation=0) { return {...startAttempt(c,generation),selectedSubjectId:c.target!.subjectId,selectedEvidenceId:c.evidence[0].id,answerCodes:conclusionAnswers(c.variant!,c.choices.conclusion[0].code)}; }
test("SYNTHETIC challenge source is exact, deterministic, style-independent and does not mutate public facts",async()=>{
 const w=capture(),original=JSON.stringify(w),c=await deriveChallenge(w);expect(c.availability).toBe("available");expect(c.variant).toBe("node-link");expect(c.evidence[0].sourceUrls[0]).toBe(w.nodes[0].evidence[0]);
 const reordered=structuredClone(w);reordered.nodes.reverse();reordered.edges.reverse();reordered.commits.reverse();expect(await deriveChallenge(reordered)).toEqual(c);expect(JSON.stringify(w)).toBe(original);
 const a=correct(c);expect(validateAttempt(c,a,c.identity)).toBe("correct");expect(validateAttempt(c,{...a,answerCodes:conclusionAnswers("node-link","production-healthy")},c.identity)).toBe("incorrect");
 for(const patch of [{selectedSubjectId:"forged"},{selectedEvidenceId:"forged"},{answerCodes:{...a.answerCodes,unknown:"forged"}},{rewardKey:"forged"},{evidenceFingerprint:"forged"},{snapshotKey:"forged"}]) expect(validateAttempt(c,{...a,...patch},c.identity)).not.toBe("correct");
 expect(validateAttempt(c,a,{...c.identity!,collectedAt:"2024-01-01T00:00:00Z"})).toBe("stale-attempt");expect(c.snapshotKey).toBe(snapshotKey(c.identity!));
});
test("SYNTHETIC unsafe or reconstructed directory source never qualifies, no substring merge proof",async()=>{
 for(const evidence of [[],["packages"],["https://github.com/other/repo/tree/"+"a".repeat(40)+"/packages"],["https://evil.test/tree/main/packages"]]) {const w=capture();for(const n of w.nodes)n.evidence=evidence;w.commits=[];expect((await deriveChallenge(w)).availability).toBe("unavailable");}
 const w=capture(),base=w.nodes[0].evidence[0];w.commits=[];
 for(const url of [base+"?x=1",base+"#fragment",base.replace("https://github.com/","https://user@github.com/"),base.replace(w.headSha,"main"),base.replace("github.com","github.com.evil.test")]){w.nodes[0].evidence=[url];expect((await deriveChallenge(w)).availability).toBe("unavailable");}
 const f=capture();for(const n of f.nodes)n.evidence=[];const marker=f.commits[0];marker.id="f".repeat(40);marker.url=`${f.repo.url}/commit/${marker.id}`;marker.message="Merge #123 原始信息";
 const c=await deriveChallenge(f);expect(c.variant).toBe("commit-marker");expect(c.target!.subjectId).not.toBe(f.headSha);expect(c.evidence[0].eventTime?.basis).toBe("author");expect(validateAttempt(c,correct(c),c.identity)).toBe("correct");expect(validateAttempt(c,{...correct(c),answerCodes:conclusionAnswers("commit-marker","confirmed-merge")},c.identity)).toBe("incorrect");
 marker.date="bad";expect((await deriveChallenge(f)).availability).toBe("unavailable");
});
test("SYNTHETIC missing, demo, invalid and collapsed captures fail closed; stale facts stay usable",async()=>{
 for(const mutate of [(w:any)=>w.source="demo",(w:any)=>w.headSha="short",(w:any)=>w.collectedAt="2999-01-01T00:00:00Z",(w:any)=>w.coverage.tree="unavailable",(w:any)=>w.nodes=[],(w:any)=>w.repo.url="https://evil.test/a/b"]){const w=capture();mutate(w);expect((await deriveChallenge(w)).availability).toBe("unavailable");}
 for(const path of ["", ".", "../src", "src/../test", "src%2Ftest", "src?test", "src\\test"]){const w=capture();w.commits=[];w.nodes=[{...w.nodes[0],path,evidence:[`${w.repo.url}/tree/${w.headSha}/${path}`]}];expect((await deriveChallenge(w)).availability).toBe("unavailable");}
 const w=capture();w.refreshAfter=1;expect((await deriveChallenge(w)).availability).toBe("available");
});
test("SYNTHETIC new heads/rules/fallback retain reward slot; session fallback is bounded and never claims durable success",async()=>{
 const w=capture(),c=await deriveChallenge(w),s=new ProgressStore(undefined),first=await s.complete(c,correct(c),c.identity);expect(first.receipt.persistence).toBe("session");expect(first.state.durableCountKnown).toBe(false);expect(first.state.warning).toContain("not saved");
 const changed=structuredClone(w);changed.headSha="c".repeat(40);changed.nodes[0].evidence=[`${changed.repo.url}/tree/${changed.headSha}/${changed.nodes[0].path}`];const v2=await deriveChallenge(changed,Date.now(),2);expect(v2.rewardKey).toBe(c.rewardKey);expect(v2.challengeId).not.toBe(c.challengeId);const replay=await s.complete(v2,correct(v2),v2.identity);expect(replay.existing).toBe(true);expect(replay.receipt).toEqual(first.receipt);expect(replay.state.completions.length).toBe(1);
 await expect(s.complete(c,correct(c,999),c.identity)).rejects.toBeInstanceOf(StaleProgress);
 await expect(s.complete(c,{...correct(c),selectedEvidenceId:"forged"},c.identity)).rejects.toThrow("do not qualify");
});
