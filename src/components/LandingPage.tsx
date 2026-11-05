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
import type { FeaturedProject, StyleId } from "../contracts";
import { WorldCanvas } from "../world/WorldCanvas";
import { illustration, STYLES } from "../client/demo";
import { createWorld, getGallery, shortNumber } from "../client/api";
import { Brand } from "./shared";
import { RepositoryPreview } from "./RepositoryPreview";
export function LandingPage() {
  const [repo, setRepo] = useState(""),
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
          <a href={appPath("/atlas")}>Explore Atlas</a>
          <a href="#worlds">{"Explore worlds"}</a>
          <a href="#perspectives">{"Perspectives"}</a>
          <a className="header-cta" href="#launch">
            {"Build a world"}
            <ArrowUpRight size={14} />
          </a>
          <a className="header-repo-link" href="https://github.com/luworks/github-factory" target="_blank" rel="noopener noreferrer" aria-label={"GitHub source repository"}>
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
              {"A NEW PERSPECTIVE ON OPEN SOURCE"}
            </div>
            <h1>
              {(
                <>
                  Every codebase.
                  <br />A world of <em>its own.</em>
                </>
              )}
            </h1>
            <p className="hero-description">
              {"Turn a public GitHub repository into a living, explorable world. See the architecture. Follow the work. Find where you belong."}
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
                aria-label={busy ? ("Mapping") : "Generate world"}
                disabled={!ready || busy || !repo.trim()}
              >
                {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={20} />}
                <span>{busy ? ("Mapping") : "Generate world"}</span>
              </button>
            </form>
            <p className="repo-disclosure">
              {"Enter any publicly accessible GitHub repository URL; license metadata is shown as reported. Generating an AI guide sends a limited survey of paths, architecture and activity to the configured AI provider."}
            </p>
            {busy && (
              <div role="status" className="mapping-status">
                <span className="signal-dot" />
                {"Surveying public source, architecture and activity. Large repositories may take a moment."}
              </div>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="hero-examples">
              <span>{"TRY"}</span>
              {["openclaw/openclaw", "react/react", "pingdotgg/t3code"].map((r) => (
                <button key={r} onClick={() => setRepo(`https://github.com/${r}`)} disabled={!ready || busy || !gallery.some((p) => p.fullName === r && p.ready)}>
                  {r.split("/")[1]}
                  <ChevronRight size={11} />
                </button>
              ))}
            </div>
            <a className="primary-button" style={{minHeight:44,fontSize:14,marginTop:14}} href={appPath("/atlas")}>Explore Atlas <ArrowUpRight size={14} /></a>
            <div className="hero-assurances">
              <span>
                <Github size={13} />
                {"Public repos. Read-only."}
              </span>
              <span>
                <Layers3 size={13} />
                {"Five worlds. One source of truth."}
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
              <p>{"Not another dashboard. A codebase you can step into."}</p>
            </div>
          </div>
        </section>
        <section className="principle-strip">
          <div>
            <span className="strip-number">01 /</span>
            <Box size={18} />
            <p>
              {"Architecture becomes a place"}
              <small>{"Modules, services and dependencies. Finally, a mental map."}</small>
            </p>
          </div>
          <div>
            <span className="strip-number">02 /</span>
            <Activity size={18} />
            <p>
              {"Progress becomes a story"}
              <small>{"Real issues, pull requests and CI. Always in context."}</small>
            </p>
          </div>
          <div>
            <span className="strip-number">03 /</span>
            <Globe2 size={18} />
            <p>
              {"Contribution finds a direction"}
              <small>{"Evidence-linked AI guidance to find your next move."}</small>
            </p>
          </div>
        </section>
        <section className="worlds-section" id="worlds">
          <div className="section-heading">
            <div>
              <div className="eyebrow">THE OPEN-SOURCE ATLAS</div>
              <h2>{"Great projects. Uncharted worlds."}</h2>
            </div>
            <span className="quiet-label">
              {`${gallery.length} CURATED POPULAR PROJECTS`}
              <ArrowUpRight size={15} />
            </span>
          </div>
          <div className="project-grid">
            {gallery.map((p) => (
              <div className="project-card-shell" key={p.fullName}>
              <a className="project-card" href={p.ready ? appPath(`/world/${p.fullName}?style=${p.suggestedStyle}`) : undefined} aria-disabled={!p.ready} tabIndex={p.ready ? undefined : -1} onClick={(e) => { if (!p.ready) e.preventDefault(); }} >
                <div className="project-art">
                  <RepositoryPreview fullName={p.fullName} style={p.suggestedStyle} enabled={galleryLoaded} />
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
                      {p.ready ? ("Explore world") : ("Map unavailable")}
                      <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              </a>
              <a className="project-source-link" href={`https://github.com/${p.fullName}`} target="_blank" rel="noopener noreferrer" aria-label={`${"GitHub source"}: ${p.fullName}`}>
                <Github size={11} /> {"Source"}
              </a>
              </div>
            ))}
          </div>
        </section>
        <section className="perspectives-section" id="perspectives">
          <div className="perspective-copy">
            <div className="eyebrow">SAME CODE. DIFFERENT WORLDS.</div>
            <h2>{"Find your kind of world."}</h2>
            <p>
              {"Industrial belts. Command bases. Hex-tile civilizations. Or a colony on the moon. Change the lens, keep the truth."}
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
                <strong>{s.name}</strong>
                <small>{s.subtitle}</small>
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
        </section>
        <section className="closing-line">
          <span className="closing-orbit">◒</span>
          <h2>{"Code was meant to be explored."}</h2>
          <a href="#launch">
            {"Your world starts here"}
            <ArrowRight size={18} />
          </a>
        </section>
      </main>
      <footer className="site-footer">
        <Brand compact />
        <span>{"BUILT FOR THE CURIOUS. BUILT ON OPEN SOURCE."}</span>
        <p>
          <ShieldCheck size={13} />
          {"Powered by Meta Muse Spark 1.3"}
        </p>
      </footer>
    </div>
  );
}
