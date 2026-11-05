import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { FeaturedProject } from "../contracts";
import { getCachedWorld, getGallery } from "../client/api";
import { Brand, External } from "../components/shared";
import { factsFromWorld, layoutLandmarks, statusText, type CacheStatus } from "./model";
import { AtlasCanvas } from "./AtlasCanvas";
import { readAtlasSession, saveAtlasSession, type AtlasSession } from "./session";
import { selectionLoader } from "./loader";
import type { Camera } from "./camera";
import { explorationFlags, noteExploration, subscribeExploration } from "../progression/session";
import "./atlas.css";
export function AtlasPage() {
    const [catalog, setCatalog] = useState<FeaturedProject[] | null>(null), [catalogError, setCatalogError] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null), [statuses, setStatuses] = useState(new Map<string, CacheStatus>()), [imports, setImports] = useState<string[]>([]), [query, setQuery] = useState(""), [page, setPage] = useState(0), [pane, setPane] = useState<"map" | "list">("map"), [chooser, setChooser] = useState<string[]>([]), [locateRequest, setLocateRequest] = useState<{
        key: string;
        revision: number;
    } | null>(null), [positionSaved, setPositionSaved] = useState(true), [initial, setInitial] = useState<AtlasSession | null>(null), [progressRevision, setProgressRevision] = useState(0), [focusedKey, setFocusedKey] = useState<string | null>(null), [inspectInput, setInspectInput] = useState(""), [inspectError, setInspectError] = useState<string | null>(null);
    const session = useRef<AtlasSession | null>(null), view = useRef({ centerX: 1400, centerY: 1000, zoomRatio: 1 }), selectedRef = useRef<string | null>(null), origin = useRef<"list" | "canvas">("list"), importRef = useRef<string[]>([]), statusRef = useRef(statuses), list = useRef<HTMLDivElement>(null), pendingRestore = useRef(false), mounted = useRef(true);
    const loader = useMemo(() => selectionLoader((key: string) => { const [owner, repo] = key.split("/"); return getCachedWorld(owner, repo); }), []);
    const updateStatus = useCallback((key: string, value: CacheStatus) => { const next = new Map(statusRef.current); next.set(key, value); statusRef.current = next; setStatuses(next); }, []);
    const save = useCallback((token?: string) => {
        const record: AtlasSession = { layoutVersion: 1, ...view.current, selectedRepoKey: selectedRef.current, focusOrigin: origin.current, listScroll: list.current?.scrollTop ?? session.current?.listScroll ?? 0, importedRepoKeys: importRef.current, returnToken: token ?? session.current?.returnToken ?? null };
        session.current = record;
        setPositionSaved(saveAtlasSession(record));
    }, []);
    const loadFacts = useCallback((key: string) => {
        const old = statusRef.current.get(key), lastReceived = old?.state === "cached" ? old.facts : old?.lastReceived;
        updateStatus(key, { state: "loading", lastReceived });
        loader.select(key, w => {
            const facts = factsFromWorld(w, key);
            if (!facts) {
                updateStatus(key, { state: "unavailable", lastReceived });
                return;
            }
            updateStatus(key, { state: "cached", facts });
        }, error => updateStatus(key, (error as {
            code?: string;
        })?.code === "CACHE_MISS" ? { state: "miss", lastReceived } : { state: "unavailable", lastReceived }));
    }, [loader, updateStatus]);
    const cancelRead = useCallback(() => {
        loader.cancel();
        const key = selectedRef.current, state = key ? statusRef.current.get(key) : undefined;
        if (key && state?.state === "loading") updateStatus(key, { state: "unchecked", lastReceived: state.lastReceived });
    }, [loader, updateStatus]);
    const choose = useCallback((keys: string[], via: "list" | "canvas") => {
        if (keys.length !== 1) {
            cancelRead();
            setChooser(keys);
            return;
        }
        const key = keys[0];
        const previous = selectedRef.current, prior = previous ? statusRef.current.get(previous) : undefined;
        if (previous && previous !== key && prior?.state === "loading")
            updateStatus(previous, { state: "unchecked", lastReceived: prior.lastReceived });
        selectedRef.current = key;
        origin.current = via;
        setSelected(key);
        setChooser([]);
        setInspectError(null);
        if (via === "list")
            setLocateRequest(x => ({ key, revision: (x?.revision ?? 0) + 1 }));
        if (statusRef.current.get(key)?.state !== "cached")
            loadFacts(key);
        else
            loader.cancel();
    }, [loader, loadFacts, updateStatus, cancelRead]);
    useEffect(() => {
        mounted.current = true;
        const saved = readAtlasSession();
        setPositionSaved(saved.saved);
        session.current = saved.value;
        const params = new URLSearchParams(window.location.search), returnToken = params.get("atlasReturn"), canRestore = saved.value && params.get("home") !== "1" && (!params.has("atlasReturn") || params.getAll("atlasReturn").length === 1 && returnToken === saved.value.returnToken);
        const restorable = canRestore ? saved.value : null;
        if (saved.value) {
            importRef.current = saved.value.importedRepoKeys;
            setImports(importRef.current);
        }
        if (restorable) {
            view.current = { centerX: restorable.centerX, centerY: restorable.centerY, zoomRatio: restorable.zoomRatio };
            selectedRef.current = restorable.selectedRepoKey;
            origin.current = restorable.focusOrigin;
            setInitial(restorable);
            setSelected(restorable.selectedRepoKey);
            if (window.innerWidth < 600 && restorable.focusOrigin === "list")
                setPane("list");
            pendingRestore.current = true;
        }
        void getGallery().then(({ projects }) => { if (mounted.current)
            setCatalog(projects.slice(0, 2000)); }).catch(() => { if (mounted.current) {
            setCatalog([]);
            setCatalogError("Catalog unavailable. Cached status remains unknown.");
        } });
        const onPageHide = () => save();
        window.addEventListener("pagehide", onPageHide);
        const unsubscribe = subscribeExploration(() => setProgressRevision(x => x + 1));
        return () => { mounted.current = false; loader.cancel(); window.removeEventListener("pagehide", onPageHide); unsubscribe(); };
    }, [loader, save]);
    const landmarks = useMemo(() => layoutLandmarks(catalog ?? [], imports), [catalog, imports]);
    useEffect(() => { if (catalog && pendingRestore.current) {
        pendingRestore.current = false;
        if (selectedRef.current) {
            loadFacts(selectedRef.current);
            const index = landmarks.findIndex(x => x.repoKey === selectedRef.current);
            if (index >= 0)
                setPage(Math.floor(index / 50));
        }
        requestAnimationFrame(() => { if (list.current && session.current)
            list.current.scrollTop = session.current.listScroll; const key = selectedRef.current; if (key) {
            const target = window.innerWidth < 600 && origin.current === "canvas" ? document.querySelector<HTMLCanvasElement>(".atlas-map canvas") : document.getElementById("atlas-repo-" + key);
            (target ?? document.getElementById("atlas-filter"))?.focus({ preventScroll: true });
        } });
    } }, [catalog, landmarks, loadFacts]);
    const current = selected ? statuses.get(selected) : undefined, facts = current?.state === "cached" ? current.facts : undefined, lastReceived = current && current.state !== "cached" ? current.lastReceived : undefined;
    useEffect(() => { if (chooser.length === 0 && facts && selected === facts.identity.repoKey)
        noteExploration(facts.identity, "discovered"); }, [facts, selected, chooser.length]);
    const selectedLandmark = landmarks.find(x => x.repoKey === selected), filtered = landmarks.filter(x => (x.fullName + " " + x.title + " " + x.category).toLowerCase().includes(query.toLowerCase())), rows = filtered.slice(page * 50, page * 50 + 50), enterToken = useMemo(() => selected ? crypto.randomUUID() : null, [selected]);
    const flags = selected ? explorationFlags(selected) : { discovered: false, visited: false };
    void progressRevision;
    const inspect = () => {
        try {
            const url = new URL(inspectInput.trim());
            const parts = url.pathname.replace(/\/$/, "").split("/").slice(1);
            if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || parts.length !== 2 || !parts.every(p => /^[a-z0-9_.-]+$/i.test(p)))
                throw Error();
            const key = parts.join("/").toLowerCase();
            if (!landmarks.some(p => p.repoKey === key) && imports.length >= 100) {
                setInspectError("The 100-repository survey capacity is full. Existing positions are retained.");
                return;
            }
            choose([key], "list");
        }
        catch {
            setInspectError("Enter a public HTTPS GitHub repository URL. This action only checks existing cached facts.");
        }
    };
    useEffect(() => { if (facts && selected && !landmarks.some(p => p.repoKey === selected) && importRef.current.length < 100) {
        importRef.current = [...importRef.current, selected];
        setImports(importRef.current);
        save();
    } }, [facts, selected, landmarks, save]);
    return <main className="atlas-shell">
  <header className="atlas-header"><Brand compact/><h1>Repository Atlas</h1><Link to="/">Mission Control</Link></header>
  <div className="atlas-intro"><p>Choose a landmark, inspect its captured identity, then enter its world. This atlas shows its catalog and your cached survey entries.</p><p>{catalog === null ? "Loading catalog" : `${landmarks.length} listed landmarks · ${[...statuses.values()].filter(s => s.state === "cached").length} captures checked this visit`} · No full GitHub map or complete history is claimed.</p></div>
  {catalogError && <p className="atlas-warning" role="alert">{catalogError}</p>}
  {!positionSaved && <p className="atlas-warning" role="status">View position is temporary. Browser session storage is unavailable; a reload may lose it.</p>}
  <div className="atlas-tabs" aria-label="Atlas view"><button aria-pressed={pane === "map"} onClick={() => setPane("map")}>Map</button><button aria-pressed={pane === "list"} onClick={() => setPane("list")}>Repository list</button></div>
  <div className={`atlas-body atlas-pane-${pane}`}>
   <section className="atlas-list" aria-label="Repository list"><label htmlFor="atlas-filter">Find a landmark</label><input id="atlas-filter" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Repository or editorial region"/>
    <div className="atlas-list-rows" ref={list} onKeyDown={e => { if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
        return; const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button")), index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (index < 0)
        return; e.preventDefault(); const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))); buttons[next]?.focus(); }}>
    {rows.map((p, i) => <button id={"atlas-repo-" + p.repoKey} key={p.repoKey} aria-pressed={selected === p.repoKey} tabIndex={focusedKey === p.repoKey || !rows.some(x => x.repoKey === focusedKey) && i === 0 ? 0 : -1} onFocus={() => setFocusedKey(p.repoKey)} onClick={() => choose([p.repoKey], "list")}><strong>{p.fullName}</strong><span>{statusText(statuses.get(p.repoKey))}</span><small>Editorial region · {p.category}</small></button>)}
    {catalog !== null && rows.length === 0 && <p>No matching landmarks. Unlisted public repositories may already have cached worlds.</p>}
    </div>
    {filtered.length > 50 && <div className="atlas-pagination"><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>{page + 1} / {Math.ceil(filtered.length / 50)}</span><button disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}
    <form className="atlas-inspect" onSubmit={e => { e.preventDefault(); inspect(); }}><label htmlFor="atlas-repository">Inspect an existing cached repository</label><input id="atlas-repository" type="url" value={inspectInput} onChange={e => setInspectInput(e.target.value)} placeholder="https://github.com/owner/repo" required/><button type="submit">Check cached facts</button><small>No collection, GitHub or model request.</small>{inspectError && <p role="alert">{inspectError}</p>}</form>
   </section>
   {catalog !== null && !(initial?.selectedRepoKey === selected && selected && (!current || current.state === "loading")) ? <AtlasCanvas landmarks={landmarks} statuses={statuses} selected={selected} initialView={initial ?? undefined} locateRequest={locateRequest} onChoose={choose} onClear={() => { cancelRead(); setChooser([]); selectedRef.current = null; setSelected(null); save(); }} onView={(camera: Camera, homeZoom: number, commit: boolean) => { view.current = { centerX: camera.centerX, centerY: camera.centerY, zoomRatio: camera.zoom / homeZoom }; if (commit)
        save(); }}/> : <div className="atlas-map"><p className="atlas-map-unavailable">Loading the bounded catalog…</p></div>}
   <aside className="atlas-card" aria-label="Selected repository identity"><div className="atlas-card-content">
    {chooser.length > 0 ? <><h2>Choose a landmark</h2><p>{chooser.length} landmarks share this map target. Selection does not enter a world.</p>{chooser.slice(0, 50).map(key => <button key={key} onClick={() => choose([key], "list")}>{key}</button>)}{chooser.length > 50 && <p>Use repository list search for all members.</p>}</> : selected ? <>
     <div className="atlas-card-top"><span>CAPTURE IDENTITY</span><button aria-label="Close selected landmark" onClick={() => { cancelRead(); selectedRef.current = null; setSelected(null); save(); }}>×</button></div>
     <h2>{(facts?.fullName ?? selected).split("/").map((part, i) => <span key={i}>{i === 0 ? part + " /" : part}</span>)}</h2><p className="atlas-status" data-state={current?.state ?? "unchecked"} data-freshness={facts && facts.refreshAfter <= Date.now() ? "stale" : "unknown"}>{statusText(current)}</p><span className="sr-only" role="status">{facts?.fullName ?? selected}: {statusText(current)}</span>
     {!selectedLandmark && !facts && <p>This source is not currently listed in the catalog. Its availability remains unknown until checked.</p>}
     {facts ? <><p>{facts.description}</p><dl><dt>Captured head</dt><dd><code>{facts.identity.headSha}</code></dd><dt>Captured at</dt><dd>{facts.identity.collectedAt}</dd><dt>Freshness</dt><dd>{facts.refreshAfter <= Date.now() ? "Stale capture · current state unknown" : "Capture within cache window · current state unknown"}</dd><dt>Captured coverage</dt><dd>{facts.tree} tree · GitHub {facts.github}<br />{facts.nodes} districts / {facts.edges} connections</dd><dt>License metadata</dt><dd>{facts.license ?? "unknown"}</dd></dl><p>Historical trees unavailable. This does not block entering this captured world.</p><External href={facts.sourceUrl}>GitHub source</External>
      <p className="atlas-observation">{flags.visited ? "Visited this session" : flags.discovered ? "Discovered this session" : "Captured identity checked"} · No Exploration star awarded.</p>

     </> : <><p>{current?.state === "miss" ? "No cached capture was found. No collection was started." : current?.state === "unavailable" ? "The cached source cannot currently be verified. Storage failure is not proof of a missing or private repository." : "Select a landmark to check existing cached facts."}</p>{lastReceived && <div className="atlas-last"><p>Last received: {lastReceived.fullName} at {lastReceived.identity.collectedAt}; current state unknown.</p><code>{lastReceived.identity.headSha}</code><p>{lastReceived.tree} tree · {lastReceived.nodes} districts / {lastReceived.edges} connections. These prior facts do not authorize entry while the source is unavailable.</p></div>}<External href={`https://github.com/${selected}`}>GitHub repository</External></>}

    </> : <><h2>An observatory for code</h2><p>Select a landmark on the map or in the visible repository list. Unchecked landmarks are outlines, not confirmed captured worlds.</p><p>Arrow keys pan, +/− zoom, 0 returns home and F locates a selection. Pinch or drag on touch screens.</p><p>Exploration starts with source evidence. Selecting or entering a world does not earn an Exploration star.</p></>}
   </div>{selected && chooser.length===0 && <div className="atlas-actions">{facts && enterToken && <Link className="atlas-enter" to="/world/$owner/$repo" params={{ owner: facts.fullName.split("/")[0], repo: facts.fullName.split("/")[1] }} search={{ mode: "cached", from: "atlas", atlasReturn: enterToken, style: selectedLandmark?.style ?? "moonshot" }} preload={false} onClick={() => save(enterToken)}>Enter cached world</Link>}<button className="atlas-retry" disabled={current?.state === "loading"} onClick={() => loadFacts(selected)}>Reload cached facts</button></div>}</aside>
  </div>
  <footer className="atlas-footer">Public cached source · Read only · Original scenery · Session observations are not saved progress</footer>
 </main>;
}
