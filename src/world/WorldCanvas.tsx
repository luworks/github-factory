import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import type { StyleId, WorldSnapshot } from "../contracts";
import { layoutWorld, mapBounds, pickNode, type PlacedNode } from "./layout";
import { paintTerrain, paintConnections, paintBuilding, paintLabels, PALETTES } from "./paint";
export interface WorldCanvasProps {
  world: WorldSnapshot;
  style: StyleId;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
  onRendered?: () => void;
  paused?: boolean;
}
export function WorldCanvas({ world, style, selectedId, onSelect, className = "", onRendered, paused = false }: WorldCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null),
    box = useRef<HTMLDivElement>(null),
    cam = useRef({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const data = useRef({ world, style, selectedId, onSelect, onRendered, paused });
  const renderedIdentity = useRef("");
  data.current = { world, style, selectedId, onSelect, onRendered, paused };
  const layoutIdentity = useRef("");
  const placed = useRef<PlacedNode[]>([]),
    hover = useRef<string | null>(null),
    size = useRef({ w: 1000, h: 700 }),
    [tip, setTip] = useState<string | null>(null);
  const reset = () => {
    const b = mapBounds(placed.current),
      { w, h } = size.current;
    cam.current = {
      k: Math.min(w / b.width, h / b.height) * 0.88,
      x: w / 2 - (b.x + b.width / 2) * Math.min(w / b.width, h / b.height) * 0.88,
      y: h / 2 - (b.y + b.height / 2) * Math.min(w / b.width, h / b.height) * 0.88,
    };
  };
  useEffect(() => {
    const identity = `${world.repo.fullName}:${style}:${world.nodes
      .map((n) => `${n.id}:${n.kind}`)
      .toSorted()
      .join("|")}`;
    placed.current = layoutWorld(world.nodes, style);
    if (layoutIdentity.current !== identity) {
      layoutIdentity.current = identity;
      reset();
      hover.current = null;
      setTip(null);
    }
  }, [world.repo.fullName, world.nodes, style]);
  useEffect(() => {
    const node = placed.current.find((p) => p.node.id === selectedId);
    if (!node) return;
    const c = cam.current,
      { w, h } = size.current;
    const x = node.x * c.k + c.x,
      y = node.y * c.k + c.y;
    if (x < 100 || x > w - 100 || y < 125 || y > h - 85) {
      cam.current = { ...c, x: w / 2 - node.x * c.k, y: h / 2 + 30 - node.y * c.k };
    }
  }, [selectedId]);
  useEffect(() => {
    const cv = canvas.current,
      el = box.current;
    if (!cv || !el) return;
    const g = cv.getContext("2d");
    if (!g) return;
    let frame = 0,
      stopped = false,
      last = 0;
    let ground: HTMLCanvasElement | null = null,
      groundKey = "";
    const resize = () => {
      const r = el.getBoundingClientRect(),
        dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height };
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      reset();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const retro = document.createElement("canvas");
    const retroContext = retro.getContext("2d")!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const draw = (now: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30 || document.hidden) return;
      last = now - ((now - last) % (1000 / 30));
      const { world: w, style: s, selectedId: sel } = data.current,
        p = PALETTES[s],
        dpr = Math.min(2, window.devicePixelRatio || 1),
        { w: width, h: height } = size.current,
        c = cam.current;
      const key = s + ":" + w.repo.fullName + ":" + w.headSha + ":" + w.nodes.map((n) => n.id).join(",");
      if (key !== groundKey) {
        ground = document.createElement("canvas");
        ground.width = 2800;
        ground.height = 1800;
        const bg = ground.getContext("2d")!;
        bg.translate(1400, 900);
        paintTerrain(bg, s, placed.current, w.repo.fullName);
        // Feather the finite scenery cache into the ground color when zoomed far out.
        bg.resetTransform();
        bg.globalCompositeOperation = "destination-in";
        const vertical = bg.createLinearGradient(0, 0, 0, 1800);
        vertical.addColorStop(0, "#0000");
        vertical.addColorStop(0.08, "#000");
        vertical.addColorStop(0.92, "#000");
        vertical.addColorStop(1, "#0000");
        bg.fillStyle = vertical;
        bg.fillRect(0, 0, 2800, 1800);
        const horizontal = bg.createLinearGradient(0, 0, 2800, 0);
        horizontal.addColorStop(0, "#0000");
        horizontal.addColorStop(0.06, "#000");
        horizontal.addColorStop(0.94, "#000");
        horizontal.addColorStop(1, "#0000");
        bg.fillStyle = horizontal;
        bg.fillRect(0, 0, 2800, 1800);
        groundKey = key;
      }
      // A deliberately coarse original raster gives the first military style a 90s RTS texture.
      // Text stays on the full-resolution canvas for legibility.
      const scene = s === "red-alert" ? retroContext : g;
      const resolution = s === "red-alert" ? 0.7 : dpr;
      if (s === "red-alert" && (retro.width !== Math.ceil(width * resolution) || retro.height !== Math.ceil(height * resolution))) {
        retro.width = Math.ceil(width * resolution);
        retro.height = Math.ceil(height * resolution);
      }
      scene.setTransform(resolution, 0, 0, resolution, 0, 0);
      scene.fillStyle = p.ground;
      scene.fillRect(0, 0, width, height);
      scene.setTransform(resolution * c.k, 0, 0, resolution * c.k, resolution * c.x, resolution * c.y);
      scene.imageSmoothingEnabled = s !== "red-alert";
      if (ground) scene.drawImage(ground, -1400, -900);
      paintConnections(scene, placed.current, w.edges, s, now / 1000, !motion.matches && !data.current.paused);
      for (const pn of placed.current.toSorted((a, b) => a.y - b.y))
        paintBuilding(scene, pn, s, sel === pn.node.id, hover.current === pn.node.id, motion.matches || data.current.paused ? 0 : now / 1000);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (s === "red-alert") {
        g.imageSmoothingEnabled = false;
        g.drawImage(retro, 0, 0, width, height);
      }
      const vignette = g.createRadialGradient(width / 2, height / 2, height * 0.15, width / 2, height / 2, width * 0.7);
      vignette.addColorStop(0, "#00000000");
      vignette.addColorStop(1, s === "civilization" ? "#514b3026" : "#07101666");
      g.fillStyle = vignette;
      g.fillRect(0, 0, width, height);
      paintLabels(g, placed.current, s, sel, hover.current, c);
      const identity = JSON.stringify([w.repo.fullName, w.headSha, w.collectedAt, w.source]);
      if (identity !== renderedIdentity.current) { renderedIdentity.current = identity; data.current.onRendered?.(); }
    };
    frame = requestAnimationFrame(draw);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top,
        c = cam.current,
        k = Math.max(0.18, Math.min(2.5, c.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      cam.current = { x: x - ((x - c.x) * k) / c.k, y: y - ((y - c.y) * k) / c.k, k };
    };
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      cv.removeEventListener("wheel", wheel);
    };
  }, []);
  const pos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(),
      c = cam.current;
    return { x: (e.clientX - r.left - c.x) / c.k, y: (e.clientY - r.top - c.y) / c.k };
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (d) {
      if (d.id !== e.pointerId) return;
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      cam.current.x = d.cx + dx;
      cam.current.y = d.cy + dy;
      return;
    }
    const p = pos(e);
    const id = pickNode(placed.current, p.x, p.y);
    hover.current = id;
    setTip(id);
  };
  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) {
      const p = pos(e);
      onSelect(pickNode(placed.current, p.x, p.y));
    }
  };
  const cancel = (id: number) => {
    if (drag.current?.id === id) drag.current = null;
  };
  const zoom = (factor: number) => {
    const c = cam.current,
      { w, h } = size.current,
      k = Math.max(0.18, Math.min(2.5, c.k * factor));
    cam.current = { x: w / 2 - ((w / 2 - c.x) * k) / c.k, y: h / 2 - ((h / 2 - c.y) * k) / c.k, k };
  };
  return (
    <div className={`world-canvas-wrap style-${style} ${className}`} ref={box}>
      <canvas
        ref={canvas}
        data-testid="world-canvas"
        aria-label={`${world.repo.name} repository world. Drag to pan, scroll to zoom. Select a district in the list for source evidence.`}
        tabIndex={0}
        style={{ touchAction: "none", cursor: drag.current ? "grabbing" : tip ? "pointer" : "grab" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={(e) => cancel(e.pointerId)}
        onLostPointerCapture={(e) => cancel(e.pointerId)}
        onPointerLeave={() => {
          hover.current = null;
          setTip(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "0") {
            reset();
            e.preventDefault();
          }
          if (e.key === "Escape") onSelect(null);
          if (e.key === "+" || e.key === "=") zoom(1.2);
          if (e.key === "-") zoom(0.8);
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(e.key)) e.preventDefault();
          const p = cam.current;
          if (e.key === "ArrowLeft") p.x += 30;
          if (e.key === "ArrowRight") p.x -= 30;
          if (e.key === "ArrowUp") p.y += 30;
          if (e.key === "ArrowDown") p.y -= 30;
        }}
      />
      <div
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}
        aria-label="Repository districts"
      >
        {world.nodes.map((node) => (
          <button key={node.id} aria-pressed={selectedId === node.id} onClick={() => onSelect(node.id)}>
            {node.label} — {node.kind}, {node.status}
          </button>
        ))}
      </div>
      <div className="map-coordinates">
        {world.repo.fullName.toUpperCase()}
        <br />
        <span>
          {world.nodes.length} DISTRICTS · {world.edges.length} CONNECTIONS
        </span>
      </div>
      <div className="camera-controls">
        <button aria-label="Zoom in" onClick={() => zoom(1.2)}>
          <Plus size={16} />
        </button>
        <button aria-label="Zoom out" onClick={() => zoom(0.8)}>
          <Minus size={16} />
        </button>
        <button aria-label="Reset camera" onClick={reset}>
          <Maximize2 size={15} />
        </button>
      </div>
      <div className="map-hint">
        DRAG TO EXPLORE <span>·</span> SCROLL TO ZOOM
      </div>
      {tip && (
        <div className="map-tooltip">
          {world.nodes.find((n) => n.id === tip)?.label}
          <span>Click to inspect district ↗</span>
        </div>
      )}
    </div>
  );
}
