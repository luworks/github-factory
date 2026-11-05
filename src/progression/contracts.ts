import type { EvidenceRef, WorldIdentity } from "../evidence/contracts";
export type ChallengeVariant = "node-link" | "commit-marker";
export type Answers = { supportedClaim?: string; runtimeClaim?: string; dateBasis?: string; mergeClaim?: string };
export interface ProgressChallenge {
    schemaVersion: 1; challengeKind: "captured-source"; rulesVersion: number;
    challengeId: string | null; rewardKey: string | null; identity: WorldIdentity | null; snapshotKey: string | null;
    variant: ChallengeVariant | null; availability: "available" | "unavailable";
    unavailableReason: "source-unverified" | "invalid-identity" | "missing-evidence" | "invalid-source" | null;
    evidence: EvidenceRef[]; evidenceFingerprint: string | null;
    promptCode: "choose-captured-source" | "locate-captured-commit" | null;
    choices: { source: { code: string; label: string }[]; conclusion: { code: string; label: string }[] };
    verification: "local-answer-check";
    target: { subjectId: string; label: string; sourceUrl: string; authorDate: string | null } | null;
}
export interface Attempt {
    attemptId: string; challengeId: string; rewardKey: string; snapshotKey: string; evidenceFingerprint: string;
    variant: ChallengeVariant; selectedSubjectId: string | null; selectedEvidenceId: string | null;
    answerCodes: Answers; progressGeneration: number; status: "inspecting" | "checking";
}
export interface CompletionReceipt {
    schemaVersion: 1; rewardKey: string; challengeId: string; rulesVersion: number;
    completedIdentity: WorldIdentity; variant: ChallengeVariant; evidenceFingerprint: string; completedAt: string;
    verification: "local-answer-check"; persistence: "device" | "session"; reward: "exploration-star";
}
export interface RepoProgress { schemaVersion: 1; repoKey: string; discovered: boolean; visited: boolean }
export interface ProgressOverlay {
    schemaVersion: 1; identity: WorldIdentity; discovered: boolean; visited: boolean;
    challengeAvailable: boolean; completion: CompletionReceipt | null;
}
export const rewardKeyFor = (repoKey: string) => JSON.stringify([repoKey, "first-evidence"]);
export const challengeIdFor = (repoKey: string, rulesVersion: number) => JSON.stringify([repoKey, "captured-source", rulesVersion]);
