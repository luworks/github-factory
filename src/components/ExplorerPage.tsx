import { Link } from "@tanstack/react-router";
import { cachedWorldReady, worldIdentity } from "../evidence/captured";
import { readAtlasSession, validatedReturnToken } from "../atlas/session";
import { noteExploration, subscribeExploration, explorationFlags } from "../progression/session";
import "../atlas/atlas.css";
import { SourceChallenge } from "./SourceChallenge";
import { appPath } from "../base-path";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Github,
  Layers3,
  LoaderCircle,
  Map,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import type { BudgetStatus, StyleId, WorldNode, WorldSnapshot } from "../contracts";
import { WorldCanvas } from "../world/WorldCanvas";
import { STYLES } from "../client/demo";
import { clock, enrichWorld, getBudget, getCachedWorld, getWorld, refreshWorld, shortNumber } from "../client/api";
import { Brand, External } from "./shared";
/** Keep source text intact while offering natural identifier wrapping points. */
function identifierBreaks(value: string) {
  return value.split(/(?<=[/@_.-])/u).map((part, i) => <span key={i}>{part}<wbr /></span>);
}
function sourceUrl(world: WorldSnapshot, path: string) {
  return `${world.repo.url}/tree/${encodeURIComponent(world.headSha)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
function ciSummary(w: WorldSnapshot) {
  if (!w.workflows.length) return { label: "No CI evidence", tone: "neutral" };
  const failed = w.workflows.filter((r) => ["failure", "timed_out", "action_required"].includes(r.conclusion ?? ""));
  if (failed.length)
    return {
      label: `${failed.length} check${failed.length > 1 ? "s" : ""} need attention`,
      tone: "attention",
    };
  if (w.workflows.some((r) => r.status !== "completed")) return { label: "CI in progress", tone: "active" };
  const passed = w.workflows.filter((r) => r.conclusion === "success").length;
  return {
    label: `${passed} passed · ${w.workflows.length - passed} other`,
    tone: passed === w.workflows.length ? "healthy" : "neutral",
  };
}
export function ExplorerPage({
  owner,
  repo,
  readMode = "legacy",
}: {
  owner: string;
  repo: string;
  readMode?: "legacy" | "cached" | "invalid";
}) {
  const [atlasToken,setAtlasToken] = useState<string|null>(null), [,setProgressRevision] = useState(0);
  const loadGeneration = useRef(0);
  const cachedOnly = readMode === "cached";
  const [sourceVerified,setSourceVerified] = useState(false);
  const [motionPaused,setMotionPaused] = useState(false), [challengeOpen,setChallengeOpen] = useState(false);
  const [world, setWorld] = useState<WorldSnapshot | null>(null),
    [error, setError] = useState<string | null>(null),
    [refreshing, setRefreshing] = useState(false),
    [generating, setGenerating] = useState(false),
    [budget, setBudget] = useState<BudgetStatus | null>(null),
    [style, setStyle] = useState<StyleId>("moonshot"),
    [selectedId, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState<"world" | "activity" | "guide">("world"),
    [copied, setCopied] = useState(false),
    [showLayers, setShowLayers] = useState(false);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("style");
    if (STYLES.some((x) => x.id === s)) setStyle(s as StyleId);
  }, []);
  const load = useCallback(
    async (refresh = false) => {
      const generation = ++loadGeneration.current;
      if (refresh) setRefreshing(true);
      try {
        if (readMode === "invalid") throw new Error("Invalid exploration mode. Return to Atlas to choose a cached world.");
        const next = await (cachedOnly ? getCachedWorld(owner, repo) : refresh ? refreshWorld(owner, repo) : getWorld(owner, repo));
        if (generation !== loadGeneration.current) return;
        if (cachedOnly && !cachedWorldReady(next)) throw new Error("This cached capture cannot be verified for exploration.");
        setWorld(next);
        setSourceVerified(true);
        setError(null);
      } catch (e) {
        if (generation === loadGeneration.current) { setSourceVerified(false); setError(e instanceof Error ? e.message : "The repository could not be loaded."); }
      } finally {
        if (generation === loadGeneration.current) setRefreshing(false);
      }
    },
    [owner, repo, readMode, cachedOnly],
  );
  useEffect(() => {
    let active = true;
    setWorld(null); setSelected(null); setSourceVerified(false);
    void load();
    if (!cachedOnly && readMode !== "invalid")     getBudget()
      .then((b) => {
        if (active) setBudget(b);
      })
      .catch(() => {});
    const timer = readMode === "legacy" ? setInterval(() => {
      if (active && document.visibilityState === "visible") void load();
    }, 60000) : undefined;
    return () => {
      active = false;
      ++loadGeneration.current;
      if (timer) clearInterval(timer);
    };
  }, [owner, repo, load, cachedOnly, readMode]);
  useEffect(() => {
    if (!cachedOnly) return;
    setAtlasToken(validatedReturnToken(window.location.search,readAtlasSession().value));
    return subscribeExploration(()=>setProgressRevision(x=>x+1));
  },[cachedOnly]);
  const changeStyle = (s: StyleId) => {
    setStyle(s);
    const url = new URL(window.location.href);
    url.searchParams.set("style", s);
    window.history.replaceState({}, "", url);
  };
  const generate = async () => {
    setGenerating(true);
    try {
      setWorld(await enrichWorld(owner, repo));
      setBudget(await getBudget());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The field guide could not be generated.");
    } finally {
      setGenerating(false);
    }
  };
  const select = (id: string | null) => {
    setSelected(id);
    setTab("world");
  };
  const filtered = useMemo(
    () => world?.nodes.filter((n) => (n.label + " " + n.path + " " + n.kind).toLowerCase().includes(query.toLowerCase())) ?? [],
    [world, query],
  );
  const selected = world?.nodes.find((n) => n.id === selectedId),
    ci = world ? ciSummary(world) : null,
    stale = world ? Date.now() > world.refreshAfter : false;
  const share = async () => {
    try {
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.delete("atlasReturn"); shareUrl.searchParams.delete("from");
      await navigator.clipboard.writeText(shareUrl.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy the browser URL to share this world.");
    }
  };
  const styleInfo = STYLES.find((s) => s.id === style)!;
  return (
    <div className={`explorer explorer-${style}`}>
      <header className="explorer-header">
        <Brand compact />
        {cachedOnly && <button className="share-button" onClick={() => setMotionPaused(x=>!x)} aria-pressed={motionPaused}>{motionPaused ? "Resume motion" : "Pause motion"}</button>}
        {cachedOnly && <Link className="explorer-atlas-back" to="/atlas" search={atlasToken ? {atlasReturn:atlasToken} : {home:"1"}} preload={false}>Back to Atlas</Link>}
        <span className="breadcrumb-divider">/</span>
        <a className="repo-breadcrumb" href={world?.repo.url ?? `https://github.com/${owner}/${repo}`} target="_blank" rel="noreferrer">
          <Github size={15} />
          <span>
            {world?.repo.owner ?? owner}
            <b> / {world?.repo.name ?? repo}</b>
          </span>
          <ArrowUpRight size={12} />
        </a>
        <div className="explorer-top-actions">
          <span className="public-tag">PUBLIC REPOSITORY</span>
          <button className="share-button" onClick={share} aria-label={copied ? "World link copied" : "Share world"}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? ("Copied") : "Share world"}</span>
          </button>
        </div>
      </header>
      {cachedOnly && world && <div className="explorer-visit-status">{explorationFlags(world.repo.fullName.toLowerCase()).visited ? "Visited on this device" : "Rendering cached world"} · No Exploration star awarded for entry. <button className="source-challenge-toggle" aria-pressed={challengeOpen} onClick={() => setChallengeOpen(x=>!x)}>{challengeOpen ? "Hide source challenge" : "Show source challenge"}</button></div>}
      {!world ? (
        <main className="world-loading">
          {error ? (
            <>
              <TriangleAlert size={36} />
              <h1>{"We couldn’t map this territory."}</h1>
              <p role="alert">{error}</p>
              <div>
                <button
                  className="primary-button"
                  onClick={() => {
                    setError(null);
                    void load();
                  }}
                >
                  {"Try again"}
                  <RefreshCw size={14} />
                </button>
                <a href={appPath("/")}>{"Back to Mission Control"}</a>
              </div>
            </>
          ) : (
            <>
              <span className="loading-orbit">
                <OrbitIcon />
              </span>
              <div className="eyebrow">ESTABLISHING UPLINK</div>
              <h1>{"Surveying your world."}</h1>
              <p>
                {owner} / <strong>{repo}</strong>
              </p>
              <small>
                {"Reading public source paths, dependencies and GitHub activity."}
              </small>
              <div className="loading-track">
                <span />
              </div>
            </>
          )}
        </main>
      ) : (
        <>
          <div className="world-topline">
            <div className={`world-signal ${world.source === "demo" ? "demo" : stale ? "stale" : world.health.github === "error" ? "error" : world.health.github === "partial" ? "partial" : "connected"}`}>
              <span className="signal-dot" />
              {world.source === "demo"
                ? "ILLUSTRATION"
                : stale
                  ? "STALE CACHE · CURRENT STATE UNKNOWN"
                  : world.health.github === "error"
                    ? "UPLINK DEGRADED"
                    : world.health.github === "partial"
                      ? "PARTIAL SNAPSHOT"
                      : "GITHUB CONNECTED"}
              <span className="signal-time">{clock(world.collectedAt)}</span>
            </div>
            <div className="world-tabs">
              {[
                { id: "world", icon: Map, en: "World" },
                { id: "activity", icon: Activity, en: "Activity" },
                { id: "guide", icon: BookOpen, en: "Field guide" },
              ].map((t) => (
                <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id as typeof tab)}>
                  <t.icon size={14} />
                  {t.en}
                </button>
              ))}
            </div>
            <div className="world-source-stamp">
              <GitBranch size={12} />
              {world.repo.defaultBranch}
              <code>{world.headSha.slice(0, 7)}</code>
              <button aria-label="Refresh GitHub data" onClick={() => void load(true)} disabled={refreshing}>
                <RefreshCw size={13} className={refreshing ? "spin" : ""} />
              </button>
            </div>
          </div>
          {error && (
            <div className="explorer-error" role="alert">
              <TriangleAlert size={13} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={13} />
              </button>
            </div>
          )}
          <div className="explorer-grid">
            <aside className="district-sidebar">
              <div className="sidebar-title">
                <span>{"WORLD INDEX"}</span>
                <b>{String(world.nodes.length).padStart(2, "0")}</b>
              </div>
              <div className="district-search">
                <Search size={14} />
                <input
                  aria-label="Find district"
                  placeholder={"Find a district…"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <kbd>/</kbd>
              </div>
              <div className="district-list">
                {filtered.map((n, i) => (
                  <button key={n.id} className={`district-row ${selectedId === n.id ? "selected" : ""}`} onClick={() => select(n.id)}>
                    <span className={`node-kind kind-${n.kind}`}>
                      {n.kind === "data" ? "◫" : n.kind === "infra" ? "⌁" : n.kind === "app" ? "▣" : n.kind === "service" ? "⬡" : "◇"}
                    </span>
                    <span>
                      <strong title={n.label}>{n.label}</strong>
                      <small>{n.kind} · {n.status}</small>
                    </span>
                    <span className={`node-status status-${n.status}`} title={n.status} />
                    <ChevronRight size={12} />
                  </button>
                ))}
                {!filtered.length && <p className="empty-note">{"No matching districts."}</p>}
              </div>
              <div className="sidebar-bottom">
                <div className="sidebar-metric">
                  <span>{"PRIMARY LANGUAGE"}</span>
                  <b>{world.repo.language ?? "Mixed"}</b>
                </div>
                <div className="language-bar">
                  {Object.entries(world.languages)
                    .slice(0, 5)
                    .map(([l, n], i) => (
                      <i key={l} title={l} style={{ flex: n, background: ["#a8c8b2", "#d2ae77", "#9ea9cb", "#dc997a", "#99ae8b"][i] }} />
                    ))}
                </div>
                <div className="sidebar-bottom-label">
                  <span>
                    <Star size={12} />
                    {shortNumber(world.repo.stars)}
                  </span>
                  <External href={world.repo.url}>GitHub</External>
                </div>
              </div>
            </aside>
            <section className="world-stage">
              {tab === "world" ? (
                <>
                  <WorldCanvas paused={motionPaused} world={world} style={style} selectedId={selectedId} onSelect={select} onRendered={() => { const identity = worldIdentity(world); if (cachedOnly && identity) noteExploration(identity,"visited"); }} />
                  <div className="stage-heading">
                    <span className="stage-eyebrow">{styleInfo.name.toUpperCase()} / REPOSITORY WORLD</span>
                    <h1>
                      {world.repo.name}
                      <span>↗</span>
                    </h1>
                    <p>{world.repo.description?.slice(0, 150)}</p>
                  </div>
                  <div className="stage-tools">
                    <button className={showLayers ? "active" : ""} onClick={() => setShowLayers(!showLayers)}>
                      <Layers3 size={15} />
                      {"Map legend"}
                    </button>
                    {showLayers && (
                      <div className="map-legend">
                        <strong>{"READING THE WORLD"}</strong>
                        <p>
                          <i className="legend-node" />
                          {"Buildings are repository modules"}
                        </p>
                        <p>
                          <i className="legend-edge" />
                          {"Routes are labeled relationships"}
                        </p>
                        <p>
                          <span className="status-active node-status" />
                          {"Activity comes from GitHub snapshots"}
                        </p>
                        <small>
                          {"Moving particles illustrate connections, not runtime traffic."}
                        </small>
                      </div>
                    )}
                  </div>
                  <div className="world-caption">
                    <ShieldCheck size={12} />
                    {"SOURCE-DRIVEN WORLD · MOTION ILLUSTRATES CONNECTIONS"}
                  </div>
                </>
              ) : tab === "activity" ? (
                <div className="activity-view" key="activity">
                  <div className="eyebrow">THE WORK IN MOTION</div>
                  <h1>{"Every change leaves a mark."}</h1>
                  <p>
                    {"Real events from GitHub, with their source and observation window."}
                  </p>
                  <div className="activity-summary">
                    <div>
                      <GitPullRequest size={20} />
                      <b>{world.pulls.length}</b>
                      <span>{"pull requests in window"}</span>
                    </div>
                    <div>
                      <Box size={20} />
                      <b>{world.issues.length}</b>
                      <span>{"issues in window"}</span>
                    </div>
                    <div>
                      <Activity size={20} />
                      <b>{world.workflows.length}</b>
                      <span>{"recent workflow runs"}</span>
                    </div>
                  </div>
                  <h3 className="section-kicker">CI / CD</h3>
                  {world.workflows.length ? (
                    world.workflows.map((r) => (
                      <a key={r.id} className="run-row" href={r.url} target="_blank" rel="noreferrer">
                        <span
                          className={`run-icon ${r.conclusion === "success" ? "good" : r.conclusion === "failure" ? "bad" : "neutral"}`}
                        >
                          {r.conclusion === "success" ? (
                            <CheckCircle2 size={18} />
                          ) : r.conclusion === "failure" ? (
                            <XCircle size={18} />
                          ) : (
                            <Clock3 size={18} />
                          )}
                        </span>
                        <span>
                          <strong>{r.name}</strong>
                          <small>
                            {r.branch} · {r.headSha.slice(0, 7)}
                          </small>
                        </span>
                        <em>{r.conclusion ?? r.status}</em>
                        <ArrowUpRight size={13} />
                      </a>
                    ))
                  ) : (
                    <p className="empty-note">
                      {"No workflow evidence was returned. An empty window does not mean CI passed."}
                    </p>
                  )}
                  <h3 className="section-kicker">{"RECENT COMMITS"}</h3>
                  {world.commits.map((c) => (
                    <a key={c.id} className="commit-row" href={c.url} target="_blank" rel="noreferrer">
                      <GitCommitHorizontal size={16} />
                      <div>
                        <strong>{c.message.split("\n")[0]}</strong>
                        <small>
                          {c.author} · {clock(c.date)}
                        </small>
                      </div>
                      <code>{c.id.slice(0, 7)}</code>
                    </a>
                  ))}
                  <h3 className="section-kicker">{"PUBLIC WORK QUEUE"}</h3>
                  {[...world.pulls, ...world.issues].slice(0, 20).map((w) => (
                    <a className="work-item-row" key={`${w.kind}${w.number}`} href={w.url} target="_blank" rel="noreferrer">
                      {w.kind === "pull" ? <GitPullRequest size={15} /> : <Box size={15} />}
                      <span>
                        <strong>{w.title}</strong>
                        <small>
                          #{w.number} · {w.author} · {w.state}
                          {w.draft ? " · draft" : ""}
                        </small>
                      </span>
                      <ArrowUpRight size={13} />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="guide-view" key="guide">
                  <div className="guide-icon">
                    <Sparkles size={28} />
                  </div>
                  <div className="eyebrow">YOUR REPOSITORY FIELD GUIDE</div>
                  <h1>{"See the whole. Find your next move."}</h1>
                  <p className="guide-summary">{world.blueprint.summary}</p>
                  <p>{world.blueprint.narrative}</p>
                  <div className="guide-provider">
                    <Sparkles size={13} />
                    {world.blueprint.generator.provider === "rules"
                      ? "Evidence-based architecture analysis"
                      : `${world.blueprint.generator.model} · $${world.blueprint.generator.costUsd.toFixed(4)}`}
                    <button onClick={() => void generate()} disabled={generating || !budget?.configured || budget.remainingUsd <= 0}>
                      {generating ? <LoaderCircle className="spin" size={13} /> : <ArrowRight size={13} />}{" "}
                      {"Generate AI field guide"}
                    </button>
                  </div>
                  {budget && (!budget.configured || budget.remainingUsd <= 0) && (
                    <p role="status">{"AI guide disabled: provider is unconfigured or available budget is zero. Sources and deterministic analysis remain available."}</p>
                  )}
                  <p className="repo-disclosure">
                    {"The AI guide uses a limited survey of public repository paths, architecture and activity, sent to the configured AI provider when you generate it."}
                  </p>
                  {world.blueprint.generator.notes.length > 0 && (
                    <div className="guide-notes">
                      {world.blueprint.generator.notes.map((n, i) => (
                        <p key={i}>{n}</p>
                      ))}
                    </div>
                  )}
                  <h3 className="section-kicker">{"DISTRICT GUIDE"}</h3>
                  <div className="district-guide-grid">
                    {world.blueprint.districts.map((d) => (
                      <button key={d.nodeId} onClick={() => select(d.nodeId)}>
                        <span>↗</span>
                        <h3>{d.title}</h3>
                        <p>{d.purpose}</p>
                      </button>
                    ))}
                  </div>
                  <h3 className="section-kicker">{"EVIDENCE-LINKED NEXT MOVES"}</h3>
                  {world.blueprint.missions.length ? (
                    world.blueprint.missions.map((m, i) => (
                      <article className="mission-card" key={m.id}>
                        <div className="mission-number">{String(i + 1).padStart(2, "0")}</div>
                        <div>
                          <span className="mission-priority">{m.priority.toUpperCase()} PRIORITY · SUGGESTION</span>
                          <h3>{m.title}</h3>
                          <p>{m.description}</p>
                          {m.url && <External href={m.url}>{"View source"}</External>}
                          {m.nodeIds
                            .filter((id) => world.nodes.some((n) => n.id === id))
                            .map((id) => (
                              <button className="inline-link" key={id} onClick={() => select(id)}>
                                {world.nodes.find((n) => n.id === id)?.label}
                                <ArrowRight size={11} />
                              </button>
                            ))}
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="empty-note">
                      {"No specific recommendations without enough evidence."}
                    </p>
                  )}
                </div>
              )}
              <div className="style-dock" role="group" aria-label="World perspective">
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    className={style === s.id ? "active" : ""}
                    onClick={() => {
                      changeStyle(s.id);
                      setTab("world");
                    }}
                    title={s.subtitle}
                  >
                    <span>{s.glyph}</span>
                    <strong>{s.name}</strong>
                    {style === s.id && <i />}
                  </button>
                ))}
              </div>
            </section>
            <aside className={`inspector${challengeOpen ? " challenge-open" : ""}`}>
              {cachedOnly && <SourceChallenge world={world} available={sourceVerified} onSelect={select}/>}
              <div className="inspector-title">
                <span>{selected ? ("DISTRICT INTELLIGENCE") : "WORLD INTELLIGENCE"}</span>
                {selected && (
                  <button aria-label="Close district" onClick={() => select(null)}>
                    <X size={14} />
                  </button>
                )}
              </div>
              {selected ? (
                <>
                  <div className={`inspector-art inspector-${selected.kind}`}>
                    <span>{selected.kind === "data" ? "◫" : selected.kind === "app" ? "▣" : "⬡"}</span>
                    <small>{selected.kind.toUpperCase()} DISTRICT</small>
                  </div>
                  <div className="inspector-content">
                    <div className={`evidence-badge ${selected.confidence}`}>
                      <ShieldCheck size={11} />
                      {selected.confidence === "observed"
                        ? "SOURCE OBSERVED"
                        : "STRUCTURE INFERRED"}
                    </div>
                    <h2>{identifierBreaks(selected.label)}</h2>
                    <code className="path-label">{selected.path || "/"}</code>
                    <p>{world.blueprint.districts.find((d) => d.nodeId === selected.id)?.purpose || selected.description}</p>
                    <dl className="node-facts">
                      <div>
                        <dt>{"TYPE"}</dt>
                        <dd>{selected.kind}</dd>
                      </div>
                      <div>
                        <dt>{"STATUS"}</dt>
                        <dd>{selected.status}</dd>
                      </div>
                      <div>
                        <dt>{"LANGUAGE"}</dt>
                        <dd>{selected.language ?? "—"}</dd>
                      </div>
                    </dl>
                    <h4>{"SOURCE EVIDENCE"}</h4>
                    {selected.evidence.map((e, i) => (
                      <External key={i} href={e.startsWith("https:") ? e : sourceUrl(world, e)} className="evidence-link">
                        <FileCode2 size={12} />
                        <span className="evidence-link-text">{e.startsWith("https:") ? new URL(e).pathname.split("/").slice(4).join("/") || "Repository" : e}</span>
                      </External>
                    ))}
                    <External className="view-source-button" href={sourceUrl(world, selected.path)}>
                      {"Inspect on GitHub"}
                    </External>
                    <h4>{"CONNECTED DISTRICTS"}</h4>
                    {world.edges
                      .filter((e) => e.source === selected.id || e.target === selected.id)
                      .map((e) => {
                        const id = e.source === selected.id ? e.target : e.source,
                          n = world.nodes.find((n) => n.id === id);
                        return n ? (
                          <button className="connected-node" key={e.id} onClick={() => select(id)}>
                            <span>
                              <strong title={n.label}>{n.label}</strong>
                              <small>
                                {e.label} · {e.confidence}
                              </small>
                            </span>
                            <ArrowRight size={13} />
                          </button>
                        ) : null;
                      })}
                  </div>
                </>
              ) : (
                <div className="inspector-content overview-content">
                  <div className="overview-orbit">◒</div>
                  <div className="eyebrow">{world.repo.owner.toUpperCase()}</div>
                  <h2>{world.repo.name}</h2>
                  <p>{world.blueprint.summary || world.repo.description}</p>
                  <div className={`ci-status ${ci?.tone}`}>
                    <Activity size={15} />
                    <span>{ci?.label}</span>
                  </div>
                  <p className="repository-license">License: <strong>{world.repo.license ?? "unknown"}</strong> · <External href={world.repo.url}>GitHub metadata source</External></p>
                  <div className="overview-stats">
                    <div>
                      <b>{world.nodes.length}</b>
                      <span>{"districts"}</span>
                    </div>
                    <div>
                      <b>{world.edges.length}</b>
                      <span>{"connections"}</span>
                    </div>
                    <div>
                      <b>{shortNumber(world.repo.stars)}</b>
                      <span>{"stars"}</span>
                    </div>
                  </div>
                  <div className="explore-tip">
                    <Map size={18} />
                    <p>
                      {"Select a building or a district in the index to discover its role and source evidence."}
                    </p>
                  </div>
                  <button className="guide-cta" onClick={() => setTab("guide")}>
                    <Sparkles size={16} />
                    <span>{"Open the field guide"}</span>
                    <ArrowRight size={14} />
                  </button>
                  <h4>{"OBSERVATION WINDOW"}</h4>
                  <div className="coverage-note">
                    <p>
                      {world.coverage.tree === "full"
                        ? "Repository path tree available"
                        : world.coverage.tree === "truncated"
                          ? "Path tree partially sampled"
                          : "Path tree unavailable"}
                    </p>
                    <p>
                      {world.issues.length} issues · {world.pulls.length} PRs · {world.workflows.length} CI runs
                    </p>
                    {world.coverage.notes.map((n, i) => (
                      <p key={i}>{n}</p>
                    ))}
                  </div>
                  <External className="view-source-button" href={world.repo.url}>
                    {"View repository on GitHub"}
                  </External>
                </div>
              )}
              <div className="inspector-bottom">
                <span>
                  <ShieldCheck size={12} />
                  {"PUBLIC DATA · READ-ONLY"}
                </span>
                {budget && (
                  <span title="Persisted API cost estimate; all providers share this cap.">
                    {budget.provider.toUpperCase()} · ${budget.spentUsd.toFixed(2)} / ${budget.limitUsd.toFixed(0)}
                  </span>
                )}
              </div>
            </aside>
          </div>
          <footer className="explorer-footer">
            <a href={appPath("/")}>
              <ArrowLeft size={11} />
              {"MISSION CONTROL"}
            </a>
            <span>
              <span className="signal-dot" />
              {"Powered by Meta Muse Spark 1.3"}
            </span>
            <span>{"ARCHITECTURE INFERENCE LABELED · NOT RUNTIME TELEMETRY"}</span>
          </footer>
        </>
      )}
      {!world && <footer className="explorer-footer"><a href={appPath("/")}>{"HOME"}</a><span>{"Powered by Meta Muse Spark 1.3"}</span></footer>}
    </div>
  );
}
function OrbitIcon() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="1" />
      <ellipse cx="50" cy="50" rx="45" ry="16" fill="none" stroke="currentColor" transform="rotate(-35 50 50)" />
      <circle cx="80" cy="34" r="5" fill="currentColor" />
    </svg>
  );
}
