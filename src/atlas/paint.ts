import { MAP_CONTRAST as C } from "../world/paint";
import { hash, visibleGroups, type CacheStatus, type Landmark } from "./model";
import type { Camera, Size } from "./camera";
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
export const contains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width + 8 && a.x + a.width + 8 > b.x && a.y < b.y + b.height + 8 && a.y + a.height + 8 > b.y;
const polygon = (g: CanvasRenderingContext2D, points: number[][], fill: string, stroke?: string) => { g.beginPath(); points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 1.5;
    g.stroke();
} };
function sculpture(g: CanvasRenderingContext2D, x: number, y: number, size: number, variant: number) {
    g.save();
    g.translate(x, y);
    g.scale(size / 64, size / 64);
    g.fillStyle = C.surface;
    g.beginPath();
    g.ellipse(0, 14, 40, 16, 0, 0, Math.PI * 2);
    g.fill();
    polygon(g, [[-35, 3], [0, -8], [35, 3], [35, 14], [0, 25], [-35, 14]], C.border, C.edge);
    polygon(g, [[-35, 3], [0, -8], [35, 3], [0, 14]], C.muted, C.edge);
    if (variant === 0) {
        polygon(g, [[-23, 0], [0, -9], [23, 0], [23, -13], [0, -22], [-23, -13]], C.surface, C.edge);
        g.beginPath();
        g.ellipse(0, -17, 17, 14, 0, Math.PI, 0);
        g.lineTo(17, -13);
        g.lineTo(-17, -13);
        g.closePath();
        g.fillStyle = C.muted;
        g.fill();
        g.strokeStyle = C.edge;
        g.stroke();
    }
    else if (variant === 1) {
        for (const [xx, hh] of [[-18, 34], [15, 45]]) {
            polygon(g, [[xx - 7, 6], [xx + 7, 1], [xx + 7, -hh], [xx - 7, -hh + 5]], C.surface, C.edge);
            polygon(g, [[xx - 10, -hh + 4], [xx, -hh - 2], [xx + 10, -hh - 6], [xx + 2, -hh]], C.muted, C.edge);
        }
        g.strokeStyle = C.edge;
        g.lineWidth = 5;
        g.beginPath();
        g.arc(-1, -10, 17, Math.PI, 0);
        g.stroke();
    }
    else
        for (let i = 0; i < 3; i++) {
            g.beginPath();
            g.ellipse(0, -i * 9, 28 - i * 6, 11 - i * 2, 0, 0, Math.PI * 2);
            g.fillStyle = i % 2 ? C.surface : C.muted;
            g.fill();
            g.strokeStyle = C.edge;
            g.stroke();
        }
    g.restore();
}
/** Original vector scenery. No textures, tile cache, physics or cross-repo graph. */
export function paintAtlas(g: CanvasRenderingContext2D, points: Landmark[], camera: Camera, size: Size, statuses: Map<string, CacheStatus>, selected: string | null, hover: string | null, lit: ReadonlySet<string> = new Set()) {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, size.width, size.height);
    g.save();
    g.translate(size.width / 2 - camera.centerX * camera.zoom, size.height / 2 - camera.centerY * camera.zoom);
    g.scale(camera.zoom, camera.zoom);
    for (let i = 0; i < 14; i++) {
        const x = 170 + (i % 5) * 1720, y = 340 + Math.floor(i / 5) * 1830, skew = (i % 3) * 140;
        polygon(g, [[x, y], [x + 1100, y - 180 - skew], [x + 1510, y + 340], [x + 1050, y + 640], [x - 120, y + 470]], C.surface);
        g.beginPath();
        g.moveTo(x - 120, y + 470);
        g.bezierCurveTo(x + 350, y + 680, x + 1100, y + 570, x + 1510, y + 340);
        g.strokeStyle = C.border;
        g.globalAlpha = .35;
        g.lineWidth = 2 / camera.zoom;
        g.stroke();
        g.globalAlpha = 1;
    }
    g.beginPath();
    g.moveTo(550, 1200);
    g.bezierCurveTo(2000, 2200, 2350, 400, 4100, 1200);
    g.bezierCurveTo(6000, 2300, 3700, 3700, 6700, 4900);
    g.setLineDash([9 / camera.zoom, 12 / camera.zoom]);
    g.strokeStyle = C.border;
    g.lineWidth = 1.5 / camera.zoom;
    g.stroke();
    g.setLineDash([]);
    g.restore();
    const groups = visibleGroups(points, camera, size, selected), targets: HitTarget[] = [], labels: {
        group: typeof groups[number];
        rect: Rect;
        text: string;
    }[] = [], accepted: Rect[] = [];
    const maxLabels = size.width < 600 ? 10 : 24;
    const byPriority = [...groups].sort((a, b) => Number(b.keys.includes(selected ?? "")) - Number(a.keys.includes(selected ?? "")) || Number(b.keys.includes(hover ?? "")) - Number(a.keys.includes(hover ?? "")));
    for (const group of groups) {
        const active = group.keys.length === 1 && group.keys[0] === selected, cached = group.landmark && statuses.get(group.landmark.repoKey)?.state === "cached", extent = camera.zoom < .12 ? 36 : camera.zoom > .6 ? 72 : 54;
        const { x, y } = group;
        if (group.keys.length > 1) {
            g.fillStyle = C.surface;
            g.strokeStyle = C.border;
            g.lineWidth = 2;
            g.beginPath();
            g.roundRect(x - 27, y - 26, 54, 52, 8);
            g.fill();
            g.stroke();
            g.fillStyle = C.text;
            g.font = '600 14px ui-monospace,monospace';
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(String(group.keys.length), x, y);
        }
        else if (cached)
            sculpture(g, x, y, extent, hash(group.keys[0]) % 3);
        else {
            g.strokeStyle = C.border;
            g.lineWidth = 2;
            g.setLineDash([5, 4]);
            g.beginPath();
            g.ellipse(x, y, extent * .5, extent * .32, 0, 0, Math.PI * 2);
            g.stroke();
            g.setLineDash([]);
            g.fillStyle = C.surface;
            g.fillRect(x - 10, y - 14, 20, 25);
            g.fillStyle = C.text;
            g.font = '500 18px ui-monospace,monospace';
            g.textBaseline = "middle";
            g.textAlign = "center";
            g.fillText("?", x, y + 5);
        }
        if (active || group.keys.includes(hover ?? "")) {
            g.beginPath();
            g.ellipse(x, y + 8, extent * .67, extent * .42, 0, 0, Math.PI * 2);
            g.strokeStyle = C.surface;
            g.lineWidth = 6;
            g.stroke();
            g.strokeStyle = active ? C.focus : C.text;
            g.lineWidth = 2;
            g.stroke();
        }
        if (group.keys.some(key => lit.has(key))) {
            g.strokeStyle = C.focus; g.fillStyle = C.surface; g.lineWidth = 2;
            g.beginPath(); g.arc(x + extent * .42, y - extent * .5, 12, 0, Math.PI * 2); g.fill(); g.stroke();
            g.fillStyle = C.text; g.font = '600 16px ui-monospace,monospace'; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("✧", x + extent * .42, y - extent * .5);
        }
        targets.push({ keys: group.keys, x, y, rects: [{ x: x - Math.max(22, extent * .65), y: y - Math.max(22, extent * .8), width: Math.max(44, extent * 1.3), height: Math.max(44, extent * 1.15) }] });
    }
    for (const group of byPriority) {
        if (labels.length >= maxLabels && !group.keys.includes(selected ?? ""))
            continue;
        let text = group.landmark?.fullName ?? `${group.keys.length} catalog landmarks`;
        g.font = `${group.keys.includes(selected ?? "") ? 600 : 500} ${group.keys.includes(selected ?? "") ? 14 : 13}px ui-monospace,SFMono-Regular,Consolas,monospace`;
        const maxWidth = Math.min(group.keys.includes(selected ?? "") ? 260 : 180, size.width - 24);
        while (text.length > 1 && g.measureText(text + "…").width > maxWidth)
            text = text.slice(0, -1);
        if (text !== (group.landmark?.fullName ?? `${group.keys.length} catalog landmarks`))
            text += "…";
        const width = g.measureText(text).width + 16, height = 30;
        const candidates = [{ x: group.x - width / 2, y: group.y + 42, width, height }, { x: group.x - width / 2, y: group.y - 76, width, height }, { x: group.x + 48, y: group.y - 16, width, height }, { x: group.x - width - 48, y: group.y - 16, width, height }];
        const rect = candidates.find(r => r.x >= 8 && r.x + r.width <= size.width - 8 && r.y >= 8 && r.y + r.height <= size.height - 64 && !accepted.some(a => overlaps(r, a)) && !(r.x + r.width > size.width - 64 && r.y < 230));
        if (rect) {
            accepted.push(rect);
            labels.push({ group, rect, text });
            targets.find(t => t.keys === group.keys)?.rects.push(rect);
        }
    }
    for (const { group, rect, text } of labels) {
        const active = group.keys.includes(selected ?? "");
        g.font = `${active ? 600 : 500} ${active ? 14 : 13}px ui-monospace,SFMono-Regular,Consolas,monospace`;
        g.fillStyle = active ? C.labelSelectedPlate : C.labelPlate;
        g.strokeStyle = active ? C.labelSelectedBorder : C.border;
        g.lineWidth = active ? 2 : 1;
        g.beginPath();
        g.roundRect(rect.x, rect.y, rect.width, rect.height, 3);
        g.fill();
        g.stroke();
        g.fillStyle = active ? C.labelSelectedText : C.labelText;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(text, rect.x + rect.width / 2, rect.y + 15);
    }
    return targets;
}
