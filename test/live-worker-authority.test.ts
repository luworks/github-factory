import { expect, test } from "bun:test";
import { verifyLiveWorkerAuthority } from "../scripts/live-worker-authority";
import { liveAuthorityFixture } from "./fixtures/worker-authority";

test("SYNTHETIC live management reads pin physical binding, single deployment/version and actual module on every observation", async () => {
  for (const multipart of [false, true]) {
    const { config, request, calls } = liveAuthorityFixture({ multipart });
    await expect(verifyLiveWorkerAuthority(config, "SYNTHETIC_TOKEN", request)).resolves.toMatchObject(config.workerAuthority);
    expect(calls).toEqual(["/deployments", "/settings", "", "/deployments", "/settings"]);
  }
});
for (const kind of ["split", "physical-db", "version", "deployment", "module", "during-deployment", "during-settings", "duplicate-module", "unknown-format", "network-error"] as const) {
  test(`SYNTHETIC management rejects ${kind} even with otherwise valid self-reported configuration`, async () => {
    const { config, request } = liveAuthorityFixture({ kind });
    await expect(verifyLiveWorkerAuthority(config, "SYNTHETIC_TOKEN", request)).rejects.toThrow();
  });
}

test("SYNTHETIC missing independent management authority fails before any network read", async () => {
  const { config, request, calls } = liveAuthorityFixture();
  await expect(verifyLiveWorkerAuthority({ ...config, workerAuthority: undefined as any }, "SYNTHETIC_TOKEN", request)).rejects.toThrow();
  await expect(verifyLiveWorkerAuthority({ ...config, storageIdentity: { ...config.storageIdentity, admissionFenced: false } }, "SYNTHETIC_TOKEN", request)).rejects.toThrow();
  expect(calls).toEqual([]);
});

for (const kind of ["valid", "split", "physical-db", "before-stop-version", "during-drain-module", "final-module"] as const) {
  test(`SYNTHETIC real retirement program ${kind} respects stop, periodic and final management boundaries`, () => {
    const run = Bun.spawnSync([process.execPath, "--no-env-file", new URL("./fixtures/retirement-program.ts", import.meta.url).pathname], {
      cwd: new URL("..", import.meta.url).pathname, env: { PATH: process.env.PATH, HOME: "/tmp", MOON_FACTORY_RETIREMENT_FIXTURE: kind }, stdout: "pipe", stderr: "pipe", timeout: 15_000,
    });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    const result = JSON.parse(run.stdout.toString());
    expect(result.passed).toBe(true);
    expect(result.managementReads).toBeGreaterThan(0);
    expect(result.stopCalls).toBe(["valid", "during-drain-module", "final-module"].includes(kind) ? 1 : 0);
    expect(result.receipts).toBe(kind === "valid" ? 1 : 0);
    if (kind === "valid") expect(result.managementReads).toBeGreaterThan(30);
    if (kind === "final-module") expect(result.readyObserved).toBe(true);
  });
}
