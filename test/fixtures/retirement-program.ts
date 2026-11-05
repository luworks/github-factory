/** Isolated subprocess fixture: mock OS/network/SQLite boundaries only; the real
 * retirement entrypoint and management verifier execute without injected gates.
 * No live process, credential file, ledger or external network is accessed. */
import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import * as filesystem from "node:fs";
import * as childProcess from "node:child_process";
import { liveAuthorityFixture, syntheticModule } from "./worker-authority";
const kind = process.env.MOON_FACTORY_RETIREMENT_FIXTURE;
if (!kind) throw new Error("Explicit SYNTHETIC subprocess required");
const fixture = liveAuthorityFixture({ kind: ["split", "physical-db"].includes(kind) ? kind : undefined });
const hash = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const retiredRelease = "/home/sn0admin/.local/share/github-factory/releases/SYNTHETIC";
const fixtureDir = filesystem.mkdtempSync("/tmp/moon-factory-retirement-fixture-");
const ledgerPath = fixtureDir + "/SYNTHETIC-ledger.sqlite", envText = "SYNTHETIC_ENV_ONLY";
const syntheticDb = new Database(ledgerPath);
syntheticDb.exec("CREATE TABLE ai_calls(id TEXT PRIMARY KEY,state TEXT); CREATE TABLE ai_public_hourly(call_id TEXT,admitted_at TEXT); INSERT INTO ai_calls VALUES('fixture','settled'); INSERT INTO ai_public_hourly VALUES('fixture','2026-11-04T00:00:00Z')");
syntheticDb.close();
const oldReceipt = JSON.stringify({ ledger: ledgerPath, device: 1, inode: 2 });
const authority = JSON.stringify({ ledgerPath, ledgerRealpath: ledgerPath, device: 1, inode: 2, receiptPath: "/SYNTHETIC/original-receipt.json", receiptSha256: hash(oldReceipt) });
const config = { ...fixture.config, identity: { pid: 12345, startTicks: "456", bootId: "SYNTHETIC_BOOT", sourceSha: "c".repeat(40), envSha256: hash(envText), protectedPid: 777, ledgerDevice: 1, ledgerInode: 2, epoch: fixture.config.storageIdentity.epoch },
  retiredRelease, ledgerPath, authorityFile: "/SYNTHETIC/authority.json", authoritySha256: hash(authority), cloudflareTokenFile: "/SYNTHETIC/account.token", dedicatedTunnelId: "55555555-5555-4555-8555-555555555555", connectorTokenFile: "/SYNTHETIC/connector.token", storageSecretFile: "/SYNTHETIC/storage.secret", receiptPath: "/SYNTHETIC/retirement.json", auditPath: "/SYNTHETIC/audit.jsonl" };
let stopCalls = 0, managementReads = 0, deploymentReads = 0, receipts = 0, readyObserved = false, clock = 1_000_000;
const fakeRead = (file: any, encoding?: any): any => {
  const path = String(file); let value: string;
  if (path === config.authorityFile) value = authority;
  else if (path === "/SYNTHETIC/original-receipt.json") value = oldReceipt;
  else if (path === config.cloudflareTokenFile) value = "SYNTHETIC_ACCOUNT_TOKEN";
  else if (path === config.storageSecretFile) value = "SYNTHETIC_STORAGE_SECRET";
  else if (path === config.connectorTokenFile) value = Buffer.from(JSON.stringify({ t: config.dedicatedTunnelId, a: config.cloudflareAccountId })).toString("base64");
  else if (path === retiredRelease + "/SOURCE_SHA") value = config.identity.sourceSha;
  else if (path === retiredRelease + "/.env") value = envText;
  else if (path === "/proc/sys/kernel/random/boot_id") value = config.identity.bootId;
  else if (path === "/proc/12345/stat") { const tail = Array(20).fill("0"); tail[19] = "456"; value = "12345 (SYNTHETIC) " + tail.join(" "); }
  else if (path === "/proc/uptime") { clock += 500; value = `${clock / 1000} 0`; }
  else if (path.startsWith("/proc/12345/net/")) value = path.endsWith("/unix") ? "header\n0: 3 0 0 0001 03 10\n" : "header\n";
  else throw new Error("Undeclared filesystem read " + path);
  return encoding ? value : Buffer.from(value);
};
mock.module("node:fs", () => ({ ...filesystem, readFileSync: fakeRead, statSync: () => ({ dev: 1, ino: 2 }), realpathSync: (p: string) => p,
  readdirSync: (p: string) => { if (p !== "/proc/12345/fd") throw new Error("Undeclared fd scan"); return ["1", "2"]; },
  readlinkSync: (p: string) => { if (!/^\/proc\/12345\/fd\/[12]$/.test(p)) throw new Error("Undeclared fd link"); return "socket:[10]"; },
  appendFileSync: (p: string, data: string) => { if (p !== config.auditPath) throw new Error("Undeclared audit write"); if (JSON.parse(data).verdict?.ready) readyObserved = true; },
  writeFileSync: (p: string) => { if (p !== config.receiptPath) throw new Error("Undeclared file write"); receipts++; },
}));
mock.module("node:child_process", () => ({ ...childProcess, execFileSync: (cmd: string, args: string[]) => {
  if (cmd !== "systemctl" || args[0] !== "--user") throw new Error("Undeclared command");
  if (args[1] === "stop") { if (args[2] !== "github-factory-tunnel.service") throw new Error("Wrong stop target"); stopCalls++; return ""; }
  if (args[1] !== "show") throw new Error("Undeclared mutation");
  const unit = args[2], field = args[4];
  if (!["github-factory-tunnel.service", "github-factory-web.service", "moonshot-web.service"].includes(unit)) throw new Error("Unrelated service");
  const tunnel = unit === "github-factory-tunnel.service";
  if (field === "MainPID") return tunnel ? stopCalls ? "0" : "999" : unit === "moonshot-web.service" ? "777" : "12345";
  if (field === "ActiveState") return tunnel && stopCalls ? "inactive" : "active";
  if (field === "WorkingDirectory") return retiredRelease;
  if (field === "ExecStart") return "cloudflared tunnel --token-file " + config.connectorTokenFile;
  if (field === "StandardOutput" || field === "StandardError") return "journal";
  throw new Error("Undeclared property");
} }));
Bun.sleep = (async () => {}) as any;
globalThis.fetch = (async (url: any, options: any) => {
  const value = String(url);
  if (value.includes("/workers/scripts/")) {
    managementReads++;
    if (value.endsWith("/deployments")) {
      deploymentReads++;
      if (kind === "before-stop-version" && deploymentReads >= 3) { const data = fixture.deployment(); data.deployments[0].versions[0].version_id = "66666666-6666-4666-8666-666666666666"; return Response.json({ success: true, result: data }); }
    }
    if (value.endsWith("/github-factory-gateway") && (kind === "during-drain-module" && stopCalls || kind === "final-module" && readyObserved)) return new Response(syntheticModule + "// drift", { headers: { "content-type": "application/javascript" } });
    return fixture.request(url, options);
  }
  if (value.includes("/cfd_tunnel/") && value.endsWith("/configurations")) return Response.json({ success: true, result: { config: { ingress: [{ hostname: "github-factory-origin.chaorders.com", service: "http://127.0.0.1:4177" }, { service: "http_status:404" }] } } });
  if (value.includes("/cfd_tunnel/") && value.endsWith("/connections")) return Response.json({ success: true, result: [] });
  if (value === "https://chaorders.com/github-factory/_storage" && options.method === "POST") return Response.json({ ok: true, identity: config.storageIdentity });
  throw new Error("Undeclared network boundary");
}) as typeof fetch;
let rejection = "";
try {
  const { drainRetiringRuntime } = await import("../../scripts/drain-retiring-runtime");
  await drainRetiringRuntime(config);
  if (kind !== "valid") throw new Error("Invalid retirement passed");
} catch (error) {
  if (kind === "valid") throw error;
  rejection = (error as Error).message;
  const expected = kind === "split" ? /single known 100%/ : kind === "physical-db" ? /physical Worker binding/ : kind === "before-stop-version" ? /deployment\/version changed/ : /Actual Worker module changed/;
  if (!expected.test(rejection)) throw error;
}
filesystem.rmSync(fixtureDir, { recursive: true, force: true });
console.log(JSON.stringify({ passed: true, rejection, kind, stopCalls, managementReads, receipts, readyObserved, liveNetworkCalls: 0, liveCredentialReads: 0, activeLedgerOpens: 0, syntheticSqliteOnly: true }));
