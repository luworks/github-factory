import type { WorldSnapshot } from "../contracts";
import { parseRepo, type Fetcher } from "./github";
import { requireOpenSourceLicense } from "./open-source";
import { WorldStorageError, type CachedWorld, type SnapshotStore, type WorldStorageStatus, type WorldSummary } from "./world-storage";

type StoredRow = { key: string; repo: string; snapshot: string; expires_at: number; saved_at: number };

/** No management token and no SQLite fallback. The Worker accepts fixed storage
 * operations only and binds the single product D1 database server-side. */
export class D1WorldStore implements SnapshotStore {
  private waiting = new Map<string, { now: number; resolve: (entry: CachedWorld | null) => void; reject: (error: unknown) => void }[]>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private config: { endpoint: string; secret: string }, private network: Fetcher = fetch) {
    let endpoint: URL;
    try { endpoint = new URL(config.endpoint); } catch { throw new WorldStorageError(); }
    if (endpoint.origin !== "https://chaorders.com" || endpoint.pathname !== "/github-factory/_storage" || endpoint.search || endpoint.hash ||
        endpoint.username || endpoint.password || config.secret.length < 32) throw new WorldStorageError();
  }
  private async rpc<T>(operation: Record<string, unknown>): Promise<T> {
    try {
      const response = await this.network(this.config.endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json", "x-factory-storage-key": this.config.secret }, body: JSON.stringify(operation) });
      if (!response.ok || !response.body) throw new WorldStorageError();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > 20 * 1024 * 1024) throw new WorldStorageError(); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const result = JSON.parse(new TextDecoder().decode(bytes));
      if (result.ok !== true || result.backend !== "d1" || result.op !== operation.op) throw new WorldStorageError();
      return result.result as T;
    } catch { throw new WorldStorageError(); }
  }
  private entry(row: StoredRow | undefined, now: number): CachedWorld | null {
    if (!row) return null;
    try {
      const world = JSON.parse(row.snapshot) as WorldSnapshot;
      if (world.schemaVersion !== 1 || world.source !== "github" || world.repo.fullName.toLowerCase() !== row.repo ||
          !/^[a-f0-9]{40}$/i.test(world.headSha) || !Number.isFinite(Date.parse(world.collectedAt)) ||
          !Array.isArray(world.nodes) || !Array.isArray(world.edges) || !world.blueprint || !Number.isSafeInteger(row.expires_at)) throw new WorldStorageError();
      requireOpenSourceLicense(world.repo.license);
      return { world, expiresAt: row.expires_at, fresh: row.expires_at > now };
    } catch { throw new WorldStorageError(); }
  }
  get(repo: string, now = Date.now()): Promise<CachedWorld | null> {
    const key = parseRepo(repo).fullName.toLowerCase();
    return new Promise((resolve, reject) => {
      const list = this.waiting.get(key) ?? []; list.push({ now, resolve, reject }); this.waiting.set(key, list);
      if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = undefined; void this.flush(); }, 5);
    });
  }
  private async flush() {
    const pending = this.waiting; this.waiting = new Map();
    const entries = [...pending.entries()];
    for (let i = 0; i < entries.length; i += 32) {
      const group = entries.slice(i, i + 32);
      try {
        const rows = await this.rpc<StoredRow[]>({ op: "getMany", keys: group.map(([key]) => key) });
        if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.key !== "string" || !group.some(([key]) => row.key === key)) || new Set(rows.map((row) => row.key)).size !== rows.length) throw new WorldStorageError();
        const byKey = new Map(rows.map((row) => [row.key, row]));
        for (const [key, listeners] of group) for (const listener of listeners) listener.resolve(this.entry(byKey.get(key), listener.now));
      } catch (error) { for (const [, listeners] of group) for (const listener of listeners) listener.reject(error); }
    }
  }
  async summaries(repos: string[]): Promise<WorldSummary[]> {
    const keys = repos.map((repo) => parseRepo(repo).fullName.toLowerCase());
    const rows = await this.rpc<WorldSummary[]>({ op: "summaries", keys });
    if (!Array.isArray(rows)) throw new WorldStorageError();
    for (const row of rows) if (!row || !keys.includes(row.key) || !row.repo || !Number.isFinite(Date.parse(row.collectedAt)) || !Number.isSafeInteger(row.expiresAt)) throw new WorldStorageError();
    return rows;
  }
  async put(world: WorldSnapshot, ttlMs = 90_000, now = Date.now()) {
    requireOpenSourceLicense(world.repo.license);
    const result = await this.rpc<{ saved: boolean }>({ op: "put", snapshot: JSON.stringify(world), savedAt: now, expiresAt: now + Math.max(60_000, Math.min(120_000, ttlMs)) });
    if (result.saved !== true) throw new WorldStorageError();
  }
  async alias(input: string, canonical: string) { const result = await this.rpc<{ saved: boolean }>({ op: "alias", alias: parseRepo(input).fullName.toLowerCase(), canonical: parseRepo(canonical).fullName.toLowerCase() }); if (result.saved !== true) throw new WorldStorageError(); }
  async delete(repo: string) { const result = await this.rpc<{ deleted: boolean }>({ op: "delete", repo: parseRepo(repo).fullName.toLowerCase() }); if (result.deleted !== true) throw new WorldStorageError(); }
  async status() {
    const status = await this.rpc<WorldStorageStatus>({ op: "status" });
    if (status.backend !== "d1" || status.authoritative !== true || status.schemaVersion !== 1 || !Number.isInteger(status.worlds) || !Number.isInteger(status.aliases)) throw new WorldStorageError();
    return status;
  }
}
