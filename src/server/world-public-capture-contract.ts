import { trustedPrivateCanonical, type TrustedPrivateRepositoryObservation } from "./github";

export const WORLD_CAPTURE_LIMITS = Object.freeze({ generations: 256, barriers: 1024, metadataBytes: 512 * 1024, snapshotBytes: 512 * 1024, parameterBytes: 60 * 1024, worlds: 100, aliases: 200 });
export interface WorldCaptureIdentity { databaseId: string; bindingNonce: string; epoch: string }
export interface RemoteWorldGeneration { readonly repo: string; readonly sequence: number; readonly handle: string }
export interface WorldCaptureWrite { snapshot: string; savedAt: number; expiresAt: number }
export type GenerationPayload = ["world-capture-v1", string, string, string, string, string, string, number, boolean, string];
export class WorldCaptureError extends Error {
  constructor(readonly code = "WORLD_CAPTURE_UNAVAILABLE", readonly status = 503, readonly writeOutcome: "not-started" | "unknown" = "not-started", readonly barrier: "confirmed" | "unknown" | null = null, readonly cleanup: "confirmed" | "unconfirmed" | "not-started" | null = null) { super(writeOutcome === "unknown" ? "World storage outcome is unknown. No automatic retry or rollback was claimed." : "World capture authority is unavailable or rejected this operation."); }
}
export const captureReject = (code = "WORLD_CAPTURE_INVALID_REQUEST", status = 400): never => { throw new WorldCaptureError(code, status); };
export const captureKey = (input: unknown) => {
  if (typeof input !== "string" || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]{1,100}$/.test(input) || [".", ".."].includes(input.split("/")[1]!)) return captureReject();
  return input.toLowerCase();
};
export const captureBytes = (value: string) => new TextEncoder().encode(value).length;
export const captureHash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
const hex = (value: unknown, size: number): value is string => typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
export function captureIdentity(value: WorldCaptureIdentity): WorldCaptureIdentity {
  if (!value || Object.keys(value).sort().join() !== "bindingNonce,databaseId,epoch" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.databaseId) || !hex(value.bindingNonce, 32) || !hex(value.epoch, 32)) return captureReject();
  return { databaseId: value.databaseId, bindingNonce: value.bindingNonce, epoch: value.epoch };
}
export function captureCryptoKey(key: CryptoKey) {
  if (!key || key.type !== "secret" || key.extractable || key.algorithm.name !== "HMAC" || (key.algorithm as HmacKeyAlgorithm).hash.name !== "SHA-256" || (key.algorithm as HmacKeyAlgorithm).length < 256 || !key.usages.includes("sign") || !key.usages.includes("verify")) return captureReject();
  return key;
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const unbase64 = (value: string) => { if (!/^[A-Za-z0-9_-]+$/.test(value)) return captureReject(); const decoded = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0)); if (base64(decoded) !== value) return captureReject(); return decoded; };
async function sign(key: CryptoKey, kind: string, value: unknown) {
  const body = base64(new TextEncoder().encode(JSON.stringify(value))), signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${kind}.${body}`)));
  return `${kind}.${body}.${base64(signature)}`;
}
async function verify(key: CryptoKey, kind: string, token: unknown): Promise<unknown> {
  if (typeof token !== "string" || token.length > 4096) return captureReject();
  const parts = token.split("."); if (parts.length !== 3 || parts[0] !== kind || parts[2]!.length !== 43) return captureReject();
  try { if (!await crypto.subtle.verify("HMAC", key, unbase64(parts[2]!), new TextEncoder().encode(`${kind}.${parts[1]}`))) return captureReject(); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(unbase64(parts[1]!))); }
  catch { return captureReject(); }
}
export const captureKeyTag = async (identity: WorldCaptureIdentity, key: CryptoKey) => {
  const checked = captureIdentity(identity);
  const signature = await crypto.subtle.sign("HMAC", captureCryptoKey(key), new TextEncoder().encode(JSON.stringify(["world-capture-key-v1", checked.databaseId, checked.bindingNonce, checked.epoch])));
  return [...new Uint8Array(signature)].map(v => v.toString(16).padStart(2, "0")).join("");
};
export async function issueWorldGeneration(identity: WorldCaptureIdentity, key: CryptoKey, repo: string, canonical: string, sequence: number, explicit: boolean): Promise<RemoteWorldGeneration> {
  const nonce = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, "0")).join("");
  const payload: GenerationPayload = ["world-capture-v1", identity.databaseId, identity.bindingNonce, identity.epoch, await captureKeyTag(identity, key), captureKey(repo), captureKey(canonical), sequence, explicit, nonce];
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(payload))));
  return Object.freeze({ repo: payload[5], sequence, handle: `wc1.${nonce}.${base64(signature)}` });
}
export function worldGenerationShape(value: RemoteWorldGeneration) {
  if (!value || Object.keys(value).sort().join() !== "handle,repo,sequence" || value.repo !== captureKey(value.repo) || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || typeof value.handle !== "string" || !/^wc1\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(value.handle)) return captureReject();
  return value;
}
export async function verifyWorldGeneration(value: RemoteWorldGeneration, identity: WorldCaptureIdentity, key: CryptoKey, stored: { canonical: string; sequence: number; explicit: boolean }): Promise<{ payload: GenerationPayload; hash: string }> {
  worldGenerationShape(value);
  if (value.sequence !== stored.sequence || stored.canonical !== captureKey(stored.canonical) || typeof stored.explicit !== "boolean") return captureReject();
  const parts = value.handle.split("."), payload: GenerationPayload = ["world-capture-v1", identity.databaseId, identity.bindingNonce, identity.epoch, await captureKeyTag(identity, key), value.repo, stored.canonical, value.sequence, stored.explicit, parts[1]!];
  if (!await crypto.subtle.verify("HMAC", key, unbase64(parts[2]!), new TextEncoder().encode(JSON.stringify(payload)))) return captureReject();
  return { payload, hash: await captureHash(value.handle) };
}
/** Only the accepted current producer capability can be converted into this
 * serializable SERVER claim. The injected key is never a browser credential.
 * Future RPC must authenticate its caller; no browser group/epoch overrides. */
export async function signWorldPrivateObservation(generation: RemoteWorldGeneration, proof: TrustedPrivateRepositoryObservation, identity: WorldCaptureIdentity, key: CryptoKey): Promise<string> {
  worldGenerationShape(generation);
  const canonical = trustedPrivateCanonical(proof, generation.repo, generation);
  if (!canonical) return captureReject();
  return sign(key, "wcp1", ["world-private-v1", await captureHash(generation.handle), generation.repo, generation.sequence, canonical, identity.databaseId, identity.bindingNonce, identity.epoch, await captureKeyTag(identity, key)]);
}
export async function verifyWorldPrivateObservation(claim: string, generation: RemoteWorldGeneration, identity: WorldCaptureIdentity, key: CryptoKey): Promise<string> {
  worldGenerationShape(generation);
  const hash = await captureHash(generation.handle), value = await verify(key, "wcp1", claim);
  if (!Array.isArray(value) || value.length !== 9 || value[0] !== "world-private-v1" || value[1] !== hash || value[2] !== generation.repo || value[3] !== generation.sequence || value[4] !== captureKey(value[4]) || value[5] !== identity.databaseId || value[6] !== identity.bindingNonce || value[7] !== identity.epoch || value[8] !== await captureKeyTag(identity, key)) return captureReject();
  return value[4];
}
export function captureChunks(value: string): string[] {
  const bytes = new TextEncoder().encode(value), pieces: string[] = [];
  for (let at = 0; at < bytes.length;) { let end = Math.min(at + WORLD_CAPTURE_LIMITS.parameterBytes, bytes.length); while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--; pieces.push(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at, end))); at = end; }
  return pieces.length ? pieces : [""];
}

export const WORLD_CAPTURE_TABLE_SQL = {
  world_capture_authority: "CREATE TABLE world_capture_authority (singleton INTEGER PRIMARY KEY CHECK(singleton=1), protocol INTEGER NOT NULL CHECK(protocol=1), database_uuid TEXT NOT NULL CHECK(length(database_uuid)=36), binding_nonce TEXT NOT NULL CHECK(length(binding_nonce)=32 AND binding_nonce NOT GLOB '*[^0-9a-f]*'), authority_epoch TEXT NOT NULL CHECK(length(authority_epoch)=32 AND authority_epoch NOT GLOB '*[^0-9a-f]*'), key_tag TEXT NOT NULL CHECK(length(key_tag)=64 AND key_tag NOT GLOB '*[^0-9a-f]*'), sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence BETWEEN 0 AND 9007199254740991), revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991), checksum TEXT NOT NULL CHECK(length(checksum)=64 AND checksum NOT GLOB '*[^0-9a-f]*'))",
  world_capture_barriers: "CREATE TABLE world_capture_barriers (repo TEXT PRIMARY KEY CHECK(length(repo) BETWEEN 3 AND 140 AND repo=lower(repo) AND repo NOT GLOB '*[^a-z0-9_./-]*'), sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991), denied INTEGER NOT NULL CHECK(typeof(denied)='integer' AND denied IN (0,1)))",
  world_capture_generations: "CREATE TABLE world_capture_generations (handle_hash TEXT PRIMARY KEY CHECK(length(handle_hash)=64 AND handle_hash NOT GLOB '*[^0-9a-f]*'), repo TEXT NOT NULL, start_canonical TEXT NOT NULL, start_sequence INTEGER NOT NULL CHECK(typeof(start_sequence)='integer' AND start_sequence BETWEEN 0 AND 9007199254740991), explicit INTEGER NOT NULL CHECK(typeof(explicit)='integer' AND explicit IN (0,1)), status TEXT NOT NULL CHECK(status IN ('active','committed','deny-pending','denied')), operation_hash TEXT, roots TEXT, targets TEXT, accepted_sequence INTEGER, ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 1 AND 9007199254740991), CHECK((status='active' AND operation_hash IS NULL AND roots IS NULL AND targets IS NULL AND accepted_sequence IS NULL) OR (status<>'active' AND operation_hash IS NOT NULL AND length(operation_hash)=64 AND operation_hash NOT GLOB '*[^0-9a-f]*' AND roots IS NOT NULL AND json_valid(roots) AND json_type(roots)='array' AND json_array_length(roots) BETWEEN 1 AND 2 AND targets IS NOT NULL AND json_valid(targets) AND json_type(targets)='array' AND json_array_length(targets)<=204 AND typeof(accepted_sequence)='integer' AND accepted_sequence BETWEEN 0 AND 9007199254740991)))",
  world_capture_guard: "CREATE TABLE world_capture_guard (singleton INTEGER PRIMARY KEY CHECK(singleton=1), accepted INTEGER NOT NULL CHECK(accepted=1))",
} as const;
/** Token-safe DDL comparison: quoted literals remain byte-exact, comments and
 * unexpected syntax cannot hide a missing CHECK. No schema repair is attempted. */
export function captureSqlTokens(sql: string): string {
  const tokens: string[] = [];
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i]!)) { i++; continue; }
    if (sql[i] === "'") { const start = i++; for (;;) { if (i >= sql.length) return captureReject(); if (sql[i++] === "'") { if (sql[i] === "'") { i++; continue; } break; } } tokens.push(sql.slice(start, i)); continue; }
    const word = sql.slice(i).match(/^[A-Za-z0-9_]+/); if (word) { tokens.push(word[0].toLowerCase()); i += word[0].length; continue; }
    if (/[(),=<>.*-]/.test(sql[i]!)) { if (sql.slice(i, i + 2) === "--") return captureReject(); tokens.push(sql[i++]!); continue; }
    if (sql[i] === ";" && i === sql.length - 1) break;
    return captureReject();
  }
  return JSON.stringify(tokens);
}
