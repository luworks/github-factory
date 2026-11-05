import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Explicit project-local env loading; never walk into the parent repository.
export function projectEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      values[match[1]] = value;
    }
  }
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) values[name] = value;
  return values;
}

export function getConfig(env: Record<string, string> = projectEnv()) {
  if (env.MOONSHOT_WORLD_STORE && !["sqlite", "d1"].includes(env.MOONSHOT_WORLD_STORE)) throw new Error("Invalid world storage configuration");
  const publicRuntime = Boolean(env.MOONSHOT_PUBLIC_ORIGIN);
  const budgetUsd = Math.max(0, Math.min(50, Number(env.MOONSHOT_BUDGET_USD || 0) || 0));
  // Public analysis uses a fixed Meta deployment. Provider/model/endpoint are
  // server configuration, never choices accepted from a repository request.
  const provider = !publicRuntime && env.MOONSHOT_PROVIDER === "openai" ? "openai" : "muse";
  return {
    provider,
    model: provider === "muse" ? publicRuntime ? "muse-spark-1.3" : env.MOONSHOT_META_MODEL || "muse-spark-1.3" : env.MOONSHOT_MODEL || "gpt-6.1-sol",
    baseUrl:
      provider === "muse"
        ? publicRuntime ? "https://api.meta.ai/v1" : env.MOONSHOT_META_API_BASE_URL || "https://api.meta.ai/v1"
        : env.MOONSHOT_API_BASE_URL || "https://api.openai.com/v1",
    apiKey: provider === "muse" ? env.MOONSHOT_META_API_KEY || "" : env.MOONSHOT_API_KEY || "",
    githubToken: env.GITHUB_TOKEN || "",
    publicOrigin: env.MOONSHOT_PUBLIC_ORIGIN || "",
    githubRequestsPerHour: Math.max(0, Math.min(1000, Math.floor(Number(env.MOONSHOT_GITHUB_REQUESTS_PER_HOUR ?? 45) || 0))),
    dataDir: resolve(env.MOONSHOT_DATA_DIR || ".data"),
    worldStore: env.MOONSHOT_WORLD_STORE === "d1" ? "d1" : "sqlite",
    d1StorageUrl: env.MOONSHOT_D1_STORAGE_URL || "",
    d1StorageSecret: env.MOONSHOT_D1_STORAGE_SECRET || "",
    // An explicit existing file is required; BudgetLedger never initializes a
    // new file at this path, so migration cannot silently fork paid history.
    ledgerPath: env.MOONSHOT_BUDGET_LEDGER_PATH || undefined,
    requireExistingLedger: publicRuntime && budgetUsd > 0,
    // Conservative accounting ceiling, not a market exchange-rate claim:
    // US$0.30 * 10 CNY/USD = CNY3. Operators may lower, never raise this guard.
    hourlyBudgetUsd: publicRuntime ? Math.max(0, Math.min(0.30, Number(env.MOONSHOT_HOURLY_BUDGET_USD ?? 0.30) || 0)) : undefined,
    budgetUsd,
  } as const;
}
