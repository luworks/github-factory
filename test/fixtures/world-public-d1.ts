import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HistoryD1Binding, HistoryStatement } from "../../deploy/history-storage";
import { D1PublicCaptureCore, WORLD_CAPTURE_VIEW_SQL } from "../../deploy/world-public-captures";
import { captureHash, captureKeyTag, type WorldCaptureIdentity } from "../../src/server/world-public-capture-contract";

/** Real transactional SQLite, synthetic new files only. Two independent
 * connections exercise durable authority rather than process-local maps. */
export class SyntheticWorldD1 implements HistoryD1Binding {
  readonly db: Database;
  readonly calls: string[][] = [];
  beforeBatch?: (batch: number) => Promise<void>;
  afterCommit?: (batch: number) => Promise<void>;
  interrupt?: { batch: number; statement: number };
  result?: "false" | "short" | "typed" | "fake-success";
  constructor(path: string) { this.db = new Database(path); this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000"); }
  prepare(sql: string): HistoryStatement {
    const binding = this;
    const statement = { sql, values: [] as unknown[], bind(...values: unknown[]) { this.values = values; return this; },
      async all<T>() { return { success: true, results: binding.db.query(sql).all(...this.values as any[]) as T[] }; },
      async first<T>() { return binding.db.query(sql).get(...this.values as any[]) as T | null; } };
    return statement;
  }
  async batch(statements: HistoryStatement[]) {
    const actual = statements as (HistoryStatement & { sql: string; values: any[] })[], batch = this.calls.length;
    this.calls.push(actual.map(s => s.sql)); await this.beforeBatch?.(batch);
    if (this.result === "fake-success") return statements.map(() => ({ success: true }));
    this.db.transaction(() => actual.forEach((s, statement) => {
      if (this.interrupt?.batch === batch && this.interrupt.statement === statement) throw Error("SYNTHETIC statement interruption");
      this.db.query(s.sql).run(...s.values);
    })).immediate();
    await this.afterCommit?.(batch);
    if (this.result === "typed") { const { WorldCaptureError } = await import("../../src/server/world-public-capture-contract"); throw new WorldCaptureError("FORGED_ZERO_WRITE", 400, "not-started"); }
    return this.result === "short" ? [] : statements.map(() => ({ success: this.result !== "false" }));
  }
  withSession() { return this; }
}
export async function syntheticWorldD1() {
  const directory = mkdtempSync(join(tmpdir(), "factory-capture-d1-")), path = join(directory, "synthetic.sqlite");
  const a = new SyntheticWorldD1(path), b = new SyntheticWorldD1(path);
  for (const migration of ["0001-world-cache.sql", "0002-migration-identity.sql", "0004-world-public-captures.sql"]) a.db.exec(readFileSync(new URL(`../../deploy/d1/${migration}`, import.meta.url), "utf8"));
  const identity: WorldCaptureIdentity = { databaseId: "11111111-1111-4111-8111-111111111111", bindingNonce: "2".repeat(32), epoch: "3".repeat(32) };
  const key = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(41), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  a.db.query("INSERT INTO storage_identity VALUES(1,?,?,?)").run(identity.databaseId, identity.bindingNonce, "SYNTHETIC");
  a.db.query("INSERT INTO world_capture_authority VALUES(1,1,?,?,?,?,0,0,?)").run(identity.databaseId, identity.bindingNonce, identity.epoch, await captureKeyTag(identity, key), "0".repeat(64));
  const reseal = async () => { const r = a.db.query(WORLD_CAPTURE_VIEW_SQL).get() as { view: string }; a.db.query("UPDATE world_capture_authority SET checksum=?").run(await captureHash(r.view)); };
  await reseal();
  const core = new D1PublicCaptureCore(a, identity, key), other = new D1PublicCaptureCore(b, identity, key);
  const dump = () => JSON.stringify(["worlds", "world_aliases", "world_capture_authority", "world_capture_barriers", "world_capture_generations", "world_capture_guard"].map(t => a.db.query(`SELECT * FROM ${t} ORDER BY rowid`).all()));
  return { a, b, core, other, identity, key, reseal, dump, restart: () => new D1PublicCaptureCore(b, identity, key), close() { a.db.close(); b.db.close(); rmSync(directory, { force: true, recursive: true }); } };
}
