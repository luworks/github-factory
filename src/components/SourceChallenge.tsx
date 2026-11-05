import { useEffect, useRef, useState } from "react";
import type { WorldSnapshot } from "../contracts";
import { snapshotKey } from "../evidence/contracts";
import { worldIdentity } from "../evidence/captured";
import { conclusionAnswers, deriveChallenge, startAttempt, validateAttempt } from "../progression/rules";
import type { Attempt, ProgressChallenge } from "../progression/contracts";
import { completeExploration, useProgress } from "../progression/session";
import { completionFor } from "../progression/progress-store";
import "./source-challenge.css";

export function SourceChallenge({ world, available, onSelect }: { world: WorldSnapshot; available: boolean; onSelect: (id: string | null) => void }) {
    const progress = useProgress(), [challenge, setChallenge] = useState<ProgressChallenge | null>(null), [attempt, setAttempt] = useState<Attempt | null>(null), [conclusion, setConclusion] = useState(""), [message, setMessage] = useState(""), [saving, setSaving] = useState(false);
    const generation = useRef(0), lock = useRef(false), current = worldIdentity(world), key = current ? snapshotKey(current) : "invalid";
    const activeCapture = useRef({key,available}); activeCapture.current = {key,available};
    const completion = current ? completionFor(progress, current.repoKey) : null;
    useEffect(() => {
        const version = ++generation.current; setAttempt(null); setConclusion(""); setChallenge(null); setMessage("");
        if (available) void deriveChallenge(world).then(c => { if (version === generation.current) setChallenge(c); });
        return () => { ++generation.current; };
    }, [world, key, available]);
    useEffect(() => { if (attempt && attempt.progressGeneration !== progress.generation) { setAttempt(null); setMessage("Progress was reset. Start again."); } }, [attempt, progress.generation]);
    const submit = async () => {
        if (!challenge || !attempt || !available || lock.current) return;
        lock.current = true; setSaving(true); const version = generation.current;
        try {
            const result = validateAttempt(challenge, attempt, current);
            if (result !== "correct") { setMessage(result === "incorrect" ? "Try again. Match the captured source and its limits; a directory link does not prove runtime health or a merged contribution." : "Snapshot changed or source unavailable. Start again."); return; }
            const saved = await completeExploration(challenge, attempt, current, () => version === generation.current && activeCapture.current.key === key && activeCapture.current.available);
            if (version !== generation.current) return;
            setMessage(saved.existing ? "Already completed locally. No additional Exploration star." : saved.receipt.persistence === "device" ? "Exploration star earned. Saved on this device." : "Exploration star earned. Session progress — not saved."); setAttempt(null);
        } catch (e) { if (version === generation.current) setMessage(e instanceof Error ? e.message : "Progress was not saved. Retry saving."); }
        finally { lock.current = false; setSaving(false); }
    };
    return <section className="source-challenge" aria-label="Source challenge">
      <h3>Source challenge</h3>
      <p>Local answer check against captured evidence. This does not verify reading, understanding, a GitHub contribution or current production health.</p>
      {completion && <div className="exploration-receipt"><strong>✧ 1 Exploration star · {completion.persistence === "device" ? "Completed on this device" : "Session progress — not saved"}</strong><p>Completed locally on <code>{completion.completedIdentity.headSha}</code> at {completion.completedIdentity.collectedAt}. No additional star for practice, another capture or another style.</p></div>}
      {progress.warning && <p className="progress-warning">{progress.warning}</p>}
      {!available || challenge?.availability === "unavailable" ? <p>Source challenge unavailable — this cached world lacks enough verified pinned evidence or its current source cannot be verified. Continue exploring.</p> : !challenge ? <p>Checking captured evidence…</p> : <>
        <p>Historical capture · current GitHub state unknown. <code>{challenge.identity!.headSha}</code> · {challenge.identity!.collectedAt}</p>
        {!attempt ? <button onClick={() => { setAttempt(startAttempt(challenge, progress.generation)); setConclusion(""); setMessage(""); if (challenge.variant === "node-link") onSelect(challenge.target!.subjectId); }}>{completion ? "Practice source challenge" : "Start source challenge"}</button> : <form onSubmit={e => { e.preventDefault(); void submit(); }}>
          <p>{challenge.variant === "node-link" ? "Trace a captured source: " : "Locate this recorded commit: "}<strong>{challenge.target!.label}</strong></p>
          {challenge.variant === "commit-marker" && <p>Author timestamp: {challenge.target!.authorDate}. Merge evidence is unknown.</p>}
          <a href={challenge.target!.sourceUrl} target="_blank" rel="noreferrer">Inspect challenge source</a>
          <fieldset disabled={saving}><legend>Choose the matching captured source</legend>{challenge.choices.source.map(choice => <label key={choice.code}><input type="radio" name="challenge-source" checked={attempt.selectedEvidenceId === choice.code} onChange={() => setAttempt(a => a && ({ ...a, selectedEvidenceId: choice.code, selectedSubjectId: challenge.evidence.find(e => e.id === choice.code)?.subject[challenge.variant === "node-link" ? "nodeId" : "sha"] ?? null }))}/><span>{choice.label}</span></label>)}</fieldset>
          <fieldset disabled={saving}><legend>What does this capture support?</legend>{challenge.choices.conclusion.map(choice => <label key={choice.code}><input type="radio" name="challenge-conclusion" checked={conclusion === choice.code} onChange={() => { setConclusion(choice.code); setAttempt(a => a && ({ ...a, answerCodes: conclusionAnswers(challenge.variant!, choice.code) })); }}/><span>{choice.label}</span></label>)}</fieldset>
          <button type="submit" disabled={saving || !conclusion || !attempt.selectedEvidenceId}>{saving ? "Saving local progress…" : "Submit source answers"}</button><button type="button" disabled={saving} onClick={() => { setAttempt(null); setMessage("Challenge cancelled. No new star."); }}>Cancel challenge</button>
        </form>}
      </>}
      {message && <p role="status">{message}</p>}
    </section>;
}
