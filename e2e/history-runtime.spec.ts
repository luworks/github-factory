import { expect, test } from "@playwright/test";

// SYNTHETIC route-registration evidence against an independently owned,
// unconfigured loopback build. This is not enabled/live history acceptance.
test("registered history GET and POST stay unavailable with no runtime configuration", async ({ request, baseURL }) => {
  const route = new URL("api/history/synthetic-history/registered-route", baseURL).href;
  for (const method of ["GET", "POST"] as const) {
    const response = await request.fetch(route, { method,
      ...(method === "POST" ? { data: { action: "walk", cursor: "synthetic.invalid" } } : {}),
    });
    expect(response.status()).toBe(503);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(await response.json()).toEqual({ code: "HISTORY_HTTP_UNAVAILABLE", error: "History is temporarily unavailable. No automatic retry or fallback was attempted." });
  }
});

test("browser fetch reaches the registered history route under the compiled base path", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  // The favicon is a real same-artifact static document; avoid other API flows.
  await page.goto(new URL("favicon.svg", baseURL).href);
  const result = await page.evaluate(async url => {
    const response = await fetch(url);
    return { status: response.status, payload: await response.json() };
  }, new URL("api/history/synthetic-history/registered-route", baseURL).href);
  expect(result.status).toBe(503); expect(result.payload.code).toBe("HISTORY_HTTP_UNAVAILABLE");
});
