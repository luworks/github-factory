import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, statSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertIdentity, type StorageIdentity } from "../deploy/migration-contract";
import { evaluateRetirement, inspectSockets, assertOriginalLedger, type OriginalLedgerAuthority, type RetirementIdentity, type RetirementState } from "./retirement-guard";
interface DrainConfig {
  identity: RetirementIdentity; retiredRelease: string; ledgerPath: string;
  cloudflareAccountId: string; cloudflareTokenFile: string; dedicatedTunnelId: string; connectorTokenFile: string;
  authorityFile: string; authoritySha256: string; storageSecretFile: string; storageIdentity: StorageIdentity; receiptPath: string; auditPath: string;
}
const show = (unit: string, property: string) => execFileSync("systemctl", ["--user", "show", unit, "-p", property, "--value"], { encoding: "utf8" }).trim();
const nowMono = () => Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000;
const procStart = (pid: number) => readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1)!.split(" ")[19];
const sha = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
/** Operations entrypoint; never invoked by tests or CI. Exact target handles
 * come from a private reviewed config. It stops ONLY the dedicated connector,
 * never the retiring app or protected old service. It does NOT restart anything. */
export async function drainRetiringRuntime(config: DrainConfig) {
  const expected = config.identity;
  const authorityBytes = readFileSync(config.authorityFile);
  if (new Bun.CryptoHasher("sha256").update(authorityBytes).digest("hex") !== config.authoritySha256) throw new Error("Original authority pin changed");
  const original = JSON.parse(authorityBytes.toString()) as OriginalLedgerAuthority;
  const authorityReceipt = readFileSync(original.receiptPath);
  if (new Bun.CryptoHasher("sha256").update(authorityReceipt).digest("hex") !== original.receiptSha256) throw new Error("Original handoff receipt changed");
  const handoff = JSON.parse(authorityReceipt.toString());
  if (handoff.ledger !== original.ledgerPath || handoff.device !== original.device || handoff.inode !== original.inode) throw new Error("Original handoff identity mismatch");
  if (!Number.isInteger(expected.pid) || expected.pid <= 1 || expected.pid === expected.protectedPid || !config.retiredRelease.startsWith("/home/sn0admin/.local/share/github-factory/releases/") || !/^[a-f0-9-]{36}$/.test(config.dedicatedTunnelId)) throw new Error("Unknown retirement authority");
  const accountToken = readFileSync(config.cloudflareTokenFile, "utf8").trim();
  const cf = async (suffix: string) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/cfd_tunnel/${config.dedicatedTunnelId}${suffix}`, {
      headers: { authorization: `Bearer ${accountToken}`, connection: "close" }, signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    const result = await response.json() as { success: boolean; result: any };
    if (!response.ok || result.success !== true) throw new Error("Dedicated tunnel evidence unavailable"); return result.result;
  };
  const fence = async () => {
    const response = await fetch("https://chaorders.com/github-factory/_storage", { method: "POST", headers: { "content-type": "application/json", connection: "close", "x-factory-storage-key": readFileSync(config.storageSecretFile, "utf8").trim() }, body: '{"op":"status"}', signal: AbortSignal.timeout(15_000), redirect: "error" });
    const result = await response.json() as { ok: boolean; identity: StorageIdentity };
    if (!response.ok || result.ok !== true) throw new Error("Edge fence evidence unavailable"); assertIdentity(result.identity, config.storageIdentity); return true;
  };
  const handles = () => {
    if (show("github-factory-web.service", "MainPID") !== String(expected.pid) || show("github-factory-web.service", "ActiveState") !== "active" || show("github-factory-web.service", "WorkingDirectory") !== config.retiredRelease ||
      readFileSync(join(config.retiredRelease, "SOURCE_SHA"), "utf8").trim() !== expected.sourceSha || sha(readFileSync(join(config.retiredRelease, ".env"), "utf8")) !== expected.envSha256 ||
      procStart(expected.pid) !== expected.startTicks || readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() !== expected.bootId ||
      show("moonshot-web.service", "MainPID") !== String(expected.protectedPid) || show("moonshot-web.service", "ActiveState") !== "active") throw new Error("Retiring or protected service identity changed");
    const ledger = statSync(config.ledgerPath);
    assertOriginalLedger(config.ledgerPath, original, { realpath: realpathSync(config.ledgerPath), device: ledger.dev, inode: ledger.ino });
    if (expected.ledgerDevice !== original.device || expected.ledgerInode !== original.inode || ledger.dev !== expected.ledgerDevice || ledger.ino !== expected.ledgerInode) throw new Error("Original ledger identity changed");
  };
  handles();
  if (!show("github-factory-tunnel.service", "ExecStart").includes(`--token-file ${config.connectorTokenFile}`)) throw new Error("Connector unit authority unknown");
  const connector = JSON.parse(Buffer.from(readFileSync(config.connectorTokenFile, "utf8").trim(), "base64").toString());
  if (connector.t !== config.dedicatedTunnelId || connector.a !== config.cloudflareAccountId) throw new Error("Dedicated connector token identity mismatch");
  const tunnelConfig = (await cf("/configurations")).config;
  if (tunnelConfig.ingress?.length !== 2 || tunnelConfig.ingress[0].hostname !== "github-factory-origin.chaorders.com" || tunnelConfig.ingress[0].service !== "http://127.0.0.1:4177" || tunnelConfig.ingress[1].service !== "http_status:404") throw new Error("Tunnel may serve unrelated paths");
  await fence();
  const fenceConfirmedAt = new Date().toISOString();
  appendFileSync(config.auditPath, JSON.stringify({ event: "FENCE_CONFIRMED", at: fenceConfirmedAt, epoch: expected.epoch }) + "\n", { mode: 0o600 });
  execFileSync("systemctl", ["--user", "stop", "github-factory-tunnel.service"], { timeout: 120_000 });
  if (show("github-factory-tunnel.service", "ActiveState") !== "inactive" || show("github-factory-tunnel.service", "MainPID") !== "0") throw new Error("Dedicated connector did not stop");
  // Read-only authority: no settlement, cancellation, copy or mutation of ledger.
  const db = new Database(config.ledgerPath, { readonly: true, strict: true });
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000");
  const journalOutputVerified = show("github-factory-web.service", "StandardOutput") === "journal" && ["inherit", "journal"].includes(show("github-factory-web.service", "StandardError"));
  let state: RetirementState | null = null, metadataAt = 0, connections = -1, fenceVerified = false;
  const deadline = nowMono() + 600_000;
  try {
    while (nowMono() < deadline) {
      handles();
      if (show("github-factory-tunnel.service", "ActiveState") !== "inactive" || show("github-factory-tunnel.service", "MainPID") !== "0") throw new Error("Connector reopened during drain");
      if (nowMono() - metadataAt >= 10_000) { const listed = await cf("/connections"); if (!Array.isArray(listed)) throw new Error("Tunnel connection evidence unknown"); connections = listed.length; fenceVerified = await fence(); metadataAt = nowMono(); }
      if (connections !== 0) { await Bun.sleep(2000); continue; }
      const sockets = inspectSockets(expected.pid, journalOutputVerified);
      if (sockets.inboundSockets) { if (state) throw new Error("Input reopened after drain began"); await Bun.sleep(2000); continue; }
      const calls = db.query(`SELECT COUNT(*) publicCalls,COALESCE(SUM(CASE WHEN c.state='reserved' THEN 1 ELSE 0 END),0) publicReserved,MAX(h.admitted_at) latestPublicAdmission FROM ai_public_hourly h JOIN ai_calls c ON c.id=h.call_id`).get() as { publicCalls: number; publicReserved: number; latestPublicAdmission: string | null };
      const observation = { ...expected, ...calls, ...sockets, wallTimeMs: Date.now(), monotonicMs: nowMono(), fenceVerified, connectorStopped: true, tunnelConnections: connections };
      const verdict = evaluateRetirement(state, observation, expected); state = verdict.state;
      appendFileSync(config.auditPath, JSON.stringify({ observation, verdict }) + "\n", { mode: 0o600 });
      if (verdict.ready) {
        // Fresh authenticated evidence after the quiet interval, not old receipt.
        await fence(); const finalConnections = await cf("/connections");
        if (!Array.isArray(finalConnections) || finalConnections.length) throw new Error("Tunnel reopened at retirement boundary");
        handles();
        const finalCalls = db.query(`SELECT COUNT(*) publicCalls,COALESCE(SUM(CASE WHEN c.state='reserved' THEN 1 ELSE 0 END),0) publicReserved,MAX(h.admitted_at) latestPublicAdmission FROM ai_public_hourly h JOIN ai_calls c ON c.id=h.call_id`).get() as { publicCalls: number; publicReserved: number; latestPublicAdmission: string | null };
        const finalVerdict = evaluateRetirement(state, { ...expected, ...finalCalls, ...inspectSockets(expected.pid, journalOutputVerified), wallTimeMs: Date.now(), monotonicMs: nowMono(), fenceVerified: true, connectorStopped: true, tunnelConnections: 0 }, expected);
        state = finalVerdict.state; if (!finalVerdict.ready) continue;
        const receipt = { verifiedAtMs: Date.now(), expiresAtMs: Date.now() + 30_000, fenceConfirmedAt, identity: expected, verdict: finalVerdict, connectorRemainsStopped: true, retiredAppRemainsAlive: true,
          scope: "Only public ai_public_hourly reservations checked; protected legacy reservations were neither cancelled nor settled.", noLedgerMutation: true };
        writeFileSync(config.receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 }); return receipt;
      }
      await Bun.sleep(2000);
    }
    throw new Error("Retiring workload did not become provably quiet; no app restart allowed");
  } finally { db.close(); }
}
if (import.meta.main) {
  try { const path = process.argv[2]; if (!path?.startsWith("/")) throw new Error(); console.log(JSON.stringify(await drainRetiringRuntime(JSON.parse(readFileSync(path, "utf8"))))); }
  catch { console.error("Retirement drain FAILED CLOSED. Connector may remain stopped; do not restart the app without a fresh successful receipt."); process.exitCode = 1; }
}
