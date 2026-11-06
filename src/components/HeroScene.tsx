import { useEffect, useRef } from "react";
import type { StyleId } from "../contracts";
import { buildHeroScene, createParticles, seeded, spawnAmbient, stepParticles, STILL_TIME, riseProgress, type HeroScene as Scene } from "../gallery/hero-scene";
import { heroCamera, islandCache, paintHeroScene, paintNameplates, type HeroView, type Layers } from "../gallery/hero-render";

const SWITCH_OUT = 0.42, SWITCH_SCAN = 0.55;
const scenes = new Map<StyleId, Scene>();
const sceneFor = (style: StyleId) => { let s = scenes.get(style); if (!s) { s = buildHeroScene(style); scenes.set(style, s); } return s; };

/**
 * Living hero diorama: one RAF loop, paused offscreen (IntersectionObserver), when
 * the document is hidden, under prefers-reduced-motion (one still frame instead)
 * and on unmount. Device pixel ratio and total pixels are capped.
 */
export function HeroScene({ style }: { style: StyleId }) {
  const wrap = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), counter = useRef<HTMLSpanElement>(null);
  const control = useRef<{ setStyle: (style: StyleId) => void }>({ setStyle: () => {} });
  const initial = useRef(style);
  useEffect(() => {
    const cv = canvas.current, el = wrap.current;
    const g = cv?.getContext("2d");
    if (!cv || !el || !g) return;
    const stage = el.closest<HTMLElement>(".hero-scene") ?? el;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const world = document.createElement("canvas"), low = document.createElement("canvas"), lowContext = low.getContext("2d")!;
    const particles = createParticles(), random = seeded(99);
    let scene = sceneFor(initial.current), previous: Scene | null = null;
    let raf = 0, visible = false, disposed = false, last: number | null = null;
    let time = 0, introAt = 0, switchAt = -Infinity, width = 1, height = 1, dpr = 1;
    let island: Layers["island"] | null = null, islandKey = "";
    let previousIsland: Layers["island"] | null = null, previousKey = "";
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let scroll = window.scrollY, reported = -1;
    const animated = () => !motion.matches;
    const eligible = () => !disposed && visible && !document.hidden && width > 1 && height > 1;

    const layersFor = (s: Scene, view: HeroView, which: "current" | "previous"): Layers => {
      const res = view.resolution * s.theme.pixel;
      const k = heroCamera(s, view).k * res * 1.03;
      const key = `${s.theme.id}:${Math.round(k * 20)}`;
      if (which === "current" && key !== islandKey) { island = islandCache(s, k); islandKey = key; }
      if (which === "previous" && key !== previousKey) { previousIsland = islandCache(s, k); previousKey = key; }
      const w = Math.max(1, Math.round(width * res)), h = Math.max(1, Math.round(height * res));
      if (world.width !== w || world.height !== h) { world.width = w; world.height = h; }
      return { world, island: (which === "current" ? island : previousIsland)!, islandScale: k };
    };

    const paintScene = (s: Scene, view: HeroView, which: "current" | "previous") => {
      const pixelated = s.theme.pixel < 1;
      const res = view.resolution * s.theme.pixel;
      const v = { ...view, resolution: res };
      const layers = layersFor(s, view, which);
      if (pixelated) {
        const w = Math.max(1, Math.round(width * res)), h = Math.max(1, Math.round(height * res));
        if (low.width !== w || low.height !== h) { low.width = w; low.height = h; }
        const cam = paintHeroScene(lowContext, s, v, layers, which === "current" ? particles : null);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.imageSmoothingEnabled = false;
        g.drawImage(low, 0, 0, cv.width, cv.height);
        g.imageSmoothingEnabled = true;
        // Retro scanlines.
        g.fillStyle = "rgba(0,0,0,0.08)";
        for (let y = 0; y < cv.height; y += Math.max(2, Math.round(3 * dpr))) g.fillRect(0, y, cv.width, 1);
        return cam;
      }
      return paintHeroScene(g, s, v, layers, which === "current" ? particles : null);
    };

    const render = () => {
      const live = animated();
      const t = live ? time : STILL_TIME;
      const base: HeroView = { width, height, resolution: dpr, time: t, built: live ? time - introAt : Infinity, px: pointer.x, py: pointer.y, scroll: live ? Math.max(0, scroll) : 0, animated: live };
      const sinceSwitch = time - switchAt;
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (live && previous && sinceSwitch < SWITCH_OUT) {
        // Demolish: the old perspective sinks back into the ground, outer ring first.
        const old = previous;
        const view = { ...base, rise: (index: number) => { const b = old.buildings[index]; return Math.max(0, 1 - Math.max(0, sinceSwitch - (1.4 - b.delay) * 0.12) / 0.26); } };
        paintScene(old, view, "previous");
      } else {
        const cam = paintScene(scene, base, "current");
        if (live && previous && sinceSwitch < SWITCH_OUT + SWITCH_SCAN) {
          // Scan wipe reveals the new perspective over the cleared old island.
          const k = (sinceSwitch - SWITCH_OUT) / SWITCH_SCAN, eased = 1 - (1 - k) ** 3, scanY = eased * height;
          g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.beginPath(); g.rect(0, scanY * dpr, cv.width, cv.height); g.clip();
          paintScene(previous, { ...base, rise: () => 0 }, "previous");
          g.restore();
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          const beam = g.createLinearGradient(0, scanY - 18, 0, scanY + 2);
          beam.addColorStop(0, "rgba(255,255,255,0)"); beam.addColorStop(1, scene.theme.glow);
          g.fillStyle = beam; g.fillRect(0, scanY - 18, width, 20);
          g.fillStyle = "#ffffff"; g.fillRect(0, scanY, width, 1.5);
        } else if (previous && sinceSwitch >= SWITCH_OUT + SWITCH_SCAN) { previous = null; previousIsland = null; previousKey = ""; }
        paintNameplates(g, scene, base, cam, dpr);
      }
      // HUD construction counter: direct DOM writes only when the value changes.
      const elapsed = live ? time - introAt : Infinity;
      const done = live && previous && sinceSwitch < SWITCH_OUT ? 0 : scene.buildings.filter((b) => riseProgress(elapsed, b.delay) >= 1).length;
      if (done !== reported && counter.current) {
        reported = done;
        counter.current.textContent = `${done}/${scene.buildings.length}`;
        stage.style.setProperty("--built", (done / Math.max(1, scene.buildings.length)).toFixed(3));
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!eligible() || !animated()) return;
      const dt = last === null ? 1 / 60 : Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      time += dt;
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 5);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 5);
      // Write-only CSS custom properties drive the 3D card tilt (no layout reads here).
      stage.style.setProperty("--hero-tilt-x", `${(-pointer.y * 3).toFixed(2)}deg`);
      stage.style.setProperty("--hero-tilt-y", `${(pointer.x * 4).toFixed(2)}deg`);
      if (time - switchAt > SWITCH_OUT) {
        const elapsed = time - introAt;
        spawnAmbient(particles, scene, dt, time, random, (b) => riseProgress(elapsed, b.delay) >= 1);
      }
      stepParticles(particles, dt, scene.theme.particle);
      render();
      request();
    };
    const request = () => { if (!raf && eligible() && animated()) raf = requestAnimationFrame(frame); };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; last = null; };
    const still = () => {
      if (disposed || width <= 1) return;
      // Reduced motion: one composed frame with a deterministic particle field.
      particles.life.fill(0);
      const r = seeded(5);
      for (let k = 0; k < 80; k++) { spawnAmbient(particles, scene, 0.1, STILL_TIME, r, () => true); stepParticles(particles, 0.1, scene.theme.particle); }
      stage.style.setProperty("--hero-tilt-x", "0deg"); stage.style.setProperty("--hero-tilt-y", "0deg");
      render();
    };
    const sync = () => { if (animated()) request(); else { stop(); still(); } };

    const resize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      width = rect.width; height = rect.height;
      dpr = Math.min(1.75, window.devicePixelRatio || 1, Math.sqrt(1_800_000 / (width * height)));
      cv.width = Math.round(width * dpr); cv.height = Math.round(height * dpr);
      if (!animated() && visible) still(); else if (raf === 0 && visible) { render(); request(); }
    };
    const resizer = new ResizeObserver(resize);
    resizer.observe(el);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
      if (visible) { if (animated()) request(); else still(); } else stop();
    });
    intersection.observe(el);
    const visibility = () => { if (document.hidden) stop(); else sync(); };
    const onScroll = () => { scroll = window.scrollY; };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = stage.getBoundingClientRect();
      pointer.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      pointer.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    };
    const onLeave = () => { pointer.tx = 0; pointer.ty = 0; };
    document.addEventListener("visibilitychange", visibility);
    motion.addEventListener("change", sync);
    window.addEventListener("scroll", onScroll, { passive: true });
    stage.addEventListener("pointermove", onPointer);
    stage.addEventListener("pointerleave", onLeave);
    control.current.setStyle = (next) => {
      if (next === scene.theme.id) return;
      const nextScene = sceneFor(next);
      if (animated() && time - introAt > 0.2) {
        previous = scene; previousIsland = island; previousKey = islandKey;
        switchAt = time; introAt = time + SWITCH_OUT;
      } else { previous = null; introAt = time; }
      scene = nextScene; island = null; islandKey = "";
      particles.life.fill(0); particles.next = 0;
      if (animated()) request(); else still();
    };
    resize();
    return () => {
      disposed = true; stop();
      resizer.disconnect(); intersection.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", sync);
      window.removeEventListener("scroll", onScroll);
      stage.removeEventListener("pointermove", onPointer);
      stage.removeEventListener("pointerleave", onLeave);
      control.current.setStyle = () => {};
      cv.width = cv.height = world.width = world.height = low.width = low.height = 0;
    };
  }, []);
  useEffect(() => { control.current.setStyle(style); }, [style]);
  return (
    <div ref={wrap} className="hero-stage">
      <canvas ref={canvas} className="hero-canvas" data-testid="hero-canvas" aria-hidden="true" />
      <div className="hero-hud" aria-hidden="true">
        <span className="hero-hud-label">{"Districts"}</span>
        <span ref={counter} className="hero-hud-count" data-testid="hero-built">{"0/0"}</span>
        <span className="hero-hud-bar"><i /></span>
      </div>
    </div>
  );
}
