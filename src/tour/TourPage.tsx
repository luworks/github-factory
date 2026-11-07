import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Pause, Play, RotateCcw, ShieldCheck, SkipForward, X } from "lucide-react";
import { appPath } from "../base-path";
import { getCachedWorld, getGallery } from "../client/api";
import { WorldCanvas, type CameraTarget } from "../world/WorldCanvas";
import { Brand } from "../components/shared";
import {
  beatIndexAt,
  collectStops,
  createTourClock,
  nextBoundary,
  planTour,
  shotAt,
  STYLE_NAMES,
  tourCandidates,
  tourDuration,
  type TourStop,
} from "./schedule";
import "./tour.css";

const FADE_MS = 900;
const GLIDE_MS = 520;
const noop = () => {};

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
/** Where a framed district lands: right of the caption on wide screens, above it on phones. */
const WIDE_ANCHOR = [0.6, 0.42] as const,
  NARROW_ANCHOR = [0.5, 0.33] as const;

/** Hands-free cinematic tour across cached gallery worlds. Cache-only GET reads; no collection,
 * model calls or writes. Timing uses timeouts at beat/keyframe boundaries only, never RAF; the
 * world canvas owns its own (visibility-gated) frame loop. */
export function TourPage({ record = false }: { record?: boolean }) {
  const reduced = useMedia("(prefers-reduced-motion: reduce)"),
    narrow = useMedia("(max-width: 640px)");
  const [stops, setStops] = useState<TourStop[] | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [ended, setEnded] = useState(false);
  const [seek, setSeek] = useState(0);
  const clock = useRef(createTourClock(() => performance.now()));
  const stage = useRef<HTMLDivElement>(null),
    fade = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    getGallery()
      .then((g) => collectStops(tourCandidates(g.projects), getCachedWorld))
      .catch(() => [] as TourStop[])
      .then((found) => { if (active) setStops(found); });
    return () => { active = false; };
  }, []);

  const beats = useMemo(() => planTour(stops ?? [], { reducedMotion: reduced }), [stops, reduced]);
  const total = tourDuration(beats);
  const index = beatIndexAt(beats, elapsed),
    beat = beats[index],
    shot = shotAt(beat, elapsed - beat.start),
    stop = stops?.[beat.stop];
  const playing = !!stops?.length && !userPaused && !hidden && !ended;

  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);

  // Wake only when the visible beat or keyframe changes; nothing runs per frame.
  useEffect(() => {
    const c = clock.current;
    if (!playing) { c.pause(); return; }
    c.play();
    let timer = 0;
    const tick = () => {
      let now = c.elapsed();
      if (now >= total) {
        if (!record) { c.pause(); c.seek(total - 1); setElapsed(total - 1); setEnded(true); return; }
        c.seek(0); now = 0;
      }
      setElapsed(now);
      const next = nextBoundary(beats, now) ?? total;
      timer = window.setTimeout(tick, Math.max(16, next - now));
    };
    tick();
    return () => { window.clearTimeout(timer); c.pause(); };
  }, [playing, beats, total, record, seek]);

  const go = (i: number) => {
    const target = Math.max(0, Math.min(beats.length - 1, i));
    clock.current.seek(beats[target].start);
    setElapsed(beats[target].start);
    setEnded(false);
    setSeek((n) => n + 1);
  };
  const exit = () => window.location.assign(appPath("/"));
  const toggle = () => {
    if (!ended) return setUserPaused((p) => !p);
    go(0);
    setUserPaused(false);
  };
  const controls = useRef({ go, exit, toggle, index, last: beats.length - 1 });
  controls.current = { go, exit, toggle, index, last: beats.length - 1 };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const c = controls.current,
        onControl = e.target instanceof HTMLElement && !!e.target.closest("button, a");
      if (e.key === "Escape") { e.preventDefault(); c.exit(); }
      else if (e.key === " " && !onControl) { e.preventDefault(); c.toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); c.go(c.index + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); c.go(c.index - 1); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // The stage is a film, not a control surface.
  useEffect(() => { stage.current?.setAttribute("inert", ""); }, []);

  // Cross-fade: freeze the last painted frame over the stage, then let CSS fade it out.
  const scene = stop ? `${beat.stop}:${beat.style}` : "";
  const previousScene = useRef(scene);
  useLayoutEffect(() => {
    const before = previousScene.current;
    previousScene.current = scene;
    const overlay = fade.current,
      source = stage.current?.querySelector<HTMLCanvasElement>('canvas[data-testid="world-canvas"]');
    if (!overlay || !source || !before || before === scene || reduced || !source.width) return;
    overlay.width = source.width;
    overlay.height = source.height;
    overlay.getContext("2d")?.drawImage(source, 0, 0);
    overlay.classList.remove("is-fading");
    void overlay.offsetWidth;
    overlay.classList.add("is-fading");
  }, [scene, reduced]);

  // Portrait screens fit the world by width, so districts need a closer shot to read.
  const camera = useMemo<CameraTarget>(
    () => ({ nodeId: shot.nodeId, zoom: shot.zoom * (narrow ? 1.7 : 1), glide: GLIDE_MS, anchor: narrow ? NARROW_ANCHOR : WIDE_ANCHOR }),
    [shot.nodeId, shot.zoom, narrow],
  );
  const state = !stops ? "loading" : !stops.length ? "empty" : ended ? "ended" : userPaused || hidden ? "paused" : "playing";
  const caption = beat.caption;
  const isEnd = beat.kind === "end";

  return (
    <div
      className={`tour ${record ? "tour-record" : ""} ${reduced ? "tour-slideshow" : "tour-motion"} tour-style-${beat.style}`}
      data-testid="tour"
      data-state={state}
      data-beat={index}
      data-beat-kind={beat.kind}
      data-style={stop ? beat.style : ""}
      data-repo={stop?.world.repo.fullName ?? ""}
      data-mode={reduced ? "slideshow" : "motion"}
      data-record={record ? "1" : "0"}
    >
      <div className="tour-stage" ref={stage} aria-hidden="true">
        {stop && (
          <WorldCanvas
            world={stop.world}
            style={beat.style}
            selectedId={isEnd ? null : shot.nodeId}
            onSelect={noop}
            paused={!playing && !ended}
            camera={camera}
          />
        )}
        <canvas ref={fade} className="tour-fade" style={{ "--tour-fade": `${FADE_MS}ms` } as React.CSSProperties} />
      </div>
      <div className="tour-letterbox top" aria-hidden="true" />
      <div className="tour-letterbox bottom" aria-hidden="true" />

      <header className="tour-top">
        <Brand compact />
        {stop && !isEnd && (
          <span className="tour-style-chip" key={beat.style}>
            <i aria-hidden="true" />
            {STYLE_NAMES[beat.style]}
          </span>
        )}
        <div className="tour-controls" role="group" aria-label="Tour controls">
          <button type="button" onClick={toggle} disabled={!stops?.length} aria-label={ended ? "Replay tour" : userPaused ? "Play tour" : "Pause tour"}>
            {ended ? <RotateCcw size={15} /> : userPaused ? <Play size={15} /> : <Pause size={15} />}
            <span>{ended ? "Replay" : userPaused ? "Play" : "Pause"}</span>
          </button>
          <button type="button" onClick={() => go(beats.length - 1)} disabled={!stops?.length || isEnd} aria-label="Skip tour">
            <SkipForward size={15} />
            <span>Skip</span>
          </button>
          <button type="button" onClick={exit} aria-label="Close tour">
            <X size={16} />
          </button>
        </div>
      </header>

      {!stops && (
        <div className="tour-loading" role="status">
          <span className="signal-dot" />
          Loading cached worlds…
        </div>
      )}

      {stops && !isEnd && (
        <section className="tour-caption" key={beat.id} aria-live="polite">
          <div className="tour-eyebrow">{caption.eyebrow}</div>
          <h1>
            {beat.kind === "repo" && caption.title.includes("/") ? (
              <>
                <span className="tour-owner">{caption.title.split("/")[0]}/</span>
                <wbr />
                {caption.title.split("/").slice(1).join("/")}
              </>
            ) : (
              caption.title
            )}
          </h1>
          <p>{caption.line}</p>
          {(caption.meta || caption.confidence) && (
            <div className="tour-meta">
              {caption.confidence && (
                <span className={`evidence-badge ${caption.confidence}`}>
                  <ShieldCheck size={11} />
                  {caption.confidence === "observed" ? "SOURCE OBSERVED" : "STRUCTURE INFERRED"}
                </span>
              )}
              {caption.meta && <span>{caption.meta}</span>}
            </div>
          )}
        </section>
      )}

      {stops && isEnd && (
        <section className="tour-end" aria-live="polite">
          <div className="tour-eyebrow">{stops.length ? caption.eyebrow : "NO CACHED WORLDS YET"}</div>
          <h1>{caption.title}</h1>
          <p>{stops.length ? caption.line : "No gallery world is cached right now, so the tour has nothing to show. Map a public repository to start one."}</p>
          <div className="tour-cta">
            <a className="tour-primary" href={appPath("/#launch")}>
              Build your world <ArrowRight size={16} />
            </a>
            <a className="tour-secondary" href={appPath("/atlas")}>
              Explore Atlas <ArrowUpRight size={15} />
            </a>
          </div>
          {stops.length > 0 && <div className="tour-credits-label">WORLDS IN THIS TOUR</div>}
          {stops.length > 0 && (
            <ul className="tour-credits" aria-label="Worlds in this tour">
              {stops.map((s) => (
                <li key={s.world.repo.fullName}>
                  <a href={appPath(`/world/${encodeURIComponent(s.world.repo.owner)}/${encodeURIComponent(s.world.repo.name)}?mode=cached`)}>{s.world.repo.fullName}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <footer className="tour-bottom">
        <div
          className="tour-progress"
          role="progressbar"
          aria-label="Tour progress"
          aria-valuemin={1}
          aria-valuemax={beats.length}
          aria-valuenow={index + 1}
          aria-valuetext={`Beat ${index + 1} of ${beats.length}`}
        >
          {beats.map((b, i) => (
            <span key={b.id} className={i < index ? "done" : i === index ? "current" : ""} style={{ flexGrow: b.duration }}>
              {i === index && (
                <i
                  key={`${b.id}:${seek}`}
                  style={{ animationDuration: `${b.duration}ms`, animationPlayState: state === "playing" ? "running" : "paused" }}
                />
              )}
            </span>
          ))}
        </div>
        <p className="tour-disclaimer">
          {stop && <span className="tour-snapshot">Cached snapshot of {stop.world.repo.fullName} · </span>}Inferred architecture from public GitHub metadata, not live telemetry
          <span className="tour-keys"> · Space pause · ← → beats · Esc exit</span>
        </p>
      </footer>
    </div>
  );
}
