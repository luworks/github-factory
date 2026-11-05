import { expect, test } from "bun:test";
import { evaluateRetirement, inspectSockets, type RetirementIdentity, type RetirementObservation } from "../scripts/retirement-guard";
const identity: RetirementIdentity = { pid: 123, startTicks: "456", bootId: "synthetic-boot", sourceSha: "a".repeat(40), envSha256: "b".repeat(64), protectedPid: 777, ledgerDevice: 1, ledgerInode: 2, epoch: "c".repeat(32) };
const sample = (monotonicMs: number, extra: Partial<RetirementObservation> = {}): RetirementObservation => ({ ...identity, monotonicMs, wallTimeMs: monotonicMs + 100_000, fenceVerified: true, connectorStopped: true, tunnelConnections: 0, activeSockets: [], unknownSockets: [], inboundSockets: 0, publicReserved: 0, publicCalls: 5, latestPublicAdmission: null, ...extra });
test("SYNTHETIC retirement rejects instant zero/new-process counters and requires 240s plus 30s continuous quiet", () => {
  let result = evaluateRetirement(null, sample(0), identity); expect(result.ready).toBe(false);
  result = evaluateRetirement(result.state, sample(239_999), identity); expect(result.ready).toBe(false);
  result = evaluateRetirement(result.state, sample(240_000, { publicReserved: 1 }), identity); expect(result.ready).toBe(false);
  result = evaluateRetirement(result.state, sample(250_000), identity); expect(result.ready).toBe(false);
  result = evaluateRetirement(result.state, sample(275_000), identity); expect(result.ready).toBe(false);
  for (let time = 277_000; time <= 307_000; time += 2000) result = evaluateRetirement(result.state, sample(time), identity);
  expect(result.ready).toBe(true);
  result = evaluateRetirement(result.state, sample(308_000, { publicCalls: 6, latestPublicAdmission: "synthetic-late-admission" }), identity); expect(result.ready).toBe(false);
});
test("SYNTHETIC retirement fails closed for slow accepted input, active IPv6 work, unknown sockets, reconnect, identity drift or lost fence", () => {
  for (const extra of [{ inboundSockets: 1 }, { unknownSockets: ["unclassified"] }, { fenceVerified: false }, { connectorStopped: false }, { tunnelConnections: 1 }, { pid: 124 }, { protectedPid: 778 }, { startTicks: "new" }, { ledgerInode: 3 }, { bootId: "reboot" }]) expect(() => evaluateRetirement(null, sample(0, extra), identity)).toThrow();
  const initial = evaluateRetirement(null, sample(0), identity);
  const active = evaluateRetirement(initial.state, sample(240_000, { activeSockets: ["tcp6:outgoing:01"] }), identity); expect(active.ready).toBe(false);
});
test("SYNTHETIC socket scan recognizes IPv6 and allows only the exact inherited journald UNIX inode", () => {
  const links = new Map([["1", "socket:[10]"], ["2", "socket:[10]"], ["6", "socket:[20]"], ["7", "socket:[30]"], ["8", "socket:[40]"], ["9", "socket:[50]"]]);
  const empty = "header\n";
  const files: Record<string, string> = {
    tcp: empty + "0: 0100007F:1051 00000000:0000 0A 0 0 0 1000 0 20\n",
    tcp6: empty + "0: 00000000000000000000000001000000:FFFF 00000000000000000000000002000000:01BB 01 0 0 0 1000 0 30\n",
    unix: empty + "0: 3 0 0 0001 03 10\n0: 3 0 0 0001 03 40\n",
  };
  const scan = inspectSockets(123, true, (path) => files[path.split("/").at(-1)!] ?? empty, links);
  expect(scan.allowedJournalInode).toBe("10"); expect(scan.activeSockets).toEqual(["tcp6:30:01", "unix:40:03"]); expect(scan.unknownSockets).toEqual(["50"]);
  expect(inspectSockets(123, false, (path) => files[path.split("/").at(-1)!] ?? empty, links).activeSockets).toContain("unix:10:03");
});

test("SYNTHETIC post-drain receipt expires and new work invalidates restart", async () => {
  const { requireFreshRetirementReceipt } = await import("../scripts/retirement-guard");
  let verdict = evaluateRetirement(null, sample(0), identity);
  for (let time = 2000; time <= 240_000; time += 2000) verdict = evaluateRetirement(verdict.state, sample(time), identity);
  const receipt = { identity, verifiedAtMs: 1_000_000, expiresAtMs: 1_030_000, verdict };
  expect(() => requireFreshRetirementReceipt(receipt, identity, sample(242_000), 1_000_100)).not.toThrow();
  expect(() => requireFreshRetirementReceipt(receipt, identity, sample(242_000), 1_030_000)).toThrow();
  expect(() => requireFreshRetirementReceipt(receipt, identity, sample(242_000, { publicReserved: 1 }), 1_000_100)).toThrow();
});

test("SYNTHETIC retirement cannot promote the current env ledger/copy/symlink to original authority", async () => {
  const { assertOriginalLedger } = await import("../scripts/retirement-guard");
  const original = { ledgerPath: "/synthetic/original.sqlite", ledgerRealpath: "/synthetic/original.sqlite", device: 1, inode: 2, receiptPath: "/synthetic/old-receipt.json", receiptSha256: "a".repeat(64) };
  expect(() => assertOriginalLedger(original.ledgerPath, original, { realpath: original.ledgerRealpath, device: 1, inode: 2 })).not.toThrow();
  for (const [path, actual] of [["/synthetic/copied.sqlite", { realpath: "/synthetic/copied.sqlite", device: 1, inode: 99 }], [original.ledgerPath, { realpath: original.ledgerRealpath, device: 1, inode: 99 }], ["/synthetic/alias.sqlite", { realpath: original.ledgerRealpath, device: 1, inode: 2 }], [original.ledgerPath, { realpath: "/synthetic/replaced.sqlite", device: 1, inode: 2 }]] as const) expect(() => assertOriginalLedger(path, original, actual)).toThrow();
});
