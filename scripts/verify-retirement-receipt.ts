import { Database } from "bun:sqlite";
import { readFileSync, statSync, readlinkSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assertOriginalLedger, inspectSockets, requireFreshRetirementReceipt } from "./retirement-guard";
import { verifyLiveWorkerAuthority } from "./live-worker-authority";
// Final read-only check immediately before restarting the exact retired app.
if (import.meta.main) {
  try {
    const config = JSON.parse(readFileSync(process.argv[2], "utf8")), expected = config.identity;
    const token = readFileSync(config.cloudflareTokenFile, "utf8").trim();
    await verifyLiveWorkerAuthority(config, token);
    const show = (unit: string, field: string) => execFileSync("systemctl", ["--user", "show", unit, "-p", field, "--value"], { encoding: "utf8" }).trim();
    if (show("github-factory-web.service", "MainPID") !== String(expected.pid) || show("moonshot-web.service", "MainPID") !== String(expected.protectedPid) ||
      show("github-factory-tunnel.service", "ActiveState") !== "inactive" || show("github-factory-tunnel.service", "MainPID") !== "0" || readlinkSync(`/proc/${expected.pid}/cwd`) !== config.retiredRelease ||
      readFileSync(`/proc/${expected.pid}/stat`, "utf8").split(") ").at(-1)!.split(" ")[19] !== expected.startTicks || readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() !== expected.bootId ||
      readFileSync(`${config.retiredRelease}/SOURCE_SHA`, "utf8").trim() !== expected.sourceSha || new Bun.CryptoHasher("sha256").update(readFileSync(`${config.retiredRelease}/.env`)).digest("hex") !== expected.envSha256) throw new Error();
    const rawAuthority = readFileSync(config.authorityFile);
    if (new Bun.CryptoHasher("sha256").update(rawAuthority).digest("hex") !== config.authoritySha256) throw new Error();
    const original = JSON.parse(rawAuthority.toString()), receiptBytes = readFileSync(original.receiptPath);
    if (new Bun.CryptoHasher("sha256").update(receiptBytes).digest("hex") !== original.receiptSha256) throw new Error();
    const handoff = JSON.parse(receiptBytes.toString()); if (handoff.ledger !== original.ledgerPath || handoff.device !== original.device || handoff.inode !== original.inode) throw new Error();
    const stat = statSync(config.ledgerPath); assertOriginalLedger(config.ledgerPath, original, { realpath: realpathSync(config.ledgerPath), device: stat.dev, inode: stat.ino }); if (stat.dev !== expected.ledgerDevice || stat.ino !== expected.ledgerInode) throw new Error();
    const db = new Database(config.ledgerPath, { readonly: true, strict: true }); db.exec("PRAGMA query_only=ON");
    let calls: { publicCalls: number; publicReserved: number; latestPublicAdmission: string | null };
    try { calls = db.query(`SELECT COUNT(*) publicCalls,COALESCE(SUM(CASE WHEN c.state='reserved' THEN 1 ELSE 0 END),0) publicReserved,MAX(h.admitted_at) latestPublicAdmission FROM ai_public_hourly h JOIN ai_calls c ON c.id=h.call_id`).get() as typeof calls; } finally { db.close(); }
    const journal = show("github-factory-web.service", "StandardOutput") === "journal" && ["journal", "inherit"].includes(show("github-factory-web.service", "StandardError"));
    requireFreshRetirementReceipt(JSON.parse(readFileSync(config.receiptPath, "utf8")), expected, { ...expected, ...calls, ...inspectSockets(expected.pid, journal),
      monotonicMs: Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000, wallTimeMs: Date.now(), fenceVerified: true, connectorStopped: true, tunnelConnections: 0 });
    await verifyLiveWorkerAuthority(config, token);
    console.log('{"retirementReceiptStillValid":true}');
  } catch { console.error("Retirement receipt invalid or live work remains; restart rejected"); process.exitCode = 1; }
}
