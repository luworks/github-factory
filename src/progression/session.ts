import { useEffect, useState } from "react";
import type { WorldIdentity } from "../evidence/contracts";
import { ProgressStore, completionFor, type ProgressState } from "./progress-store";
import type { Attempt, ProgressChallenge } from "./contracts";
export interface ExplorationFlags { discovered: boolean; visited: boolean }
const store = new ProgressStore();
let state: ProgressState = { generation: 0, repos: [], completions: [], durableRepos: [], persistence: "session", warning: null, durableCountKnown: false };
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null, revision = 0;
function publish(next: ProgressState) { state = next; for (const listener of listeners) listener(); }
export function explorationFlags(key: string): ExplorationFlags { return state.repos.find(r => r.repoKey === key) ?? { discovered: false, visited: false }; }
export function explorationCompletion(key: string) { return completionFor(state, key); }
export async function reconcileProgress() { const version = ++revision, next = await store.read(); if (version === revision) publish(next); }
export function noteExploration(identity: WorldIdentity, event: "discovered" | "visited") {
    if (identity.source !== "github") return;
    const old = explorationFlags(identity.repoKey); if (old.discovered && (event === "discovered" || old.visited)) return;
    const version = ++revision;
    void store.note(identity, event).then(next => { if (version === revision) publish(next); channel?.postMessage("changed"); }).catch(() => { void reconcileProgress(); });
}
export function subscribeExploration(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function completeExploration(challenge: ProgressChallenge, attempt: Attempt, identity: WorldIdentity | null, stillCurrent?: () => boolean) {
    ++revision; const result = await store.complete(challenge, attempt, identity, stillCurrent); publish(result.state); channel?.postMessage("changed"); return result;
}
export async function clearExploration() { ++revision; publish(await store.reset()); channel?.postMessage("changed"); }
export function useProgress() {
    const [, setRevision] = useState(0);
    useEffect(() => {
        const unsubscribe = subscribeExploration(() => setRevision(x => x + 1));
        if (!channel && typeof BroadcastChannel !== "undefined") { try { channel = new BroadcastChannel("moon-factory-exploration"); channel.onmessage = () => { void reconcileProgress(); }; } catch { /* Focus reconciliation remains available. */ } }
        void reconcileProgress();
        const focus = () => { if (document.visibilityState === "visible") void reconcileProgress(); };
        window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
        return () => { unsubscribe(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
    }, []);
    return state;
}
