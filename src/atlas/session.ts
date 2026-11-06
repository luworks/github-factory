import { appPath } from "../base-path";
export const LAYOUT_VERSION = 1;
export interface AtlasSession {
    layoutVersion: 1;
    centerX: number;
    centerY: number;
    zoomRatio: number;
    selectedRepoKey: string | null;
    focusOrigin: "list" | "canvas";
    listScroll: number;
    importedRepoKeys: string[];
    returnToken: string | null;
}
const KEY = "moonfactory.atlas.session.v1", validKey = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9-]+\/[a-z0-9_.-]+$/.test(x) && x.length <= 140;
let memory: AtlasSession | null = null;
export function validateSession(x: any): x is AtlasSession { return !!x && x.layoutVersion === LAYOUT_VERSION && [x.centerX, x.centerY, x.zoomRatio, x.listScroll].every(Number.isFinite) && x.zoomRatio > 0 && x.zoomRatio <= 100 && x.listScroll >= 0 && (x.selectedRepoKey === null || validKey(x.selectedRepoKey)) && ["list", "canvas"].includes(x.focusOrigin) && Array.isArray(x.importedRepoKeys) && x.importedRepoKeys.length <= 100 && x.importedRepoKeys.every(validKey) && new Set(x.importedRepoKeys).size === x.importedRepoKeys.length && (x.returnToken === null || typeof x.returnToken === "string" && /^[a-f0-9-]{36}$/.test(x.returnToken)); }
export function readAtlasSession(storage?: Pick<Storage, "getItem">) {
    try {
        const raw = (storage ?? window.sessionStorage).getItem(KEY);
        if (raw && new TextEncoder().encode(raw).length > 32768)
            throw Error();
        const value = raw ? JSON.parse(raw) : null;
        if (value && !validateSession(value))
            throw Error();
        memory = value;
        return { value: value as AtlasSession | null, saved: true };
    }
    catch {
        return { value: memory, saved: false };
    }
}
export function saveAtlasSession(value: AtlasSession, storage?: Pick<Storage, "setItem">) {
    if (!validateSession(value))
        return false;
    memory = structuredClone(value);
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > 32768)
        return false;
    try {
        (storage ?? window.sessionStorage).setItem(KEY, text);
        return true;
    }
    catch {
        return false;
    }
}
export function validatedReturnToken(search: string, session: AtlasSession | null) { const q = new URLSearchParams(search); const token = q.get("atlasReturn"); return q.getAll("mode").length === 1 && q.get("mode") === "cached" && q.getAll("from").length === 1 && q.get("from") === "atlas" && q.getAll("atlasReturn").length === 1 && token === session?.returnToken ? token : null; }
export function atlasBackHref(search: string, session: AtlasSession | null) { const token = validatedReturnToken(search, session); return appPath(token ? `/atlas?atlasReturn=${encodeURIComponent(token)}` : "/atlas?home=1"); }
