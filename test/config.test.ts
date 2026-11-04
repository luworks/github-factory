import { expect, test } from "bun:test";
import { getConfig } from "../src/server/config";

test("public deployment pins Meta model/endpoint and caps hourly accounting without lowering cumulative history", () => {
  const config = getConfig({ MOONSHOT_PUBLIC_ORIGIN: "https://chaorders.com", MOONSHOT_PROVIDER: "openai", MOONSHOT_META_MODEL: "caller-override",
    MOONSHOT_META_API_BASE_URL: "https://elsewhere.example", MOONSHOT_BUDGET_USD: "50", MOONSHOT_HOURLY_BUDGET_USD: "99" });
  expect(config).toMatchObject({ provider: "muse", model: "muse-spark-1.3", baseUrl: "https://api.meta.ai/v1", budgetUsd: 50, hourlyBudgetUsd: 0.3, requireExistingLedger: true });
  expect(getConfig({}).budgetUsd).toBe(0);
  expect(getConfig({}).apiKey).toBe("");
});
