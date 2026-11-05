import { assertIdentity, stableJson, type StorageIdentity } from "../deploy/migration-contract";
import { requireWorkerBindingAuthority } from "./worker-binding-authority";
export interface WorkerDeploymentIdentity { deploymentId: string; versionId: string; moduleSha256: string }
export interface WorkerManagementConfig { cloudflareAccountId: string; workerAuthority: WorkerDeploymentIdentity; storageIdentity: StorageIdentity }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
function currentDeployment(value: any) {
  if (!value || !Array.isArray(value.deployments) || !value.deployments.length) throw new Error("Current Worker deployment unavailable");
  const rows = [...value.deployments];
  if (rows.some((row) => !Number.isFinite(Date.parse(row?.created_on)))) throw new Error("Worker deployment chronology unknown");
  rows.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  if (rows.length > 1 && rows[0].created_on === rows[1].created_on && rows[0].id !== rows[1].id) throw new Error("Ambiguous current Worker deployment");
  const active = rows[0];
  if (!uuid(active.id) || !Array.isArray(active.versions) || active.versions.length !== 1 || active.versions[0]?.percentage !== 100 || !uuid(active.versions[0].version_id)) throw new Error("Worker must have a single known 100% version");
  return { deploymentId: active.id, versionId: active.versions[0].version_id };
}
async function moduleHash(response: Response) {
  const type = response.headers.get("content-type") || "", body = Buffer.from(await response.arrayBuffer());
  if (/^(application|text)\/javascript(?:\+module)?(?:\s*;|$)/i.test(type)) return new Bun.CryptoHasher("sha256").update(body).digest("hex");
  const boundary = type.match(/^multipart\/[^;]+;.*?boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundary) throw new Error("Unknown Worker module format");
  const marker = Buffer.from("--" + (boundary[1] || boundary[2])), modules: Buffer[] = [];
  let start = body.indexOf(marker);
  while (start >= 0) {
    const next = body.indexOf(marker, start + marker.length); if (next < 0) break;
    const headerEnd = body.indexOf("\r\n\r\n", start + marker.length);
    if (headerEnd >= 0 && headerEnd < next) {
      const headers = body.subarray(start + marker.length, headerEnd).toString("utf8");
      if (/content-disposition:[^\r\n]*\b(?:name|filename)="gateway\.mjs"/i.test(headers)) {
        if (body.subarray(next - 2, next).toString() !== "\r\n") throw new Error("Malformed Worker module part");
        modules.push(body.subarray(headerEnd + 4, next - 2));
      }
    }
    start = next;
  }
  if (modules.length !== 1) throw new Error("Actual Worker module unavailable or duplicated");
  return new Bun.CryptoHasher("sha256").update(modules[0]).digest("hex");
}
/** Fresh independent management evidence. RPC status can never substitute for
 * physical bindings, single-version traffic or actual deployed module bytes.
 * The second deployment/settings read rejects drift during the observation. */
export async function verifyLiveWorkerAuthority(config: WorkerManagementConfig, token: string, request: typeof fetch = fetch) {
  assertIdentity(config.storageIdentity, config.storageIdentity);
  if (!/^[a-f0-9]{32}$/.test(config.cloudflareAccountId) || !token || !config.workerAuthority || !uuid(config.workerAuthority.deploymentId) || !uuid(config.workerAuthority.versionId) || config.workerAuthority.moduleSha256 !== config.storageIdentity.workerBundleSha256) throw new Error("Unknown Worker management authority");
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/workers/scripts/github-factory-gateway`;
  const read = async (suffix: string) => {
    const response = await request(url + suffix, { headers: { authorization: `Bearer ${token}`, connection: "close" }, signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) throw new Error("Worker management evidence unavailable");
    return response;
  };
  const json = async (suffix: string) => { const body = await (await read(suffix)).json() as any; if (body?.success !== true) throw new Error("Worker management evidence rejected"); return body.result; };
  const first = currentDeployment(await json("/deployments"));
  if (first.deploymentId !== config.workerAuthority.deploymentId || first.versionId !== config.workerAuthority.versionId) throw new Error("Worker deployment/version changed");
  const bindings = requireWorkerBindingAuthority(await json("/settings"), config.storageIdentity);
  const moduleSha256 = await moduleHash(await read(""));
  if (moduleSha256 !== config.workerAuthority.moduleSha256) throw new Error("Actual Worker module changed");
  const last = currentDeployment(await json("/deployments"));
  const lastBindings = requireWorkerBindingAuthority(await json("/settings"), config.storageIdentity);
  if (stableJson(first) !== stableJson(last) || stableJson(bindings) !== stableJson(lastBindings)) throw new Error("Worker changed during authority observation");
  return { ...first, moduleSha256, bindings };
}
