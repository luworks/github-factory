import { parseHistoryWireJson } from "./history-rpc-contract";
import { WORLD_CAPTURE_LIMITS, captureBytes, captureKey, worldGenerationShape, type RemoteWorldGeneration, type WorldCaptureWrite } from "./world-public-capture-contract";

export const WORLD_CAPTURE_RPC_URL = "https://chaorders.com/github-factory/_storage";
export const WORLD_CAPTURE_RPC_LIMITS = Object.freeze({ bodyBytes: 2 * 1024 * 1024, responseBytes: 2 * 1024 * 1024, keys: 32, bodyMs: 5000, totalMs: 10000 });
export class WorldCaptureRpcInputError extends Error { constructor() { super("Invalid fixed world storage request."); } }
const reject = (): never => { throw new WorldCaptureRpcInputError(); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const worldWireInteger = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
export function parseWorldCaptureJson(text: string): unknown {
  try {
    const value = parseHistoryWireJson(text);
    const finite = (v: unknown): boolean => typeof v === "number" ? Number.isFinite(v) : v && typeof v === "object" ? Object.values(v).every(finite) : true;
    if (!finite(value)) return reject(); return value;
  } catch { return reject(); }
}
const key = (v: unknown) => { try { const normalized = captureKey(v); if (normalized !== v) return reject(); return normalized; } catch { return reject(); } };
// Source spelling is evidence. Validate the original owner/repo syntax without
// replacing its case; only lookup and wire keys require normalized spelling.
const sourceName = (v: unknown) => { try { captureKey(v); return true; } catch { return false; } };
function generation(v: unknown) { try { return { ...worldGenerationShape(v as RemoteWorldGeneration) }; } catch { return reject(); } }
function write(v: unknown): WorldCaptureWrite {
  if (!record(v) || !exact(v, ["snapshot", "savedAt", "expiresAt"]) || typeof v.snapshot !== "string" || captureBytes(v.snapshot) > WORLD_CAPTURE_LIMITS.snapshotBytes || !worldWireInteger(v.savedAt) || !worldWireInteger(v.expiresAt) || v.expiresAt - v.savedAt < 60000 || v.expiresAt - v.savedAt > 120000) return reject();
  const snapshot = parseWorldCaptureJson(v.snapshot);
  if (!record(snapshot) || !record(snapshot.repo) || !sourceName(snapshot.repo.fullName) || snapshot.source !== "github" || snapshot.schemaVersion !== 1 || snapshot.repo.url !== `https://github.com/${snapshot.repo.fullName}` || typeof snapshot.headSha !== "string" || !/^[a-f0-9]{40}$/i.test(snapshot.headSha) || typeof snapshot.collectedAt !== "string" || !Number.isFinite(Date.parse(snapshot.collectedAt)) || !Array.isArray(snapshot.nodes) || snapshot.nodes.length > 100 || !Array.isArray(snapshot.edges) || snapshot.edges.length > 256 || !snapshot.blueprint) return reject();
  return { snapshot: v.snapshot, savedAt: v.savedAt, expiresAt: v.expiresAt };
}
export type WorldCaptureRpcOperation =
  | { op: "status" }
  | { op: "getMany" | "summaries"; keys: string[] }
  | { op: "captureBegin"; repo: string; explicitRevalidation: boolean }
  | { op: "captureAssert" | "captureInspect"; generation: RemoteWorldGeneration }
  | { op: "captureCommit"; generation: RemoteWorldGeneration; write: WorldCaptureWrite }
  | { op: "captureRevoke"; generation: RemoteWorldGeneration; claim?: string }
  | { op: "put"; write: WorldCaptureWrite }
  | { op: "alias"; alias: string; canonical: string }
  | { op: "evict"; repo: string };
export function parseWorldCaptureOperation(v: unknown): WorldCaptureRpcOperation {
  if (!record(v)) return reject();
  if (v.op === "status" && exact(v, ["op"])) return { op: v.op };
  if (["getMany", "summaries"].includes(v.op as string) && exact(v, ["op", "keys"]) && Array.isArray(v.keys) && v.keys.length > 0 && v.keys.length <= WORLD_CAPTURE_RPC_LIMITS.keys) { const keys = v.keys.map(key); if (new Set(keys).size !== keys.length) return reject(); return { op: v.op as "getMany" | "summaries", keys }; }
  if (v.op === "captureBegin" && exact(v, ["op", "repo", "explicitRevalidation"]) && typeof v.explicitRevalidation === "boolean") return { op: v.op, repo: key(v.repo), explicitRevalidation: v.explicitRevalidation };
  if (["captureAssert", "captureInspect"].includes(v.op as string) && exact(v, ["op", "generation"])) return { op: v.op as "captureAssert" | "captureInspect", generation: generation(v.generation) };
  if (v.op === "captureCommit" && exact(v, ["op", "generation", "write"])) return { op: v.op, generation: generation(v.generation), write: write(v.write) };
  if (v.op === "captureRevoke" && exact(v, Object.hasOwn(v, "claim") ? ["op", "generation", "claim"] : ["op", "generation"])) { if (Object.hasOwn(v, "claim") && (typeof v.claim !== "string" || v.claim.length > 4096 || !/^wcp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(v.claim))) return reject(); return { op: v.op, generation: generation(v.generation), ...(typeof v.claim === "string" ? { claim: v.claim } : {}) }; }
  if (v.op === "put" && exact(v, ["op", "write"])) return { op: v.op, write: write(v.write) };
  if (v.op === "alias" && exact(v, ["op", "alias", "canonical"])) return { op: v.op, alias: key(v.alias), canonical: key(v.canonical) };
  if (v.op === "evict" && exact(v, ["op", "repo"])) return { op: v.op, repo: key(v.repo) };
  return reject();
}
