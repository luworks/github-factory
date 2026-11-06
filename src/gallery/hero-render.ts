import {
  heroDaylight, paintBuilding, paintIsland, paintOcean, paintParticles, paintPulses, paintSky, paintTraffic, paintWindows,
  riseProgress, type HeroScene, type ParticlePool,
} from "./hero-scene";

/** Frame composition for the landing hero. The component owns scheduling; this
 * module only paints one frame from explicit inputs, so a still frame is exact. */

export interface HeroView {
  /** CSS pixel size of the stage. */
  width: number; height: number;
  /** Device pixels per CSS pixel for the scene buffer (already capped). */
  resolution: number;
  /** Animation clock in seconds. */
  time: number;
  /** Seconds since this scene's construction intro began (Infinity = finished). */
  built: number;
  /** Smoothed pointer offset in [-1, 1] and scroll offset in CSS pixels. */
  px: number; py: number; scroll: number;
  /** Override for buildings (used by the demolish half of a style switch). */
  rise?: (index: number) => number;
  animated: boolean;
}

export interface Camera { k: number; ox: number; oy: number }
export function heroCamera(scene: HeroScene, view: Pick<HeroView, "width" | "height" | "time" | "px" | "py" | "scroll" | "animated">): Camera {
  const b = scene.bounds;
  const compact = view.width < 520;
  let k = Math.min(view.width / (b.width * (compact ? 1.02 : 1.16)), view.height / (b.height * 1.34));
  const t = view.animated ? view.time : 0;
  k *= 1 + Math.sin(t * 0.21) * 0.014;
  const ox = view.width / 2 - (b.x + b.width / 2) * k + Math.sin(t * 0.13) * 6 - view.px * 14;
  const oy = view.height / 2 - (b.y + b.height / 2) * k + view.height * 0.035 + Math.cos(t * 0.17) * 4 - view.py * 8 - Math.min(160, view.scroll) * 0.12;
  return { k, ox, oy };
}

/** Cached static island, rendered once per style and scale. */
export function islandCache(scene: HeroScene, scale: number) {
  const b = scene.bounds, canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(b.width * scale));
  canvas.height = Math.max(1, Math.ceil(b.height * scale));
  const g = canvas.getContext("2d");
  if (g) { g.setTransform(scale, 0, 0, scale, -b.x * scale, -b.y * scale); paintIsland(g, scene); }
  return canvas;
}

export interface Layers { world: HTMLCanvasElement; island: HTMLCanvasElement; islandScale: number }

/** Paint sky, ocean, island, traffic, buildings, lighting and particles into `g`
 * (whose transform is reset here). Labels are painted separately at full resolution. */
export function paintHeroScene(g: CanvasRenderingContext2D, scene: HeroScene, view: HeroView, layers: Layers, particles: ParticlePool | null) {
  const { width: W, height: H, resolution: res, time } = view;
  const theme = scene.theme;
  const light = heroDaylight(time);
  const night = 1 - light.daylight;
  const cam = heroCamera(scene, view);
  g.setTransform(res, 0, 0, res, 0, 0);
  g.imageSmoothingEnabled = true;
  paintSky(g, theme, W, H, time, light, -view.px * 10, -view.py * 6);
  const b = scene.bounds;
  if (theme.ocean) paintOcean(g, theme, W, H, cam.oy + (b.y + b.height * 0.42) * cam.k, time, light.daylight);

  // World layer: island, traffic and buildings, then lighting tints restricted to it.
  const wl = layers.world.getContext("2d")!;
  wl.setTransform(1, 0, 0, 1, 0, 0);
  wl.clearRect(0, 0, layers.world.width, layers.world.height);
  wl.setTransform(res * cam.k, 0, 0, res * cam.k, res * cam.ox, res * cam.oy);
  wl.drawImage(layers.island, b.x, b.y, layers.island.width / layers.islandScale, layers.island.height / layers.islandScale);
  paintTraffic(wl, scene, time, night);
  for (const [index, building] of scene.buildings.entries()) {
    const rise = view.rise ? view.rise(index) : riseProgress(view.built, building.delay);
    paintBuilding(wl, building, theme, rise, time);
    const since = view.built - building.delay;
    // Construction effects: dust burst on groundbreaking and a placement ring on completion.
    if (view.animated && !view.rise && since > 0 && since < 0.7) {
      const k = since / 0.7;
      wl.fillStyle = `rgba(214,200,170,${0.5 * (1 - k)})`;
      for (let p = 0; p < 7; p++) {
        const a = (p / 7) * Math.PI * 2 + building.seed * 6;
        wl.beginPath(); wl.arc(building.x + Math.cos(a) * building.w * (0.4 + k), building.y + Math.sin(a) * building.d * (0.4 + k) - k * 6, 2.5 + k * 4, 0, Math.PI * 2); wl.fill();
      }
    }
    const ring = since - 0.75;
    if (view.animated && !view.rise && ring > 0 && ring < 0.55) {
      const k = ring / 0.55;
      wl.strokeStyle = theme.glow; wl.globalAlpha = 1 - k; wl.lineWidth = 2 / cam.k;
      wl.beginPath(); wl.ellipse(building.x, building.y, building.w * (0.8 + k * 0.9), building.d * (0.8 + k * 0.9), 0, 0, Math.PI * 2); wl.stroke();
      wl.globalAlpha = 1;
    }
  }
  wl.setTransform(1, 0, 0, 1, 0, 0);
  wl.globalCompositeOperation = "source-atop";
  if (night > 0.01) { wl.fillStyle = `rgba(8,16,44,${night * 0.52})`; wl.fillRect(0, 0, layers.world.width, layers.world.height); }
  if (light.dusk > 0.01) { wl.fillStyle = `rgba(255,128,60,${light.dusk * 0.16})`; wl.fillRect(0, 0, layers.world.width, layers.world.height); }
  if (light.daylight > 0.05) {
    // A slow sun glint sweeps across the island.
    const sweep = ((time * 0.07) % 1.6 - 0.3) * layers.world.width;
    const band = wl.createLinearGradient(sweep - 160 * res, 0, sweep + 160 * res, layers.world.height * 0.4);
    band.addColorStop(0, "rgba(255,255,240,0)"); band.addColorStop(0.5, `rgba(255,252,235,${0.14 * light.daylight})`); band.addColorStop(1, "rgba(255,255,240,0)");
    wl.fillStyle = band; wl.fillRect(0, 0, layers.world.width, layers.world.height);
  }
  if (theme.clouds) {
    wl.fillStyle = `rgba(20,30,40,${0.12 * (0.3 + light.daylight * 0.7)})`;
    for (let c = 0; c < 3; c++) {
      const x = ((time * 9 + c * 260) % (W + 400) - 200) * res, y = (H * (0.35 + c * 0.18)) * res;
      wl.beginPath(); wl.ellipse(x, y, 90 * res, 30 * res, -0.2, 0, Math.PI * 2); wl.fill();
    }
  }
  wl.globalCompositeOperation = "source-over";
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(layers.world, 0, 0);

  // Emissive layer: windows, data pulses and particles stay bright at night.
  g.setTransform(res * cam.k, 0, 0, res * cam.k, res * cam.ox, res * cam.oy);
  for (const [index, building] of scene.buildings.entries()) {
    const rise = view.rise ? view.rise(index) : riseProgress(view.built, building.delay);
    paintWindows(g, building, theme, rise, Math.min(1, night * 1.3 + light.dusk * 0.6), time);
  }
  paintPulses(g, scene, time);
  if (particles) paintParticles(g, particles, theme, time);
  g.setTransform(res, 0, 0, res, 0, 0);
  if (theme.clouds) {
    for (let c = 0; c < 3; c++) {
      const x = (time * 9 + c * 260) % (W + 400) - 200 - view.px * 20, y = H * (0.2 + c * 0.18) - view.py * 10;
      g.fillStyle = `rgba(255,255,255,${0.5 + light.daylight * 0.3})`;
      for (let p = 0; p < 4; p++) { g.beginPath(); g.ellipse(x + p * 22 - 33, y + (p % 2) * 5, 26 - (p % 2) * 6, 13, 0, 0, Math.PI * 2); g.fill(); }
    }
  }
  const vignette = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
  vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(0,0,0,0.38)");
  g.fillStyle = vignette; g.fillRect(0, 0, W, H);
  return cam;
}

/** Floating district nameplates (illustrative). Painted on the full-resolution canvas. */
export function paintNameplates(g: CanvasRenderingContext2D, scene: HeroScene, view: HeroView, cam: Camera, dpr: number) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace";
  g.textBaseline = "middle";
  // Obstacles: the top bar, the HUD and the style chips; labels stack upward to avoid them and each other.
  const placed: { x: number; y: number; w: number; h: number }[] = [
    { x: 0, y: 0, w: view.width, h: 56 },
    { x: view.width - 190, y: 50, w: 190, h: 62 },
    { x: 0, y: view.height - 110, w: view.width, h: 110 },
  ];
  const hit = (r: { x: number; y: number; w: number; h: number }) => placed.some((o) => r.x < o.x + o.w + 4 && r.x + r.w + 4 > o.x && r.y < o.y + o.h + 3 && r.y + r.h + 3 > o.y);
  const order = scene.buildings.map((b, index) => ({ b, index })).filter(({ b }) => b.label).toSorted((a, c) => c.b.y - a.b.y);
  for (const { b, index } of order) {
    const rise = view.rise ? view.rise(index) : riseProgress(view.built, b.delay);
    const appear = view.rise ? 0 : Math.min(1, Math.max(0, (view.built - b.delay - 0.8) / 0.4));
    if (rise < 0.9 || appear <= 0) continue;
    const bob = view.animated ? Math.sin(view.time * 1.6 + b.seed * 9) * 2.5 : 0;
    const text = b.label!, w = g.measureText(text).width + 16;
    const anchorX = cam.ox + b.x * cam.k, anchorY = cam.oy + (b.y - b.h * 0.9) * cam.k;
    const x = Math.max(w / 2 + 6, Math.min(view.width - w / 2 - 6, anchorX));
    let y = cam.oy + (b.y - b.h) * cam.k - 22;
    const rect = () => ({ x: x - w / 2, y: y - 10, w, h: 20 });
    // Try above first, then below, then give up (skip) rather than overlap.
    let tries = 0;
    while (hit(rect()) && tries < 8) { y -= 24; tries++; }
    if (hit(rect()) || y < 60) { y = cam.oy + (b.y - b.h) * cam.k - 22; tries = 0; while (hit(rect()) && tries < 8) { y += 24; tries++; } }
    if (hit(rect())) continue;
    placed.push(rect());
    y += bob;
    g.globalAlpha = appear;
    g.strokeStyle = "rgba(250,250,250,0.55)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y + (y < anchorY ? 10 : -10)); g.lineTo(anchorX, anchorY); g.stroke();
    g.fillStyle = "rgba(17,17,17,0.88)";
    g.beginPath(); g.roundRect(x - w / 2, y - 10, w, 20, 3); g.fill();
    g.strokeStyle = scene.theme.glow; g.stroke();
    g.fillStyle = "#fafafa"; g.textAlign = "center"; g.fillText(text, x, y + 0.5);
  }
  g.globalAlpha = 1;
  g.textAlign = "start";
}
