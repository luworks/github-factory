import { captureClientFixture } from "./capture-client";
import { WORLD_CAPTURE_RPC_URL } from "../../src/server/world-capture-rpc-contract";
import type { Fetcher } from "../../src/server/github";

/** Synthetic authority only; never read an operator key, env, DB or ledger. */
export const assemblyEnv = () => ({
  MOONSHOT_WORLD_CAPTURE_ENABLED: "true", MOONSHOT_WORLD_CAPTURE_SCHEMA_VERSION: "4", MOONSHOT_WORLD_STORE: "d1",
  MOONSHOT_WORLD_CAPTURE_KEY_HEX: "29".repeat(32), MOONSHOT_WORLD_CAPTURE_BINDING_NONCE: "2".repeat(32), MOONSHOT_WORLD_CAPTURE_EPOCH: "3".repeat(32),
  MOONSHOT_D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111", MOONSHOT_D1_STORAGE_URL: WORLD_CAPTURE_RPC_URL,
  MOONSHOT_D1_STORAGE_SECRET: "SYNTHETIC-client-storage-credential-at-least-32",
});
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void;
  return { promise: new Promise<T>((a, b) => { resolve = a; reject = b; }), resolve: (value: T) => resolve(value), reject };
}
export async function assemblyFixture() {
  const f = await captureClientFixture(), calls: string[] = [];
  let privacy = false;
  const source = "Synthetic/MiXeD", input = "synthetic/unknown", head = "a".repeat(40), tree = "b".repeat(40);
  const network: Fetcher = async (target, init) => {
    if (String(target) === WORLD_CAPTURE_RPC_URL) return f.network(target, init);
    const url = new URL(String(target)); if (url.origin !== "https://api.github.com") throw Error("SYNTHETIC assembly fixed targets only");
    calls.push(url.href);
    if (url.pathname === `/repos/${input}`) return new Response(null, { status: 301, headers: { location: `https://api.github.com/repos/${source}` } });
    if (url.pathname.toLowerCase() === "/repos/synthetic/mixed") return Response.json({ private: privacy, visibility: privacy ? "private" : "public", full_name: source, id: 123, default_branch: "main", description: "SYNTHETIC 原始 source spelling", language: "TypeScript", license: { spdx_id: "NOASSERTION" } });
    if (url.pathname.endsWith("/git/ref/heads/main")) return Response.json({ object: { type: "commit", sha: head } });
    if (url.pathname.endsWith(`/git/commits/${head}`)) return Response.json({ sha: head, tree: { sha: tree } });
    if (url.pathname.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ path: "package.json", type: "blob", sha: tree }, { path: "src/index.ts", type: "blob", sha: tree }] });
    if (url.pathname.endsWith("/languages")) return Response.json({ TypeScript: 20 });
    if (url.pathname.includes("/contents/")) return Response.json({ type: "file", encoding: "base64", size: 2, content: btoa("{}") });
    if (url.pathname.endsWith("/actions/runs")) return Response.json({ workflow_runs: [] });
    return Response.json([]);
  };
  return { ...f, network, githubCalls: calls, source, input, head, privacy(value: boolean) { privacy = value; } };
}
