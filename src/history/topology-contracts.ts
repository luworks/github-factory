/** Offline immutable facts. These DTOs are separate from live WorldSnapshot,
 * event playback, player progress and any future transport/persistence schema. */
export const TOPOLOGY_LIMITS = Object.freeze({ commits: 500, commitBytes: 2048, parents: 16, provenance: 8, frameEntries: 8000, frameBytes: 512 * 1024, decodedFrames: 2, workingBytes: 2 * 1024 * 1024, sceneNodes: 30, sceneEdges: 50 });
export interface TopologyProvenance { readonly sourceUrl: string; readonly fetchedAt: string }
export interface ImmutableCommit {
  readonly schemaVersion: 1; readonly repoKey: string; readonly sha: string; readonly treeSha: string;
  /** null means unobserved. Only an observed [] establishes a root. */
  readonly parents: readonly string[] | null;
  readonly authorAt: string | null; readonly committerAt: string | null; readonly message: string;
  readonly provenance: readonly TopologyProvenance[]; readonly omittedProvenance: number | null;
}
export interface TreeScope { readonly prefix: string; readonly recursive: true }
export type TreeEntryType = "blob" | "tree" | "symlink" | "submodule";
export interface ImmutableTreeEntry { readonly path: string; readonly type: TreeEntryType; readonly sha: string }
export interface ImmutableTreeFrame {
  readonly schemaVersion: 1; readonly repoKey: string; readonly commitSha: string; readonly treeSha: string;
  readonly scope: TreeScope; readonly completeness: "full" | "partial";
  readonly sourceCompleteness: "full" | "partial"; readonly sourceOmittedEntries: number | null;
  readonly entries: readonly ImmutableTreeEntry[]; readonly inputEntryCount: number;
  readonly omittedInputEntries: number; readonly deduplicatedInputEntries: number;
  readonly limits: readonly ("entry-cap" | "byte-cap")[];
  readonly provenance: readonly TopologyProvenance[]; readonly omittedProvenance: number | null;
}
export type TopologyResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
export interface TopologyAnchor { readonly repoKey: string; readonly sha: string; readonly generation: string }
export interface FirstParentSpine {
  readonly anchor: TopologyAnchor; readonly commits: readonly ImmutableCommit[];
  readonly termination: "observed-root" | "missing-anchor" | "missing-parent" | "parents-unobserved" | "cycle" | "window-cap";
  readonly nextParentSha: string | null; readonly reachedRoot: true | null;
  readonly nonSpineShas: readonly string[]; readonly nonSpineRelationship: "unknown";
}
export interface EndpointComparison {
  readonly beforeKey: string; readonly afterKey: string;
  readonly continuity: "adjacent-first-parent" | "endpoint-gap";
  readonly scopeComparable: boolean; readonly exactEndpoints: boolean;
  readonly added: readonly ImmutableTreeEntry[]; readonly removed: readonly ImmutableTreeEntry[];
  readonly modified: readonly { path: string; before: ImmutableTreeEntry; after: ImmutableTreeEntry }[];
  readonly beforeOnlyObserved: readonly ImmutableTreeEntry[]; readonly afterOnlyObserved: readonly ImmutableTreeEntry[];
  readonly absence: "established-at-complete-endpoints" | "unknown";
  readonly modifiedEntries: number | null; readonly changedDirectoryHashes: number | null;
  readonly renameEvidence: "unavailable"; readonly intermediateSteps: "not-reconstructed";
}
export interface HistoricScene {
  readonly frameKey: string; readonly repoKey: string; readonly commitSha: string; readonly treeSha: string;
  readonly nodes: readonly { id: string; path: string; label: string; type: TreeEntryType; role: string; roleConfidence: "inferred"; status: "unknown"; sourceUrl: string }[];
  readonly edges: readonly { id: string; source: string; target: string; claim: "captured-path-containment" }[];
  readonly observedEntries: number; readonly omittedObservedEntries: number;
  readonly partial: boolean; readonly sourceOmittedEntries: number | null; readonly omittedInputEntries: number;
}
export interface TopologyWindow { readonly anchor: TopologyAnchor; readonly spine: FirstParentSpine; readonly frames: readonly ImmutableTreeFrame[] }
export interface TopologyCursor { readonly repoKey: string; readonly anchorSha: string; readonly generation: string; readonly frameKey: string }
