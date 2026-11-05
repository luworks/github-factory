import type { WorkerManagementConfig } from "../../scripts/live-worker-authority";
export const syntheticModule = "// SYNTHETIC module only — Unicode is hashed as exact UTF-8 bytes.\nexport default {};\n";
export function liveAuthorityFixture(options: { kind?: string; multipart?: boolean } = {}) {
  const identity = { databaseId: "11111111-1111-4111-8111-111111111111", bindingNonce: "a".repeat(32), epoch: "b".repeat(32), sourceSha: "c".repeat(40), workerBundleSha256: new Bun.CryptoHasher("sha256").update(syntheticModule).digest("hex"), admissionFenced: true };
  const workerAuthority = { deploymentId: "22222222-2222-4222-8222-222222222222", versionId: "33333333-3333-4333-8333-333333333333", moduleSha256: identity.workerBundleSha256 };
  const config: WorkerManagementConfig = { cloudflareAccountId: "a".repeat(32), workerAuthority, storageIdentity: identity };
  const settings = { bindings: [
    { name: "WORLDS_DB", type: "d1", id: identity.databaseId }, { name: "COMPANY_SITE", type: "service", service: "chaorders-site" },
    { name: "FACTORY_GATEWAY_SECRET", type: "secret_text" }, { name: "FACTORY_STORAGE_SECRET", type: "secret_text" },
    ...Object.entries({ FACTORY_STORAGE_MODE: "worlds", FACTORY_ADMISSION_FENCE: identity.epoch, FACTORY_ORIGIN: "https://github-factory-origin.chaorders.com", FACTORY_SOURCE_SHA: identity.sourceSha, FACTORY_MIGRATION_EPOCH: identity.epoch, FACTORY_WORKER_BUNDLE_SHA256: identity.workerBundleSha256 }).map(([name, text]) => ({ name, type: "plain_text", text })),
  ] };
  const deployment = () => ({ deployments: [{ id: workerAuthority.deploymentId, created_on: "2026-11-04T00:00:00Z", versions: [{ version_id: workerAuthority.versionId, percentage: 100 }] }] });
  const calls: string[] = [];
  const request = (async (url: string | URL | Request) => {
    const path = String(url).split("/github-factory-gateway")[1]; calls.push(path);
    if (options.kind === "network-error") throw new Error("SYNTHETIC unavailable");
    if (path === "/deployments") {
      const data = deployment(), nth = calls.filter((p) => p === path).length;
      if (options.kind === "split") data.deployments[0].versions = [{ version_id: workerAuthority.versionId, percentage: 50 }, { version_id: "f".repeat(36), percentage: 50 }];
      if (options.kind === "version" || options.kind === "during-deployment" && nth === 2) data.deployments[0].versions[0].version_id = "44444444-4444-4444-8444-444444444444";
      if (options.kind === "deployment") data.deployments[0].id = "44444444-4444-4444-8444-444444444444";
      return Response.json({ success: true, result: data });
    }
    if (path === "/settings") {
      const data = structuredClone(settings), nth = calls.filter((p) => p === path).length;
      if (options.kind === "physical-db" || options.kind === "during-settings" && nth === 2) (data.bindings[0] as { id: string }).id = "44444444-4444-4444-8444-444444444444";
      return Response.json({ success: true, result: data });
    }
    if (path !== "") throw new Error("Undeclared network read");
    if (options.kind === "unknown-format") return new Response(syntheticModule, { headers: { "content-type": "text/plain" } });
    if (options.multipart || options.kind === "duplicate-module") {
      const part = '--fixture\r\nContent-Disposition: form-data; name="gateway.mjs"; filename="gateway.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n' + syntheticModule + '\r\n';
      return new Response(part + (options.kind === "duplicate-module" ? part : "") + '--fixture--\r\n', { headers: { "content-type": 'multipart/form-data; boundary="fixture"' } });
    }
    return new Response(options.kind === "module" ? "// different module" : syntheticModule, { headers: { "content-type": "application/javascript+module" } });
  }) as typeof fetch;
  return { config, request, calls, settings, deployment };
}
