import { expect, test } from "bun:test";
import { allowMutation, apiError, readJson } from "../src/server/http";
test("rejects cross-origin JSON mutations", () => {
  expect(() =>
    allowMutation(
      new Request("http://localhost/api/worlds", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
      }),
      "origin-test",
    ),
  ).toThrow("must start from Moonshot");
});
test("rejects non-JSON and large or invalid request bodies", async () => {
  expect(() =>
    allowMutation(new Request("http://localhost/api/worlds", { method: "POST", headers: { "content-type": "text/plain" } }), "body-test"),
  ).toThrow("JSON");
  await expect(readJson(new Request("http://localhost/api/worlds", { method: "POST", body: "x".repeat(2049) }))).rejects.toThrow(
    "too long",
  );
  await expect(readJson(new Request("http://localhost/api/worlds", { method: "POST", body: "[]" }))).rejects.toThrow(
    "valid repository request",
  );
});
test("redacts unexpected upstream error details", async () => {
  const r = apiError(new Error("sensitive-upstream-detail"));
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("sensitive-upstream-detail");
});
