import { useEffect, useRef, useState } from "react";
import type { StyleId } from "../contracts";
import type { RepositoryPreviewData } from "../gallery/contracts";
import { animatePreview } from "../gallery/animation";
import { loadRepositoryPreview } from "../gallery/preview-loader";
import { layoutWorld, mapBounds, type PlacedNode } from "../world/layout";
import { PALETTES, paintTerrain, paintConnections, paintBuilding } from "../world/paint";
import "./repository-preview.css";

/** Move decorative survey signals along the actual source graph. The signal
 * speed, lights and camera drift are illustration, never measured activity. */
function paintPreviewMotion(
  g: CanvasRenderingContext2D, placed: PlacedNode[], edges: RepositoryPreviewData["edges"],
  style: StyleId, time: number, scale: number, x: number, y: number,
) {
  const palette = PALETTES[style];
  const byId = new Map(placed.map((node) => [node.node.id, node]));
  const orthogonal = style === "factorio" || style === "red-alert";
  g.save();
  g.lineWidth = 1.2;
  // Pixel-sized signals stay visible when a large repository is miniaturized.
  for (const [index, edge] of edges.slice(0, 24).entries()) {
    const a = byId.get(edge.source), b = byId.get(edge.target);
    if (!a || !b) continue;
    const point = (progress: number) => {
      if (orthogonal) {
        const horizontal = Math.abs(b.x - a.x), vertical = Math.abs(b.y - a.y);
        const distance = progress * (horizontal + vertical);
        return distance <= horizontal && horizontal
          ? { x: a.x + (b.x - a.x) * distance / horizontal, y: a.y + 9 }
          : { x: b.x, y: a.y + 9 + (b.y - a.y) * (distance - horizontal) / (vertical || 1) };
      }
      const inverse = 1 - progress, middle = (a.x + b.x) / 2;
      return {
        x: inverse ** 3 * a.x + 3 * inverse ** 2 * progress * middle + 3 * inverse * progress ** 2 * middle + progress ** 3 * b.x,
        y: inverse ** 3 * (a.y + 9) + 3 * inverse ** 2 * progress * (a.y + 9) + 3 * inverse * progress ** 2 * (b.y + 9) + progress ** 3 * (b.y + 9),
      };
    };
    for (let trail = 2; trail >= 0; trail--) {
      const progress = ((time * 0.28 + index * 0.173 - trail * 0.035) % 1 + 1) % 1;
      const position = point(0.1 + progress * 0.8);
      const px = position.x * scale + x, py = position.y * scale + y;
      g.globalAlpha = trail ? 0.3 / trail : 0.95;
      g.fillStyle = trail ? palette.glow : palette.text;
      g.shadowColor = palette.glow;
      g.shadowBlur = trail ? 0 : 8;
      g.beginPath();
      if (orthogonal) g.rect(px - 2.7, py - 2.7, 5.4, 5.4);
      else if (style === "civilization") {
        g.moveTo(px, py - 4); g.lineTo(px + 3, py); g.lineTo(px, py + 4); g.lineTo(px - 3, py); g.closePath();
      } else g.arc(px, py, trail ? 2.2 : 3.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.shadowBlur = 0;
  // A district scan also animates a single-node world without inventing links.
  for (const [index, node] of placed.entries()) {
    if (index % 3) continue;
    const phase = (time * 0.55 + index * 0.19) % 1;
    g.globalAlpha = 0.6 * (1 - phase);
    g.strokeStyle = palette.glow;
    g.beginPath();
    g.ellipse(node.x * scale + x, (node.y + 7) * scale + y, 8 + phase * 17, 4 + phase * 8, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

/** Pointer offset shared by a card's tilt handler and its canvas (write-only from the card). */
export interface PreviewTilt { x: number; y: number }
const easeOutBack = (t: number) => { const c = 1.7; return t <= 0 ? 0 : t >= 1 ? 1 : 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

// Share WorldCanvas's procedural renderer, with a small, noninteractive card camera.
// The shared animation clock caps work and pauses completely under reduced motion.
// On first sight the districts rise from the ground (staggered), then the finished
// city is baked into one cached bitmap so steady-state frames are a single blit
// plus the light sweep and survey signals.
function MiniWorldCanvas({ data, style, tilt }: { data: RepositoryPreviewData; style: StyleId; tilt?: PreviewTilt }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tiltRef = useRef(tilt);
  tiltRef.current = tilt;
  useEffect(() => {
    const cv = canvas.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const placed = layoutWorld(data.nodes.slice(0, 30), style).toSorted((a, b) => a.y - b.y);
    const edges = data.edges.slice(0, 96);
    const bounds = mapBounds(placed);
    const ground = document.createElement("canvas"), terrain = document.createElement("canvas");
    const bg = ground.getContext("2d"), tg = terrain.getContext("2d");
    if (!bg || !tg) return;
    let width = 1, height = 1, scale = 1, x = 0, y = 0;
    let stopAnimation = () => {};
    let introStart: number | null = null, baked = false;
    const INTRO = 0.9 + placed.length * 0.06;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const paintCity = (target: CanvasRenderingContext2D, progress: (index: number) => number) => {
      for (const [index, pn] of placed.entries()) {
        const rise = progress(index);
        if (rise <= 0) continue;
        target.save();
        target.translate(pn.x, pn.y + 20); target.scale(1, rise); target.translate(-pn.x, -(pn.y + 20));
        paintBuilding(target, pn, style, false, false, 0);
        target.restore();
      }
    };
    const draw = (time: number) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = PALETTES[style].ground;
      g.fillRect(0, 0, width, height);
      const lean = tiltRef.current;
      const driftX = time ? Math.sin(time * 0.7) * 2.5 - (lean?.x ?? 0) * 7 : 0;
      const driftY = time ? Math.cos(time * 0.55) * 1.5 - (lean?.y ?? 0) * 4 : 0;
      if (time > 0 && !baked) {
        if (introStart === null) introStart = time;
        const elapsed = time - introStart;
        g.drawImage(terrain, driftX, driftY);
        g.setTransform(scale, 0, 0, scale, x + driftX, y + driftY);
        paintCity(g, (index) => easeOutBack(Math.min(1, Math.max(0, (elapsed - index * 0.06) / 0.55))));
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (elapsed > INTRO) baked = true;
      } else g.drawImage(ground, driftX, driftY);
      if (time > 0) {
        // A slow sunlight band sweeps the miniature (illustration, not activity).
        const sweep = ((time * 0.12) % 1.8 - 0.4) * width;
        const band = g.createLinearGradient(sweep - 70, 0, sweep + 70, height * 0.5);
        band.addColorStop(0, "rgba(255,255,255,0)"); band.addColorStop(0.5, "rgba(255,255,240,0.12)"); band.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = band; g.fillRect(0, 0, width, height);
        paintPreviewMotion(g, placed, edges, style, time, scale, x + driftX, y + driftY);
      }
    };
    const updateMotion = () => {
      stopAnimation();
      draw(0);
      stopAnimation = !document.hidden && !motion.matches ? animatePreview(draw) : () => {};
    };
    const resize = () => {
      // At most 720×320 pixels per canvas, independent of device pixel ratio.
      const rect = cv.getBoundingClientRect();
      width = Math.max(1, Math.min(720, Math.round(rect.width * 1.5)));
      height = Math.max(1, Math.min(320, Math.round(rect.height * 1.5)));
      cv.width = ground.width = terrain.width = width;
      cv.height = ground.height = terrain.height = height;
      scale = Math.min(width / bounds.width, (height - 10) / bounds.height) * 0.92;
      x = width / 2 - (bounds.x + bounds.width / 2) * scale;
      y = height / 2 - (bounds.y + bounds.height / 2) * scale;
      for (const layer of [bg, tg]) {
        layer.setTransform(1, 0, 0, 1, 0, 0);
        layer.fillStyle = PALETTES[style].ground;
        layer.fillRect(0, 0, width, height);
        layer.setTransform(scale, 0, 0, scale, x, y);
        paintTerrain(layer, style, placed, data.fullName);
        paintConnections(layer, placed, edges, style, 0, false);
      }
      paintCity(bg, () => 1);
      draw(0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(cv);
    resize();
    updateMotion();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateMotion);
    return () => {
      stopAnimation();
      observer.disconnect();
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateMotion);
      ground.width = ground.height = terrain.width = terrain.height = 0;
    };
  }, [data, style]);
  return <canvas ref={canvas} className="repository-preview-canvas" data-testid="repository-preview-canvas" aria-hidden="true" />;
}

export function RepositoryPreview({ fullName, style, enabled = true, tilt }: { fullName: string; style: StyleId; enabled?: boolean; tilt?: PreviewTilt }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<RepositoryPreviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const prefetch = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNear(true); prefetch.disconnect(); } }, { rootMargin: "120px" });
    const viewport = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.01 });
    prefetch.observe(el);
    viewport.observe(el);
    return () => { prefetch.disconnect(); viewport.disconnect(); };
  }, []);
  useEffect(() => {
    if (!near || !enabled) return;
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    void loadRepositoryPreview(fullName, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setData(result); setNow(Date.now()); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [near, fullName, enabled]);
  useEffect(() => {
    if (!visible || !data?.refreshAfter || data.refreshAfter <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, data.refreshAfter - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [visible, data]);
  const mapped = !!data?.nodes.length;
  const state = data?.state === "cached" && data.refreshAfter !== null && data.refreshAfter <= now ? "stale" : data?.state;
  const label = failed ? ("Preview unavailable")
    : !data ? (near ? ("Loading cached map…") : ("Preview pending"))
    : state === "stale" ? ("Stale cache · current state unknown")
    : state === "cached" ? ("Cached snapshot")
    : state === "unavailable" ? ("Structure unavailable")
    : ("Unknown · no cached map");
  return (
    <div ref={box} className={`repository-preview preview-${style}`} data-preview-state={failed ? "unavailable" : state || "loading"}>
      <div className="repository-preview-stage">
        {mapped && visible && <MiniWorldCanvas data={data!} style={style} tilt={tilt} />}
        {!mapped && <div className="repository-preview-empty">{!data && near && !failed && <span className="preview-loader" aria-hidden="true"><i /><i /><i /></span>}<span>{label}</span><small>{"No automatic collection or model calls"}</small></div>}
      </div>
      {mapped && <div className="repository-preview-caption">
        <span>{label} · {data!.tree === "truncated" ? ("partial tree") : data!.github !== "ok" ? ("partial upstream evidence") : ("GitHub facts")}</span>
        <span>{data!.nodes.length}/{data!.totalNodes} {"districts"} · {data!.edges.length}/{data!.totalEdges} {"links"} · {`${data!.nodes.filter((n) => n.confidence === "observed").length} observed / ${data!.nodes.filter((n) => n.confidence === "inferred").length} inferred`}</span>
        <span>{data!.headSha?.slice(0, 7) || ("head unknown")} · {data!.collectedAt ? <time dateTime={data!.collectedAt}>{new Date(data!.collectedAt).toISOString().replace("T", " ").slice(0, 16)} UTC</time> : ("capture time unknown")}</span>
        <span className="repository-preview-motion-note">{"Motion illustrates links · not live activity"}</span>
      </div>}
    </div>
  );
}
