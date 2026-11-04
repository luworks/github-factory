import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetLedger, modelPrices, type BudgetConfig } from "../src/server/budget";
const dirs: string[] = [],
  ledgers: BudgetLedger[] = [];
function config(overrides: Partial<BudgetConfig> = {}): BudgetConfig {
  const dataDir = mkdtempSync(join(tmpdir(), "moonshot-budget-"));
  dirs.push(dataDir);
  return { dataDir, budgetUsd: 50, provider: "openai", model: "gpt-6.1-sol", apiKey: "offline-placeholder", ...overrides };
}
function open(value: BudgetConfig) {
  const ledger = new BudgetLedger(value);
  ledgers.push(ledger);
  return ledger;
}
const prices = { input: 2.5, output: 10 };
afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe("persistent hard budget", () => {
  test("public hourly admission preserves the original cumulative ceiling and counts failures", () => {
    const ledger = open(config({ hourlyBudgetUsd: 0.30 }));
    const usage = { input: 40_000, output: 0 }; // offline US$0.10 bound
    const one = ledger.reserve("hour-one", usage, prices);
    ledger.settle(one, null, prices, "network_failure");
    ledger.reserve("hour-two", usage, prices);
    ledger.reserve("hour-three", usage, prices);
    expect(() => ledger.reserve("hour-overflow", usage, prices)).toThrow("hourly_budget_exhausted");
    expect(ledger.status()).toMatchObject({ limitUsd: 50, spentUsd: 0.1, reservedUsd: 0.2, remainingUsd: 0,
      hourly: { limitUsd: 0.3, limitCny: 3, accountingCnyPerUsd: 10, spentUsd: 0.1, reservedUsd: 0.2, remainingUsd: 0, calls: 3 } });
  });
  test("old pending reservations and late settlements remain inside the rolling hourly bound", () => {
    let now = 3_600_000;
    const ledger = new BudgetLedger(config({ hourlyBudgetUsd: 0.2 }), () => now); ledgers.push(ledger);
    const usage = { input: 40_000, output: 0 };
    const old = ledger.reserve("old-pending", usage, prices);
    now += 3_600_001;
    ledger.reserve("new-pending", usage, prices);
    expect(() => ledger.reserve("too-many", usage, prices)).toThrow("hourly_budget_exhausted");
    ledger.settle(old, null, prices, "late_failure");
    expect(ledger.status().hourly).toMatchObject({ spentUsd: 0.1, reservedUsd: 0.1, remainingUsd: 0 });
    now += 3_600_001;
    expect(ledger.status().hourly).toMatchObject({ spentUsd: 0, reservedUsd: 0.1, remainingUsd: 0.1 });
  });
  test("hourly public cap cannot be configured above US$0.30 and zero disables admission", () => {
    const excessive = open(config({ hourlyBudgetUsd: 9 }));
    expect(excessive.status().hourly?.limitUsd).toBe(0.3);
    const disabled = open(config({ hourlyBudgetUsd: 0 }));
    expect(() => disabled.reserve("no-paid", { input: 1, output: 1 }, prices)).toThrow("hourly_budget_exhausted");
    expect(disabled.status().calls).toBe(0);
  });
  test("paid public operation requires an explicit existing authoritative ledger", () => {
    expect(() => new BudgetLedger(config({ requireExistingLedger: true }))).toThrow("authoritative budget ledger required");
    expect(() => new BudgetLedger(config({ requireExistingLedger: true, ledgerPath: "/tmp/never-created-factory-budget-ledger.sqlite" }))).toThrow("unavailable");
  });
  test("independent processes cannot exceed the rolling public hourly cap", async () => {
    const c = config({ hourlyBudgetUsd: 0.3 }); open(c);
    const script = `import {BudgetLedger} from ${JSON.stringify(new URL("../src/server/budget.ts", import.meta.url).pathname)};const ledger=new BudgetLedger(${JSON.stringify(c)});let ok=0;for(let n=0;n<10;n++){try{ledger.reserve(process.argv[1]+n,{input:40000,output:0},{input:2.5,output:10});ok++;}catch(e){if(e.code!=="hourly_budget_exhausted")throw e;}}ledger.close();console.log(ok);`;
    const processes = Array.from({ length: 4 }, (_, i) => Bun.spawn([process.execPath, "--no-env-file", "-e", script, `hour-racer-${i}-`], { stdout: "pipe", stderr: "pipe" }));
    const result = await Promise.all(processes.map(async (p) => ({ code: await p.exited, count: Number((await new Response(p.stdout).text()).trim()), error: await new Response(p.stderr).text() })));
    expect(result.map((r) => ({ code: r.code, error: r.error }))).toEqual(result.map(() => ({ code: 0, error: "" })));
    expect(result.reduce((sum, r) => sum + r.count, 0)).toBe(3);
    expect(open(c).status()).toMatchObject({ limitUsd: 50, calls: 3, reservedUsd: 0.3, hourly: { reservedUsd: 0.3, remainingUsd: 0 } });
  });
  test("known conservative prices; unknown and contributor variants rejected", () => {
    expect(modelPrices("openai", "gpt-6.1-sol")).toEqual(prices);
    for (const model of ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"])
      expect(modelPrices("muse", model)).toEqual({ input: 1.25, output: 4.25 });
    expect(modelPrices("muse", "muse-wonder-1.0")).toEqual({ input: 4, output: 20 });
    expect(modelPrices("muse", "muse-spark-1.3-contributor")).toBeNull();
    expect(modelPrices("openai", "unknown")).toBeNull();
  });
  test("reserve before send, cap oversized config, persist across provider switch", () => {
    const c = config({ budgetUsd: 500 }),
      ledger = open(c);
    ledger.reserve("one", { input: 1000, output: 1000 }, prices);
    expect(ledger.status()).toMatchObject({ limitUsd: 50, spentUsd: 0, reservedUsd: 0.0125, calls: 1 });
    expect(open({ ...c, provider: "muse", model: "muse-spark-1.3" }).status()).toMatchObject({ reservedUsd: 0.0125, calls: 1 });
  });
  test("crashed reservation stays; unknown cost fully charged; active key fenced", () => {
    const c = config(),
      ledger = open(c);
    ledger.reserve("crashed", { input: 1000, output: 1000 }, prices);
    expect(open(c).status().reservedUsd).toBe(0.0125);
    const other = ledger.reserve("network-error", { input: 1000, output: 1000 }, prices);
    expect(ledger.settle(other, null, prices, "timeout")).toBe(0.0125);
    expect(ledger.status()).toMatchObject({ spentUsd: 0.0125, reservedUsd: 0.0125, calls: 2 });
    expect(() => ledger.reserve("crashed", { input: 1, output: 1 }, prices)).toThrow("generation_in_progress");
  });
  test("provider estimates round up, settle once, known unused amount released", () => {
    const ledger = open(config()),
      r = ledger.reserve("a", { input: 1000, output: 1000 }, prices);
    expect(ledger.settle(r, { input: 1, output: 1 }, prices, "completed")).toBe(0.000013);
    expect(ledger.settle(r, null, prices, "duplicate")).toBe(0.000013);
    expect(ledger.status()).toMatchObject({ spentUsd: 0.000013, reservedUsd: 0 });
    expect(ledger.accounting()[0]).toMatchObject({ accounting: "provider_usage_estimate", calls: 1, inputTokens: 1, outputTokens: 1 });
  });
  for (const usage of [
    { input: 1001, output: 1 },
    { input: 1, output: 1001 },
    { input: -1, output: 1 },
    { input: 0.5, output: 1 },
  ])
    test(`invalid usage ${JSON.stringify(usage)} fully charged`, () => {
      const ledger = open(config()),
        r = ledger.reserve("a", { input: 1000, output: 1000 }, prices);
      expect(ledger.settle(r, usage, prices, "invalid_usage")).toBe(r.reservedUsd);
      expect(ledger.accounting()[0]?.accounting).toBe("conservative_reservation");
    });
  test("micro-dollar boundary and lower limit cannot overspend", () => {
    const c = config({ budgetUsd: 0.000025 }),
      ledger = open(c);
    ledger.reserve("a", { input: 1, output: 1 }, prices);
    expect(() => ledger.reserve("b", { input: 1, output: 1 }, prices)).toThrow("budget_exhausted");
    expect(open({ ...c, budgetUsd: 0 }).status().remainingUsd).toBe(0);
  });
  test("provider violating its bound freezes further spend across provider changes", () => {
    const c = config(),
      ledger = open(c),
      r = ledger.reserve("a", { input: 1000, output: 1000 }, prices);
    ledger.settle(r, { input: 1001, output: 1 }, prices, "invalid_usage");
    expect(ledger.status()).toMatchObject({ remainingUsd: 0, spentUsd: 0.0125 });
    expect(() =>
      open({ ...c, provider: "muse", model: "muse-spark-1.3" }).reserve("b", { input: 1, output: 1 }, { input: 1.25, output: 4.25 }),
    ).toThrow("budget_accounting_unverified");
  });
  test("bad usage, unknown models and underpriced reservations fail closed", () => {
    const ledger = open(config());
    for (const usage of [
      { input: NaN, output: 10 },
      { input: -1, output: 1 },
      { input: 200001, output: 0 },
      { input: 1, output: 16385 },
    ])
      expect(() => ledger.reserve("bad", usage, prices)).toThrow("invalid_reservation");
    expect(() => ledger.reserve("cheap", { input: 1000, output: 1000 }, { input: 1, output: 1 })).toThrow("invalid_reservation");
    expect(ledger.status().calls).toBe(0);
    expect(() => open(config({ model: "unpriced" })).reserve("bad", { input: 1, output: 1 }, prices)).toThrow("invalid_reservation");
  });
  test("four real SQLite writer processes cannot cross $50", async () => {
    const c = config({ budgetUsd: 999 });
    open(c);
    const script = join(c.dataDir, "reserve.ts");
    writeFileSync(
      script,
      `import {BudgetLedger} from ${JSON.stringify(new URL("../src/server/budget.ts", import.meta.url).pathname)};const ledger=new BudgetLedger(${JSON.stringify(c)});let ok=0,denied=0;for(let n=0;n<40;n++){try{ledger.reserve(process.argv[2]+n,{input:200000,output:0},{input:2.5,output:10});ok++;}catch(e){if(e.code!=="budget_exhausted")throw e;denied++;}}ledger.close();console.log(JSON.stringify({ok,denied}));`,
    );
    const children = Array.from({ length: 4 }, (_, i) =>
      Bun.spawn([process.execPath, "--no-env-file", script, String(i)], { stdout: "pipe", stderr: "pipe" }),
    );
    const totals = await Promise.all(
      children.map(async (child) => {
        const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(err).toBe("");
        expect(exit).toBe(0);
        return JSON.parse(out) as { ok: number; denied: number };
      }),
    );
    expect(totals.reduce((n, r) => n + r.ok, 0)).toBe(100);
    expect(totals.reduce((n, r) => n + r.denied, 0)).toBe(60);
    expect(open(c).status()).toMatchObject({ limitUsd: 50, spentUsd: 0, reservedUsd: 50, remainingUsd: 0, calls: 100 });
    expect(() =>
      open({ ...c, provider: "muse", model: "muse-spark-1.3" }).reserve("switch", { input: 1, output: 1 }, { input: 1.25, output: 4.25 }),
    ).toThrow("budget_exhausted");
  });
});
