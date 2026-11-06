import { useEffect, useRef } from "react";
import type { NodeKind, StyleId } from "../contracts";
import { drawArchitecture } from "../world/art";
import { PALETTES, MAP_CONTRAST } from "../world/paint";
import type { HistoricalCheckpoint, HistoricalViewerModel } from "./viewer-model";

/** Only supplied historic entries are painted. Empty stable slots have no
 * buildings or labels; instant checkpoint changes invent no intermediate tree. */
export function HistoricSceneCanvas({ model, checkpoint, style, selectedId, onSelect, onVisibility }: {
  model: HistoricalViewerModel; checkpoint: HistoricalCheckpoint; style: StyleId;
  selectedId: string | null; onSelect: (id: string) => void; onVisibility: (visible: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null);
  const camera = useRef({ x: 0, y: 0, k: 1 }), invalidate = useRef(() => {});
  const data = useRef({ model, checkpoint, style, selectedId, onSelect, onVisibility });
  data.current = { model, checkpoint, style, selectedId, onSelect, onVisibility };
  const drag = useRef<{ pointer: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  useEffect(() => {
    const cv = canvas.current, el = box.current, g = cv?.getContext("2d");
    if (!cv || !el || !g) return;
    let raf = 0, visible = false, stopped = false, width = 0, height = 0, sized = false, lastPaint = -Infinity;
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; const pointer = drag.current?.pointer; drag.current = null; if (pointer !== undefined && cv.hasPointerCapture(pointer)) cv.releasePointerCapture(pointer); };
    const draw = (now: number) => {
      raf = 0;
      if (stopped || !visible || document.hidden || !width || !height) return;
      if (now - lastPaint < 1000 / 30) { raf = requestAnimationFrame(draw); return; }
      lastPaint = now;
      const { model: m, checkpoint: current, style: s, selectedId: selected } = data.current;
      const dpr = Math.min(2, devicePixelRatio || 1), c = camera.current, positions = new Map(m.slots.map(p => [p.id, p]));
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = PALETTES[s].ground; g.fillRect(0, 0, width, height);
      g.setTransform(dpr * c.k, 0, 0, dpr * c.k, dpr * c.x, dpr * c.y);
      const present = new Set(current.scene.nodes.map(n => n.id));
      g.strokeStyle = MAP_CONTRAST.edge; g.lineWidth = 2;
      for (const edge of current.scene.edges) {
        const a = positions.get(edge.source), b = positions.get(edge.target);
        if (!a || !b || !present.has(edge.source) || !present.has(edge.target)) continue;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      for (const node of current.scene.nodes) {
        const p = positions.get(node.id); if (!p) continue;
        g.save(); g.translate(p.x, p.y);
        const kind: NodeKind = node.type === "tree" ? "package" : node.type === "blob" ? "docs" : "external";
        drawArchitecture(g, kind, s, 0);
        if (node.id === selected) { g.strokeStyle = MAP_CONTRAST.focus; g.lineWidth = 4; g.strokeRect(-71, -100, 142, 130); }
        g.restore();
        const text = [...node.label].slice(0, 20).join("") + ([...node.label].length > 20 ? "…" : "");
        g.font = "13px ui-monospace, monospace"; g.textAlign = "center";
        const w = Math.min(285, g.measureText(text).width + 16); g.fillStyle = MAP_CONTRAST.labelPlate; g.fillRect(p.x - w / 2, p.y + 33, w, 23);
        g.fillStyle = MAP_CONTRAST.labelText; g.fillText(text, p.x, p.y + 49, w - 12);
      }
      cv.dataset.paintCount = String(Number(cv.dataset.paintCount || 0) + 1);
      cv.dataset.camera = JSON.stringify(c);
      cv.dataset.paintedIds = JSON.stringify(current.scene.nodes.map(n => n.id));
    };
    const request = () => { if (!raf && visible && !document.hidden && !stopped) raf = requestAnimationFrame(draw); };
    invalidate.current = request;
    const resize = () => {
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) { stop(); return; }
      const oldWidth = width, oldHeight = height; width = r.width; height = r.height;
      const dpr = Math.min(2, devicePixelRatio || 1); cv.width = Math.round(width * dpr); cv.height = Math.round(height * dpr);
      if (!sized) {
        const slots = data.current.model.slots, xs = slots.map(p => p.x), ys = slots.map(p => p.y);
        const spanX = slots.length ? Math.max(...xs) - Math.min(...xs) + 180 : 180, spanY = slots.length ? Math.max(...ys) - Math.min(...ys) + 220 : 220;
        camera.current = { x: width / 2, y: height / 2 + 30, k: Math.min(1, width / spanX * .88, height / spanY * .88) };
      } else {
        camera.current.x += (width - oldWidth) / 2; camera.current.y += (height - oldHeight) / 2;
        if (width < oldWidth || height < oldHeight) { const slots=data.current.model.slots, xs=slots.map(p=>p.x), ys=slots.map(p=>p.y); const spanX=slots.length?Math.max(...xs)-Math.min(...xs)+180:180, spanY=slots.length?Math.max(...ys)-Math.min(...ys)+220:220; camera.current.k=Math.min(camera.current.k,width/spanX*.88,height/spanY*.88); }
      }
      sized = true; request();
    };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(el); resize();
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; data.current.onVisibility(visible && !document.hidden); if (visible) request(); else stop(); }); intersection.observe(el);
    const visibility = () => { data.current.onVisibility(visible && !document.hidden); if (document.hidden) stop(); else request(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { stopped = true; stop(); resizeObserver.disconnect(); intersection.disconnect(); document.removeEventListener("visibilitychange", visibility); invalidate.current = () => {}; };
  }, [model.identity]);
  useEffect(() => { invalidate.current(); }, [checkpoint, style, selectedId, model]);
  const zoom = (factor: number) => { camera.current.k = Math.max(.12, Math.min(3, camera.current.k * factor)); invalidate.current(); };
  return <div className="historic-scene-wrap" ref={box}>
    <canvas ref={canvas} data-testid="historic-scene-canvas" aria-label="Historical checkpoint map. Arrow keys pan, plus and minus zoom; select captured paths in the list." tabIndex={0}
      onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); camera.current.x += e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0; camera.current.y += e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0; invalidate.current(); } else if (["+", "=", "-"].includes(e.key)) { e.preventDefault(); zoom(e.key === "-" ? .85 : 1.15); } }}
      onPointerDown={e => { if (drag.current || e.pointerType === "mouse" && e.button !== 0) return; drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, cx: camera.current.x, cy: camera.current.y, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { const d = drag.current; if (!d || d.pointer !== e.pointerId) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true; camera.current.x = d.cx + dx; camera.current.y = d.cy + dy; invalidate.current(); }}
      onPointerUp={e => { const d = drag.current; if (!d || d.pointer !== e.pointerId) return; drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); if (!d.moved) { const r = e.currentTarget.getBoundingClientRect(), c = camera.current, x = (e.clientX - r.left - c.x) / c.k, y = (e.clientY - r.top - c.y) / c.k, visible = new Set(checkpoint.scene.nodes.map(n => n.id)); const hit = [...model.slots].reverse().find(p => visible.has(p.id) && Math.abs(x - p.x) < 73 && y > p.y - 100 && y < p.y + 55); if (hit) onSelect(hit.id); } }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
    <div className="historic-map-controls"><button type="button" aria-label="Zoom historical map in" onClick={() => zoom(1.15)}>+</button><button type="button" aria-label="Zoom historical map out" onClick={() => zoom(.85)}>−</button></div>
  </div>;
}
