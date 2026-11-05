import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HISTORY_RPC_URL } from "./history-rpc-contract";
import type { HistoryRpcStoreConfig } from "./d1-history-store";
import { WORLD_CAPTURE_RPC_URL } from "./world-capture-rpc-contract";

export interface WorldCaptureConfig {
  readonly schemaVersion: 4;
  readonly endpoint: string;
  readonly secret: string;
  readonly identity: Readonly<{ databaseId: string; bindingNonce: string; epoch: string }>;
  readonly keyHex: string;
}

/** Pure, server-owned opt-in. Disabled settings never expose a capture key.
 * The epoch and independent key must come from the pinned operator authority;
 * parsing does not create, rotate, derive or certify either of them. */
export function worldCaptureConfig(env: Record<string, string>): WorldCaptureConfig | null {
  const enabled = env.MOONSHOT_WORLD_CAPTURE_ENABLED;
  if (enabled === undefined || enabled === "" || enabled === "false") return null;
  const reject = (): never => { throw new Error("Invalid world capture configuration"); };
  if (enabled !== "true" || env.MOONSHOT_WORLD_STORE !== "d1" || env.MOONSHOT_WORLD_CAPTURE_SCHEMA_VERSION !== "4" || env.MOONSHOT_D1_STORAGE_URL !== WORLD_CAPTURE_RPC_URL) return reject();
  const secret = env.MOONSHOT_D1_STORAGE_SECRET || "", keyHex = env.MOONSHOT_WORLD_CAPTURE_KEY_HEX || "";
  const identity = { databaseId: env.MOONSHOT_D1_DATABASE_ID || "", bindingNonce: env.MOONSHOT_WORLD_CAPTURE_BINDING_NONCE || "", epoch: env.MOONSHOT_WORLD_CAPTURE_EPOCH || "" };
  const bytes = new TextEncoder().encode(secret).length;
  if (secret.length < 32 || bytes > 256 || !/^[a-f0-9]{64}$/.test(keyHex) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(identity.databaseId) ||
      !/^[a-f0-9]{32}$/.test(identity.bindingNonce) || !/^[a-f0-9]{32}$/.test(identity.epoch)) return reject();
  return Object.freeze({ schemaVersion: 4, endpoint: WORLD_CAPTURE_RPC_URL, secret, identity: Object.freeze(identity), keyHex });
}

export interface HistoryRuntimeConfig {
  readonly publicOrigin: string;
  readonly rpc: HistoryRpcStoreConfig;
  readonly cursorKeyHex: string;
}

/** Server-only opt-in. Invalid/missing settings are indistinguishably disabled;
 * no default signing key, storage fallback, environment read or provisioning. */
export function historyConfig(env: Record<string, string>): HistoryRuntimeConfig | null {
  if (env.MOONSHOT_HISTORY_ENABLED !== "true" || env.MOONSHOT_WORLD_STORE !== "d1" || env.MOONSHOT_HISTORY_SCHEMA_VERSION !== "3") return null;
  const publicOrigin = env.MOONSHOT_PUBLIC_ORIGIN || "";
  try { const origin = new URL(publicOrigin); if (origin.protocol !== "https:" || origin.origin !== publicOrigin) return null; } catch { return null; }
  const secret = env.MOONSHOT_D1_STORAGE_SECRET || "", gatewaySecret = env.MOONSHOT_GATEWAY_SECRET || "";
  const size = (value: string) => new TextEncoder().encode(value).length;
  const identity = { databaseId: env.MOONSHOT_D1_DATABASE_ID || "", bindingNonce: env.MOONSHOT_HISTORY_BINDING_NONCE || "", epoch: env.MOONSHOT_HISTORY_EPOCH || "", sourceSha: env.MOONSHOT_HISTORY_SOURCE_SHA || "", workerBundleSha256: env.MOONSHOT_HISTORY_WORKER_BUNDLE_SHA256 || "" };
  const cursorKeyHex = env.MOONSHOT_HISTORY_CURSOR_KEY_HEX || "";
  if (env.MOONSHOT_D1_STORAGE_URL !== HISTORY_RPC_URL || size(secret) < 32 || size(secret) > 256 || size(gatewaySecret) < 32 || size(gatewaySecret) > 256 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(identity.databaseId) ||
      !/^[a-f0-9]{32}$/.test(identity.bindingNonce) || !/^[a-f0-9]{32}$/.test(identity.epoch) || !/^[a-f0-9]{40}$/.test(identity.sourceSha) ||
      !/^[a-f0-9]{64}$/.test(identity.workerBundleSha256) || !/^[a-f0-9]{64}$/.test(cursorKeyHex)) return null;
  return { publicOrigin, rpc: { endpoint: HISTORY_RPC_URL, secret, identity }, cursorKeyHex };
}

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
  const worldCapture = worldCaptureConfig(env);
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
    d1DatabaseId: env.MOONSHOT_D1_DATABASE_ID || "",
    worldCapture,
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
