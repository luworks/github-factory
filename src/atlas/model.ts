import { CURATED_PROJECTS } from "../catalog";
import type { FeaturedProject, StyleId, WorldSnapshot } from "../contracts";
import { cachedWorldReady, worldIdentity } from "../evidence/captured";
import { codePointCompare, type WorldIdentity } from "../evidence/contracts";
import { project, type Bounds, type Camera, type Size } from "./camera";
export interface Landmark {
    repoKey: string;
    fullName: string;
    title: string;
    category: string;
    style: StyleId;
    x: number;
    y: number;
}
export interface CachedFacts {
    identity: WorldIdentity;
    fullName: string;
    description: string;
    sourceUrl: string;
    tree: string;
    github: string;
    nodes: number;
    edges: number;
    refreshAfter: number;
    license: string | null;
}
export type CacheStatus = {
    state: "unchecked" | "loading" | "miss" | "unavailable";
    lastReceived?: CachedFacts;
} | {
    state: "cached";
    facts: CachedFacts;
};
export function factsFromWorld(w: WorldSnapshot, expectedKey?: string, now = Date.now()): CachedFacts | null {
    const identity = worldIdentity(w, now);
    if (!identity || !cachedWorldReady(w, now) || expectedKey && identity.repoKey !== expectedKey)
        return null;
    return { identity, fullName: w.repo.fullName, description: w.repo.description, sourceUrl: w.repo.url, tree: w.coverage.tree, github: w.health.github, nodes: w.nodes.length, edges: w.edges.length, refreshAfter: w.refreshAfter, license: w.repo.license };
}
export function statusText(status?: CacheStatus) { return !status || status.state === "unchecked" ? "Cached status not checked" : status.state === "loading" ? "Loading cached facts" : status.state === "miss" ? "Not collected" : status.state === "unavailable" ? "Cached facts unavailable" : "Cached capture"; }
export function hash(value: string) { let h = 2166136261; for (const ch of value)
    h = Math.imul(h ^ ch.codePointAt(0)!, 16777619); return h >>> 0; }
// Immutable v1 editorial slots. Response order, captures and GitHub stars never
// determine placement. A catalog slot change requires a new layout version.
const slots = new Map(CURATED_PROJECTS.map((p, i) => [p.fullName.toLowerCase(), i]));
const home = [[650, 650], [1400, 750], [950, 1400], [1850, 1400], [2150, 500]];
export function layoutLandmarks(projects: readonly FeaturedProject[], imports: readonly string[]): Landmark[] {
    const byKey = new Map<string, FeaturedProject>();
    for (const p of projects)
        if (/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(p.fullName))
            byKey.set(p.fullName.toLowerCase(), p);
    for (const key of imports.slice(0, 100))
        if (!byKey.has(key))
            byKey.set(key, { fullName: key, name: key.split("/")[1], description: "", category: "Survey region", suggestedStyle: "moonshot", language: null, stars: null, ready: false, collectedAt: null });
    return [...byKey].map(([key, p]) => {
        const slot = slots.get(key), importSlot = imports.indexOf(key), h = hash(key);
        const point = slot !== undefined ? slot < 5 ? home[slot] : [3200 + (slot - 5) % 5 * 850, 650 + Math.floor((slot - 5) / 5) * 1350] : importSlot >= 0 ? [500 + (importSlot % 10) * 760, 4700 + Math.floor(importSlot / 10) * 115] : [500 + h % 7200, 500 + (hash(key + ":y") % 5000)];
        return { repoKey: key, fullName: p.fullName, title: p.name, category: p.category, style: p.suggestedStyle, x: point[0], y: point[1] };
    }).sort((a, b) => a.y - b.y || codePointCompare(a.repoKey, b.repoKey));
}
export function homeBounds(points: Landmark[]): Bounds {
    const known = points.filter(p => (slots.get(p.repoKey) ?? 1000) < 5);
    const group = known.length ? known : points.slice(0, 5);
    return group.length ? { left: Math.min(...group.map(p => p.x)) - 160, top: Math.min(...group.map(p => p.y)) - 160, right: Math.max(...group.map(p => p.x)) + 160, bottom: Math.max(...group.map(p => p.y)) + 160 } : { left: 500, top: 400, right: 2200, bottom: 1800 };
}
export interface ProjectedLandmark {
    x: number;
    y: number;
    keys: string[];
    landmark?: Landmark;
}
export function visibleGroups(points: Landmark[], camera: Camera, size: Size, selected: string | null): ProjectedLandmark[] {
    const visible = points.map(p => ({ ...project(p, camera, size), landmark: p })).filter(p => p.x >= -128 && p.x <= size.width + 128 && p.y >= -128 && p.y <= size.height + 128);
    const cap = size.width < 600 ? 40 : 80, clusterCap = size.width < 600 ? 16 : 32;
    let cell = 2 ** Math.ceil(Math.log2((size.width < 600 ? 72 : 64) / camera.zoom));
    for (let level = 0; level < 12; level++, cell *= 2) {
        const bins = new Map<string, typeof visible>();
        const singles: ProjectedLandmark[] = [];
        for (const p of visible) {
            if (p.landmark.repoKey === selected) {
                singles.push({ ...p, keys: [selected] });
                continue;
            }
            const key = `${Math.floor(p.landmark.x / cell)}:${Math.floor(p.landmark.y / cell)}`;
            const bin = bins.get(key) ?? [];
            bin.push(p);
            bins.set(key, bin);
        }
        const clusters: ProjectedLandmark[] = [];
        for (const bin of bins.values())
            if (bin.length >= 3)
                clusters.push({ x: bin.reduce((n, p) => n + p.x, 0) / bin.length, y: bin.reduce((n, p) => n + p.y, 0) / bin.length, keys: bin.map(p => p.landmark.repoKey).sort(codePointCompare) });
            else
                singles.push(...bin.map(p => ({ ...p, keys: [p.landmark.repoKey] })));
        if (singles.length <= cap && clusters.length <= clusterCap || level === 11)
            return [...clusters, ...singles].sort((a, b) => a.y - b.y || codePointCompare(a.keys[0], b.keys[0]));
    }
    return [];
}
