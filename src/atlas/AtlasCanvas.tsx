import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { constrain, easeCamera, fit, pan, resizeCamera, unproject, wheelFactor, zoomAt, type Camera, type Point, type Size } from "./camera";
import { homeBounds, statusText, type CacheStatus, type Landmark } from "./model";
import { contains, paintAtlas, type HitTarget } from "./paint";
import { createScenery } from "./scenery";
interface Props {
    landmarks: Landmark[];
    statuses: Map<string, CacheStatus>;
    selected: string | null;
    lit?: ReadonlySet<string>;
    initialView?: {
        centerX: number;
        centerY: number;
        zoomRatio: number;
    };
    locateRequest?: {
        key: string;
        revision: number;
    } | null;
    onChoose: (keys: string[], origin: "canvas") => void;
    onClear: () => void;
    onView: (camera: Camera, homeZoom: number, commit: boolean) => void;
}
type Change = { animate?: boolean; anchor?: { screen: Point; world: Point } | null };
/** Ambient scenery is capped near 30fps; camera easing runs at display rate. */
const AMBIENT_MS = 1000 / 30 - 4, STILL_TIME = 4.2;
export function AtlasCanvas(props: Props) {
    const canvas = useRef<HTMLCanvasElement>(null), wrap = useRef<HTMLDivElement>(null), data = useRef(props);
    data.current = props;
    const view = useRef<{
        camera: Camera;
        target: Camera;
        anchor: Change["anchor"];
        size: Size;
        initialized: boolean;
    }>({ camera: { centerX: 1400, centerY: 1000, zoom: .2 }, target: { centerX: 1400, centerY: 1000, zoom: .2 }, anchor: null, size: { width: 1, height: 1 }, initialized: false });
    const targets = useRef<HitTarget[]>([]), invalidate = useRef(() => { }), commitView = useRef<(c: Camera, commit?: boolean, how?: Change) => void>(() => { }), cancelGesture = useRef<(silent?: boolean) => void>(() => { });
    const pointers = useRef(new Map<number, Point>()), gesture = useRef<{
        mode: "drag" | "pinch";
        camera: Camera;
        point: Point;
        distance: number;
        moved: boolean;
        at: number;
        touch: boolean;
    } | null>(null), suppressTap = useRef(false);
    const [unavailable, setUnavailable] = useState(false), [tooltip, setTooltip] = useState<{
        text: string;
        detail: string;
        x: number;
        y: number;
        key: string;
    } | null>(null);
    const hoverTimer = useRef<ReturnType<typeof setTimeout>>(), hoverKey = useRef<string | null>(null), hoverMix = useRef(0);
    const setHover = (key: string | null) => { if (hoverKey.current === key) return; hoverKey.current = key; hoverMix.current = 0; if (canvas.current) canvas.current.style.cursor = key ? "pointer" : ""; invalidate.current(); };
    const clearHover = () => { if (hoverTimer.current)
        clearTimeout(hoverTimer.current); hoverTimer.current = undefined; setHover(null); setTooltip(null); };
    const change = (c: Camera, commit = false, how: Change = {}) => commitView.current(c, commit, how);
    const center = () => ({ x: view.current.size.width / 2, y: view.current.size.height / 2 });
    const zoomBy = (factor: number, at: Point = center()) => { const v = view.current; change(zoomAt(v.target, factor, at, v.size), true, { animate: true, anchor: { screen: at, world: unproject(at, v.target, v.size) } }); };
    const home = () => change(fit(homeBounds(data.current.landmarks), view.current.size), true, { animate: true });
    const locate = (key: string | null) => { const p = data.current.landmarks.find(x => x.repoKey === key); if (p)
        change({ ...view.current.target, centerX: p.x, centerY: p.y }, true, { animate: true }); };
    useEffect(() => {
        const cv = canvas.current, el = wrap.current;
        if (!cv || !el)
            return;
        let raf = 0, timer: ReturnType<typeof setTimeout> | 0 = 0, visible = true, disposed = false, stepAt = 0, motionState = "";
        const context = cv.getContext("2d");
        if (!context) {
            setUnavailable(true);
            return;
        }
        const scenery = createScenery(context), started = performance.now(), reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        let motion = !reduced.matches;
        const eligible = () => !disposed && visible && !document.hidden && el.clientWidth > 0 && el.clientHeight > 0;
        const request = () => { if (timer) {
            clearTimeout(timer);
            timer = 0;
        } if (!raf && eligible())
            raf = requestAnimationFrame(draw); };
        const mark = (state: string) => { if (state !== motionState) {
            motionState = state;
            el.dataset.motion = state;
        } };
        const draw = (now: number) => {
            raf = 0;
            if (!eligible())
                return;
            const v = view.current, dt = Math.max(0, now - (stepAt || now)), size = v.size, ratio = cv.width / size.width;
            stepAt = now;
            let moving = false;
            if (v.camera !== v.target) {
                const next = motion ? easeCamera(v.camera, v.target, dt, size, v.anchor) : null;
                v.camera = next ?? v.target;
                if (next)
                    moving = true;
                else
                    v.anchor = null;
            }
            const easingHover = motion && !!hoverKey.current && hoverMix.current < 1;
            hoverMix.current = motion ? Math.min(1, hoverMix.current + dt / 140) : 1;
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            targets.current = paintAtlas(context, { points: data.current.landmarks, camera: v.camera, size, statuses: data.current.statuses, selected: data.current.selected, hover: hoverKey.current, hoverMix: hoverMix.current, lit: data.current.lit ?? new Set(), time: motion ? (now - started) / 1000 : STILL_TIME, animated: motion, ratio, scenery });
            mark(moving ? "camera" : motion ? "ambient" : "still");
            if (moving || easingHover)
                request();
            else if (motion)
                timer = setTimeout(() => { timer = 0; request(); }, AMBIENT_MS);
        };
        invalidate.current = request;
        commitView.current = (camera, commit = false, how = {}) => {
            const v = view.current, wasMoving = v.camera !== v.target;
            v.target = constrain(camera, v.size);
            if (how.animate && motion) {
                v.anchor = how.anchor ?? null;
                if (!wasMoving)
                    stepAt = performance.now();
            }
            else {
                v.camera = v.target;
                v.anchor = null;
            }
            data.current.onView(v.target, fit(homeBounds(data.current.landmarks), v.size).zoom, commit);
            request();
        };
        const resize = () => {
            const rect = el.getBoundingClientRect(), size = { width: rect.width, height: rect.height };
            if (size.width < 1 || size.height < 1)
                return;
            const old = view.current, home = homeBounds(data.current.landmarks), homeCamera = fit(home, size), saved = data.current.initialView;
            const camera = old.initialized ? resizeCamera(old.target, old.size, size, home) : saved ? constrain({ centerX: saved.centerX, centerY: saved.centerY, zoom: homeCamera.zoom * saved.zoomRatio }, size) : constrain(homeCamera, size);
            const pixels = size.width < 600 ? 1500000 : 4000000, ratio = Math.min(1.5, window.devicePixelRatio || 1, Math.sqrt(pixels / (size.width * size.height)));
            cv.width = Math.max(1, Math.floor(size.width * ratio));
            cv.height = Math.max(1, Math.floor(size.height * ratio));
            // First arrival without a saved view eases in from a wider shot (motion only).
            const intro = !old.initialized && !saved && motion ? constrain({ ...camera, zoom: camera.zoom * .78 }, size) : camera;
            view.current = { camera: intro, target: camera, anchor: null, size, initialized: true };
            stepAt = performance.now();
            data.current.onView(camera, homeCamera.zoom, false);
            request();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(el);
        resize();
        const stop = () => {
            if (raf) cancelAnimationFrame(raf);
            if (timer) clearTimeout(timer);
            raf = 0;
            timer = 0;
            stepAt = 0;
            mark("paused");
            cancelGesture.current(disposed);
        };
        const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible)
            request();
        else
            stop(); });
        intersection.observe(el);
        const visibility = () => { if (document.hidden)
            stop();
        else
            request(); };
        document.addEventListener("visibilitychange", visibility);
        const onMotion = () => { motion = !reduced.matches; request(); };
        reduced.addEventListener("change", onMotion);
        const blur = () => cancelGesture.current();
        window.addEventListener("blur", blur);
        const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey)
            return; e.preventDefault(); clearHover(); const r = cv.getBoundingClientRect(); zoomBy(wheelFactor(e.deltaY, e.deltaMode, r.height), { x: e.clientX - r.left, y: e.clientY - r.top }); };
        cv.addEventListener("wheel", wheel, { passive: false });
        return () => { disposed = true; stop(); observer.disconnect(); intersection.disconnect(); document.removeEventListener("visibilitychange", visibility); reduced.removeEventListener("change", onMotion); window.removeEventListener("blur", blur); cv.removeEventListener("wheel", wheel); if (hoverTimer.current)
            clearTimeout(hoverTimer.current); scenery.dispose(); cv.width = 0; cv.height = 0; invalidate.current = () => { }; commitView.current = () => { }; };
    }, []);
    useEffect(() => { invalidate.current(); }, [props.landmarks, props.statuses, props.selected, props.lit]);
    useEffect(() => { if (props.locateRequest)
        locate(props.locateRequest.key); }, [props.locateRequest, props.landmarks]);
    const point = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const hits = (p: Point) => targets.current.filter(t => t.rects.some(r => contains(r, p.x, p.y)));
    const begin = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (e.button !== 0 || pointers.current.size >= 2)
            return;
        clearHover();
        const p = point(e);
        if (view.current.camera !== view.current.target) {
            view.current.target = view.current.camera;
            view.current.anchor = null;
        }
        pointers.current.set(e.pointerId, p);
        e.currentTarget.setPointerCapture(e.pointerId);
        const all = [...pointers.current.values()];
        if (all.length === 2) {
            suppressTap.current = true;
            gesture.current = { mode: "pinch", camera: { ...view.current.camera }, point: { x: (all[0].x + all[1].x) / 2, y: (all[0].y + all[1].y) / 2 }, distance: Math.max(1, Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y)), moved: true, at: performance.now(), touch: true };
        }
        else
            gesture.current = { mode: "drag", camera: { ...view.current.camera }, point: p, distance: 1, moved: false, at: performance.now(), touch: e.pointerType !== "mouse" };
    };
    const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const p = point(e), g = gesture.current;
        if (!pointers.current.has(e.pointerId) || !g) {
            if (e.pointerType === "mouse") {
                if (hoverTimer.current)
                    clearTimeout(hoverTimer.current);
                const hit = hits(p);
                if (hit.length === 1 && hit[0].keys.length === 1) {
                    const key = hit[0].keys[0], landmark = props.landmarks.find(x => x.repoKey === key);
                    setHover(key);
                    if (props.selected)
                        return;
                    hoverTimer.current = setTimeout(() => { setTooltip({ key, text: landmark?.fullName ?? key, detail: `${landmark ? landmark.category + " · " : ""}${statusText(props.statuses.get(key))}`, x: Math.max(8, Math.min(p.x + 16, view.current.size.width - 288)), y: Math.max(8, Math.min(p.y - 64, view.current.size.height - 76)) }); }, 120);
                }
                else
                    clearHover();
            }
            return;
        }
        pointers.current.set(e.pointerId, p);
        if (g.mode === "pinch" && pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const zoomed = zoomAt(g.camera, Math.hypot(a.x - b.x, a.y - b.y) / g.distance, g.point, view.current.size);
            change(pan(zoomed, mid.x - g.point.x, mid.y - g.point.y, view.current.size));
        }
        else {
            const dx = p.x - g.point.x, dy = p.y - g.point.y;
            if (Math.hypot(dx, dy) > (g.touch ? 10 : 6))
                g.moved = true;
            if (g.moved)
                change(pan(g.camera, dx, dy, view.current.size));
        }
    };
    const end = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!pointers.current.has(e.pointerId))
            return;
        const g = gesture.current;
        if (g?.mode === "drag" && !g.moved && !suppressTap.current && performance.now() - g.at <= 500) {
            const matched = hits(point(e));
            const keys = [...new Set(matched.flatMap(t => t.keys))];
            if (keys.length)
                props.onChoose(keys, "canvas");
        }
        pointers.current.delete(e.pointerId);
        if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        const remaining = [...pointers.current.values()];
        gesture.current = remaining.length ? { mode: "drag", camera: { ...view.current.camera }, point: remaining[0], distance: 1, moved: false, at: performance.now(), touch: true } : null;
        if (!remaining.length)
            suppressTap.current = false;
        change(view.current.camera, true);
    };
    cancelGesture.current = (silent = false) => {
        const cv = canvas.current, ids = [...pointers.current.keys()];
        pointers.current.clear();
        gesture.current = null;
        suppressTap.current = false;
        for (const id of ids) if (cv?.hasPointerCapture(id)) cv.releasePointerCapture(id);
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverKey.current = null;
        if (cv) cv.style.cursor = "";
        if (!silent) setTooltip(null);
    };
    return <div className="atlas-map" ref={wrap}>
  {unavailable ? <p className="atlas-map-unavailable" role="status">Map unavailable. Use the repository list and source card.</p> : <canvas ref={canvas} tabIndex={0} aria-label="Atlas map. Arrow keys pan; plus and minus zoom; zero returns home; F locates the selected landmark." onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={() => cancelGesture.current()} onLostPointerCapture={e => { if (pointers.current.has(e.pointerId))
            cancelGesture.current(); }} onPointerLeave={() => { if (!pointers.current.size)
            clearHover(); }} onKeyDown={e => {
                if (e.ctrlKey || e.metaKey || e.altKey)
                    return;
                const s = view.current.size, step = e.shiftKey ? 128 : 64;
                const deltas: Record<string, [
                    number,
                    number
                ]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
                if (deltas[e.key]) {
                    e.preventDefault();
                    change(pan(view.current.target, ...deltas[e.key], s), true, { animate: true });
                }
                else if (["+", "=", "-"].includes(e.key)) {
                    e.preventDefault();
                    zoomBy(e.key === "-" ? 1 / 1.2 : 1.2);
                }
                else if (e.key === "0") {
                    e.preventDefault();
                    home();
                }
                else if (e.key.toLowerCase() === "f") {
                    e.preventDefault();
                    locate(props.selected);
                }
                else if (e.key === "Escape") {
                    if (tooltip)
                        clearHover();
                    else
                        props.onClear();
                }
            }}/>}
  {tooltip && !props.selected && <div className="atlas-tooltip" style={{ left: tooltip.x, top: tooltip.y }}><strong>{tooltip.text}</strong><span>{tooltip.detail}</span></div>}
  <div className="atlas-camera" aria-label="Atlas camera controls">
   <button aria-label="Zoom in Atlas" onClick={() => zoomBy(1.2)}>+</button>
   <button aria-label="Zoom out Atlas" onClick={() => zoomBy(1 / 1.2)}>−</button>
   <button aria-label="Atlas home" onClick={home}>⌂</button>
   <button aria-label="Locate selected landmark" disabled={!props.selected} onClick={() => locate(props.selected)}>⌖</button>
  </div>
  <div className="atlas-hud" aria-hidden="true"><span>Observatory chart</span><span>Editorial regions · not live data</span></div>
  <ul className="atlas-legend" aria-label="Map legend">
   <li><i className="atlas-legend-planet"/>Verified cached capture</li>
   <li><i className="atlas-legend-ghost">?</i>Unchecked · outline only</li>
   <li><i className="atlas-legend-lantern">✧</i>Lantern lit</li>
  </ul>
  <p className="atlas-map-note">Scenic routes, not dependency links · Illustrative motion, not live data</p>
 </div>;
}
