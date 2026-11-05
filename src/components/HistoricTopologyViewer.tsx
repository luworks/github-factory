import { useCallback, useEffect, useMemo, useState } from "react";
import type { StyleId } from "../contracts";
import { HistoricSceneCanvas } from "../history/scene-canvas";
import { checkpointTransition, prepareHistoricalViewer, type HistoricalViewerModel } from "../history/viewer-model";
import "../history/viewer.css";
const styles: { id: StyleId; label: string }[] = [{ id: "moonshot", label: "Moon Factory" }, { id: "factorio", label: "Factorio" }, { id: "red-alert", label: "Red Alert" }, { id: "red-alert-2", label: "Red Alert 2" }, { id: "civilization", label: "Civilization" }];
const recordedTime = (value: string | null) => value === null ? "Unknown" : /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? value : `Unknown (original value: ${value})`;
/** Standalone only. No API, storage, current-world metrics or default demo data.
 * Integration requires an independently verified loaded TopologyWindow. */
export function HistoricTopologyViewer({ window: input }: { window: unknown }) {
  const model = useMemo(() => prepareHistoricalViewer(input), [input]);
  return model ? <LoadedHistoricalViewer key={model.identity} model={model} /> : <section className="historic-viewer" aria-label="Historical topology"><p role="status">Historical checkpoints unavailable. No validated captured frames were provided.</p></section>;
}
function LoadedHistoricalViewer({ model }: { model: HistoricalViewerModel }) {
  const [cursor, setCursor] = useState(model.checkpoints[0].scene.frameKey), [style, setStyle] = useState<StyleId>("moonshot"), [playing, setPlaying] = useState(false), [visible, setVisible] = useState(false);
  const [transition, setTransition] = useState<ReturnType<typeof checkpointTransition>>(null);
  const [selection, setSelection] = useState<{ id: string; path: string; selectedAt: string } | null>(null);
  const found = model.checkpoints.findIndex(c => c.scene.frameKey === cursor), index = found < 0 ? 0 : found, current = model.checkpoints[index];
  const onVisibility = useCallback((value: boolean) => { setVisible(value); if (!value) setPlaying(false); }, []);
  useEffect(() => { if (found < 0) { setCursor(model.checkpoints[0].scene.frameKey); setPlaying(false); setTransition(null); } }, [found, model]);
  const go = (target: number, manual = true) => {
    if (!Number.isInteger(target) || !model.checkpoints[target]) return;
    if (manual) setPlaying(false);
    setTransition(checkpointTransition(model, index, target)); setCursor(model.checkpoints[target].scene.frameKey);
  };
  useEffect(() => {
    if (!playing || !visible || index >= model.checkpoints.length - 1) return;
    const timer = setTimeout(() => { const next = index + 1; setTransition(checkpointTransition(model, index, next)); setCursor(model.checkpoints[next].scene.frameKey); if (next === model.checkpoints.length - 1) setPlaying(false); }, 1200);
    return () => clearTimeout(timer);
  }, [playing, visible, index, model]);
  const select = (id: string) => { const node = current.scene.nodes.find(n => n.id === id); if (node) setSelection({ id, path: node.path, selectedAt: current.commit.sha }); };
  const selected = current.scene.nodes.find(n => n.id === selection?.id), retained = selection && current.frame.entries.find(e => e.path === selection.path);
  const inScope = selection && (!current.frame.scope.prefix || selection.path === current.frame.scope.prefix || selection.path.startsWith(current.frame.scope.prefix + "/"));
  return <section className="historic-viewer" aria-label="Historical topology" data-testid="historic-viewer">
    <header><h2>Loaded historical checkpoints</h2><p>First-parent order · {model.checkpoints.length} supplied checkpoints · Intermediate topology is not reconstructed.</p></header>
    <details className="historic-anchor"><summary>Fixed source anchor</summary><dl><dt>Repository</dt><dd>{model.window.anchor.repoKey}</dd><dt>Anchor commit</dt><dd><code>{model.window.anchor.sha}</code></dd><dt>Generation</dt><dd>{model.window.anchor.generation}</dd></dl></details>
    <div className="historic-playback" role="group" aria-label="Historical checkpoint controls">
      <button type="button" onClick={() => go(index - 1)} disabled={index === 0}>Previous checkpoint</button>
      <button type="button" disabled={!visible || model.checkpoints.length < 2} onClick={() => { if (playing) setPlaying(false); else { if (index === model.checkpoints.length - 1) go(0); setPlaying(true); } }}>{playing ? "Pause checkpoints" : "Play checkpoints"}</button>
      <button type="button" onClick={() => go(index + 1)} disabled={index === model.checkpoints.length - 1}>Next checkpoint</button>
      <label>Seek loaded checkpoint <input type="range" min={0} max={model.checkpoints.length - 1} value={index} disabled={model.checkpoints.length < 2} onChange={e => go(Number(e.currentTarget.value))} /></label>
      <output aria-live="polite">Checkpoint {index + 1} of {model.checkpoints.length} · {playing ? "Playing" : "Paused"}</output>
    </div>
    <div className="historic-style" role="group" aria-label="Historical art style">{styles.map(s => <button key={s.id} type="button" aria-pressed={style === s.id} onClick={() => setStyle(s.id)}>{s.label}</button>)}</div>
    <HistoricSceneCanvas model={model} checkpoint={current} style={style} selectedId={selection?.id ?? null} onSelect={select} onVisibility={onVisibility} />
    <p className="historic-transition" data-testid="historic-transition" role="status">{!transition ? "Selected supplied checkpoint. No intermediate changes inferred." : transition.kind === "apply-exact-delta" ? `Exact adjacent endpoint change: ${transition.comparison.added.length} added entries, ${transition.comparison.removed.length} removed entries, ${transition.comparison.modified.length} changed entries. No rename or intermediate birth inferred.` : "Checkpoint gap. Jumped to a supplied frame; addition/deletion transition was not applied. Intermediate changes and rename evidence are unknown."}</p>
    <article className="historic-source" aria-label="Selected checkpoint source">
      <h3>Captured tree at selected commit</h3><dl><dt>Commit SHA</dt><dd><code data-testid="historic-commit">{current.commit.sha}</code></dd><dt>Tree SHA</dt><dd><code>{current.frame.treeSha}</code></dd><dt>Original author time</dt><dd>{recordedTime(current.commit.authorAt)}</dd><dt>Original committer time</dt><dd>{recordedTime(current.commit.committerAt)}</dd><dt>Commit capture / fetchedAt</dt><dd>{current.commit.provenance.map(p => <div key={p.sourceUrl + p.fetchedAt}><a href={p.sourceUrl} target="_blank" rel="noreferrer">Commit evidence</a> · {p.fetchedAt}</div>)}</dd><dt>Tree capture / fetchedAt</dt><dd>{current.frame.provenance.map(p => <div key={p.sourceUrl + p.fetchedAt}><a href={p.sourceUrl} target="_blank" rel="noreferrer">Tree evidence</a> · {p.fetchedAt}</div>)}</dd></dl>
      <p><a href={`https://github.com/${model.window.anchor.repoKey}/commit/${current.commit.sha}`} target="_blank" rel="noreferrer">View pinned commit</a> · <a href={`https://github.com/${model.window.anchor.repoKey}/tree/${current.commit.sha}`} target="_blank" rel="noreferrer">View pinned tree</a></p>
      <p>{current.commit.message}</p><p data-testid="historic-coverage">Scope: {current.frame.scope.prefix || "Repository root"} · {current.frame.completeness === "full" ? "Complete captured scope" : "Partial captured scope; absence unknown"}. Showing {current.scene.nodes.length} of {current.scene.observedEntries} observed entries; {current.scene.omittedObservedEntries} omitted from this map. Source omitted entries: {current.frame.sourceOmittedEntries ?? "Unknown"}. Input entries omitted by local limits: {current.frame.omittedInputEntries}. Architecture roles are inferred from entry type; status unknown. Edges show captured path containment only.</p>
    </article>
    <aside className="historic-selection" aria-label="Historical selection" aria-live="polite">{!selection ? "Select a captured path on the map or in the list." : selected ? <><strong>{selected.path}</strong><p>{selected.type} · {selected.role} · status unknown</p><a href={selected.sourceUrl} target="_blank" rel="noreferrer">View selected path at this commit</a></> : <><strong>{selection.path}</strong><p>{retained ? "Present in the captured tree, omitted from this bounded map." : inScope && current.frame.completeness === "full" ? "Not present in this complete captured scope." : "Not observed in this captured scope; presence is unknown."}</p><p>Selected at commit <code>{selection.selectedAt}</code>. This selection does not create a building in the current checkpoint.</p><a href={`https://github.com/${model.window.anchor.repoKey}/tree/${selection.selectedAt}/${selection.path.split("/").map(encodeURIComponent).join("/")}`} target="_blank" rel="noreferrer">View prior selected path source</a></>}</aside>
    <ol className="historic-paths" aria-label="Captured paths">{current.scene.nodes.map(node => <li key={node.id}><button type="button" aria-pressed={selection?.id === node.id} onClick={() => select(node.id)}>{node.path}</button><span>{node.type}</span><a href={node.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Source for ${node.path}`}>Source</a></li>)}</ol>
  </section>;
}
