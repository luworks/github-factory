import { appPath } from "../base-path";
import { CURATED_PROJECTS } from "../catalog";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Github,
  Globe2,
  GitBranch,
  Star,
  Activity,
  Box,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Layers3,
} from "lucide-react";
import type { FeaturedProject, Lang, StyleId } from "../contracts";
import { WorldCanvas } from "../world/WorldCanvas";
import { illustration, STYLES } from "../client/demo";
import { createWorld, getGallery, shortNumber } from "../client/api";
import { Brand, LanguageButton } from "./shared";
import { RepositoryPreview } from "./RepositoryPreview";
export function LandingPage({ lang, onLangChange }: { lang: Lang; onLangChange: (l: Lang) => void }) {
  const zh = lang === "zh",
    [repo, setRepo] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [gallery, setGallery] = useState<readonly FeaturedProject[]>(CURATED_PROJECTS),
    [style, setStyle] = useState<StyleId>("moonshot");
  const [ready, setReady] = useState(false);
  const [galleryLoaded, setGalleryLoaded] = useState(false);
  useEffect(() => setReady(true), []);
  const sample = useMemo(illustration, []);
  useEffect(() => {
    let active = true;
    getGallery()
      .then((x) => {
        if (active && x.projects.length) setGallery(x.projects);
      })
      .catch(() => {})
      .finally(() => { if (active) setGalleryLoaded(true); });
    return () => {
      active = false;
    };
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const w = await createWorld(repo.trim());
      window.location.assign(appPath(`/world/${encodeURIComponent(w.repo.owner)}/${encodeURIComponent(w.repo.name)}?style=${style}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to map this repository.");
      setBusy(false);
    }
  };
  return (
    <div className="landing">
      <header className="site-header">
        <Brand />
        <nav>
          <a href="#worlds">{zh ? "探索世界" : "Explore worlds"}</a>
          <a href="#perspectives">{zh ? "五种视角" : "Perspectives"}</a>
          <LanguageButton lang={lang} onChange={onLangChange} />
          <a className="header-cta" href="#launch">
            {zh ? "创建世界" : "Build a world"}
            <ArrowUpRight size={14} />
          </a>
          <a className="header-repo-link" href="https://github.com/luworks/github-factory" target="_blank" rel="noopener noreferrer" aria-label={zh ? "GitHub 源码仓库" : "GitHub source repository"}>
            <Github size={14} />
            <span>GitHub</span>
          </a>
        </nav>
      </header>
      <main>
        <section className="hero" id="launch">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="signal-dot" />
              {zh ? "给开源一个全新的视角" : "A NEW PERSPECTIVE ON OPEN SOURCE"}
            </div>
            <h1>
              {zh ? (
                <>
                  每一份代码，
                  <br />
                  都有自己的<span>世界。</span>
                </>
              ) : (
                <>
                  Every codebase.
                  <br />A world of <em>its own.</em>
                </>
              )}
            </h1>
            <p className="hero-description">
              {zh
                ? "把开源 GitHub 仓库变成一个可探索的世界。看懂架构，发现正在发生的变化，找到你的下一次贡献。"
                : "Turn an open-source GitHub repository into a living, explorable world. See the architecture. Follow the work. Find where you belong."}
            </p>
            <form className={`repo-form ${busy ? "is-busy" : ""}`} onSubmit={submit}>
              <Github size={21} />
              <label className="sr-only" htmlFor="repository">
                GitHub repository URL
              </label>
              <input
                id="repository"
                name="repository"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://github.com/owner/repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                disabled={!ready || busy}
                required
                maxLength={240}
              />
              <button
                type="submit"
                aria-label={busy ? (zh ? "勘测中" : "Mapping") : zh ? "生成世界" : "Generate world"}
                disabled={!ready || busy || !repo.trim()}
              >
                {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={20} />}
                <span>{busy ? (zh ? "勘测中" : "Mapping") : zh ? "生成世界" : "Generate world"}</span>
              </button>
            </form>
            <p className="repo-disclosure">
              {zh
                ? "仅接受有可识别开源许可证的公开 GitHub 仓库网址。生成 AI 导览时，会将部分仓库路径、架构摘要和项目动态发送给配置的 AI 服务。"
                : "Enter a public GitHub repository URL with a recognized open-source license. Generating an AI guide sends a limited survey of paths, architecture and activity to the configured AI provider."}
            </p>
            {busy && (
              <div role="status" className="mapping-status">
                <span className="signal-dot" />
                {zh
                  ? "正在读取公开代码结构与项目进展。大型仓库可能需要一点时间。"
                  : "Surveying public source, architecture and activity. Large repositories may take a moment."}
              </div>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="hero-examples">
              <span>{zh ? "试试" : "TRY"}</span>
              {["openclaw/openclaw", "react/react", "pingdotgg/t3code"].map((r) => (
                <button key={r} onClick={() => setRepo(`https://github.com/${r}`)} disabled={!ready || busy || !gallery.some((p) => p.fullName === r && p.ready)}>
                  {r.split("/")[1]}
                  <ChevronRight size={11} />
                </button>
              ))}
            </div>
            <div className="hero-assurances">
              <span>
                <Github size={13} />
                {zh ? "开源仓库 · 只读" : "Open-source repos. Read-only."}
              </span>
              <span>
                <Layers3 size={13} />
                {zh ? "五个世界 · 同一份事实" : "Five worlds. One source of truth."}
              </span>
            </div>
          </div>
          <div className="hero-scene">
            <div className="hero-scene-top">
              <span>
                <span className="signal-dot" />
                WORLD PREVIEW
              </span>
              <span>SECTOR 001 / MOON FACTORY</span>
            </div>
            <WorldCanvas world={sample} style={style} selectedId={null} onSelect={() => {}} className="hero-world" />
            <div className="hero-scene-bottom">
              <span>AN ILLUSTRATIVE WORLD</span>
              <span>
                YOUR REPO GOES HERE <ArrowUpRight size={12} />
              </span>
            </div>
            <div className="hero-scene-note">
              <span>01</span>
              <p>{zh ? "不是又一个看板。是你可以走进去的代码。" : "Not another dashboard. A codebase you can step into."}</p>
            </div>
          </div>
        </section>
        <section className="principle-strip">
          <div>
            <span className="strip-number">01 /</span>
            <Box size={18} />
            <p>
              {zh ? "架构变成地点" : "Architecture becomes a place"}
              <small>{zh ? "模块、服务和依赖，终于一目了然。" : "Modules, services and dependencies. Finally, a mental map."}</small>
            </p>
          </div>
          <div>
            <span className="strip-number">02 /</span>
            <Activity size={18} />
            <p>
              {zh ? "进展变成故事" : "Progress becomes a story"}
              <small>{zh ? "真正的 Issue、PR 与 CI，持续更新。" : "Real issues, pull requests and CI. Always in context."}</small>
            </p>
          </div>
          <div>
            <span className="strip-number">03 /</span>
            <Globe2 size={18} />
            <p>
              {zh ? "贡献从此有方向" : "Contribution finds a direction"}
              <small>{zh ? "有证据的 AI 解说，帮你找到下一步。" : "Evidence-linked AI guidance to find your next move."}</small>
            </p>
          </div>
        </section>
        <section className="worlds-section" id="worlds">
          <div className="section-heading">
            <div>
              <div className="eyebrow">THE OPEN-SOURCE ATLAS</div>
              <h2>{zh ? "世界已备好，等你探索。" : "Great projects. Uncharted worlds."}</h2>
            </div>
            <span className="quiet-label">
              {zh ? `${gallery.length} 个精选热门公开项目` : `${gallery.length} CURATED POPULAR PROJECTS`}
              <ArrowUpRight size={15} />
            </span>
          </div>
          <div className="project-grid">
            {gallery.map((p) => (
              <div className="project-card-shell" key={p.fullName}>
              <a className="project-card" href={p.ready ? appPath(`/world/${p.fullName}?style=${p.suggestedStyle}`) : undefined} aria-disabled={!p.ready} tabIndex={p.ready ? undefined : -1} onClick={(e) => { if (!p.ready) e.preventDefault(); }} >
                <div className="project-art">
                  <RepositoryPreview fullName={p.fullName} style={p.suggestedStyle} lang={lang} enabled={galleryLoaded} />
                  <span className="project-category">{p.category}</span>
                  <span className="project-arrow">
                    <ArrowUpRight size={18} />
                  </span>
                </div>
                <div className="project-card-body">
                  <span className="project-owner">{p.fullName.split("/")[0]} /</span>
                  <h3>{p.name}</h3>
                  <p>{p.description}</p>
                  <div className="project-meta">
                    <span>
                      <span className={`language-dot lang-${p.language?.toLowerCase()}`} />
                      {p.language ?? "Repository"}
                    </span>
                    {p.stars !== null && (
                      <span>
                        <Star size={12} />
                        {shortNumber(p.stars)}
                      </span>
                    )}
                    <span className="project-ready">
                      {p.ready ? (zh ? "探索世界" : "Explore world") : (zh ? "地图暂不可用" : "Map unavailable")}
                      <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              </a>
              <a className="project-source-link" href={`https://github.com/${p.fullName}`} target="_blank" rel="noopener noreferrer" aria-label={`${zh ? "GitHub 来源" : "GitHub source"}: ${p.fullName}`}>
                <Github size={11} /> {zh ? "来源" : "Source"}
              </a>
              </div>
            ))}
          </div>
        </section>
        <section className="perspectives-section" id="perspectives">
          <div className="perspective-copy">
            <div className="eyebrow">SAME CODE. DIFFERENT WORLDS.</div>
            <h2>{zh ? "选一个你想住进的世界。" : "Find your kind of world."}</h2>
            <p>
              {zh
                ? "工业传送带、军事基地、六边形文明，或是一座月面殖民地。换一个视角，事实始终一致。"
                : "Industrial belts. Command bases. Hex-tile civilizations. Or a colony on the moon. Change the lens, keep the truth."}
            </p>
          </div>
          <div className="style-options">
            {STYLES.map((s) => (
              <button
                key={s.id}
                className={`style-option ${style === s.id ? "selected" : ""}`}
                onClick={() => {
                  setStyle(s.id);
                  document.getElementById("launch")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <span className={`style-symbol symbol-${s.id}`}>{s.glyph}</span>
                <strong>{zh ? s.zh : s.name}</strong>
                <small>{s.subtitle}</small>
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
        </section>
        <section className="closing-line">
          <span className="closing-orbit">◒</span>
          <h2>{zh ? "代码不该只被阅读。\n它应该被探索。" : "Code was meant to be explored."}</h2>
          <a href="#launch">
            {zh ? "你的世界，从这里开始" : "Your world starts here"}
            <ArrowRight size={18} />
          </a>
        </section>
      </main>
      <footer className="site-footer">
        <Brand compact />
        <span>{zh ? "为开源的好奇心而造。" : "BUILT FOR THE CURIOUS. BUILT ON OPEN SOURCE."}</span>
        <p>
          <ShieldCheck size={13} />
          {zh ? "AI 支持：Meta Muse Spark 1.3" : "Powered by Meta Muse Spark 1.3"}
        </p>
      </footer>
    </div>
  );
}
