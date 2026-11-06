import type { HistoricScene, ImmutableCommit, ImmutableTreeFrame, TopologyCursor, TopologyWindow } from "./topology-contracts";
import { createTopologyWindow, planTopologyTransition, projectHistoricScene, topologyFrameKey } from "./topology";

export interface HistoricalCheckpoint { frame: ImmutableTreeFrame; commit: ImmutableCommit; scene: HistoricScene }
export interface HistoricalViewerModel {
  window: TopologyWindow;
  identity: string;
  checkpoints: HistoricalCheckpoint[];
  slots: { id: string; x: number; y: number }[];
}
/** Rebuild from C1 validators. Supplied spine labels, dates and scene coordinates
 * never determine order or geometry; no current WorldSnapshot is accepted. */
export function prepareHistoricalViewer(input: unknown): HistoricalViewerModel | null {
  try {
    if (!input || typeof input !== "object") return null;
    const raw = input as Partial<TopologyWindow>;
    const checked = createTopologyWindow(raw.anchor, raw.spine?.commits, raw.frames);
    if (!checked.ok || !checked.value.frames.length) return null;
    const window = checked.value, checkpoints: HistoricalCheckpoint[] = [];
    for (const commit of [...window.spine.commits].reverse()) {
      for (const frame of window.frames.filter(f => f.commitSha === commit.sha)) {
        const scene = projectHistoricScene(frame, commit);
        if (!scene.ok) return null;
        checkpoints.push({ frame, commit, scene: scene.value });
      }
    }
    if (!checkpoints.length) return null;
    const ids = [...new Set(checkpoints.flatMap(c => c.scene.nodes.map(n => n.id)))].sort();
    const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length))), rows = Math.ceil(ids.length / cols);
    const slots = ids.map((id, i) => ({ id, x: (i % cols - (cols - 1) / 2) * 180, y: (Math.floor(i / cols) - (rows - 1) / 2) * 145 }));
    return { window, checkpoints, slots, identity: JSON.stringify(window.anchor) };
  } catch { return null; }
}
export function checkpointCursor(model: HistoricalViewerModel, index: number): TopologyCursor {
  return { repoKey: model.window.anchor.repoKey, anchorSha: model.window.anchor.sha, generation: model.window.anchor.generation, frameKey: topologyFrameKey(model.checkpoints[index].frame) };
}
export function checkpointTransition(model: HistoricalViewerModel, from: number, to: number) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || !model.checkpoints[from] || !model.checkpoints[to] || from === to) return null;
  const transition = planTopologyTransition(model.window, checkpointCursor(model, from), checkpointCursor(model, to));
  return transition.ok ? transition.value : null;
}
