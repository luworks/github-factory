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

export function getConfig() {
  const env = projectEnv();
  const provider = env.MOONSHOT_PROVIDER === "muse" ? "muse" : "openai";
  return {
    provider,
    model: provider === "muse" ? env.MOONSHOT_META_MODEL || "muse-spark-1.3" : env.MOONSHOT_MODEL || "gpt-6.1-sol",
    baseUrl:
      provider === "muse"
        ? env.MOONSHOT_META_API_BASE_URL || "https://api.meta.ai/v1"
        : env.MOONSHOT_API_BASE_URL || "https://api.openai.com/v1",
    apiKey: provider === "muse" ? env.MOONSHOT_META_API_KEY || "" : env.MOONSHOT_API_KEY || "",
    githubToken: env.GITHUB_TOKEN || "",
    publicOrigin: env.MOONSHOT_PUBLIC_ORIGIN || "",
    githubRequestsPerHour: Math.max(0, Math.min(1000, Math.floor(Number(env.MOONSHOT_GITHUB_REQUESTS_PER_HOUR ?? 45) || 0))),
    dataDir: resolve(env.MOONSHOT_DATA_DIR || ".data"),
    budgetUsd: Math.max(0, Math.min(50, Number(env.MOONSHOT_BUDGET_USD || 0) || 0)),
  } as const;
}
