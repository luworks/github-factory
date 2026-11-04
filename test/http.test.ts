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
test("trusted public origin overrides upstream host without trusting forwarded headers", () => {
  const previous = process.env.MOONSHOT_PUBLIC_ORIGIN;
  process.env.MOONSHOT_PUBLIC_ORIGIN = "https://chaorders.com";
  const request = (origin: string) => new Request("http://origin.internal/api/worlds", {
    method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-host": "evil.example" },
  });
  try {
    expect(() => allowMutation(request("https://chaorders.com"), "proxy-test")).not.toThrow();
    expect(() => allowMutation(request("https://evil.example"), "proxy-test")).toThrow("must start");
    expect(() => allowMutation(request("http://origin.internal"), "proxy-test")).toThrow("must start");
  } finally {
    if (previous === undefined) delete process.env.MOONSHOT_PUBLIC_ORIGIN;
    else process.env.MOONSHOT_PUBLIC_ORIGIN = previous;
  }
});
test("rate limit responses retain retry guidance", async () => {
  const response = apiError({ status: 429, code: "PUBLIC_RATE_LIMIT", message: "Cooldown", retryAfter: 7.2 });
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("8");
});
