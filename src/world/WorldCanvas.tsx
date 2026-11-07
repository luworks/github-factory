import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import type { StyleId, WorldEdge, WorldSnapshot } from "../contracts";
import { layoutWorld, mapBounds, pickNode, type LabelRect, type PlacedNode } from "./layout";
import { paintTerrain, paintConnections, paintBuilding, paintLabels, PALETTES } from "./paint";
import { setSunlight, setWind } from "./primitives";
import { sceneryAnchors, type SceneryAnchors } from "./terrain";
import {
  activityLevel,
  buildRoutes,
  DAY_CYCLE,
  paintAbove,
  paintAtmosphere,
  paintEmissive,
  paintGround,
  paintTint,
  skyAt,
  START_PHASE,
  STATIC_PHASE,
  STATIC_TIME,
  type FxFrame,
  type Route,
} from "./fx";
export interface WorldCanvasProps {
  world: WorldSnapshot;
  style: StyleId;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
  onRendered?: () => void;
  paused?: boolean;
}
type Camera = { x: number; y: number; k: number };
const MIN_ZOOM = 0.18,
  MAX_ZOOM = 2.5;
/** Frame budgets with ~2ms slack so a 60Hz display is not halved by RAF jitter. */
const FAST_FRAME = 1000 / 60 - 2,
  SLOW_FRAME = 1000 / 30 - 2;
export function WorldCanvas({ world, style, selectedId, onSelect, className = "", onRendered, paused = false }: WorldCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null),
    box = useRef<HTMLDivElement>(null),
    /** Rendered camera (eases toward `goal` when motion is allowed; equals it otherwise). */
    cam = useRef<Camera>({ x: 0, y: 0, k: 1 }),
    goal = useRef<Camera>({ x: 0, y: 0, k: 1 }),
    /** Exactly what was last drawn (camera + idle drift); used for picking. */
    view = useRef<Camera>({ x: 0, y: 0, k: 1 }),
    inertia = useRef({ x: 0, y: 0 }),
    lastInput = useRef(0),
    moving = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: boolean; lx: number; ly: number; lt: number; vx: number; vy: number } | null>(null);
  const data = useRef({ world, style, selectedId, onSelect, onRendered, paused });
  const renderedIdentity = useRef("");
  data.current = { world, style, selectedId, onSelect, onRendered, paused };
  const layoutIdentity = useRef("");
  const invalidate = useRef(() => {}), reconcileMotion = useRef(() => {});
  const placed = useRef<PlacedNode[]>([]),
    hover = useRef<string | null>(null),
    size = useRef({ w: 1000, h: 700 }),
    [tip, setTip] = useState<string | null>(null);
  /** Move the camera target. Without motion (reduced/paused) the view snaps exactly. */
  const aim = (next: Camera, snap = false) => {
    goal.current = { ...next };
    if (snap || !moving.current) cam.current = { ...next };
    lastInput.current = performance.now();
    invalidate.current();
  };
  const fit = (): Camera => {
    const b = mapBounds(placed.current),
      { w, h } = size.current,
      k = Math.min(w / b.width, h / b.height) * 0.88;
    return { k, x: w / 2 - (b.x + b.width / 2) * k, y: h / 2 - (b.y + b.height / 2) * k };
  };
  const reset = (snap = false) => {
    inertia.current = { x: 0, y: 0 };
    aim(fit(), snap);
  };
  useEffect(() => {
    const identity = `${world.repo.fullName}:${style}:${world.nodes
      .map((n) => `${n.id}:${n.kind}`)
      .toSorted()
      .join("|")}`;
    placed.current = layoutWorld(world.nodes, style);
    if (layoutIdentity.current !== identity) {
      layoutIdentity.current = identity;
      reset(true);
      hover.current = null;
      setTip(null);
    }
    invalidate.current();
  }, [world.repo.fullName, world.nodes, style]);
  useEffect(() => {
    const node = placed.current.find((p) => p.node.id === selectedId);
    if (!node) return;
    const c = goal.current,
      { w, h } = size.current;
    if (moving.current) {
      // Cinematic focus: glide the selected district to the stage center.
      inertia.current = { x: 0, y: 0 };
      aim({ ...c, x: w / 2 - node.x * c.k, y: h / 2 + 30 - node.y * c.k });
      return;
    }
    const x = node.x * c.k + c.x,
      y = node.y * c.k + c.y;
    if (x < 100 || x > w - 100 || y < 125 || y > h - 85) aim({ ...c, x: w / 2 - node.x * c.k, y: h / 2 + 30 - node.y * c.k }, true);
    invalidate.current();
  }, [selectedId]);
  useEffect(() => {
    const cv = canvas.current,
      el = box.current;
    if (!cv || !el) return;
    const g = cv.getContext("2d");
    if (!g) return;
    let frame = 0, stopped = false, visible = false, dirty = true, sized = false;
    let lastPaint = -Infinity, animationTime = 0, previousAnimationPaint: number | null = null;
    let ground: HTMLCanvasElement | null = null, groundKey = "";
    let routes: Route[] = [], routeNodes: PlacedNode[] | null = null, routeEdges: WorldEdge[] | null = null, routeStyle = "";
    let anchors: SceneryAnchors | null = null, activityKey = "", activity = 0.45;
    let drift = 0, cost = 0, slow = false, frames = 0;
    const retro = document.createElement("canvas"), retroContext = retro.getContext("2d")!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    // HTML chrome over the canvas (marked data-canvas-occluder, plus our own
    // controls). Measured on resize only, never inside a frame.
    let blocked: LabelRect[] = [];
    const occluders = () => [
      ...(el.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-canvas-occluder]") ?? []),
      ...el.querySelectorAll<HTMLElement>(".camera-controls, .map-hint, .map-coordinates"),
    ];
    const measureOccluders = () => {
      const r = el.getBoundingClientRect();
      blocked = occluders().map((o) => o.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0)
        .map((b) => ({ id: "", x: b.left - r.left, y: b.top - r.top, width: b.width, height: b.height }));
    };
    const animated = () => !motion.matches && !data.current.paused;
    let previousMode = animated();
    moving.current = previousMode;
    const eligible = () => !stopped && visible && !document.hidden && size.current.w > 0 && size.current.h > 0 && el.clientWidth > 0 && el.clientHeight > 0;
    const request = () => { if (!frame && eligible() && (dirty || animated())) frame = requestAnimationFrame(draw); };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0; previousAnimationPaint = null;
      const pointer = drag.current?.id;
      drag.current = null; hover.current = null; if (!stopped) setTip(null); dirty = true;
      inertia.current = { x: 0, y: 0 }; cam.current = { ...goal.current };
      if (pointer !== undefined && cv.hasPointerCapture(pointer)) cv.releasePointerCapture(pointer);
    };
    invalidate.current = () => { dirty = true; request(); };
    reconcileMotion.current = () => {
      const next = animated();
      if (next !== previousMode) stop();
      previousMode = next; moving.current = next;
      if (!next) cam.current = { ...goal.current };
      dirty = true; request();
    };
    const resize = () => {
      const r = el.getBoundingClientRect(), old = size.current;
      if (r.width < 1 || r.height < 1) { stop(); return; }
      measureOccluders();
      if (sized && r.width === old.w && r.height === old.h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height };
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      if (!sized) reset(true);
      else for (const c of [cam.current, goal.current]) { c.x += (r.width - old.w) / 2; c.y += (r.height - old.h) / 2; }
      sized = true; dirty = true; request();
    };
    const stepCamera = (dt: number, now: number) => {
      const c = cam.current, target = goal.current, v = inertia.current;
      if (!moving.current) { cam.current = { ...target }; drift = 0; return; }
      if (!drag.current && (v.x || v.y)) {
        target.x += v.x * dt; target.y += v.y * dt;
        const decay = Math.exp(-dt / 260);
        v.x *= decay; v.y *= decay;
        if (Math.hypot(v.x, v.y) < 0.01) inertia.current = { x: 0, y: 0 };
      }
      const a = 1 - Math.exp(-dt / 120);
      c.x += (target.x - c.x) * a; c.y += (target.y - c.y) * a; c.k *= Math.pow(target.k / c.k, a);
      if (Math.abs(target.x - c.x) < 0.05 && Math.abs(target.y - c.y) < 0.05 && Math.abs(target.k / c.k - 1) < 1e-4) cam.current = { ...target };
      // Gentle idle drift fades in after a few seconds without input, and out on any input.
      const idle = now - lastInput.current > 6000 && !drag.current;
      drift += ((idle ? 1 : 0) - drift) * (1 - Math.exp(-dt / (idle ? 2500 : 350)));
    };
    const draw = (now: number) => {
      frame = 0;
      if (!eligible() || !dirty && !animated()) return;
      if (!dirty && now - lastPaint < (slow ? SLOW_FRAME : FAST_FRAME)) { request(); return; }
      const started = performance.now();
      const live = animated(), reduced = motion.matches;
      // Clamp the step so a resumed tab/visibility never fast-forwards the world.
      const dt = live && previousAnimationPaint !== null ? Math.min(50, Math.max(0, now - previousAnimationPaint)) : 0;
      animationTime += dt;
      previousAnimationPaint = live ? now : null; lastPaint = now; dirty = false;
      stepCamera(dt, now);
      const { world: w, style: s, selectedId: sel } = data.current,
        p = PALETTES[s],
        dpr = Math.min(2, window.devicePixelRatio || 1),
        { w: width, h: height } = size.current,
        base = cam.current,
        T = animationTime / 1000;
      const c = { k: base.k, x: base.x + Math.sin(T * 0.11) * 9 * drift, y: base.y + Math.sin(T * 0.083 + 1) * 5 * drift };
      view.current = c;
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
        anchors = sceneryAnchors(s, placed.current, w.repo.fullName);
      }
      if (routeNodes !== placed.current || routeEdges !== w.edges || routeStyle !== s) {
        routes = buildRoutes(placed.current, w.edges, s);
        routeNodes = placed.current; routeEdges = w.edges; routeStyle = s;
      }
      const aKey = w.repo.fullName + w.collectedAt + (w.commits?.length ?? 0);
      if (aKey !== activityKey) { activity = activityLevel(w); activityKey = aKey; }
      const fxTime = reduced ? STATIC_TIME : T;
      const fx: FxFrame = {
        style: s, t: fxTime, sky: skyAt(s, reduced ? STATIC_PHASE : START_PHASE + T / DAY_CYCLE), activity,
        nodes: placed.current, routes, anchors: anchors!, quality: slow ? 0.55 : 1, live: !reduced,
      };
      // A deliberately coarse original raster gives the first military style a 90s RTS texture.
      // Text stays on the full-resolution canvas for legibility.
      const scene = s === "red-alert" ? retroContext : g;
      const resolution = s === "red-alert" ? 0.7 : dpr;
      if (s === "red-alert" && (retro.width !== Math.ceil(width * resolution) || retro.height !== Math.ceil(height * resolution))) {
        retro.width = Math.ceil(width * resolution);
        retro.height = Math.ceil(height * resolution);
      }
      const toCamera = () => scene.setTransform(resolution * c.k, 0, 0, resolution * c.k, resolution * c.x, resolution * c.y);
      scene.setTransform(resolution, 0, 0, resolution, 0, 0);
      scene.fillStyle = p.ground;
      scene.fillRect(0, 0, width, height);
      toCamera();
      scene.imageSmoothingEnabled = s !== "red-alert";
      if (ground) scene.drawImage(ground, -1400, -900);
      paintConnections(scene, placed.current, w.edges, s, fxTime, !reduced);
      paintGround(scene, fx);
      setSunlight(fx.sky.sunX, fx.sky.day * 0.9);
      setWind(fxTime, 2.6);
      try {
        for (const pn of placed.current.toSorted((a, b) => a.y - b.y))
          paintBuilding(scene, pn, s, sel === pn.node.id, hover.current === pn.node.id, fxTime + 1, true);
      } finally {
        // Shared art stays neutral for previews and history scenes.
        setSunlight(0, 0);
        setWind(0, 0);
      }
      paintAbove(scene, fx);
      scene.setTransform(resolution, 0, 0, resolution, 0, 0);
      paintTint(scene, fx, width, height);
      toCamera();
      paintEmissive(scene, fx);
      scene.setTransform(resolution, 0, 0, resolution, 0, 0);
      paintAtmosphere(scene, fx, width, height);
      toCamera();
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
      paintLabels(g, placed.current, s, sel, hover.current, c, { width, height, blocked });
      const identity = JSON.stringify([w.repo.fullName, w.headSha, w.collectedAt, w.source]);
      if (identity !== renderedIdentity.current) { renderedIdentity.current = identity; data.current.onRendered?.(); }
      // Adaptive quality: hold 60fps when the frame is cheap, fall back to 30fps when it is not.
      const spent = performance.now() - started;
      cost = cost ? cost * 0.9 + spent * 0.1 : spent;
      if (live) { if (cost > 11) slow = true; else if (cost < 6) slow = false; }
      if (++frames % 30 === 1) cv.dataset.frameMs = cost.toFixed(2);
      request();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const chrome = new ResizeObserver(() => { measureOccluders(); dirty = true; request(); });
    for (const o of occluders()) chrome.observe(o);
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible) { dirty = true; request(); } else stop(); });
    intersection.observe(el);
    const visibility = () => { if (document.hidden) stop(); else { dirty = true; request(); } };
    const media = () => reconcileMotion.current();
    document.addEventListener("visibilitychange", visibility); motion.addEventListener("change", media);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top,
        c = goal.current,
        k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      inertia.current = { x: 0, y: 0 };
      aim({ x: x - ((x - c.x) * k) / c.k, y: y - ((y - c.y) * k) / c.k, k });
    };
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      stopped = true; stop();
      observer.disconnect(); intersection.disconnect(); chrome.disconnect();
      document.removeEventListener("visibilitychange", visibility); motion.removeEventListener("change", media);
      invalidate.current = () => {}; reconcileMotion.current = () => {};
      cv.removeEventListener("wheel", wheel);
    };
  }, []);
  useEffect(() => { reconcileMotion.current(); }, [world, style, selectedId, paused]);
  const pos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(),
      c = view.current;
    return { x: (e.clientX - r.left - c.x) / c.k, y: (e.clientY - r.top - c.y) / c.k };
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    // Grab the world where it is drawn right now, cancelling any glide.
    inertia.current = { x: 0, y: 0 };
    goal.current = { ...cam.current };
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false, lx: e.clientX, ly: e.clientY, lt: e.timeStamp, vx: 0, vy: 0 };
    lastInput.current = performance.now();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (d) {
      if (d.id !== e.pointerId) return;
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      const span = e.timeStamp - d.lt;
      if (span > 0) {
        const blend = Math.min(1, span / 50);
        d.vx += ((e.clientX - d.lx) / span - d.vx) * blend;
        d.vy += ((e.clientY - d.ly) / span - d.vy) * blend;
      }
      d.lx = e.clientX; d.ly = e.clientY; d.lt = e.timeStamp;
      aim({ ...goal.current, x: d.cx + dx, y: d.cy + dy }, true);
      return;
    }
    const p = pos(e);
    const id = pickNode(placed.current, p.x, p.y);
    hover.current = id;
    setTip(id);
    invalidate.current();
  };
  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    // Throw: keep a released drag gliding when motion is allowed and the pointer was still moving.
    if (moving.current && d.moved && e.timeStamp - d.lt < 80 && Math.hypot(d.vx, d.vy) > 0.15)
      inertia.current = { x: Math.max(-3, Math.min(3, d.vx)), y: Math.max(-3, Math.min(3, d.vy)) };
    invalidate.current();
    if (!d.moved) {
      const p = pos(e);
      onSelect(pickNode(placed.current, p.x, p.y));
    }
  };
  const cancel = (id: number) => {
    if (drag.current?.id === id) { drag.current = null; inertia.current = { x: 0, y: 0 }; invalidate.current(); }
  };
  const zoom = (factor: number) => {
    const c = goal.current,
      { w, h } = size.current,
      k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.k * factor));
    inertia.current = { x: 0, y: 0 };
    aim({ x: w / 2 - ((w / 2 - c.x) * k) / c.k, y: h / 2 - ((h / 2 - c.y) * k) / c.k, k });
  };
  const pan = (dx: number, dy: number) => {
    inertia.current = { x: 0, y: 0 };
    aim({ ...goal.current, x: goal.current.x + dx, y: goal.current.y + dy });
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
          invalidate.current();
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
          if (e.key === "ArrowLeft") pan(30, 0);
          if (e.key === "ArrowRight") pan(-30, 0);
          if (e.key === "ArrowUp") pan(0, 30);
          if (e.key === "ArrowDown") pan(0, -30);
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
        <button aria-label="Reset camera" onClick={() => reset()}>
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
