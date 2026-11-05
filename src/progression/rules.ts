import type { WorldSnapshot } from "../contracts";
import { cachedWorldReady, capturedEvidence, worldIdentity } from "../evidence/captured";
import { codePointCompare, digest, snapshotKey, type WorldIdentity } from "../evidence/contracts";
import { challengeIdFor, rewardKeyFor, type Answers, type Attempt, type ChallengeVariant, type ProgressChallenge } from "./contracts";
const conclusions = {
    "node-link": [
        { code: "captured-directory-link", label: "The map records this directory source; its role is inferred and runtime behavior is unknown." },
        { code: "production-healthy", label: "This proves the service is healthy in production." },
        { code: "merged-contribution", label: "This proves a new contribution was merged." },
    ],
    "commit-marker": [
        { code: "author-date-merge-unknown", label: "This is an author timestamp; a merged pull request is not established." },
        { code: "confirmed-merge", label: "This timestamp confirms a pull request was merged." },
        { code: "current-runtime", label: "This timestamp establishes current production health." },
    ],
};
export function conclusionAnswers(variant: ChallengeVariant, code: string): Answers {
    if (variant === "node-link") return { supportedClaim: code, runtimeClaim: code === "production-healthy" ? "healthy" : "unknown" };
    return { dateBasis: code === "author-date-merge-unknown" ? "author" : code === "confirmed-merge" ? "merged" : "runtime", mergeClaim: code === "confirmed-merge" ? "confirmed" : "unknown" };
}
/** Derive from a retained full capture. No fetching, AI, title heuristics, edge
 * source substitution or reconstructed navigation URL can qualify a task. */
export async function deriveChallenge(world: WorldSnapshot, now = Date.now(), rulesVersion = 1): Promise<ProgressChallenge> {
    const identity = worldIdentity(world, now), repoKey = identity?.repoKey;
    const base: ProgressChallenge = {
        schemaVersion: 1, challengeKind: "captured-source", rulesVersion,
        challengeId: repoKey ? challengeIdFor(repoKey, rulesVersion) : null, rewardKey: repoKey ? rewardKeyFor(repoKey) : null,
        identity, snapshotKey: identity ? snapshotKey(identity) : null, variant: null, availability: "unavailable",
        unavailableReason: !identity ? "invalid-identity" : identity.source !== "github" ? "source-unverified" : "missing-evidence",
        evidence: [], evidenceFingerprint: null, promptCode: null, choices: { source: [], conclusion: [] }, verification: "local-answer-check", target: null,
    };
    if (!identity || identity.source !== "github" || !Number.isSafeInteger(rulesVersion) || rulesVersion < 1 || rulesVersion > 999 || !cachedWorldReady(world, now)) return base;
    const envelope = await capturedEvidence(world, now);
    if (!envelope) return base;
    const nodes = envelope.evidence.filter(e => e.kind === "node-link");
    const commits = envelope.evidence.filter(e => e.kind === "commit-marker").sort((a, b) => codePointCompare(a.subject.sha!, b.subject.sha!));
    const variant: ChallengeVariant | null = nodes.length ? "node-link" : commits.length ? "commit-marker" : null;
    if (!variant) return base;
    const evidence = (variant === "node-link" ? nodes : commits).slice(0, 2), primary = evidence[0];
    const node = world.nodes.find(n => n.id === primary.subject.nodeId), commit = world.commits.find(c => c.id.toLowerCase() === primary.subject.sha);
    const target = { subjectId: variant === "node-link" ? primary.subject.nodeId! : primary.subject.sha!, label: variant === "node-link" ? node!.path : commit!.message.slice(0, 500), sourceUrl: primary.sourceUrls[0], authorDate: primary.eventTime?.at ?? null };
    const choices = { source: evidence.map(e => ({ code: e.id, label: e.sourceUrls[0] })).sort((a, b) => codePointCompare(a.code, b.code)), conclusion: conclusions[variant] };
    const evidenceFingerprint = await digest([rulesVersion, variant, evidence.map(e => [e.id, e.kind, e.sourceUrls, Object.entries(e.subject).sort(([a], [b]) => codePointCompare(a, b)), e.eventTime]).sort((a, b) => codePointCompare(String(a[0]), String(b[0]))), choices.conclusion.map(c => c.code)]);
    return { ...base, variant, availability: "available", unavailableReason: null, evidence, evidenceFingerprint, promptCode: variant === "node-link" ? "choose-captured-source" : "locate-captured-commit", choices, target };
}
export function startAttempt(challenge: ProgressChallenge, progressGeneration: number): Attempt {
    if (challenge.availability !== "available" || !challenge.challengeId || !challenge.rewardKey || !challenge.snapshotKey || !challenge.evidenceFingerprint || !challenge.variant || !Number.isSafeInteger(progressGeneration) || progressGeneration < 0) throw new Error("Source challenge unavailable");
    return { attemptId: crypto.randomUUID(), challengeId: challenge.challengeId, rewardKey: challenge.rewardKey, snapshotKey: challenge.snapshotKey, evidenceFingerprint: challenge.evidenceFingerprint, variant: challenge.variant, selectedSubjectId: null, selectedEvidenceId: null, answerCodes: {}, progressGeneration, status: "inspecting" };
}
export function validateAttempt(challenge: ProgressChallenge, attempt: Attempt, currentIdentity: WorldIdentity | null): "unavailable" | "stale-attempt" | "incorrect" | "correct" {
    if (challenge.availability !== "available" || !challenge.identity || challenge.identity.source !== "github" || !challenge.target) return "unavailable";
    if (!currentIdentity || snapshotKey(currentIdentity) !== challenge.snapshotKey || attempt.snapshotKey !== challenge.snapshotKey || attempt.evidenceFingerprint !== challenge.evidenceFingerprint ||
        attempt.challengeId !== challenge.challengeId || attempt.rewardKey !== challenge.rewardKey || attempt.variant !== challenge.variant) return "stale-attempt";
    const primary = challenge.evidence[0];
    if (!primary || attempt.selectedEvidenceId !== primary.id || attempt.selectedSubjectId !== challenge.target.subjectId || !attempt.answerCodes || Object.keys(attempt.answerCodes).some(k => !["supportedClaim", "runtimeClaim", "dateBasis", "mergeClaim"].includes(k))) return "incorrect";
    return challenge.variant === "node-link"
        ? attempt.answerCodes.supportedClaim === "captured-directory-link" && attempt.answerCodes.runtimeClaim === "unknown" && Object.keys(attempt.answerCodes).length === 2 ? "correct" : "incorrect"
        : attempt.answerCodes.dateBasis === "author" && attempt.answerCodes.mergeClaim === "unknown" && Object.keys(attempt.answerCodes).length === 2 ? "correct" : "incorrect";
}
