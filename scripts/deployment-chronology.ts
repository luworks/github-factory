/** Cloudflare deployment chronology, shared semantic contract with the private
 * Python operations helper. RFC3339, explicit known offset, <=9 fraction digits;
 * retain nanoseconds rather than truncating precision through Date.parse.
 * Operational range: 2000-01-01 onward, at most five minutes ahead of this host.
 * Unsupported leap seconds/unknown -00:00 offsets fail closed. */
export function deploymentInstant(value: unknown, nowMs = Date.now()): bigint {
  if (typeof value !== "string" || !Number.isSafeInteger(nowMs)) throw new Error("Invalid deployment chronology");
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
  if (!match || match[0] !== value || match[8] === "-00:00") throw new Error("Invalid deployment chronology");
  const [year, month, day, hour, minute, second] = match.slice(1,7).map(Number);
  const local = Date.UTC(year,month-1,day,hour,minute,second), date = new Date(local);
  if (year < 2000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) throw new Error("Invalid deployment chronology");
  const zone = match[8], offsetHours = zone === "Z" ? 0 : Number(zone.slice(1,3)), offsetMinutes = zone === "Z" ? 0 : Number(zone.slice(4,6));
  if (offsetHours > 14 || offsetMinutes > 59 || offsetHours === 14 && offsetMinutes !== 0) throw new Error("Invalid deployment timezone");
  const offset = (offsetHours * 60 + offsetMinutes) * (zone[0] === "-" ? -1 : 1);
  const instant = BigInt(local - offset * 60_000) * 1_000_000n + BigInt((match[7] || "").padEnd(9,"0"));
  if (instant < 946684800000000000n || instant > BigInt(Math.trunc(nowMs) + 300_000) * 1_000_000n) throw new Error("Unreasonable deployment chronology");
  return instant;
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
export function selectCurrentWorkerDeployment(value: any, nowMs = Date.now()) {
  if (!value || !Array.isArray(value.deployments) || !value.deployments.length || value.deployments.length > 1000) throw new Error("Current Worker deployment unavailable");
  const instants = new Set<bigint>(), ids = new Set<string>();
  const rows = value.deployments.map((row: any) => {
    const instant = deploymentInstant(row?.created_on,nowMs);
    if (!uuid(row?.id) || ids.has(row.id) || instants.has(instant)) throw new Error("Ambiguous or conflicting deployment chronology");
    ids.add(row.id); instants.add(instant); return { row, instant };
  });
  rows.sort((a: any,b: any) => a.instant > b.instant ? -1 : 1);
  const active = rows[0].row;
  if (!Array.isArray(active.versions) || active.versions.length !== 1 || active.versions[0]?.percentage !== 100 || !uuid(active.versions[0].version_id)) throw new Error("Worker must have a single known 100% version");
  return { deploymentId: active.id as string, versionId: active.versions[0].version_id as string };
}
