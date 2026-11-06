import { assertIdentity, stableJson, type StorageIdentity } from "../deploy/migration-contract";
import { requireWorkerBindingAuthority } from "./worker-binding-authority";
import { selectCurrentWorkerDeployment } from "./deployment-chronology";
export interface WorkerDeploymentIdentity { deploymentId: string; versionId: string; moduleSha256: string }
export interface WorkerManagementConfig { cloudflareAccountId: string; workerAuthority: WorkerDeploymentIdentity; storageIdentity: StorageIdentity }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
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
  const first = selectCurrentWorkerDeployment(await json("/deployments"));
  if (first.deploymentId !== config.workerAuthority.deploymentId || first.versionId !== config.workerAuthority.versionId) throw new Error("Worker deployment/version changed");
  const bindings = requireWorkerBindingAuthority(await json("/settings"), config.storageIdentity);
  const moduleSha256 = await moduleHash(await read(""));
  if (moduleSha256 !== config.workerAuthority.moduleSha256) throw new Error("Actual Worker module changed");
  const last = selectCurrentWorkerDeployment(await json("/deployments"));
  const lastBindings = requireWorkerBindingAuthority(await json("/settings"), config.storageIdentity);
  if (stableJson(first) !== stableJson(last) || stableJson(bindings) !== stableJson(lastBindings)) throw new Error("Worker changed during authority observation");
  return { ...first, moduleSha256, bindings };
}
