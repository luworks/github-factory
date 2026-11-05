import { readdirSync, readFileSync, readlinkSync } from "node:fs";
export interface RetirementIdentity { pid: number; startTicks: string; bootId: string; sourceSha: string; envSha256: string; protectedPid: number; ledgerDevice: number; ledgerInode: number; epoch: string }
export interface RetirementObservation extends RetirementIdentity {
  monotonicMs: number; wallTimeMs: number; fenceVerified: boolean; connectorStopped: boolean; tunnelConnections: number;
  activeSockets: string[]; unknownSockets: string[]; inboundSockets: number;
  publicReserved: number; publicCalls: number; latestPublicAdmission: string | null;
}
export interface RetirementState { inputClosedAtMs: number; quietSinceMs: number | null; lastSampleMs: number; admissionSignature: string }
export function evaluateRetirement(previous: RetirementState | null, sample: RetirementObservation, expected: RetirementIdentity) {
  for (const key of Object.keys(expected) as (keyof RetirementIdentity)[]) if (sample[key] !== expected[key]) throw new Error(`Retiring identity changed: ${key}`);
  if (!sample.fenceVerified || !sample.connectorStopped || sample.tunnelConnections !== 0 || sample.unknownSockets.length || !Number.isFinite(sample.monotonicMs) ||
      !Number.isInteger(sample.publicReserved) || sample.publicReserved < 0 || !Number.isInteger(sample.publicCalls) || sample.publicCalls < 0) throw new Error("Retirement evidence unknown or admission remains open");
  if (previous && sample.monotonicMs < previous.lastSampleMs) throw new Error("Monotonic clock moved backwards");
  if (sample.inboundSockets !== 0) throw new Error("Accepted input socket remains; slow body not drained");
  const admissionSignature = `${sample.publicCalls}:${sample.latestPublicAdmission}`;
  const quiet = sample.activeSockets.length === 0 && sample.publicReserved === 0;
  const continuous = previous && sample.monotonicMs - previous.lastSampleMs <= 5000;
  const state: RetirementState = {
    inputClosedAtMs: previous?.inputClosedAtMs ?? sample.monotonicMs,
    quietSinceMs: quiet ? continuous && previous?.admissionSignature === admissionSignature && previous.quietSinceMs !== null ? previous.quietSinceMs : sample.monotonicMs : null,
    lastSampleMs: sample.monotonicMs, admissionSignature,
  };
  const ready = sample.monotonicMs - state.inputClosedAtMs >= 240_000 && state.quietSinceMs !== null && sample.monotonicMs - state.quietSinceMs >= 30_000;
  return { state, ready, inputClosedForMs: sample.monotonicMs - state.inputClosedAtMs, quietForMs: state.quietSinceMs === null ? 0 : sample.monotonicMs - state.quietSinceMs };
}
export interface SocketScan { activeSockets: string[]; unknownSockets: string[]; inboundSockets: number; allowedJournalInode: string | null }
/** Includes IPv4/IPv6 TCP/UDP/raw and UNIX. Only the exact journald stream
 * inherited as BOTH stdout/stderr can be ignored; unknown socket families fail. */
export function inspectSockets(pid: number, journalOutputVerified: boolean, read = (path: string) => readFileSync(path, "utf8"), links?: Map<string, string>): SocketScan {
  const descriptors = links ?? new Map(readdirSync(`/proc/${pid}/fd`).flatMap((fd) => {
    try { return [[fd, readlinkSync(`/proc/${pid}/fd/${fd}`)]] as [string, string][]; } catch (error) { if ((error as { code?: string }).code === "ENOENT") return []; throw error; }
  }));
  const inodes = new Set([...descriptors.values()].map((value) => value.match(/^socket:\[(\d+)\]$/)?.[1]).filter((x): x is string => !!x));
  const known = new Map<string, { family: string; state: string; localPort?: number; unixType?: string }>();
  for (const family of ["tcp", "tcp6", "udp", "udp6", "raw", "raw6", "udplite", "udplite6"]) {
    let body: string;
    try { body = read(`/proc/${pid}/net/${family}`); } catch (error) { if ((error as { code?: string }).code === "ENOENT" && !["tcp", "tcp6", "udp", "udp6"].includes(family)) continue; throw error; }
    for (const line of body.split("\n").slice(1)) {
      const columns = line.trim().split(/\s+/); if (columns.length < 10) continue;
      const inode = columns[9]; if (inodes.has(inode)) known.set(inode, { family, state: columns[3], localPort: parseInt(columns[1].split(":")[1], 16) });
    }
  }
  for (const line of read(`/proc/${pid}/net/unix`).split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/); if (columns.length >= 7 && inodes.has(columns[6])) known.set(columns[6], { family: "unix", state: columns[5], unixType: columns[4] });
  }
  const journal = descriptors.get("1") === descriptors.get("2") && journalOutputVerified ? descriptors.get("1")?.match(/^socket:\[(\d+)\]$/)?.[1] ?? null : null;
  const allowedJournalInode = journal && known.get(journal)?.family === "unix" && known.get(journal)?.unixType === "0001" ? journal : null;
  const activeSockets: string[] = [], unknownSockets: string[] = []; let inboundSockets = 0;
  for (const inode of inodes) {
    const info = known.get(inode);
    if (!info) { unknownSockets.push(inode); continue; }
    if (inode === allowedJournalInode) continue;
    if (["tcp", "tcp6"].includes(info.family) && info.state === "0A" && info.localPort === 4177) continue;
    activeSockets.push(`${info.family}:${inode}:${info.state}`);
    if (info.localPort === 4177 && info.state !== "0A") inboundSockets++;
  }
  return { activeSockets, unknownSockets, inboundSockets, allowedJournalInode };
}
