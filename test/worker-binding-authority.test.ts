import { expect, test } from "bun:test";
import { requireWorkerBindingAuthority } from "../scripts/worker-binding-authority";
const expected = { databaseId: "11111111-1111-4111-8111-111111111111", bindingNonce: "a".repeat(32), sourceSha: "b".repeat(40), epoch: "c".repeat(32), workerBundleSha256: "d".repeat(64), admissionFenced: true };
function settings() { return { bindings: [
  { name: "WORLDS_DB", type: "d1", id: expected.databaseId }, { name: "COMPANY_SITE", type: "service", service: "chaorders-site" },
  { name: "FACTORY_GATEWAY_SECRET", type: "secret_text" }, { name: "FACTORY_STORAGE_SECRET", type: "secret_text" },
  ...Object.entries({ FACTORY_STORAGE_MODE: "worlds", FACTORY_ADMISSION_FENCE: expected.epoch, FACTORY_ORIGIN: "https://github-factory-origin.chaorders.com", FACTORY_SOURCE_SHA: expected.sourceSha, FACTORY_MIGRATION_EPOCH: expected.epoch, FACTORY_WORKER_BUNDLE_SHA256: expected.workerBundleSha256 }).map(([name, text]) => ({ name, type: "plain_text", text })),
] }; }
test("SYNTHETIC actual physical binding and current Worker configuration cannot be replaced by copied database metadata", () => {
  expect(requireWorkerBindingAuthority(settings(), expected).databaseId).toBe(expected.databaseId);
  for (const name of ["WORLDS_DB", "COMPANY_SITE", "FACTORY_GATEWAY_SECRET", "FACTORY_STORAGE_SECRET", "FACTORY_STORAGE_MODE", "FACTORY_ADMISSION_FENCE", "FACTORY_ORIGIN", "FACTORY_SOURCE_SHA", "FACTORY_MIGRATION_EPOCH", "FACTORY_WORKER_BUNDLE_SHA256"]) {
    const absent = settings(); absent.bindings = absent.bindings.filter((binding) => binding.name !== name); expect(() => requireWorkerBindingAuthority(absent, expected)).toThrow();
    const duplicate = settings(); duplicate.bindings.push(duplicate.bindings.find((binding) => binding.name === name)!); expect(() => requireWorkerBindingAuthority(duplicate, expected)).toThrow();
  }
  for (const [name, value] of [["WORLDS_DB", "22222222-2222-4222-8222-222222222222"], ["COMPANY_SITE", "other-company"], ["FACTORY_STORAGE_MODE", "probe-only"], ["FACTORY_ADMISSION_FENCE", "false"], ["FACTORY_ORIGIN", "https://other.example"], ["FACTORY_SOURCE_SHA", "e".repeat(40)], ["FACTORY_MIGRATION_EPOCH", "e".repeat(32)], ["FACTORY_WORKER_BUNDLE_SHA256", "e".repeat(64)]]) {
    const changed = settings(); const binding = changed.bindings.find((b) => b.name === name)! as any;
    if (name === "WORLDS_DB") binding.id = value; else if (name === "COMPANY_SITE") binding.service = value; else binding.text = value;
    expect(() => requireWorkerBindingAuthority(changed, expected)).toThrow();
  }
});
