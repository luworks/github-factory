import { appPath } from "../base-path";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { BudgetStatus, Lang, StyleId, WorldNode, WorldSnapshot } from "../contracts";
import { WorldCanvas } from "../world/WorldCanvas";
import { STYLES } from "../client/demo";
import { clock, enrichWorld, getBudget, getWorld, refreshWorld, shortNumber } from "../client/api";
import { Brand, External, LanguageButton } from "./shared";
function sourceUrl(world: WorldSnapshot, path: string) {
  return `${world.repo.url}/tree/${encodeURIComponent(world.headSha)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
function ciSummary(w: WorldSnapshot, zh: boolean) {
  if (!w.workflows.length) return { label: zh ? "CI 状态未知" : "No CI evidence", tone: "neutral" };
  const failed = w.workflows.filter((r) => ["failure", "timed_out", "action_required"].includes(r.conclusion ?? ""));
  if (failed.length)
    return {
      label: zh ? `${failed.length} 个检查需关注` : `${failed.length} check${failed.length > 1 ? "s" : ""} need attention`,
      tone: "attention",
    };
  if (w.workflows.some((r) => r.status !== "completed")) return { label: zh ? "CI 运行中" : "CI in progress", tone: "active" };
  const passed = w.workflows.filter((r) => r.conclusion === "success").length;
  return {
    label: zh ? `${passed} 个通过 · ${w.workflows.length - passed} 个其它` : `${passed} passed · ${w.workflows.length - passed} other`,
    tone: passed === w.workflows.length ? "healthy" : "neutral",
  };
}
export function ExplorerPage({
  owner,
  repo,
  lang,
  onLangChange,
}: {
  owner: string;
  repo: string;
  lang: Lang;
  onLangChange: (l: Lang) => void;
}) {
  const zh = lang === "zh",
    [world, setWorld] = useState<WorldSnapshot | null>(null),
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
      if (refresh) setRefreshing(true);
      try {
        const next = await (refresh ? refreshWorld(owner, repo) : getWorld(owner, repo));
        setWorld(next);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The repository could not be loaded.");
      } finally {
        setRefreshing(false);
      }
    },
    [owner, repo],
  );
  useEffect(() => {
    let active = true;
    getWorld(owner, repo)
      .then((w) => {
        if (active) setWorld(w);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    getBudget()
      .then((b) => {
        if (active) setBudget(b);
      })
      .catch(() => {});
    const timer = setInterval(() => {
      if (active && document.visibilityState === "visible") void load();
    }, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [owner, repo, load]);
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
    ci = world ? ciSummary(world, zh) : null,
    stale = world ? Date.now() > world.refreshAfter : false;
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(zh ? "复制网址即可分享这个世界。" : "Copy the browser URL to share this world.");
    }
  };
  const styleInfo = STYLES.find((s) => s.id === style)!;
  return (
    <div className={`explorer explorer-${style}`}>
      <header className="explorer-header">
        <Brand compact />
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
          <LanguageButton lang={lang} onChange={onLangChange} />
          <button className="share-button" onClick={share}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? (zh ? "已复制" : "Copied") : zh ? "分享世界" : "Share world"}</span>
          </button>
        </div>
      </header>
      {!world ? (
        <main className="world-loading">
          {error ? (
            <>
              <TriangleAlert size={36} />
              <h1>{zh ? "暂时无法勘测这片区域" : "We couldn’t map this territory."}</h1>
              <p role="alert">{error}</p>
              <div>
                <button
                  className="primary-button"
                  onClick={() => {
                    setError(null);
                    void load();
                  }}
                >
                  {zh ? "重试" : "Try again"}
                  <RefreshCw size={14} />
                </button>
                <a href={appPath("/")}>{zh ? "返回首页" : "Back to Mission Control"}</a>
              </div>
            </>
          ) : (
            <>
              <span className="loading-orbit">
                <OrbitIcon />
              </span>
              <div className="eyebrow">ESTABLISHING UPLINK</div>
              <h1>{zh ? "正在勘测你的世界" : "Surveying your world."}</h1>
              <p>
                {owner} / <strong>{repo}</strong>
              </p>
              <small>
                {zh ? "读取公开源文件、依赖与 GitHub 进展。" : "Reading public source paths, dependencies and GitHub activity."}
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
            <div className={`world-signal ${stale ? "stale" : ""}`}>
              <span className="signal-dot" />
              {world.source === "demo"
                ? "ILLUSTRATION"
                : stale
                  ? zh ? "历史缓存 · 当前状态未知" : "STALE CACHE · CURRENT STATE UNKNOWN"
                  : world.health.github === "error"
                    ? zh ? "数据连接异常" : "UPLINK DEGRADED"
                    : world.health.github === "partial"
                      ? zh ? "部分快照" : "PARTIAL SNAPSHOT"
                      : zh ? "GITHUB 已连接" : "GITHUB CONNECTED"}
              <span className="signal-time">{clock(world.collectedAt)}</span>
            </div>
            <div className="world-tabs">
              {[
                { id: "world", icon: Map, en: "World", zh: "世界" },
                { id: "activity", icon: Activity, en: "Activity", zh: "动态" },
                { id: "guide", icon: BookOpen, en: "Field guide", zh: "探索手册" },
              ].map((t) => (
                <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id as typeof tab)}>
                  <t.icon size={14} />
                  {zh ? t.zh : t.en}
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
                <span>{zh ? "世界索引" : "WORLD INDEX"}</span>
                <b>{String(world.nodes.length).padStart(2, "0")}</b>
              </div>
              <div className="district-search">
                <Search size={14} />
                <input
                  aria-label="Find district"
                  placeholder={zh ? "查找区域…" : "Find a district…"}
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
                      <strong>{n.label}</strong>
                      <small>{n.kind}</small>
                    </span>
                    <span className={`node-status status-${n.status}`} title={n.status} />
                    <ChevronRight size={12} />
                  </button>
                ))}
                {!filtered.length && <p className="empty-note">{zh ? "没有匹配的区域" : "No matching districts."}</p>}
              </div>
              <div className="sidebar-bottom">
                <div className="sidebar-metric">
                  <span>{zh ? "语言" : "PRIMARY LANGUAGE"}</span>
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
                  <WorldCanvas world={world} style={style} selectedId={selectedId} onSelect={select} />
                  <div className="stage-heading">
                    <span className="stage-eyebrow">{zh ? styleInfo.zh : styleInfo.name.toUpperCase()} / REPOSITORY WORLD</span>
                    <h1>
                      {world.repo.name}
                      <span>↗</span>
                    </h1>
                    <p>{world.repo.description?.slice(0, 150)}</p>
                  </div>
                  <div className="stage-tools">
                    <button className={showLayers ? "active" : ""} onClick={() => setShowLayers(!showLayers)}>
                      <Layers3 size={15} />
                      {zh ? "图层说明" : "Map legend"}
                    </button>
                    {showLayers && (
                      <div className="map-legend">
                        <strong>{zh ? "你正在看到什么" : "READING THE WORLD"}</strong>
                        <p>
                          <i className="legend-node" />
                          {zh ? "建筑是仓库模块" : "Buildings are repository modules"}
                        </p>
                        <p>
                          <i className="legend-edge" />
                          {zh ? "路线是有标注的依赖关系" : "Routes are labeled relationships"}
                        </p>
                        <p>
                          <span className="status-active node-status" />
                          {zh ? "进展基于 GitHub 快照" : "Activity comes from GitHub snapshots"}
                        </p>
                        <small>
                          {zh ? "流动粒子是示意动画，不是实际运行流量。" : "Moving particles illustrate connections, not runtime traffic."}
                        </small>
                      </div>
                    )}
                  </div>
                  <div className="world-caption">
                    <ShieldCheck size={12} />
                    {zh ? "源文件驱动的世界 · 动画仅作连接示意" : "SOURCE-DRIVEN WORLD · MOTION ILLUSTRATES CONNECTIONS"}
                  </div>
                </>
              ) : tab === "activity" ? (
                <div className="activity-view" key="activity">
                  <div className="eyebrow">THE WORK IN MOTION</div>
                  <h1>{zh ? "这个世界，正在发生什么？" : "Every change leaves a mark."}</h1>
                  <p>
                    {zh
                      ? "来自 GitHub 的真实事件。采集窗口与来源始终可见。"
                      : "Real events from GitHub, with their source and observation window."}
                  </p>
                  <div className="activity-summary">
                    <div>
                      <GitPullRequest size={20} />
                      <b>{world.pulls.length}</b>
                      <span>{zh ? "窗口内公开 PR" : "pull requests in window"}</span>
                    </div>
                    <div>
                      <Box size={20} />
                      <b>{world.issues.length}</b>
                      <span>{zh ? "窗口内 Issue" : "issues in window"}</span>
                    </div>
                    <div>
                      <Activity size={20} />
                      <b>{world.workflows.length}</b>
                      <span>{zh ? "近期运行" : "recent workflow runs"}</span>
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
                      {zh
                        ? "未获得 workflow 运行证据。没有记录不代表全部通过。"
                        : "No workflow evidence was returned. An empty window does not mean CI passed."}
                    </p>
                  )}
                  <h3 className="section-kicker">{zh ? "最近提交" : "RECENT COMMITS"}</h3>
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
                  <h3 className="section-kicker">{zh ? "公开工作队列" : "PUBLIC WORK QUEUE"}</h3>
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
                  <h1>{zh ? "看懂全局，找到下一步。" : "See the whole. Find your next move."}</h1>
                  <p className="guide-summary">{world.blueprint.summary}</p>
                  <p>{world.blueprint.narrative}</p>
                  <div className="guide-provider">
                    <Sparkles size={13} />
                    {world.blueprint.generator.provider === "rules"
                      ? zh
                        ? "确定性架构分析"
                        : "Evidence-based architecture analysis"
                      : `${world.blueprint.generator.model} · $${world.blueprint.generator.costUsd.toFixed(4)}`}
                    <button onClick={() => void generate()} disabled={generating || !budget?.configured || budget.remainingUsd <= 0}>
                      {generating ? <LoaderCircle className="spin" size={13} /> : <ArrowRight size={13} />}{" "}
                      {zh ? "生成 AI 探索手册" : "Generate AI field guide"}
                    </button>
                  </div>
                  {budget && (!budget.configured || budget.remainingUsd <= 0) && (
                    <p role="status">{zh ? "AI 导览未启用：未配置服务或可用预算为零。来源与确定性分析仍可使用。" : "AI guide disabled: provider is unconfigured or available budget is zero. Sources and deterministic analysis remain available."}</p>
                  )}
                  <p className="repo-disclosure">
                    {zh
                      ? "AI 导览使用部分公开仓库路径、架构摘要和项目动态。生成时会将这些数据发送给配置的 AI 服务。"
                      : "The AI guide uses a limited survey of public repository paths, architecture and activity, sent to the configured AI provider when you generate it."}
                  </p>
                  {world.blueprint.generator.notes.length > 0 && (
                    <div className="guide-notes">
                      {world.blueprint.generator.notes.map((n, i) => (
                        <p key={i}>{n}</p>
                      ))}
                    </div>
                  )}
                  <h3 className="section-kicker">{zh ? "区域指南" : "DISTRICT GUIDE"}</h3>
                  <div className="district-guide-grid">
                    {world.blueprint.districts.map((d) => (
                      <button key={d.nodeId} onClick={() => select(d.nodeId)}>
                        <span>↗</span>
                        <h3>{d.title}</h3>
                        <p>{d.purpose}</p>
                      </button>
                    ))}
                  </div>
                  <h3 className="section-kicker">{zh ? "有据可循的下一步" : "EVIDENCE-LINKED NEXT MOVES"}</h3>
                  {world.blueprint.missions.length ? (
                    world.blueprint.missions.map((m, i) => (
                      <article className="mission-card" key={m.id}>
                        <div className="mission-number">{String(i + 1).padStart(2, "0")}</div>
                        <div>
                          <span className="mission-priority">{m.priority.toUpperCase()} PRIORITY · SUGGESTION</span>
                          <h3>{m.title}</h3>
                          <p>{m.description}</p>
                          {m.url && <External href={m.url}>{zh ? "查看来源" : "View source"}</External>}
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
                      {zh ? "还没有足够证据提出具体建议。" : "No specific recommendations without enough evidence."}
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
                    <strong>{zh ? s.zh : s.name}</strong>
                    {style === s.id && <i />}
                  </button>
                ))}
              </div>
            </section>
            <aside className="inspector">
              <div className="inspector-title">
                <span>{selected ? (zh ? "区域详情" : "DISTRICT INTELLIGENCE") : zh ? "世界概览" : "WORLD INTELLIGENCE"}</span>
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
                        ? zh
                          ? "从源文件确认"
                          : "SOURCE OBSERVED"
                        : zh
                          ? "基于结构推断"
                          : "STRUCTURE INFERRED"}
                    </div>
                    <h2>{selected.label}</h2>
                    <code className="path-label">{selected.path || "/"}</code>
                    <p>{world.blueprint.districts.find((d) => d.nodeId === selected.id)?.purpose || selected.description}</p>
                    <dl className="node-facts">
                      <div>
                        <dt>{zh ? "类型" : "TYPE"}</dt>
                        <dd>{selected.kind}</dd>
                      </div>
                      <div>
                        <dt>{zh ? "状态证据" : "STATUS"}</dt>
                        <dd>{selected.status}</dd>
                      </div>
                      <div>
                        <dt>{zh ? "语言" : "LANGUAGE"}</dt>
                        <dd>{selected.language ?? "—"}</dd>
                      </div>
                    </dl>
                    <h4>{zh ? "来源证据" : "SOURCE EVIDENCE"}</h4>
                    {selected.evidence.map((e, i) => (
                      <External key={i} href={e.startsWith("https:") ? e : sourceUrl(world, e)} className="evidence-link">
                        <FileCode2 size={12} />
                        {e.startsWith("https:") ? new URL(e).pathname.split("/").slice(4).join("/") || "Repository" : e}
                      </External>
                    ))}
                    <External className="view-source-button" href={sourceUrl(world, selected.path)}>
                      {zh ? "打开 GitHub 源文件" : "Inspect on GitHub"}
                    </External>
                    <h4>{zh ? "关联区域" : "CONNECTED DISTRICTS"}</h4>
                    {world.edges
                      .filter((e) => e.source === selected.id || e.target === selected.id)
                      .map((e) => {
                        const id = e.source === selected.id ? e.target : e.source,
                          n = world.nodes.find((n) => n.id === id);
                        return n ? (
                          <button className="connected-node" key={e.id} onClick={() => select(id)}>
                            <span>
                              <strong>{n.label}</strong>
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
                  <div className="overview-stats">
                    <div>
                      <b>{world.nodes.length}</b>
                      <span>{zh ? "个区域" : "districts"}</span>
                    </div>
                    <div>
                      <b>{world.edges.length}</b>
                      <span>{zh ? "条连接" : "connections"}</span>
                    </div>
                    <div>
                      <b>{shortNumber(world.repo.stars)}</b>
                      <span>{zh ? "颗星" : "stars"}</span>
                    </div>
                  </div>
                  <div className="explore-tip">
                    <Map size={18} />
                    <p>
                      {zh
                        ? "点击建筑或左侧索引，查看它的职责和源文件证据。"
                        : "Select a building or a district in the index to discover its role and source evidence."}
                    </p>
                  </div>
                  <button className="guide-cta" onClick={() => setTab("guide")}>
                    <Sparkles size={16} />
                    <span>{zh ? "打开探索手册" : "Open the field guide"}</span>
                    <ArrowRight size={14} />
                  </button>
                  <h4>{zh ? "采集范围" : "OBSERVATION WINDOW"}</h4>
                  <div className="coverage-note">
                    <p>
                      {world.coverage.tree === "full"
                        ? zh
                          ? "已获取仓库路径树"
                          : "Repository path tree available"
                        : world.coverage.tree === "truncated"
                          ? zh
                            ? "路径树部分截取"
                            : "Path tree partially sampled"
                          : zh
                            ? "路径树不可用"
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
                    {zh ? "在 GitHub 查看项目" : "View repository on GitHub"}
                  </External>
                </div>
              )}
              <div className="inspector-bottom">
                <span>
                  <ShieldCheck size={12} />
                  {zh ? "公开数据 · 只读" : "PUBLIC DATA · READ-ONLY"}
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
              {zh ? "返回任务中心" : "MISSION CONTROL"}
            </a>
            <span>
              <span className="signal-dot" />
              {zh ? "AI 支持：Meta Muse Spark 1.3" : "Powered by Meta Muse Spark 1.3"}
            </span>
            <span>{zh ? "架构推断已标注 · 不代表运行时拓扑" : "ARCHITECTURE INFERENCE LABELED · NOT RUNTIME TELEMETRY"}</span>
          </footer>
        </>
      )}
      {!world && <footer className="explorer-footer"><a href={appPath("/")}>{zh ? "返回首页" : "HOME"}</a><span>{zh ? "AI 支持：Meta Muse Spark 1.3" : "Powered by Meta Muse Spark 1.3"}</span></footer>}
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
