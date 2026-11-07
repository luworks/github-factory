import { hash, visibleGroups, type CacheStatus, type Landmark, type ProjectedLandmark } from "./model";
import { project, type Camera, type Size } from "./camera";
import { planetLook, rgba, routePoint, STAR_TILE, type Scenery } from "./scenery";
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface HitTarget {
    keys: string[];
    rects: Rect[];
    x: number;
    y: number;
}
export interface AtlasFrame {
    points: Landmark[];
    camera: Camera;
    size: Size;
    statuses: Map<string, CacheStatus>;
    selected: string | null;
    hover: string | null;
    /** 0..1 eased hover emphasis for `hover`. */
    hoverMix: number;
    lit: ReadonlySet<string>;
    /** Seconds on the decorative clock. Frozen under reduced motion. */
    time: number;
    animated: boolean;
    /** Device pixels per CSS pixel of the backing store (already capped). */
    ratio: number;
    scenery: Scenery;
}
export const contains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width + 8 && a.x + a.width + 8 > b.x && a.y < b.y + b.height + 8 && a.y + a.height + 8 > b.y;
const MONO = '"IBM Plex Mono",ui-monospace,SFMono-Regular,Consolas,monospace';
const SELECT = "#52a8ff", VERIFIED = "#7fe7dc", GOLD = "#ffd27a", INK = "#eef3f4";
const TAU = Math.PI * 2;
/** On-screen planet diameter in CSS pixels; grows gently with zoom. */
export const planetSize = (zoom: number) => Math.max(30, Math.min(76, 52 * (zoom / .3) ** .35));
const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Paint one Atlas frame. Original procedural scenery only: no textures, tiles,
 * physics or cross-repository graph. Routes are scenic, not dependency links.
 * The first full-canvas `fillRect` is the frame boundary (tests count it), so
 * other full-canvas overlays use `rect()` + `fill()`. Labels use `fillText`. */
export function paintAtlas(g: CanvasRenderingContext2D, f: AtlasFrame): HitTarget[] {
    const { points, camera, size, statuses, selected, hover, lit, time: t, animated, ratio, scenery } = f;
    const W = size.width, H = size.height;
    // 1. Deep space.
    const sky = g.createLinearGradient(0, 0, W * .35, H);
    sky.addColorStop(0, "#070b16"); sky.addColorStop(.55, "#0a1020"); sky.addColorStop(1, "#05070d");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // 2. Parallax star field: two cached tiles drifting slower than the map, plus twinkles.
    const stars = scenery.stars(ratio);
    const layer = (pattern: CanvasPattern | null, depth: number, alpha: number) => {
        if (!pattern) return;
        const tile = STAR_TILE * ratio, ox = mod(-(camera.centerX * camera.zoom * depth) * ratio - (animated ? t * 1.2 * depth * ratio : 0), tile), oy = mod(-(camera.centerY * camera.zoom * depth) * ratio, tile);
        g.save();
        g.setTransform(1, 0, 0, 1, ox - tile, oy - tile);
        g.globalAlpha = alpha;
        g.fillStyle = pattern;
        g.beginPath();
        g.rect(0, 0, W * ratio + tile * 2, H * ratio + tile * 2);
        g.fill();
        g.restore();
    };
    layer(stars.far, .06, .9);
    layer(stars.near, .16, 1);
    g.save();
    g.globalCompositeOperation = "lighter";
    const tw = 1024, txo = -(camera.centerX * camera.zoom * .26), tyo = -(camera.centerY * camera.zoom * .26);
    for (const s of stars.twinkles) for (let x = mod(s.x + txo, tw); x < W + 8; x += tw) for (let y = mod(s.y + tyo, tw); y < H + 8; y += tw) {
        const pulse = animated ? .5 + .5 * Math.sin(t * s.speed + s.phase) : .7, len = s.size * (1.6 + pulse * 2.2);
        g.globalAlpha = .18 + pulse * .5;
        g.fillStyle = s.warm ? "#ffe2b8" : "#dbe8ff";
        g.fillRect(x - len, y - .5, len * 2, 1);
        g.fillRect(x - .5, y - len, 1, len * 2);
        g.beginPath(); g.arc(x, y, s.size * .7, 0, TAU); g.fill();
    }
    g.restore();
    // 3. World layer: nebula regions, chart ticks, scenic routes.
    const z = camera.zoom, ox = W / 2 - camera.centerX * z, oy = H / 2 - camera.centerY * z;
    const nebula = scenery.nebula(points);
    g.save();
    g.translate(ox, oy);
    g.scale(z, z);
    g.imageSmoothingEnabled = true;
    g.globalAlpha = .95;
    g.drawImage(nebula, 0, 0, nebula.width * 8, nebula.height * 8);
    g.globalAlpha = 1;
    const left = -ox / z, top = -oy / z, right = left + W / z, bottom = top + H / z, step = z < .12 ? 1024 : 512;
    g.fillStyle = "rgba(160,190,220,.16)";
    const tick = 4 / z, thin = 1 / z;
    for (let x = Math.floor(left / step) * step; x <= right; x += step)
        for (let y = Math.floor(top / step) * step; y <= bottom; y += step) { g.fillRect(x - tick, y - thin / 2, tick * 2, thin); g.fillRect(x - thin / 2, y - tick, thin, tick * 2); }
    const routes = scenery.routes(points);
    g.lineCap = "round";
    for (const r of routes) {
        if (Math.max(r.ax, r.bx, r.cx) < left - 200 || Math.min(r.ax, r.bx, r.cx) > right + 200 || Math.max(r.ay, r.by, r.cy) < top - 200 || Math.min(r.ay, r.by, r.cy) > bottom + 200) continue;
        g.beginPath(); g.moveTo(r.ax, r.ay); g.quadraticCurveTo(r.cx, r.cy, r.bx, r.by);
        g.strokeStyle = "rgba(127,231,220,.07)"; g.lineWidth = 7 / z; g.stroke();
        g.setLineDash([1.5 / z, 9 / z]);
        g.lineDashOffset = animated ? -t * 16 / z : 0;
        g.strokeStyle = "rgba(196,240,234,.5)"; g.lineWidth = 1.6 / z; g.stroke();
        g.setLineDash([]);
    }
    g.restore();
    // Travelling route lights (decorative motion only).
    g.save();
    g.globalCompositeOperation = "lighter";
    const spark = scenery.glow(VERIFIED);
    for (const r of routes) {
        const u = mod((animated ? t * 90 / r.length : 0) + (r.seed % 997) / 997, 1), p = project(routePoint(r, u), camera, size);
        if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) continue;
        const s = 14;
        g.globalAlpha = .75 * Math.sin(u * Math.PI);
        g.drawImage(spark, p.x - s / 2, p.y - s / 2, s, s);
    }
    g.restore();
    // Occasional shooting star, screen space, ambient only.
    if (animated) {
        const cycle = 9, k = mod(t, cycle) / 1.1, n = Math.floor(t / cycle);
        if (k < 1) {
            const sx = (hash("meteor" + n) % 1000) / 1000 * W, sy = (hash("meteor-y" + n) % 1000) / 1000 * H * .5, dx = 260, dy = 110;
            const hx = sx + dx * k, hy = sy + dy * k, trail = g.createLinearGradient(hx - dx * .35, hy - dy * .35, hx, hy);
            trail.addColorStop(0, "rgba(220,235,255,0)"); trail.addColorStop(1, `rgba(220,235,255,${.7 * Math.sin(k * Math.PI)})`);
            g.strokeStyle = trail; g.lineWidth = 1.4;
            g.beginPath(); g.moveTo(hx - dx * .35, hy - dy * .35); g.lineTo(hx, hy); g.stroke();
        }
    }
    // Vignette keeps attention on the chart center.
    const vignette = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.hypot(W, H) * .62);
    vignette.addColorStop(0, "rgba(3,5,10,0)"); vignette.addColorStop(1, "rgba(3,5,10,.62)");
    g.fillStyle = vignette; g.beginPath(); g.rect(0, 0, W, H); g.fill();
    // 4. Landmarks.
    const groups = visibleGroups(points, camera, size, selected), targets: HitTarget[] = [];
    const D = planetSize(z), bucket = Math.max(16, Math.round(D * ratio * 1.18 / 8) * 8);
    const isSelected = (gr: ProjectedLandmark) => gr.keys.length === 1 && gr.keys[0] === selected;
    const isHover = (gr: ProjectedLandmark) => !!hover && gr.keys.length === 1 && gr.keys[0] === hover;
    // Label layout first so editorial region names can avoid landmark labels.
    const labels: { group: ProjectedLandmark; rect: Rect; text: string; below: boolean }[] = [], accepted: Rect[] = [];
    const maxLabels = W < 600 ? 10 : 24;
    const byPriority = [...groups].sort((a, b) => Number(b.keys.includes(selected ?? "")) - Number(a.keys.includes(selected ?? "")) || Number(b.keys.includes(hover ?? "")) - Number(a.keys.includes(hover ?? "")));
    const discs = groups.map(group => ({ group, x: group.x, y: group.y, r: group.keys.length > 1 ? 26 : D * .42 }));
    for (const group of byPriority) {
        if (labels.length >= maxLabels && !group.keys.includes(selected ?? "")) continue;
        const active = group.keys.includes(selected ?? ""), full = group.landmark?.fullName ?? `${group.keys.length} catalog landmarks`;
        let text = full;
        g.font = `${active ? 600 : 500} ${active ? 13 : 12}px ${MONO}`;
        const maxWidth = Math.min(active ? 260 : 180, W - 40);
        while (text.length > 1 && g.measureText(text + "…").width > maxWidth) text = text.slice(0, -1);
        if (text !== full) text += "…";
        const width = g.measureText(text).width + 30, height = 26, r = (group.keys.length > 1 ? 30 : D / 2) + 10;
        const candidates = [{ x: group.x - width / 2, y: group.y + r, width, height }, { x: group.x - width / 2, y: group.y - r - height, width, height }, { x: group.x + r + 4, y: group.y - height / 2, width, height }, { x: group.x - width - r - 4, y: group.y - height / 2, width, height },
            { x: group.x - 14, y: group.y + r - 4, width, height }, { x: group.x - width + 14, y: group.y + r - 4, width, height }, { x: group.x - 14, y: group.y - r - height + 4, width, height }, { x: group.x - width + 14, y: group.y - r - height + 4, width, height }];
        const fits = (c: Rect) => c.x >= 8 && c.x + c.width <= W - 8 && c.y >= 8 && c.y + c.height <= H - 64 && !accepted.some(a => overlaps(c, a)) && !(c.x + c.width > W - 64 && c.y < 230) && !(c.x < 300 && c.y < 62);
        // Prefer a spot that leaves every other planet uncovered; only the selected or hovered
        // landmark may fall back to label-only spacing, so crowded labels yield instead of hiding planets.
        const clear = (c: Rect) => !discs.some(d => d.group !== group && c.x < d.x + d.r && c.x + c.width > d.x - d.r && c.y < d.y + d.r && c.y + c.height > d.y - d.r);
        let index = candidates.findIndex(c => fits(c) && clear(c));
        if (index < 0 && (active || group.keys.includes(hover ?? ""))) index = candidates.findIndex(fits);
        if (index >= 0) { accepted.push(candidates[index]); labels.push({ group, rect: candidates[index], text, below: index === 0 || index === 4 || index === 5 }); }
    }
    // Editorial region names: faint chart lettering, never over a landmark label.
    if (z > .1) {
        g.save();
        g.font = `600 11px ${MONO}`;
        g.textAlign = "center"; g.textBaseline = "middle";
        (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "2px";
        for (const region of scenery.regions(points)) {
            const p = project({ x: region.x, y: region.y }, camera, size), text = region.name.toUpperCase(), width = g.measureText(text).width + 8;
            const rect = { x: p.x - width / 2, y: p.y - D / 2 - 64, width, height: 18 };
            if (rect.x < 8 || rect.x + rect.width > W - 64 || rect.y < 8 || rect.y > H - 70 || accepted.some(a => overlaps(rect, a))) continue;
            accepted.push(rect);
            g.fillStyle = rgba(region.color, .95);
            g.globalAlpha = .9;
            g.fillText(text, p.x, rect.y + 9);
        }
        g.restore();
    }
    for (const group of groups) {
        const { x, y } = group, key = group.keys[0], single = group.keys.length === 1, active = isSelected(group), hovered = isHover(group);
        const scale = hovered ? 1 + .16 * f.hoverMix : 1, d = D * scale, status = single ? statuses.get(key) : undefined, cached = status?.state === "cached";
        if (!single) {
            paintCluster(g, scenery, x, y, group.keys.length, t, animated);
        } else if (cached) {
            const look = planetLook(group.landmark?.style ?? "moonshot"), sprite = scenery.planet(group.landmark?.style ?? "moonshot", hash(key) % 4, bucket), s = d * 2.2;
            g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = .55 + (animated ? .12 * Math.sin(t * 1.3 + hash(key) % 7) : 0);
            const halo = scenery.glow(look.glow); g.drawImage(halo, x - d * 1.2, y - d * 1.2, d * 2.4, d * 2.4); g.restore();
            g.drawImage(sprite, x - s / 2, y - s / 2, s, s);
            // A small moon in orbit marks a verified capture.
            const a = (animated ? t * .6 : 0) + (hash(key) % 628) / 100, mx = x + Math.cos(a) * d * .82, my = y + Math.sin(a) * d * .3;
            if (Math.sin(a) > -.2 || !look.ring) { g.fillStyle = look.light; g.beginPath(); g.arc(mx, my, Math.max(1.5, d * .05), 0, TAU); g.fill(); }
        } else {
            paintGhost(g, x, y, d, status?.state ?? "unchecked", group.landmark?.style ?? "moonshot", t, animated);
        }
        if (active) paintSelection(g, x, y, single ? d : 60, t, animated);
        else if (hovered || (!single && group.keys.includes(hover ?? ""))) {
            g.beginPath(); g.arc(x, y, (single ? d : 60) * .72, 0, TAU);
            g.strokeStyle = `rgba(255,255,255,${.3 + .4 * f.hoverMix})`; g.lineWidth = 1.5; g.stroke();
        }
        if (group.keys.some(k => lit.has(k))) {
            const lx = x + d * .48, ly = y - d * .5;
            g.save(); g.globalCompositeOperation = "lighter"; g.drawImage(scenery.glow(GOLD), lx - 16, ly - 16, 32, 32); g.restore();
            g.fillStyle = "#1a1408"; g.strokeStyle = GOLD; g.lineWidth = 1.5;
            g.beginPath(); g.arc(lx, ly, 10, 0, TAU); g.fill(); g.stroke();
            g.fillStyle = GOLD; g.font = `600 13px ${MONO}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("✧", lx, ly + 1);
        }
        const hit = Math.max(44, (single ? D : 60) * 1.3);
        targets.push({ keys: group.keys, x, y, rects: [{ x: x - hit / 2, y: y - hit / 2, width: hit, height: hit }] });
    }
    // 5. Label plates.
    for (const { group, rect, text, below } of labels) {
        const active = group.keys.includes(selected ?? ""), hovered = group.keys.includes(hover ?? ""), single = group.keys.length === 1;
        const cached = single && statuses.get(group.keys[0])?.state === "cached";
        targets.find(tg => tg.keys === group.keys)?.rects.push(rect);
        if (below && single) {
            g.strokeStyle = active ? "rgba(82,168,255,.7)" : "rgba(200,220,230,.28)"; g.lineWidth = 1;
            g.beginPath(); g.moveTo(group.x, group.y + D / 2 + 2); g.lineTo(group.x, rect.y); g.stroke();
        }
        g.font = `${active ? 600 : 500} ${active ? 13 : 12}px ${MONO}`;
        g.beginPath(); g.roundRect(rect.x, rect.y, rect.width, rect.height, 6);
        g.fillStyle = active ? "#ffffff" : hovered ? "rgba(22,32,48,.95)" : "rgba(9,14,24,.86)";
        g.fill();
        if (!cached && !active) g.setLineDash([3, 3]);
        g.strokeStyle = active ? "#0068d6" : cached ? "rgba(127,231,220,.75)" : hovered ? "rgba(230,236,240,.8)" : "rgba(170,182,196,.6)";
        g.lineWidth = active ? 2 : 1; g.stroke(); g.setLineDash([]);
        // Status pip: filled = verified capture, hollow = not confirmed.
        const px = rect.x + 11, py = rect.y + rect.height / 2;
        g.beginPath(); g.arc(px, py, 3.2, 0, TAU);
        if (cached) { g.fillStyle = active ? "#0f766e" : VERIFIED; g.fill(); }
        else if (!single) { g.fillStyle = active ? "#171717" : "#c9d3dc"; g.fill(); }
        else { g.strokeStyle = active ? "#525252" : "#aab6c2"; g.lineWidth = 1.2; g.stroke(); }
        g.fillStyle = active ? "#171717" : INK;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(text, rect.x + 9 + rect.width / 2, rect.y + rect.height / 2 + .5);
    }
    return targets;
}

/** Unconfirmed landmark: a dashed, translucent outline world with a "?" glyph. */
function paintGhost(g: CanvasRenderingContext2D, x: number, y: number, d: number, state: string, style: string, t: number, animated: boolean) {
    const look = planetLook(style), r = d / 2;
    g.save();
    const fill = g.createRadialGradient(x - r * .3, y - r * .3, 0, x, y, r);
    fill.addColorStop(0, rgba(look.glow, .14)); fill.addColorStop(1, rgba(look.glow, .03));
    g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.setLineDash([3, 4]);
    g.lineDashOffset = animated ? -t * 4 : 0;
    g.strokeStyle = state === "unavailable" ? "rgba(255,190,110,.8)" : "rgba(214,224,232,.7)"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
    g.setLineDash([2, 6]);
    g.strokeStyle = "rgba(214,224,232,.22)"; g.lineWidth = 1;
    g.beginPath(); g.ellipse(x, y, r * 1.55, r * .45, -.35, 0, TAU); g.stroke();
    g.setLineDash([]);
    if (state === "loading") {
        const a = animated ? t * 5 : 0;
        g.strokeStyle = VERIFIED; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, r + 4, a, a + Math.PI * .6); g.stroke();
    }
    g.fillStyle = state === "unavailable" ? "#ffcf8a" : INK;
    g.font = `500 ${Math.round(Math.max(14, d * .42))}px ${MONO}`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(state === "miss" ? "×" : state === "unavailable" ? "!" : "?", x, y + 1);
    g.restore();
}

function paintCluster(g: CanvasRenderingContext2D, scenery: Scenery, x: number, y: number, count: number, t: number, animated: boolean) {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = .7;
    g.drawImage(scenery.glow("#8aa8ff"), x - 46, y - 46, 92, 92);
    g.globalAlpha = 1;
    const dots = Math.min(9, count), spin = animated ? t * .35 : 0;
    g.fillStyle = "#dbe6ff";
    for (let i = 0; i < dots; i++) { const a = spin + i / dots * TAU; g.beginPath(); g.arc(x + Math.cos(a) * 30, y + Math.sin(a) * 12, 1.8, 0, TAU); g.fill(); }
    g.restore();
    g.beginPath(); g.arc(x, y, 19, 0, TAU);
    g.fillStyle = "rgba(10,16,30,.92)"; g.fill();
    g.strokeStyle = "rgba(190,210,255,.75)"; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = INK; g.font = `600 13px ${MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(count), x, y + 1);
}

/** Targeting reticle plus a soft pulse; a single still ring without motion. */
function paintSelection(g: CanvasRenderingContext2D, x: number, y: number, d: number, t: number, animated: boolean) {
    g.save();
    if (animated) for (let i = 0; i < 2; i++) {
        const k = mod(t / 1.8 + i * .5, 1);
        g.globalAlpha = (1 - k) * .55;
        g.strokeStyle = SELECT; g.lineWidth = 2 * (1 - k) + .5;
        g.beginPath(); g.arc(x, y, d * (.6 + k * .75), 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
    g.strokeStyle = SELECT; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, d * .68, 0, TAU); g.stroke();
    const rr = d * .92, rot = animated ? t * .5 : Math.PI / 4, arm = Math.max(6, d * .2);
    g.lineWidth = 2; g.strokeStyle = "#cfe6ff";
    for (let i = 0; i < 4; i++) {
        const a = rot + i * Math.PI / 2;
        g.beginPath(); g.arc(x, y, rr, a - arm / rr, a + arm / rr); g.stroke();
    }
    g.restore();
}
