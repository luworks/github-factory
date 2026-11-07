export interface Point {
    x: number;
    y: number;
}
export interface Size {
    width: number;
    height: number;
}
export interface Bounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
export interface Camera {
    centerX: number;
    centerY: number;
    zoom: number;
}
export const SCENE: Bounds = { left: 0, top: 0, right: 8192, bottom: 6144 };
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
export function fit(bounds: Bounds, size: Size, padding = 24) {
    const zoom = Math.min((Math.max(1, size.width) - Math.min(padding * 2, size.width / 2)) / Math.max(1, bounds.right - bounds.left), (Math.max(1, size.height) - Math.min(padding * 2, size.height / 2)) / Math.max(1, bounds.bottom - bounds.top)) * .88;
    return { centerX: (bounds.left + bounds.right) / 2, centerY: (bounds.top + bounds.bottom) / 2, zoom: clamp(zoom, .025, 2.5) };
}
export function constrain(camera: Camera, size: Size, bounds = SCENE): Camera {
    const minimum = Math.max(.025, fit(bounds, size).zoom * .85), zoom = clamp(Number.isFinite(camera.zoom) ? camera.zoom : minimum, minimum, 2.5);
    const axis = (n: number, start: number, end: number, span: number) => { const a = start + span / (2 * zoom), b = end - span / (2 * zoom); return a > b ? (start + end) / 2 : clamp(Number.isFinite(n) ? n : (start + end) / 2, a, b); };
    return { centerX: axis(camera.centerX, bounds.left, bounds.right, size.width), centerY: axis(camera.centerY, bounds.top, bounds.bottom, size.height), zoom };
}
export const project = (p: Point, c: Camera, s: Size): Point => ({ x: s.width / 2 + (p.x - c.centerX) * c.zoom, y: s.height / 2 + (p.y - c.centerY) * c.zoom });
export const unproject = (p: Point, c: Camera, s: Size): Point => ({ x: c.centerX + (p.x - s.width / 2) / c.zoom, y: c.centerY + (p.y - s.height / 2) / c.zoom });
export function pan(c: Camera, dx: number, dy: number, s: Size) { return constrain({ ...c, centerX: c.centerX - dx / c.zoom, centerY: c.centerY - dy / c.zoom }, s); }
export function zoomAt(c: Camera, factor: number, point: Point, s: Size) {
    const before = unproject(point, c, s), bounded = constrain({ ...c, zoom: c.zoom * factor }, s), after = unproject(point, bounded, s);
    return constrain({ ...bounded, centerX: bounded.centerX + before.x - after.x, centerY: bounded.centerY + before.y - after.y }, s);
}
export function resizeCamera(c: Camera, old: Size, next: Size, home: Bounds) { return constrain({ ...c, zoom: fit(home, next).zoom * c.zoom / fit(home, old).zoom }, next); }
/** One exponential easing step from `from` toward `to` over `dt` ms (zoom eases
 * in log space). With an `anchor`, the anchored world point stays under the same
 * screen point throughout, so pointer zoom does not drift. Returns null once the
 * remaining motion is below a quarter pixel: the caller then snaps to `to`. */
export function easeCamera(from: Camera, to: Camera, dt: number, s: Size, anchor?: { screen: Point; world: Point } | null, tau = 110): Camera | null {
    const k = 1 - Math.exp(-Math.max(0, Math.min(dt, 100)) / tau);
    const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * k);
    let next: Camera = { centerX: from.centerX + (to.centerX - from.centerX) * k, centerY: from.centerY + (to.centerY - from.centerY) * k, zoom };
    if (anchor && Math.abs(Math.log(to.zoom / from.zoom)) > 1e-6)
        next = constrain({ zoom, centerX: anchor.world.x - (anchor.screen.x - s.width / 2) / zoom, centerY: anchor.world.y - (anchor.screen.y - s.height / 2) / zoom }, s);
    const pixels = Math.hypot(next.centerX - to.centerX, next.centerY - to.centerY) * to.zoom, zoomGap = Math.abs(Math.log(next.zoom / to.zoom));
    return pixels < .25 && zoomGap < 1e-3 ? null : next;
}
export const wheelFactor = (delta: number, mode: number, height: number) => Math.exp(-clamp(delta * (mode === 1 ? 16 : mode === 2 ? height : 1), -240, 240) * .0015);
