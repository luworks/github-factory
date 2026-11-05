import { Database } from "bun:sqlite";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { isIP } from "node:net";
import { getConfig, projectEnv } from "./config";
import { HttpError } from "./http";

export type AccessBucket = "request" | "collection" | "ai" | "global-ai";
type AccessConfig = { secret: string; publicOrigin: string; dataDir: string; requestsPerMinute: number; collectionsPerHour: number; aiPerHour: number; aiGlobalPerHour: number };
const bounded = (input: string | undefined, fallback: number, maximum: number) =>
  input === undefined || input === "" ? fallback : Math.max(0, Math.min(maximum, Math.floor(Number(input) || 0)));

export function accessConfig(): AccessConfig {
  const config = getConfig(), env = projectEnv();
  return { secret: env.MOONSHOT_GATEWAY_SECRET || "", publicOrigin: config.publicOrigin, dataDir: config.dataDir,
    requestsPerMinute: bounded(env.MOONSHOT_IP_REQUESTS_PER_MINUTE, 10, 30),
    collectionsPerHour: bounded(env.MOONSHOT_IP_COLLECTIONS_PER_HOUR, 6, 20),
    aiPerHour: bounded(env.MOONSHOT_IP_AI_PER_HOUR, 2, 5), aiGlobalPerHour: bounded(env.MOONSHOT_AI_CALLS_PER_HOUR, 6, 24) };
}

/** Only the authenticated gateway may assert an IP. Forwarded and CF headers
 * from direct origin callers are never sufficient. IPs are stored only as HMACs. */
export function clientIdentity(request: Request, config: Pick<AccessConfig, "secret" | "publicOrigin">): string {
  if (!config.publicOrigin && !config.secret) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname))
      throw new HttpError(403, "GATEWAY_REQUIRED", "Use the public application address.");
    return createHmac("sha256", "local-development-only").update("loopback").digest("hex");
  }
  if (config.secret.length < 32) throw new HttpError(503, "GATEWAY_UNCONFIGURED", "The public gateway is not configured.");
  const supplied = request.headers.get("x-factory-gateway-key") || "";
  const a = Buffer.from(supplied), b = Buffer.from(config.secret);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new HttpError(403, "GATEWAY_REQUIRED", "Use the public application address.");
  let ip = request.headers.get("x-factory-client-ip") || "";
  if (!isIP(ip)) throw new HttpError(403, "CLIENT_IDENTITY_REQUIRED", "A verified client address is required.");
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  else if (isIP(ip) === 6) ip = new URL(`http://[${ip}]/`).hostname;
  return createHmac("sha256", config.secret).update(ip).digest("hex");
}

export class ClientQuota {
  private db: Database;
  constructor(path: string, private limits: { requestsPerMinute: number; collectionsPerHour: number; aiPerHour: number; aiGlobalPerHour?: number }, private now = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS client_quota (identity TEXT NOT NULL, bucket TEXT NOT NULL, window INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(identity,bucket,window))");
  }
  take(identity: string, bucket: AccessBucket) {
    const now = this.now(), duration = bucket === "request" ? 60_000 : 3_600_000;
    const window = Math.floor(now / duration), expires = (window + 1) * duration;
    const limit = bucket === "request" ? this.limits.requestsPerMinute : bucket === "collection" ? this.limits.collectionsPerHour
      : bucket === "global-ai" ? (this.limits.aiGlobalPerHour ?? 6) : this.limits.aiPerHour;
    const admitted = this.db.query(`INSERT INTO client_quota(identity,bucket,window,expires_at,used) SELECT ?,?,?,?,1 WHERE ? > 0
      ON CONFLICT(identity,bucket,window) DO UPDATE SET used=used+1 WHERE used < ? RETURNING used`).get(identity,bucket,window,expires,limit,limit);
    if (!admitted) throw Object.assign(new HttpError(429, bucket === "global-ai" ? "AI_RATE_LIMIT" : "IP_RATE_LIMIT", bucket === "global-ai"
      ? "The public AI analysis allowance is cooling down. Existing source evidence remains available."
      : bucket === "ai" ? "This client has reached its AI analysis allowance. Existing source evidence remains available."
      : "This client has reached its repository analysis allowance. Please retry after the cooldown."),
      { retryAfter: Math.max(1, Math.ceil((expires - now) / 1000)) });
    this.db.query("DELETE FROM client_quota WHERE expires_at < ?").run(now - 3_600_000);
  }
  takeAi(identity: string) {
    this.db.transaction(() => { this.take(identity, "ai"); this.take("deployment", "global-ai"); })();
  }
  close() { this.db.close(); }
}

let singleton: { path: string; quota: ClientQuota } | undefined;
export function accessRequest(request: Request) {
  const config = accessConfig(), identity = clientIdentity(request, config), path = join(config.dataDir, "public-access.sqlite");
  if (!singleton || singleton.path !== path) {
    singleton?.quota.close(); singleton = { path, quota: new ClientQuota(path, config) };
  }
  singleton.quota.take(identity, "request");
  return { admitCollection: () => singleton!.quota.take(identity, "collection"), admitAi: () => singleton!.quota.takeAi(identity) };
}
