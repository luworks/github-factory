import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ClientQuota, clientIdentity } from "../src/server/access";
import { actionRequest, repositoryRequest } from "../src/server/http";
import { GitHubClient, parseRepo } from "../src/server/github";
import { WorldStore } from "../src/server/store";
import { createWorldService } from "../src/server/service";
import { syntheticWorld } from "./fixtures/browser-world";

const secret = "synthetic-origin-authentication-key-32-chars";
const request = (headers: Record<string, string>) => new Request("https://origin.example/github-factory/api/worlds", { headers });
test("only an authenticated gateway can assert a public client identity", () => {
  const config = { secret, publicOrigin: "https://chaorders.com" };
  expect(() => clientIdentity(request({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.1", "x-factory-client-ip": "192.0.2.1" }), config)).toThrow("public application");
  expect(() => clientIdentity(request({ "x-factory-gateway-key": "forged", "x-factory-client-ip": "192.0.2.1" }), config)).toThrow("public application");
  expect(() => clientIdentity(request({ "x-factory-gateway-key": secret, "x-factory-client-ip": "192.0.2.1,192.0.2.2" }), config)).toThrow("verified client");
  const a = clientIdentity(request({ "x-factory-gateway-key": secret, "x-factory-client-ip": "192.0.2.1" }), config);
  const b = clientIdentity(request({ "x-factory-gateway-key": secret, "x-factory-client-ip": "192.0.2.1", "x-forwarded-for": "198.51.100.2" }), config);
  expect(a).toBe(b);
  expect(a).not.toContain("192.0.2.1");
  expect(clientIdentity(request({ "x-factory-gateway-key": secret, "x-factory-client-ip": "::ffff:192.0.2.1" }), config)).toBe(a);
  expect(() => clientIdentity(request({}), { secret: "", publicOrigin: config.publicOrigin })).toThrow("not configured");
});

test("per-IP quotas survive reopening and independently cap collection and AI", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-ip-quota-")), path = join(dir, "quota.sqlite");
  let now = 3_600_000;
  const limits = { requestsPerMinute: 2, collectionsPerHour: 1, aiPerHour: 1 };
  const first = new ClientQuota(path, limits, () => now);
  first.take("synthetic-ip-hash", "collection"); first.close();
  const next = new ClientQuota(path, limits, () => now);
  try {
    expect(() => next.take("synthetic-ip-hash", "collection")).toThrow("allowance");
    next.take("another-ip-hash", "collection"); next.take("synthetic-ip-hash", "ai");
    expect(() => next.take("synthetic-ip-hash", "ai")).toThrow("AI analysis allowance");
    next.take("synthetic-ip-hash", "request"); next.take("synthetic-ip-hash", "request");
    expect(() => next.take("synthetic-ip-hash", "request")).toThrow("allowance");
    now += 3_600_000; next.take("synthetic-ip-hash", "collection");
  } finally { next.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent processes cannot exceed a shared IP collection allowance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-ip-race-")), path = join(dir, "quota.sqlite");
  const limits = { requestsPerMinute: 10, collectionsPerHour: 7, aiPerHour: 2 };
  new ClientQuota(path, limits).close();
  const module = resolve("src/server/access.ts");
  const script = `import {ClientQuota} from ${JSON.stringify(module)};const q=new ClientQuota(${JSON.stringify(path)},${JSON.stringify(limits)},()=>3600000);let n=0;for(let i=0;i<8;i++){try{q.take("one-shared-ip","collection");n++;}catch(e){if(e.code!=="IP_RATE_LIMIT")throw e;}}q.close();console.log(n);`;
  try {
    const processes = Array.from({ length: 5 }, () => Bun.spawn([process.execPath, "--no-env-file", "-e", script], { stdout: "pipe", stderr: "pipe" }));
    const results = await Promise.all(processes.map(async (p) => ({ code: await p.exited, output: await new Response(p.stdout).text(), error: await new Response(p.stderr).text() })));
    expect(results.map((r) => ({ code: r.code, error: r.error }))).toEqual(results.map(() => ({ code: 0, error: "" })));
    expect(results.reduce((n, r) => n + Number(r.output.trim()), 0)).toBe(7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("rotating IPs share one global AI allowance without burning denied IP admissions", () => {
  const quota = new ClientQuota(":memory:", { requestsPerMinute: 10, collectionsPerHour: 6, aiPerHour: 1, aiGlobalPerHour: 2 }, () => 3_600_000);
  try {
    quota.takeAi("one"); quota.takeAi("two");
    expect(() => quota.takeAi("three")).toThrow("public AI analysis allowance");
    // If the failed two-quota transaction consumed the IP slot this would fail.
    expect(() => quota.take("three", "ai")).not.toThrow();
    expect(() => quota.takeAi("one")).toThrow("client has reached");
  } finally { quota.close(); }
});

test("cached source reads do not consume collection admission, misses do before collector work", async () => {
  const store = new WorldStore(":memory:"), world = syntheticWorld(); world.repo.license = "MIT";
  store.put(world);
  let admissions = 0, collections = 0;
  const service = createWorldService({ store, collector: { async collect() { collections++; throw new Error("unexpected collection"); } } });
  const admit = () => { admissions++; throw Object.assign(new Error("limited"), { status: 429, code: "IP_RATE_LIMIT" }); };
  try {
    await service.loadWorld(world.repo.fullName, { admit }); expect(admissions).toBe(0);
    await expect(service.loadWorld("another/project", { admit })).rejects.toMatchObject({ code: "IP_RATE_LIMIT" });
    expect(admissions).toBe(1); expect(collections).toBe(0);
  } finally { store.close(); }
});

test("public APIs accept only repository analysis schemas, never prompts or model overrides", () => {
  expect(repositoryRequest({ repo: "https://github.com/luworks/github-factory", enrich: false })).toContain("github.com");
  for (const body of [{ repo: "owner/repo" }, { repo: "https://github.com/owner/repo", prompt: "write code" }, { repo: "https://github.com/owner/repo", model: "other" }, { repo: "https://github.com/owner/repo", enrich: "yes" }, { repo: "https://evil.example/owner/repo" }])
    expect(() => repositoryRequest(body)).toThrow();
  for (const body of [{ prompt: "write code" }, { code: "run this" }, { model: "other" }, { refresh: false }])
    expect(() => actionRequest(body, "refresh")).toThrow();
  expect(() => actionRequest({ prompt: "write code" }, "blueprint")).toThrow();
  expect(() => actionRequest({}, "blueprint")).not.toThrow();
});

test.each([null, "NOASSERTION", "LicenseRef-Proprietary", "BUSL-1.1", "SSPL-1.0", "MIT"])("public metadata is admitted regardless of license (%s)", async (license) => {
  let requests = 0;
  const client = new GitHubClient("", async () => { requests++; return requests === 1 ? Response.json({ private: false, visibility: "public", full_name: "example/project", default_branch: "main", license: { spdx_id: license } }) : new Response("Unavailable synthetic ref", { status: 409 }); });
  await expect(client.collect(parseRepo("example/project"))).rejects.toMatchObject({ code: "EMPTY_REPO" });
  expect(requests).toBe(2); // The public repository passed admission before the missing-ref evidence.
});

test("a real public cached snapshot with unknown licensing remains usable without collection", async () => {
  const store = new WorldStore(":memory:"), world = syntheticWorld(); world.source = "github"; world.repo.license = null; store.put(world);
  let calls = 0;
  const service = createWorldService({ store, collector: { async collect() { calls++; throw new Error("must not collect"); } } });
  try { expect((await service.loadWorld(world.repo.fullName)).repo.license).toBeNull(); expect((await service.getCachedWorld(world.repo.fullName))?.repo.license).toBeNull(); expect(calls).toBe(0); }
  finally { store.close(); }
});
