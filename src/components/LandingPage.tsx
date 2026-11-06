import { appPath } from "../base-path";
import { CURATED_PROJECTS } from "../catalog";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Github,
  Globe2,
  GitBranch,
  Activity,
  Box,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Layers3,
} from "lucide-react";
import type { FeaturedProject, StyleId } from "../contracts";
import { STYLES } from "../client/demo";
import { createWorld, getGallery } from "../client/api";
import { Brand } from "./shared";
import { HeroScene } from "./HeroScene";
import { ProjectCard } from "./ProjectCard";
import "./landing-motion.css";

/** Adds `is-revealed` to `.reveal` elements as they scroll in (staggered by CSS). */
function useReveal(root: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.classList.add("motion-ready");
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-revealed"); io.unobserve(entry.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    el.querySelectorAll(".reveal:not(.is-revealed)").forEach((node) => io.observe(node));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Elapsed seconds while mapping, written directly to a span (no page re-render). */
function MappingProgress() {
  const counter = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = performance.now();
    const timer = window.setInterval(() => { if (counter.current) counter.current.textContent = `${Math.floor((performance.now() - start) / 1000)}s`; }, 250);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="mapping-progress" aria-hidden="true">
      <span className="mapping-bar"><i /></span>
      <span className="mapping-steps"><b>Survey</b><b>Architecture</b><b>Activity</b><b>World</b></span>
      <span ref={counter} className="mapping-elapsed">0s</span>
    </div>
  );
}
export function LandingPage() {
  const [repo, setRepo] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [gallery, setGallery] = useState<readonly FeaturedProject[]>(CURATED_PROJECTS),
    [style, setStyle] = useState<StyleId>("moonshot");
  const [ready, setReady] = useState(false);
  const [galleryLoaded, setGalleryLoaded] = useState(false);
  useEffect(() => setReady(true), []);
  const root = useRef<HTMLDivElement>(null);
  useReveal(root, [gallery]);
  const current = STYLES.find((s) => s.id === style) ?? STYLES[0];
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
    <div className="landing" ref={root}>
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
              <>
                <div role="status" className="mapping-status">
                  <span className="signal-dot" />
                  {"Surveying public source, architecture and activity. Large repositories may take a moment."}
                </div>
                <MappingProgress />
              </>
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
          <div className={`hero-scene hero-style-${style}`}>
            <div className="hero-scene-top">
              <span>
                <span className="signal-dot" />
                WORLD PREVIEW
              </span>
              <span key={style} className="hero-sector">{`SECTOR 00${STYLES.indexOf(current) + 1} / ${current.name.toUpperCase()}`}</span>
            </div>
            <HeroScene style={style} />
            <div className="hero-style-chips" role="group" aria-label="Hero world style">
              {STYLES.map((s) => (
                <button key={s.id} type="button" className={`hero-chip chip-${s.id}`} aria-pressed={style === s.id} aria-label={s.name} onClick={() => setStyle(s.id)} title={s.name}>
                  <span className="hero-chip-glyph" aria-hidden="true">{s.glyph}</span>
                  <span className="hero-chip-name">{s.name}</span>
                </button>
              ))}
            </div>
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
        <section className="principle-strip reveal">
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
            {gallery.map((p, index) => (
              <ProjectCard key={p.fullName} project={p} enabled={galleryLoaded} index={index} />
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
                type="button"
                className={`style-option reveal swatch-${s.id} ${style === s.id ? "selected" : ""}`}
                style={{ "--reveal-delay": `${STYLES.indexOf(s) * 80}ms` } as React.CSSProperties}
                onClick={() => {
                  setStyle(s.id);
                  document.getElementById("launch")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <span className="style-swatch" aria-hidden="true"><i /><i /><i /></span>
                <span className={`style-symbol symbol-${s.id}`}>{s.glyph}</span>
                <strong>{s.name}</strong>
                <small>{s.subtitle}</small>
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
        </section>
        <section className="closing-line reveal">
          <span className="closing-orbit" aria-hidden="true"><span>◒</span></span>
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
