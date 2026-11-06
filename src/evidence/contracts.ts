/** Captured source facts only. Player progress and camera never enter a world. */
export interface WorldIdentity { repoKey: string; headSha: string; collectedAt: string; source: "github" | "demo" }
export interface EvidenceRef {
  id: string; worldIdentity: WorldIdentity;
  kind: "capture" | "node-link" | "edge-record" | "commit-marker" | "history-event" | "tree-frame";
  sourceUrls: string[]; subject: { nodeId?: string; edgeId?: string; sha?: string; eventId?: string };
  eventTime: null | { at: string; basis: "author" | "committer" | "created" | "closed" | "merged" };
  fetchedAt: string; claim: string; confidence: "observed" | "inferred" | "unknown"; limitations: string[];
}
export const snapshotKey = (i: WorldIdentity) => JSON.stringify([i.repoKey, i.headSha, i.collectedAt, i.source]);
export const codePointCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export async function digest(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), n => n.toString(16).padStart(2, "0")).join("");
}
