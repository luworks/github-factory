import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicGitHubQuota } from "../src/server/public-quota";

test("public upstream quota survives reopening, shares admissions and blocks before fetch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "moonshot-quota-"));
  let now = 3_600_000;
  const path = join(dir, "quota.sqlite");
  const first = new PublicGitHubQuota(path, 2, () => now);
  const second = new PublicGitHubQuota(path, 2, () => now);
  let requests = 0;
  const wrapped = second.wrap(async () => { requests++; return new Response("synthetic"); });
  try {
    first.take();
    await wrapped("https://api.github.com/repos/synthetic/repo");
    first.close();
    const reopened = new PublicGitHubQuota(path, 2, () => now);
    try {
      expect(() => reopened.take()).toThrow("allowance reached");
      expect(() => wrapped("https://api.github.com/repos/synthetic/repo")).toThrow("allowance reached");
      expect(requests).toBe(1);
      now += 3_600_000;
      reopened.take();
      second.take();
      expect(() => reopened.take()).toThrow("allowance reached");
    } finally { reopened.close(); }
  } finally { second.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("zero public upstream allowance fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "moonshot-zero-quota-"));
  const quota = new PublicGitHubQuota(join(dir, "quota.sqlite"), 0);
  try { expect(() => quota.take()).toThrow("allowance reached"); }
  finally { quota.close(); rmSync(dir, { recursive: true, force: true }); }
});
