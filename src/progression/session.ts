import type { WorldIdentity } from "../evidence/contracts";
/** First increment: session observations only, no receipt and no reward. The
 * persistence/challenge increment will keep this single gameplay interface. */
export interface ExplorationFlags {
    discovered: boolean;
    visited: boolean;
}
const flags = new Map<string, ExplorationFlags>();
const listeners = new Set<() => void>();
export function explorationFlags(key: string): ExplorationFlags { return flags.get(key) ?? { discovered: false, visited: false }; }
export function noteExploration(identity: WorldIdentity, event: "discovered" | "visited") {
    if (identity.source !== "github" || !flags.has(identity.repoKey) && flags.size >= 100)
        return;
    const old = explorationFlags(identity.repoKey), next = { discovered: true, visited: old.visited || event === "visited" };
    if (next.discovered === old.discovered && next.visited === old.visited)
        return;
    flags.set(identity.repoKey, next);
    for (const listener of listeners)
        listener();
}
export function subscribeExploration(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
