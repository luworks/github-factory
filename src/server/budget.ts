import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AiBlueprint, BudgetStatus } from "../contracts";
import { getConfig } from "./config";

export const HARD_LIMIT_USD = 50;
const SCALE = 1_000_000;
export interface Prices {
  input: number;
  output: number;
}
export function modelPrices(provider: string, model: string): Prices | null {
  if (provider === "openai" && model === "gpt-6.1-sol") return { input: 2.5, output: 10 };
  if (provider === "muse" && ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"].includes(model)) return { input: 1.25, output: 4.25 };
  if (provider === "muse" && model === "muse-wonder-1.0") return { input: 4, output: 20 };
  return null;
}
export interface BudgetConfig {
  dataDir: string;
  budgetUsd: number;
  provider: string;
  model: string;
  apiKey: string;
}
export interface Usage {
  input: number;
  output: number;
}
export interface Reservation {
  id: string;
  reservedUsd: number;
  inputBound: number;
  outputBound: number;
}
export class BudgetError extends Error {
  constructor(
    public readonly code:
      "budget_exhausted" | "generation_in_progress" | "invalid_reservation" | "cache_available" | "budget_accounting_unverified",
  ) {
    super(code);
  }
}
function ceiling(config: BudgetConfig) {
  return Math.floor(Math.max(0, Math.min(HARD_LIMIT_USD, Number.isFinite(config.budgetUsd) ? config.budgetUsd : 0)) * SCALE);
}
function costMicros(usage: Usage, prices: Prices) {
  return Math.ceil(usage.input * prices.input + usage.output * prices.output);
}
function validCount(n: number) {
  return Number.isSafeInteger(n) && n >= 0;
}

/** SQLite is the shared authority across processes and provider switches. Amounts are integer micro-USD. */
export class BudgetLedger {
  private readonly db: Database;
  constructor(private readonly config: BudgetConfig) {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(join(config.dataDir, "ai-budget.sqlite"), { create: true, strict: true });
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS ai_calls (
      id TEXT PRIMARY KEY, cache_key TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      reserved_micros INTEGER NOT NULL CHECK(reserved_micros > 0), charged_micros INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK(state IN ('reserved','settled')), input_bound INTEGER NOT NULL,
      output_bound INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
      accounting TEXT NOT NULL DEFAULT 'reservation', outcome TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ai_one_active_key ON ai_calls(cache_key) WHERE state='reserved';
    CREATE TABLE IF NOT EXISTS ai_blueprints (
      cache_key TEXT PRIMARY KEY, repo TEXT NOT NULL, head TEXT NOT NULL, namespace TEXT NOT NULL,
      blueprint TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_budget_guard (
      id INTEGER PRIMARY KEY CHECK(id=1), reason TEXT NOT NULL
    );`);
  }
  close() {
    this.db.close();
  }
  status(): BudgetStatus {
    const row = this.db
      .query(
        `SELECT COALESCE(SUM(charged_micros),0) spent,
      COALESCE(SUM(CASE WHEN state='reserved' THEN reserved_micros ELSE 0 END),0) reserved, COUNT(*) calls FROM ai_calls`,
      )
      .get() as { spent: number; reserved: number; calls: number };
    const limit = ceiling(this.config);
    const guarded = Boolean(this.db.query("SELECT id FROM ai_budget_guard WHERE id=1").get());
    return {
      limitUsd: limit / SCALE,
      spentUsd: row.spent / SCALE,
      reservedUsd: row.reserved / SCALE,
      remainingUsd: guarded ? 0 : Math.max(0, limit - row.spent - row.reserved) / SCALE,
      calls: row.calls,
      provider: this.config.provider,
      model: this.config.model,
      configured: Boolean(this.config.apiKey),
    };
  }
  reserve(cacheKey: string, usage: Usage, prices: Prices, reuseCached = false): Reservation {
    const floor = modelPrices(this.config.provider, this.config.model);
    if (!floor || prices.input < floor.input || prices.output < floor.output) throw new BudgetError("invalid_reservation");
    if (
      !validCount(usage.input) ||
      !validCount(usage.output) ||
      usage.input > 200_000 ||
      usage.output > 16_384 ||
      !Number.isFinite(prices.input) ||
      !Number.isFinite(prices.output) ||
      prices.input <= 0 ||
      prices.output <= 0
    )
      throw new BudgetError("invalid_reservation");
    const amount = costMicros(usage, prices);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BudgetError("invalid_reservation");
    return this.db
      .transaction(() => {
        if (this.db.query("SELECT id FROM ai_budget_guard WHERE id=1").get()) throw new BudgetError("budget_accounting_unverified");
        if (reuseCached && this.db.query("SELECT cache_key FROM ai_blueprints WHERE cache_key=?").get(cacheKey))
          throw new BudgetError("cache_available");
        if (this.db.query("SELECT id FROM ai_calls WHERE cache_key=? AND state='reserved'").get(cacheKey))
          throw new BudgetError("generation_in_progress");
        const totals = this.db
          .query(`SELECT COALESCE(SUM(charged_micros + CASE WHEN state='reserved' THEN reserved_micros ELSE 0 END),0) total FROM ai_calls`)
          .get() as { total: number };
        if (totals.total + amount > ceiling(this.config)) throw new BudgetError("budget_exhausted");
        const id = randomUUID();
        this.db
          .query(
            `INSERT INTO ai_calls(id,cache_key,provider,model,reserved_micros,state,input_bound,output_bound,created_at)
        VALUES(?,?,?,?,?,'reserved',?,?,?)`,
          )
          .run(id, cacheKey, this.config.provider, this.config.model, amount, usage.input, usage.output, new Date().toISOString());
        return { id, reservedUsd: amount / SCALE, inputBound: usage.input, outputBound: usage.output };
      })
      .immediate();
  }
  /** Missing or impossible usage is charged at the full reservation. No failure refunds unknown spend. */
  settle(
    reservation: Reservation,
    usage: Usage | null,
    prices: Prices,
    outcome: string,
    cache?: { key: string; repo: string; head: string; namespace: string; blueprint: AiBlueprint },
  ): number {
    return this.db
      .transaction(() => {
        const row = this.db.query("SELECT * FROM ai_calls WHERE id=?").get(reservation.id) as {
          state: string;
          reserved_micros: number;
          charged_micros: number;
          input_bound: number;
          output_bound: number;
        } | null;
        if (!row) throw new BudgetError("invalid_reservation");
        if (row.state === "settled") return row.charged_micros / SCALE;
        const metered =
          usage &&
          validCount(usage.input) &&
          validCount(usage.output) &&
          usage.input <= row.input_bound &&
          usage.output <= row.output_bound;
        if (usage && (usage.input > row.input_bound || usage.output > row.output_bound)) {
          this.db.query("INSERT OR IGNORE INTO ai_budget_guard(id,reason) VALUES(1,'provider_usage_exceeded_reserved_bounds')").run();
        }
        const charged = metered ? Math.min(row.reserved_micros, costMicros(usage!, prices)) : row.reserved_micros;
        this.db
          .query(`UPDATE ai_calls SET state='settled',charged_micros=?,input_tokens=?,output_tokens=?,accounting=?,outcome=? WHERE id=?`)
          .run(
            charged,
            metered ? usage!.input : null,
            metered ? usage!.output : null,
            metered ? "provider_usage_estimate" : "conservative_reservation",
            outcome.slice(0, 80),
            reservation.id,
          );
        if (cache) {
          const blueprint = { ...cache.blueprint, generator: { ...cache.blueprint.generator, costUsd: charged / SCALE } };
          this.db
            .query(
              `INSERT INTO ai_blueprints(cache_key,repo,head,namespace,blueprint,created_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(cache_key) DO UPDATE SET blueprint=excluded.blueprint,created_at=excluded.created_at`,
            )
            .run(cache.key, cache.repo, cache.head, cache.namespace, JSON.stringify(blueprint), new Date().toISOString());
        }
        return charged / SCALE;
      })
      .immediate();
  }
  cached(key: string): AiBlueprint | null {
    const row = this.db.query("SELECT blueprint FROM ai_blueprints WHERE cache_key=?").get(key) as { blueprint: string } | null;
    if (!row) return null;
    try {
      return JSON.parse(row.blueprint) as AiBlueprint;
    } catch {
      return null;
    }
  }
  previous(repo: string, namespace: string): { head: string; blueprint: AiBlueprint } | null {
    const row = this.db
      .query("SELECT head,blueprint FROM ai_blueprints WHERE repo=? AND namespace=? ORDER BY created_at DESC,rowid DESC LIMIT 1")
      .get(repo, namespace) as { head: string; blueprint: string } | null;
    if (!row) return null;
    try {
      return { head: row.head, blueprint: JSON.parse(row.blueprint) };
    } catch {
      return null;
    }
  }
  /** Safe diagnostic totals only: no prompt, response or credentials are stored in calls. */
  accounting(): { accounting: string; outcome: string; calls: number; chargedUsd: number; inputTokens: number; outputTokens: number }[] {
    return this.db
      .query(
        `SELECT accounting,outcome,COUNT(*) calls,SUM(charged_micros)/1000000.0 chargedUsd,
      COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens FROM ai_calls GROUP BY accounting,outcome`,
      )
      .all() as ReturnType<BudgetLedger["accounting"]>;
  }
}
export function getBudgetStatus(): BudgetStatus {
  const ledger = new BudgetLedger(getConfig());
  try {
    return ledger.status();
  } finally {
    ledger.close();
  }
}
