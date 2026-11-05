import { parseRepo } from "../src/server/github";
export interface RawWorldRow { repo: string; snapshot: string; expires_at: number; saved_at: number }
export interface WorldAlias { alias: string; canonical: string }
export interface WorldExport { migrationId: string; sourceHead: string; sourceSha256: string; worlds: RawWorldRow[]; aliases: WorldAlias[] }
export interface StorageIdentity { databaseId: string; bindingNonce: string; epoch: string; sourceSha: string; workerBundleSha256: string; admissionFenced: boolean }
export interface MigrationData {
  worlds: (RawWorldRow & { snapshot_sha256: string; origin: string })[];
  aliases: WorldAlias[];
  provenance: { migration_id: string; source_backend: string; source_head: string; source_rows: number; source_aliases: number; source_sha256: string; imported_at: string }[];
  guards: { migration_id: string; source_sha256: string; accepted: number }[];
}
export const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
export async function sha256(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (n) => n.toString(16).padStart(2, "0")).join(""); }
export const exportDigest = (data: Pick<WorldExport, "worlds" | "aliases">) => sha256(stableJson({ worlds: data.worlds, aliases: data.aliases }));
export const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
export const hasFields = (x: Record<string, unknown>, fields: string[]) => Object.keys(x).length === fields.length && Object.keys(x).every((key) => fields.includes(key));
export function repositoryKey(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Invalid world export");
  try { const key = parseRepo(value).fullName.toLowerCase(); if (key !== value) throw new Error(); return key; } catch { throw new TypeError("Invalid world export"); }
}
export function validateSnapshot(snapshot: string, repo?: string) {
  let w; try { w = JSON.parse(snapshot); } catch { throw new TypeError("Invalid snapshot"); }
  if (!isRecord(w) || !isRecord(w.repo)) throw new TypeError("Invalid snapshot");
  const canonical = repositoryKey(String(w.repo.fullName).toLowerCase());
  if ((repo && canonical !== repo) || w.schemaVersion !== 1 || w.source !== "github" || w.repo.url !== `https://github.com/${w.repo.fullName}` || typeof w.headSha !== "string" || !/^[a-f0-9]{40}$/i.test(w.headSha) || typeof w.collectedAt !== "string" || !Number.isFinite(Date.parse(w.collectedAt)) ||
    !Array.isArray(w.nodes) || w.nodes.length > 100 || !Array.isArray(w.edges) || w.edges.length > 256 || !w.blueprint) throw new TypeError("Invalid snapshot");
  return canonical;
}
export async function validateExport(value: unknown): Promise<WorldExport> {
  if (!isRecord(value) || !hasFields(value, ["migrationId", "sourceHead", "sourceSha256", "worlds", "aliases"]) ||
      typeof value.migrationId !== "string" || !/^worlds-[a-f0-9]{32}$/.test(value.migrationId) || typeof value.sourceHead !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceHead) ||
      typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceSha256) || !Array.isArray(value.worlds) || value.worlds.length < 1 || value.worlds.length > 100 || !Array.isArray(value.aliases) || value.aliases.length > 200) throw new TypeError("Invalid world export");
  const data = value as unknown as WorldExport, keys = new Set<string>(), aliases = new Set<string>();
  for (const row of data.worlds) {
    if (!isRecord(row) || !hasFields(row, ["repo", "snapshot", "expires_at", "saved_at"]) || typeof row.snapshot !== "string" || new TextEncoder().encode(row.snapshot).byteLength > 512 * 1024 ||
      !Number.isSafeInteger(row.expires_at) || !Number.isSafeInteger(row.saved_at) || keys.has(repositoryKey(row.repo))) throw new TypeError("Invalid world export");
    validateSnapshot(row.snapshot, row.repo); keys.add(row.repo);
  }
  for (const row of data.aliases) {
    if (!isRecord(row) || !hasFields(row, ["alias", "canonical"]) || aliases.has(repositoryKey(row.alias)) || !keys.has(repositoryKey(row.canonical)) || keys.has(row.alias)) throw new TypeError("Invalid world export");
    aliases.add(row.alias);
  }
  if (await exportDigest(data) !== data.sourceSha256) throw new TypeError("Invalid export digest");
  return data;
}
export function assertIdentity(actual: StorageIdentity, expected: StorageIdentity) {
  if (!actual || stableJson(actual) !== stableJson(expected) || !/^[a-f0-9-]{36}$/.test(expected.databaseId) || !/^[a-f0-9]{32}$/.test(expected.bindingNonce) ||
    !/^[a-f0-9]{32}$/.test(expected.epoch) || !/^[a-f0-9]{40}$/.test(expected.sourceSha) || !/^[a-f0-9]{64}$/.test(expected.workerBundleSha256) || expected.admissionFenced !== true) throw new Error("Migration identity mismatch or admission open");
}
export async function assertMigrationRows(data: MigrationData, source: WorldExport) {
  if (!data || !Array.isArray(data.worlds) || !Array.isArray(data.aliases) || !Array.isArray(data.provenance) || !Array.isArray(data.guards)) throw new Error("Missing migration data");
  const raw = data.worlds.map(({ repo, snapshot, expires_at, saved_at }) => ({ repo, snapshot, expires_at, saved_at }));
  if (stableJson(raw) !== stableJson(source.worlds) || stableJson(data.aliases) !== stableJson(source.aliases) || await exportDigest({ worlds: raw, aliases: data.aliases }) !== source.sourceSha256) throw new Error("World or alias content/denominator mismatch");
  for (const row of data.worlds) if (row.snapshot_sha256 !== await sha256(row.snapshot) || row.origin !== `migration:${source.migrationId}`) throw new Error("Stored snapshot hash/origin mismatch");
  if (data.provenance.length !== 1 || data.guards.length !== 1) throw new Error("Migration authority mismatch");
  const p = data.provenance[0], g = data.guards[0];
  if (p.migration_id !== source.migrationId || p.source_backend !== "sqlite" || p.source_head !== source.sourceHead || p.source_rows !== source.worlds.length || p.source_aliases !== source.aliases.length || p.source_sha256 !== source.sourceSha256 || !Number.isFinite(Date.parse(p.imported_at)) ||
    g.migration_id !== source.migrationId || g.source_sha256 !== source.sourceSha256 || g.accepted !== 1) throw new Error("Migration authority mismatch");
}
