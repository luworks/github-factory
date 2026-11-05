import type { WorldNode, WorldSnapshot } from "../contracts";
import { codePointCompare, digest, snapshotKey, type EvidenceRef, type WorldIdentity } from "./contracts";
const fullName = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/;
export function worldIdentity(world: WorldSnapshot, now = Date.now()): WorldIdentity | null {
  if (!world || world.schemaVersion !== 1 || !["github", "demo"].includes(world.source) || !world.repo || !fullName.test(world.repo.fullName) ||
    world.repo.url !== `https://github.com/${world.repo.fullName}` || !/^[a-f0-9]{40}$/i.test(world.headSha) ||
    !Number.isFinite(Date.parse(world.collectedAt)) || Date.parse(world.collectedAt) > now || !Number.isFinite(world.refreshAfter)) return null;
  return { repoKey: world.repo.fullName.toLowerCase(), headSha: world.headSha.toLowerCase(), collectedAt: world.collectedAt, source: world.source };
}
export function cachedWorldReady(world: WorldSnapshot, now = Date.now()) {
  return worldIdentity(world, now)?.source === "github" && ["full", "truncated"].includes(world.coverage?.tree) &&
    Array.isArray(world.nodes) && world.nodes.length > 0 && world.nodes.length <= 100 && Array.isArray(world.edges) && world.edges.length <= 256 && !!world.blueprint;
}
export function safeDirectory(path: string) {
  return typeof path === "string" && path.length > 0 && path.length <= 512 && !/[\\\u0000-\u001f\u007f%?#]/.test(path) &&
    path.split("/").every(s => s !== "" && s !== "." && s !== "..");
}
export function recordedNodeSource(world: WorldSnapshot, node: WorldNode): string | null {
  if (!safeDirectory(node.path) || !node.id || node.id.startsWith("coverage:") || /[\u0000-\u001f]/.test(node.id) || !Array.isArray(node.evidence)) return null;
  const expected = `${world.repo.url}/tree/${world.headSha}/${node.path.split("/").map(encodeURIComponent).join("/")}`;
  return node.evidence.includes(expected) ? expected : null;
}
const legacyTiming = "The original per-endpoint upstream fetch time was not retained; this is the capture time.";
export async function capturedEvidence(world: WorldSnapshot, now = Date.now()): Promise<{ identity: WorldIdentity; evidence: EvidenceRef[]; history: { availability: "unavailable"; timeRange: null } } | null> {
  const identity = worldIdentity(world, now); if (!identity || !cachedWorldReady(world, now)) return null;
  const evidence: EvidenceRef[] = [];
  const add = async (kind: EvidenceRef["kind"], subject: EvidenceRef["subject"], urls: string[], claimCode: string, claim: string, confidence: EvidenceRef["confidence"], limitations: string[], eventTime: EvidenceRef["eventTime"] = null) => {
    const sourceUrls = [...urls].sort(codePointCompare);
    evidence.push({ id: await digest([snapshotKey(identity), kind, Object.entries(subject).sort(([a], [b]) => codePointCompare(a,b)), claimCode, sourceUrls]), worldIdentity: identity, kind, sourceUrls, subject, claim, confidence, limitations: [legacyTiming, ...limitations], eventTime, fetchedAt: identity.collectedAt });
  };
  await add("capture", { sha: identity.headSha }, [world.repo.url], "captured-identity", "Recorded repository identity, head and capture time.", "observed", ["Capture time is not an event time. Current GitHub state is unknown."]);
  for (const node of [...world.nodes].sort((a,b) => codePointCompare(a.path,b.path) || codePointCompare(a.id,b.id))) {
    const url = recordedNodeSource(world,node); if (!url) continue;
    await add("node-link", { nodeId: node.id }, [url], "captured-directory-link", "The map records a directory source at the captured head.", "observed", ["The district role is inferred; runtime behavior and entrypoints are unknown."]);
  }
  for (const edge of [...world.edges].sort((a,b)=>codePointCompare(a.id,b.id)).slice(0,50)) await add("edge-record", { edgeId: edge.id }, [], "captured-edge-annotation", "Recorded map annotation; independent edge provenance is unavailable.", edge.confidence, ["Endpoint node links do not prove this relationship or runtime traffic."]);
  for (const c of [...(world.commits || [])].sort((a,b) => codePointCompare(a.id,b.id)).slice(0,20)) {
    if (!/^[a-f0-9]{40}$/i.test(c.id) || c.url !== `${world.repo.url}/commit/${c.id}` || !Number.isFinite(Date.parse(c.date)) || typeof c.message !== "string" || !c.message.trim()) continue;
    await add("commit-marker", { sha: c.id.toLowerCase() }, [c.url], "captured-commit-marker", "Recorded commit identity and author timestamp.", "observed", ["Merge, ancestry, mainline arrival and complete history are unknown."], { at:c.date,basis:"author" });
  }
  return { identity, evidence, history:{availability:"unavailable",timeRange:null} };
}
