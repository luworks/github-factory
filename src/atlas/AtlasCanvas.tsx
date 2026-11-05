import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { constrain, fit, pan, resizeCamera, wheelFactor, zoomAt, type Camera, type Point, type Size } from "./camera";
import { homeBounds, type CacheStatus, type Landmark } from "./model";
import { contains, paintAtlas, type HitTarget } from "./paint";
interface Props {
    landmarks: Landmark[];
    statuses: Map<string, CacheStatus>;
    selected: string | null;
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
export function AtlasCanvas(props: Props) {
    const canvas = useRef<HTMLCanvasElement>(null), wrap = useRef<HTMLDivElement>(null), data = useRef(props);
    data.current = props;
    const view = useRef<{
        camera: Camera;
        size: Size;
        initialized: boolean;
    }>({ camera: { centerX: 1400, centerY: 1000, zoom: .2 }, size: { width: 1, height: 1 }, initialized: false });
    const targets = useRef<HitTarget[]>([]), invalidate = useRef(() => { }), commitView = useRef<(c: Camera, commit?: boolean) => void>(() => { }), cancelGesture = useRef<(silent?: boolean) => void>(() => { });
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
        x: number;
        y: number;
        key: string;
    } | null>(null);
    const hoverTimer = useRef<ReturnType<typeof setTimeout>>(), hoverKey = useRef<string | null>(null);
    const clearHover = () => { if (hoverTimer.current)
        clearTimeout(hoverTimer.current); hoverTimer.current = undefined; hoverKey.current = null; setTooltip(null); invalidate.current(); };
    const change = (c: Camera, commit = false) => commitView.current(c, commit);
    const home = () => change(fit(homeBounds(data.current.landmarks), view.current.size), true);
    const locate = (key: string | null) => { const p = data.current.landmarks.find(x => x.repoKey === key); if (p)
        change({ ...view.current.camera, centerX: p.x, centerY: p.y }, true); };
    useEffect(() => {
        const cv = canvas.current, el = wrap.current;
        if (!cv || !el)
            return;
        let raf = 0, visible = true, disposed = false, lastPaint = -Infinity;
        const context = cv.getContext("2d");
        if (!context) {
            setUnavailable(true);
            return;
        }
        const eligible = () => !disposed && visible && !document.hidden && el.clientWidth > 0 && el.clientHeight > 0;
        const request = () => { if (!raf && eligible())
            raf = requestAnimationFrame(draw); };
        const draw = (now: number) => {
            raf = 0;
            if (!eligible())
                return;
            if (now - lastPaint < 1000 / 30) {
                request();
                return;
            }
            lastPaint = now;
            const { size, camera } = view.current, ratio = cv.width / size.width;
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            targets.current = paintAtlas(context, data.current.landmarks, camera, size, data.current.statuses, data.current.selected, hoverKey.current);
        };
        invalidate.current = request;
        commitView.current = (camera, commit = false) => { view.current.camera = constrain(camera, view.current.size); data.current.onView(view.current.camera, fit(homeBounds(data.current.landmarks), view.current.size).zoom, commit); request(); };
        const resize = () => {
            const rect = el.getBoundingClientRect(), size = { width: rect.width, height: rect.height };
            if (size.width < 1 || size.height < 1)
                return;
            const old = view.current, home = homeBounds(data.current.landmarks), homeCamera = fit(home, size), saved = data.current.initialView;
            const camera = old.initialized ? resizeCamera(old.camera, old.size, size, home) : saved ? constrain({ centerX: saved.centerX, centerY: saved.centerY, zoom: homeCamera.zoom * saved.zoomRatio }, size) : constrain(homeCamera, size);
            const pixels = size.width < 600 ? 1500000 : 4000000, ratio = Math.min(1.5, window.devicePixelRatio || 1, Math.sqrt(pixels / (size.width * size.height)));
            cv.width = Math.max(1, Math.floor(size.width * ratio));
            cv.height = Math.max(1, Math.floor(size.height * ratio));
            view.current = { camera, size, initialized: true };
            data.current.onView(camera, homeCamera.zoom, false);
            request();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(el);
        resize();
        const stop = () => {
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
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
        const blur = () => cancelGesture.current();
        window.addEventListener("blur", blur);
        const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey)
            return; e.preventDefault(); clearHover(); const r = cv.getBoundingClientRect(); change(zoomAt(view.current.camera, wheelFactor(e.deltaY, e.deltaMode, r.height), { x: e.clientX - r.left, y: e.clientY - r.top }, view.current.size), true); };
        cv.addEventListener("wheel", wheel, { passive: false });
        return () => { disposed = true; stop(); observer.disconnect(); intersection.disconnect(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", blur); cv.removeEventListener("wheel", wheel); if (hoverTimer.current)
            clearTimeout(hoverTimer.current); cv.width = 0; cv.height = 0; invalidate.current = () => { }; commitView.current = () => { }; };
    }, []);
    useEffect(() => { invalidate.current(); }, [props.landmarks, props.statuses, props.selected]);
    useEffect(() => { if (props.locateRequest)
        locate(props.locateRequest.key); }, [props.locateRequest, props.landmarks]);
    const point = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const hits = (p: Point) => targets.current.filter(t => t.rects.some(r => contains(r, p.x, p.y)));
    const begin = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (e.button !== 0 || pointers.current.size >= 2)
            return;
        clearHover();
        const p = point(e);
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
            if (e.pointerType === "mouse" && !props.selected) {
                if (hoverTimer.current)
                    clearTimeout(hoverTimer.current);
                const hit = hits(p);
                if (hit.length === 1 && hit[0].keys.length === 1) {
                    const key = hit[0].keys[0], landmark = props.landmarks.find(x => x.repoKey === key);
                    hoverTimer.current = setTimeout(() => { hoverKey.current = key; setTooltip({ key, text: landmark?.fullName ?? key, x: Math.max(8, Math.min(p.x + 12, view.current.size.width - 288)), y: Math.max(8, Math.min(p.y - 48, view.current.size.height - 60)) }); invalidate.current(); }, 120);
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
        if (!silent) setTooltip(null);
    };
    return <div className="atlas-map" ref={wrap}>
  {unavailable ? <p className="atlas-map-unavailable" role="status">Map unavailable. Use the repository list and source card.</p> : <canvas ref={canvas} tabIndex={0} aria-label="Atlas map. Arrow keys pan; plus and minus zoom; zero returns home; F locates the selected landmark." onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={() => cancelGesture.current()} onLostPointerCapture={e => { if (pointers.current.has(e.pointerId))
            cancelGesture.current(); }} onPointerLeave={() => { if (!pointers.current.size)
            clearHover(); }} onKeyDown={e => {
                if (e.ctrlKey || e.metaKey || e.altKey)
                    return;
                const c = view.current.camera, s = view.current.size, step = e.shiftKey ? 128 : 64;
                const deltas: Record<string, [
                    number,
                    number
                ]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
                if (deltas[e.key]) {
                    e.preventDefault();
                    change(pan(c, ...deltas[e.key], s), true);
                }
                else if (["+", "=", "-"].includes(e.key)) {
                    e.preventDefault();
                    change(zoomAt(c, e.key === "-" ? 1 / 1.2 : 1.2, { x: s.width / 2, y: s.height / 2 }, s), true);
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
  {tooltip && !props.selected && <div className="atlas-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.text}</div>}
  <div className="atlas-camera" aria-label="Atlas camera controls">
   <button aria-label="Zoom in Atlas" onClick={() => change(zoomAt(view.current.camera, 1.2, { x: view.current.size.width / 2, y: view.current.size.height / 2 }, view.current.size), true)}>+</button>
   <button aria-label="Zoom out Atlas" onClick={() => change(zoomAt(view.current.camera, 1 / 1.2, { x: view.current.size.width / 2, y: view.current.size.height / 2 }, view.current.size), true)}>−</button>
   <button aria-label="Atlas home" onClick={home}>⌂</button>
   <button aria-label="Locate selected landmark" disabled={!props.selected} onClick={() => locate(props.selected)}>⌖</button>
  </div>
  <p className="atlas-map-note">Scenic routes, not dependency links · Static scenery</p>
 </div>;
}
