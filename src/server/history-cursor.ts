import type { WorldIdentity } from "../evidence/contracts";

export interface HistoryCursorClaim { identity: WorldIdentity; generation: string; revision: number }
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid history cursor.");
  const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("Invalid history cursor.");
  return bytes;
}
/** Pure injected-key codec. No environment lookup, default key, provisioner,
 * storage or expiry timer. A stable injected key survives process restarts;
 * identity/revision verification against the current store remains mandatory. */
export class HistoryCursorCodec {
  constructor(private readonly key: CryptoKey) {
    if (!key || key.type !== "secret" || key.extractable || key.algorithm.name !== "HMAC" || (key.algorithm as HmacKeyAlgorithm).hash.name !== "SHA-256" || (key.algorithm as HmacKeyAlgorithm).length < 256 || !key.usages.includes("sign") || !key.usages.includes("verify")) throw new Error("A nonextractable server HMAC key is required.");
  }
  async issue(claim: HistoryCursorClaim): Promise<string> {
    const payload = encoder.encode(JSON.stringify({ v: 1, ...claim }));
    if (payload.length > 1350) throw new Error("History cursor exceeds its bound.");
    const body = encode(payload);
    return body + "." + encode(new Uint8Array(await crypto.subtle.sign("HMAC", this.key, encoder.encode(body))));
  }
  async verify(token: unknown): Promise<HistoryCursorClaim | null> {
    try {
      if (typeof token !== "string" || token.length > 2048) return null;
      const parts = token.split("."); if (parts.length !== 2 || parts[1]!.length !== 43) return null;
      const signature = decode(parts[1]!), body = decode(parts[0]!);
      if (!await crypto.subtle.verify("HMAC", this.key, signature, encoder.encode(parts[0]!))) return null;
      const c = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      if (!c || Object.keys(c).sort().join() !== "generation,identity,revision,v" || c.v !== 1 || !Number.isSafeInteger(c.revision) || c.revision < 0 || typeof c.generation !== "string" || !/^[a-f0-9]{64}$/.test(c.generation)) return null;
      const i = c.identity;
      if (!i || Object.keys(i).sort().join() !== "collectedAt,headSha,repoKey,source" || typeof i.repoKey !== "string" || !/^[a-z0-9-]+\/[a-z0-9_.-]+$/.test(i.repoKey) || typeof i.headSha !== "string" || !/^[a-f0-9]{40}$/.test(i.headSha) || typeof i.collectedAt !== "string" || i.collectedAt.length > 128 || !Number.isFinite(Date.parse(i.collectedAt)) || i.source !== "github") return null;
      return { identity: { repoKey: i.repoKey, headSha: i.headSha, collectedAt: i.collectedAt, source: i.source }, generation: c.generation, revision: c.revision };
    } catch { return null; }
  }
}
