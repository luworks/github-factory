import type { StorageIdentity } from "../deploy/migration-contract";
export interface WorkerBindingAuthority { databaseId: string; mode: string; fence: string; origin: string; companyService: string; sourceSha: string; epoch: string; bundleSha256: string }
/** This input must be fetched from the current Cloudflare Worker settings API,
 * independently of D1/RPC rows. Copied database identity/content is insufficient. */
export function readWorkerBindingAuthority(settings: any): WorkerBindingAuthority {
  if (!settings || !Array.isArray(settings.bindings)) throw new Error("Actual Worker settings unavailable");
  const pick = (name: string, type: string) => {
    const matches = settings.bindings.filter((binding: any) => binding?.name === name);
    if (matches.length !== 1 || matches[0].type !== type) throw new Error("Missing/duplicate/wrong Worker binding"); return matches[0];
  };
  pick("FACTORY_GATEWAY_SECRET", "secret_text"); pick("FACTORY_STORAGE_SECRET", "secret_text");
  return { databaseId: pick("WORLDS_DB", "d1").id, mode: pick("FACTORY_STORAGE_MODE", "plain_text").text,
    fence: pick("FACTORY_ADMISSION_FENCE", "plain_text").text, origin: pick("FACTORY_ORIGIN", "plain_text").text,
    companyService: pick("COMPANY_SITE", "service").service, sourceSha: pick("FACTORY_SOURCE_SHA", "plain_text").text,
    epoch: pick("FACTORY_MIGRATION_EPOCH", "plain_text").text, bundleSha256: pick("FACTORY_WORKER_BUNDLE_SHA256", "plain_text").text };
}
export function requireWorkerBindingAuthority(settings: unknown, expected: StorageIdentity) {
  const actual = readWorkerBindingAuthority(settings);
  if (actual.databaseId !== expected.databaseId || actual.mode !== "worlds" || actual.fence !== expected.epoch || actual.origin !== "https://github-factory-origin.chaorders.com" || actual.companyService !== "chaorders-site" || actual.sourceSha !== expected.sourceSha || actual.epoch !== expected.epoch || actual.bundleSha256 !== expected.workerBundleSha256)
    throw new Error("Actual physical Worker binding or configuration differs");
  return actual;
}
