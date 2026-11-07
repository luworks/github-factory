/** Pure guided-tour planning and timing. No DOM, network or timers: the page drives it. */
import { STYLE_IDS, type FeaturedProject, type NodeKind, type StyleId, type WorldNode, type WorldSnapshot } from "../contracts";

export const STYLE_NAMES: Record<StyleId, string> = {
  moonshot: "Moon Factory",
  factorio: "Factorio",
  "red-alert": "Red Alert",
  "red-alert-2": "Red Alert 2",
  civilization: "Civilization",
};
export interface TourStop {
  world: WorldSnapshot;
  /** Gallery editorial style; the stop opens in it. */
  style: StyleId;
}
/** A camera keyframe, `at` ms after its beat starts. */
export interface Shot {
  at: number;
  nodeId: string | null;
  zoom: number;
}
export interface Caption {
  eyebrow: string;
  title: string;
  line: string;
  /** Short factual row under the line. */
  meta?: string;
  /** District evidence state, when the caption names a district. */
  confidence?: WorldNode["confidence"];
}
export interface Beat {
  id: string;
  kind: "intro" | "repo" | "perspective" | "end";
  /** Index into the stops; the end card keeps showing the last world behind it. */
  stop: number;
  style: StyleId;
  start: number;
  duration: number;
  shots: Shot[];
  caption: Caption;
}
export const INTRO_MS = 3600,
  BEAT_MS = 3200,
  END_MS = 5000,
  MAX_STOPS = 4;
/** Showcase order for the tour; anything else ready in the gallery follows. */
const PREFERRED = ["openclaw/openclaw", "react/react", "pytorch/pytorch", "pingdotgg/t3code", "microsoft/vscode", "kubernetes/kubernetes"];
const KIND_RANK: NodeKind[] = ["app", "service", "data", "package", "infra", "tool", "test", "docs", "external"];
const KIND_NAMES: Record<NodeKind, string> = {
  app: "App",
  service: "Service",
  package: "Package",
  data: "Data",
  infra: "Infrastructure",
  docs: "Docs",
  test: "Test",
  tool: "Tooling",
  external: "External",
};

/** Ready gallery projects only (a real cached snapshot exists), showcase order first. */
export function tourCandidates(projects: readonly FeaturedProject[]): FeaturedProject[] {
  const rank = (p: FeaturedProject) => {
    const i = PREFERRED.indexOf(p.fullName.toLowerCase());
    return i < 0 ? PREFERRED.length : i;
  };
  return projects
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => project.ready && /^[^/\s]+\/[^/\s]+$/.test(project.fullName))
    .sort((a, b) => rank(a.project) - rank(b.project) || a.index - b.index)
    .map(({ project }) => project);
}

/** Loads cached worlds in candidate order with bounded concurrency. Misses, errors and
 * empty worlds are skipped; stops keep candidate order. Never asks for more than needed. */
export async function collectStops(
  candidates: readonly FeaturedProject[],
  load: (owner: string, repo: string) => Promise<WorldSnapshot>,
  want = MAX_STOPS,
): Promise<TourStop[]> {
  const found: (TourStop | null)[] = [];
  let next = 0,
    loaded = 0,
    inFlight = 0;
  const worker = async () => {
    // In-flight reads count toward the target, so a miss is the only reason to read further.
    while (next < candidates.length && loaded + inFlight < want) {
      const index = next++,
        project = candidates[index],
        [owner, repo] = project.fullName.split("/");
      inFlight++;
      try {
        const world = await load(owner, repo);
        found[index] = world?.nodes?.length ? { world, style: project.suggestedStyle } : null;
      } catch {
        found[index] = null;
      } finally {
        inFlight--;
        if (found[index]) loaded++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(want, candidates.length) }, worker));
  return found.filter((stop): stop is TourStop => !!stop).slice(0, want);
}

/** Notable districts: guide-named districts first, then larger core kinds. */
export function notableDistricts(world: WorldSnapshot, count = 6): WorldNode[] {
  const byId = new Map(world.nodes.map((n) => [n.id, n]));
  const named = (world.blueprint?.districts ?? []).map((d) => byId.get(d.nodeId)).filter((n): n is WorldNode => !!n);
  const rest = world.nodes
    .filter((n) => n.kind !== "external")
    .toSorted((a, b) => KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind) || b.size - a.size || a.id.localeCompare(b.id));
  const picked: WorldNode[] = [];
  for (const node of [...named, ...rest]) if (!picked.includes(node) && picked.length < count) picked.push(node);
  return picked.length ? picked : world.nodes.slice(0, count);
}

const districtCaption = (node: WorldNode, eyebrow: string): Caption => ({
  eyebrow,
  title: node.label,
  line: `${KIND_NAMES[node.kind]} district · ${node.path || "/"}`,
  confidence: node.confidence,
});

/** The tour: an intro fly-in, all five perspectives on the first world ("same code, different
 * worlds"), two perspectives on each further world, then an end card. Reduced motion keeps the
 * same beats and timing but only the final keyframe of each, so the camera never flies. */
export function planTour(stops: readonly TourStop[], options: { reducedMotion?: boolean } = {}): Beat[] {
  const beats: Omit<Beat, "start">[] = [];
  if (stops.length) {
    const first = stops[0],
      d0 = notableDistricts(first.world),
      at = (i: number) => d0[i % d0.length].id;
    beats.push({
      id: "intro",
      kind: "intro",
      stop: 0,
      style: STYLE_IDS[0],
      duration: INTRO_MS,
      shots: [
        { at: 0, nodeId: null, zoom: 0.62 },
        { at: 250, nodeId: null, zoom: 1.04 },
      ],
      caption: {
        eyebrow: "MOON FACTORY · GUIDED TOUR",
        title: "Every codebase. A world of its own.",
        line: `${stops.length} public ${stops.length === 1 ? "repository" : "repositories"}, rendered from cached snapshots. Architecture is inferred from the source tree, not live telemetry.`,
      },
    });
    STYLE_IDS.forEach((style, i) => {
      const district = d0[i % d0.length];
      beats.push({
        id: `0:${style}`,
        kind: i ? "perspective" : "repo",
        stop: 0,
        style,
        duration: BEAT_MS,
        shots: i
          ? [
              { at: 0, nodeId: at(i - 1), zoom: 1.35 },
              { at: 300, nodeId: district.id, zoom: 1.75 },
            ]
          : [
              { at: 0, nodeId: null, zoom: 1.04 },
              { at: 200, nodeId: district.id, zoom: 1.6 },
            ],
        caption: i
          ? districtCaption(district, `SAME CODE · DIFFERENT WORLDS · ${i + 1}/5 · ${STYLE_NAMES[style].toUpperCase()}`)
          : repoCaption(first.world, 1, stops.length, style),
      });
    });
    stops.slice(1).forEach((stop, offset) => {
      const n = offset + 2,
        districts = notableDistricts(stop.world),
        from = STYLE_IDS.indexOf(stop.style),
        second = STYLE_IDS[(from + 2 + offset) % STYLE_IDS.length],
        a = districts[0],
        b = districts[1 % districts.length];
      beats.push({
        id: `${n - 1}:${stop.style}`,
        kind: "repo",
        stop: n - 1,
        style: stop.style,
        duration: BEAT_MS,
        shots: [
          { at: 0, nodeId: null, zoom: 0.72 },
          { at: 250, nodeId: a.id, zoom: 1.5 },
        ],
        caption: repoCaption(stop.world, n, stops.length, stop.style),
      });
      beats.push({
        id: `${n - 1}:${second}`,
        kind: "perspective",
        stop: n - 1,
        style: second,
        duration: BEAT_MS,
        shots: [
          { at: 0, nodeId: a.id, zoom: 1.3 },
          { at: 300, nodeId: b.id, zoom: 1.75 },
        ],
        caption: districtCaption(b, `SAME CODE · DIFFERENT WORLDS · ${STYLE_NAMES[second].toUpperCase()}`),
      });
    });
  }
  const last = beats.at(-1);
  beats.push({
    id: "end",
    kind: "end",
    stop: last?.stop ?? 0,
    style: last?.style ?? STYLE_IDS[0],
    duration: END_MS,
    shots: [{ at: 0, nodeId: null, zoom: 0.8 }],
    caption: {
      eyebrow: "YOUR REPOSITORY NEXT",
      title: "Build your world.",
      line: "Paste any public GitHub repository. Five perspectives, one source of truth.",
    },
  });
  let start = 0;
  return beats.map((beat) => {
    const shots = options.reducedMotion ? [{ ...beat.shots.at(-1)!, at: 0 }] : beat.shots;
    const planned = { ...beat, shots, start };
    start += beat.duration;
    return planned;
  });
}
function repoCaption(world: WorldSnapshot, n: number, total: number, style: StyleId): Caption {
  return {
    eyebrow: `WORLD ${n} OF ${total} · ${STYLE_NAMES[style].toUpperCase()}`,
    title: world.repo.fullName,
    // Original GitHub description text, unmodified.
    line: world.repo.description || "Architecture inferred from the public source tree.",
    meta: `${world.nodes.length} districts · ${world.edges.length} connections · inferred from the public source tree`,
  };
}

export const tourDuration = (beats: readonly Beat[]) => (beats.length ? beats.at(-1)!.start + beats.at(-1)!.duration : 0);
/** Beat index showing at elapsed time `t` (clamped to the tour). */
export function beatIndexAt(beats: readonly Beat[], t: number): number {
  let index = 0;
  for (let i = 0; i < beats.length; i++) if (beats[i].start <= t) index = i;
  return index;
}
/** Keyframe active `offset` ms into a beat. */
export function shotAt(beat: Beat, offset: number): Shot {
  let shot = beat.shots[0];
  for (const s of beat.shots) if (s.at <= offset) shot = s;
  return shot;
}
/** Next elapsed time at which the visible beat or keyframe changes; the tour end included. */
export function nextBoundary(beats: readonly Beat[], t: number): number | null {
  let next: number | null = null;
  for (const beat of beats)
    for (const time of [beat.start, ...beat.shots.map((s) => beat.start + s.at), beat.start + beat.duration])
      if (time > t && (next === null || time < next)) next = time;
  return next;
}
/** Overall tour position, 0..1. */
export const tourProgress = (beats: readonly Beat[], t: number) => {
  const total = tourDuration(beats);
  return total ? Math.max(0, Math.min(1, t / total)) : 0;
};

/** Pausable, seekable elapsed-time clock over an injected monotonic `now`. */
export function createTourClock(now: () => number) {
  let base = 0,
    since: number | null = null;
  return {
    elapsed: () => base + (since === null ? 0 : now() - since),
    playing: () => since !== null,
    play() {
      if (since === null) since = now();
    },
    pause() {
      if (since !== null) base += now() - since;
      since = null;
    },
    seek(t: number) {
      base = Math.max(0, t);
      if (since !== null) since = now();
    },
  };
}
export type TourClock = ReturnType<typeof createTourClock>;
