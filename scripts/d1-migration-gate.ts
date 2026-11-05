import { assertIdentity, assertMigrationRows, sha256, stableJson, validateExport, type MigrationData, type StorageIdentity, type WorldExport } from "../deploy/migration-contract";
export interface MigrationGateInput {
  source: WorldExport; expectedIdentity: StorageIdentity;
  admin: MigrationData & { databaseId: string; bindingNonce: string; apiDatabaseId: string };
  rpc: MigrationData & { identity: StorageIdentity };
  candidateSha: string; actualWorkerBundleSha256: string;
  activeEnvSha256: string; targetConfigSha256: string; epoch: string;
}
/** Pure gate, invoked afresh before select, HOLD release AND edge fence release.
 * Cached receipts alone are never an authorization to change the backend. */
export async function verifyMigrationGate(input: MigrationGateInput, now = Date.now()) {
  const source = await validateExport(input.source);
  assertIdentity(input.rpc.identity, input.expectedIdentity);
  const identity = input.expectedIdentity;
  if (source.sourceHead !== input.candidateSha || identity.sourceSha !== input.candidateSha || identity.epoch !== input.epoch ||
    input.admin.apiDatabaseId !== identity.databaseId || input.admin.databaseId !== identity.databaseId || input.admin.bindingNonce !== identity.bindingNonce ||
    input.actualWorkerBundleSha256 !== identity.workerBundleSha256 || !/^[a-f0-9]{64}$/.test(input.activeEnvSha256) || !/^[a-f0-9]{64}$/.test(input.targetConfigSha256)) throw new Error("Candidate, database or configuration identity mismatch");
  await assertMigrationRows(input.admin, source); await assertMigrationRows(input.rpc, source);
  return { verifiedAtMs: now, expiresAtMs: now + 30_000, candidateSha: input.candidateSha, exportSha256: source.sourceSha256,
    migrationId: source.migrationId, worldCount: source.worlds.length, aliasCount: source.aliases.length, identity,
    activeEnvSha256: input.activeEnvSha256, targetConfigSha256: input.targetConfigSha256, proofSha256: await sha256(stableJson(input)), adminAndFullRpcVerified: true };
}
export function requireFreshMigrationReceipt(receipt: Awaited<ReturnType<typeof verifyMigrationGate>>, expected: Pick<MigrationGateInput, "candidateSha" | "activeEnvSha256" | "targetConfigSha256" | "expectedIdentity"> & { exportSha256: string }, now = Date.now()) {
  if (!receipt || receipt.adminAndFullRpcVerified !== true || receipt.verifiedAtMs > now || receipt.expiresAtMs <= now || now - receipt.verifiedAtMs > 30_000 || receipt.expiresAtMs - receipt.verifiedAtMs > 30_000 ||
    receipt.candidateSha !== expected.candidateSha || receipt.exportSha256 !== expected.exportSha256 || receipt.activeEnvSha256 !== expected.activeEnvSha256 || receipt.targetConfigSha256 !== expected.targetConfigSha256) throw new Error("Stale or wrong migration receipt");
  assertIdentity(receipt.identity, expected.expectedIdentity);
}
if (import.meta.main) {
  try {
    const text = await Bun.stdin.text(); if (Buffer.byteLength(text) > 12 * 1024 * 1024) throw new Error("Gate input too large");
    const value = JSON.parse(text);
    if (value.command === "verify-receipt") { requireFreshMigrationReceipt(value.receipt, value.expected); console.log('{"accepted":true}'); }
    else console.log(JSON.stringify(await verifyMigrationGate(value)));
  } catch { console.error("Migration gate rejected: missing, mismatched or stale authority evidence"); process.exitCode = 1; }
}
