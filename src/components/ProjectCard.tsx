import { useEffect, useRef } from "react";
import { ArrowRight, ArrowUpRight, Github, Star } from "lucide-react";
import { appPath } from "../base-path";
import type { FeaturedProject } from "../contracts";
import { shortNumber } from "../client/api";
import { RepositoryPreview, type PreviewTilt } from "./RepositoryPreview";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Gallery card with pointer tilt, a moving glint and a "warp" transition into the
 * world page. Pointer handling writes CSS custom properties once per animation frame
 * (no layout reads inside the frame) and shares the offset with the card canvas.
 */
export function ProjectCard({ project: p, enabled, index }: { project: FeaturedProject; enabled: boolean; index: number }) {
  const shell = useRef<HTMLDivElement>(null);
  const tilt = useRef<PreviewTilt>({ x: 0, y: 0 });
  const frame = useRef(0);
  const target = useRef({ x: 0, y: 0, rect: null as DOMRect | null });
  const href = p.ready ? appPath(`/world/${p.fullName}?style=${p.suggestedStyle}`) : undefined;

  useEffect(() => {
    // Returning with the back/forward cache must not leave the warp overlay in place.
    const clear = (e: PageTransitionEvent) => { if (e.persisted) shell.current?.classList.remove("is-warping"); };
    window.addEventListener("pageshow", clear);
    return () => { window.removeEventListener("pageshow", clear); cancelAnimationFrame(frame.current); };
  }, []);

  const apply = () => {
    frame.current = 0;
    const el = shell.current;
    if (!el) return;
    const { x, y } = target.current;
    tilt.current.x = x; tilt.current.y = y;
    el.style.setProperty("--tilt-x", `${(-y * 6).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(x * 8).toFixed(2)}deg`);
    el.style.setProperty("--glint-x", `${((x + 1) * 50).toFixed(1)}%`);
    el.style.setProperty("--glint-y", `${((y + 1) * 50).toFixed(1)}%`);
  };
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(apply); };
  const onEnter = (e: React.PointerEvent) => { if (e.pointerType !== "touch") target.current.rect = shell.current?.getBoundingClientRect() ?? null; };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || reduced()) return;
    const r = target.current.rect ?? (target.current.rect = shell.current?.getBoundingClientRect() ?? null);
    if (!r || r.width < 1) return;
    target.current.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    target.current.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    shell.current?.classList.add("is-tilting");
    schedule();
  };
  const onLeave = () => {
    target.current = { x: 0, y: 0, rect: null };
    shell.current?.classList.remove("is-tilting");
    schedule();
  };
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!p.ready) { e.preventDefault(); return; }
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || reduced() || !href) return;
    // Brief zoom-into-the-map transition, then navigate to the same URL.
    e.preventDefault();
    shell.current?.classList.add("is-warping");
    window.setTimeout(() => window.location.assign(href), 320);
  };

  return (
    <div ref={shell} className="project-card-shell reveal" style={{ "--reveal-delay": `${Math.min(index, 8) * 70}ms` } as React.CSSProperties} onPointerEnter={onEnter} onPointerMove={onMove} onPointerLeave={onLeave}>
      <a className="project-card" href={href} aria-disabled={!p.ready} tabIndex={p.ready ? undefined : -1} onClick={onClick}>
        <div className="project-art">
          <RepositoryPreview fullName={p.fullName} style={p.suggestedStyle} enabled={enabled} tilt={tilt.current} />
          <span className="project-category">{p.category}</span>
          <span className="project-arrow">
            <ArrowUpRight size={18} />
          </span>
          <span className="project-glint" aria-hidden="true" />
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
              {p.ready ? "Explore world" : "Map unavailable"}
              <ArrowRight size={12} />
            </span>
          </div>
        </div>
      </a>
      <a className="project-source-link" href={`https://github.com/${p.fullName}`} target="_blank" rel="noopener noreferrer" aria-label={`GitHub source: ${p.fullName}`}>
        <Github size={11} /> {"Source"}
      </a>
      <span className="project-warp" aria-hidden="true" />
    </div>
  );
}
