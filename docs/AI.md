> Historical incubation record (2026-11-04), sanitized for publication. Current repository setup: [SETUP.md](SETUP.md).

# AI blueprint and shared budget

The AI layer only replaces `world.blueprint`. GitHub nodes, edges, statuses, timestamps, source coverage and work items remain the backend's facts. District roles, summaries and missions are AI interpretations, not evidence of runtime behavior. No generated code is executed. All exports are server-only.

## Integration

```ts
import { enrichWorld, getCachedBlueprint } from "./ai";
import { getBudgetStatus } from "./budget";

// Explicit public-repository analyze flow, after the UI privacy disclosure:
const enriched = await enrichWorld(world);
// A separate explicit regenerate action may use { force: true }.

// GET /api/world and source refresh: NEVER call enrichWorld here.
const blueprint = getCachedBlueprint(freshWorld, { allowPreviousHead: true });
const displayed = blueprint ? { ...freshWorld, blueprint } : freshWorld;
const budget = getBudgetStatus();
```

`getCachedBlueprint(world, options?)` is synchronous and cache-only. A miss, invalid entry, or unavailable SQLite store returns `null`, with zero network requests. By default it requires the exact repo, head, prompt version, provider and model. `allowPreviousHead: true` may reuse the most recent interpretation of the same repo/provider/model/prompt, marks its original and current heads in generator notes, and drops districts and missions whose node IDs or evidence are no longer present. It never rewrites fresh GitHub facts. Display the generator notes/time so a cached interpretation is visibly older than the facts.

`enrichWorld(world, { force?: boolean })` first reuses an exact cache. Force bypasses the completed cache but never bypasses the budget or an active request lock. Cache persistence and token accounting commit in one SQLite transaction. Concurrent calls within one `createAiService` instance share a promise. Separate requests/processes share a unique active cache-key fence; another active request returns a rules fallback with `generation_in_progress`. No automatic retry, waiting loop, or paid fallback between providers exists.

Production entrypoints obtain server-only configuration exclusively through `getConfig()`. `createAiService({ config, fetch?, timeoutMs? })` provides deterministic offline network injection for tests. No client field controls prices, models, endpoint, credentials, or budget. Tests never call `getConfig()` or access a real key. Existing contracts are unchanged. `getBudgetStatus()` is exported from both `budget.ts` and `ai.ts`.

## Providers and request limits

Both adapters use non-streaming `POST <baseUrl>/responses`, `text.format` with a strict JSON Schema, `store: false`, and `max_output_tokens: 4096`. There are no tools, reasoning-effort assumptions, automatic retries, contributor variants, or silent provider changes. Meta is restricted to `https://api.meta.ai/v1/responses`. OpenAI accepts the server-configured HTTPS endpoint or a loopback HTTP proxy. Redirects are refused. The default request timeout is 60 seconds, capped at 90 seconds for injected settings; the timeout covers response-body reading as well.

The serialized request is capped at 48,000 UTF-8 bytes; response reading is capped at 256,000 bytes. The prompt contains at most 40 existing nodes, 8 issues, 6 pulls and 6 workflow runs, and bounded descriptions. It sends repository metadata and source references, not cloned/executed code. Repository strings are delimited JSON data beneath a higher-priority instruction. This reduces prompt injection exposure; semantic correctness of an AI narrative remains unverified inference.

Only the exact known models have rates (USD per million tokens):

| Provider | Model          | Reserved input | Output |
| -------- | -------------- | -------------: | -----: |
| openai   | gpt-6.1-sol    |           2.50 |  10.00 |
| muse     | muse-spark-1.3 |           1.25 |   4.25 |

OpenAI's published input rate is $2 and cache-write rate is $2.50; the higher $2.50 is used for every input token, ignoring cache discounts. Requests stay well below the documented long-context price threshold. Standard Spark1.1/1.2 use the same1.25/4.25 rates; Standard Wonder1.0 uses4/20. These allowlisted prices were verified before the bounded three-model probe. Other model IDs return `unknown_model_prices` without sending anything. A provider switch reads the same ledger when `dataDir` is unchanged.

Official OpenAI documentation checked for this implementation:

- [GPT-6.1 Sol model and prices](https://developers.openai.com/api/docs/models/gpt-6.1-sol.md)
- [Responses migration: text.format](https://developers.openai.com/api/docs/guides/migrate-to-responses.md)
- [Structured outputs, refusals and incomplete responses](https://developers.openai.com/api/docs/guides/structured-outputs.md)

Meta model, endpoint, Responses structured-output shape and standard prices were also checked against the public references: [quickstart](https://dev.meta.ai/docs/quickstart), [pricing](https://dev.meta.ai/docs/pricing-rate-limits), [structured output](https://dev.meta.ai/docs/structured-output). Actual compatibility is a parent-owned live-smoke acceptance, not established by injected tests or a successful models-list request.

## Persistent budget authority

`<dataDir>/ai-budget.sqlite` uses WAL, a 5-second busy timeout, FULL synchronous writes and `BEGIN IMMEDIATE` transactions. Every request reserves before network dispatch. Amounts are integer micro-USD, rounded up. The budget is `min(server budget, $50)` and all providers share its reservations and charges. The SQLite calls table stores model, provider, bounds, accounting category, aggregate usage, outcome and timestamps; it stores no keys, prompts or raw responses. A separate cache table stores the validated public blueprint.

The reservation prices the entire serialized request's UTF-8 byte count as input tokens, plus 8,192 tokens of framing allowance, and all 4,096 possible output tokens. UTF-8 bytes plus the allowance deliberately overestimate the bounded text input. The hard budget is a local accounting fence under these provider prices, tokenization bounds and the provider honoring its output cap; it is not an account invoice or a guarantee against provider misbilling. No image, tool, background, conversation history or paid retry is enabled.

Valid provider usage within both bounds settles at conservative rates and releases only known unused reservation. Missing, negative, fractional or out-of-bound usage charges the full reservation. A provider reporting tokens above its reserved bounds additionally persists a global accounting guard: further paid calls are blocked across providers, and `remainingUsd` becomes zero until separately authorized reconciliation. This guard does not claim the actual invoice is known. Network failures, unknown response cost and malformed response bodies also charge the full reservation. A failed blueprint with valid usage still settles its known estimated cost. `BudgetLedger.accounting()` exposes safe aggregate token/accounting details without changing the fixed `BudgetStatus` contract. `calls` counts reserved request attempts, including failed attempts; it is not a count of successful worlds.

A process crash leaves its reservation permanently held and the same key locked. There is no TTL refund or automatic cleanup that could spend unknown costs again. Do not delete, replace or split this ledger, or change `dataDir`, during the shared $50 development/demo budget. Reclaiming an abandoned reservation requires external billing evidence and a separately authorized audited reconciliation; this implementation has no refund endpoint.

## Validation and failure behavior

Provider completion status must be `completed`, with exactly one output-text payload and no refusal. Runtime validation rejects unknown/duplicate district IDs, extra object fields, invalid priorities, oversized text/arrays, unknown mission node IDs and fabricated evidence strings. Every mission must cite an exact source URL already in the snapshot for an issue, pull request or unsuccessful workflow, and include that URL in its evidence. Source URLs must belong to the same GitHub repo. A bare repository homepage is insufficient mission evidence.

Errors preserve source facts and return an explicit rules blueprint with a safe reason in `generator.notes`; they never claim AI success or echo provider text/keys. HTTP 401/429/5xx, timeouts, malformed JSON, incomplete output, refusals, budget exhaustion, unknown prices, invalid source IDs and storage failures have bounded behavior. Cache-only failures return `null`. An invalid completed cache requires an explicit force request before regeneration; ordinary refresh cannot trigger spend.

## Offline evidence and parent live smoke

Run only inside `code/moonshot`:

```sh
bun --no-env-file test ./test/ai.test.ts ./test/budget.test.ts
bun --no-env-file x --bun --no-install tsc --noEmit
```

The budget test runs four real child processes against a disposable SQLite WAL file: 160 concurrent reservation attempts at $0.50 each result in 100 accepts, 60 budget denials, exactly $50 reserved, and no additional allowance after switching to Meta. Other cases cover crash fences, rounding, provider errors, timeouts, schema/source validation, cache reuse and explicit regeneration. All API responses are injected; paid network calls are zero.

Parent's smallest live acceptance is one explicit public-repo analyze request on the configured provider, followed by cache-only GET/refresh while comparing the budget call counter. Check provider/model, non-rules generator, source-backed districts, fallback notes, exact estimated charge and zero additional refresh calls. Repeat once after the intentional Meta switch if budget permits. A 200 models-list result alone does not prove generation, structured outputs or token usage compatibility. UI privacy disclosure, route authorization/rate controls, actual keys, live provider behavior and browser presentation remain parent integration work.

## Integrated live acceptance — 2026-11-04 09:55 PT

The first GPT request was charged an estimated $0.027135 but rejected for invalid mission evidence; it was explicitly a rules fallback. The output schema was then bound to the exact snapshot node IDs and actionable URLs, while retaining runtime validation. A second GPT request succeeded ($0.030173). The configured runtime was then intentionally switched to Meta Muse Spark1.3 Standard; a real successful request cost an estimated $0.022511. The same persisted ledger then had3 attempts and $0.079819 estimated cumulative cost, no active reservations. An immediate cache-only read returned the Muse blueprint without changing the call counter. These values are token-rate estimates, not account invoice reconciliation.

Later prompt revisions preserve bounded visible issue/PR/run windows in schema enums and trim duplicate URL lists to stay within the48KB request cap. Final curated-world results and final spend are recorded separately in the delivery report; this earlier successful smoke alone does not prove every later prompt or project. Failed paid requests now replace the rules note saying no paid request was made with an explicit charged-fallback note.

Muse requests now explicitly use `reasoning: { effort: "low" }`, per the [Meta reasoning guide](https://dev.meta.ai/docs/reasoning), while retaining the 4096 total output-token cap. This leaves more of the bounded output for a 30-district guide. A completed paid response is still required; truncation is charged and visibly falls back. No automatic paid retry is introduced. A real T3 Code request that previously exhausted its output cap succeeded with this setting; final figures belong in DELIVERY.md.

Architecture cache identity includes bounded path/role/evidence/topology coverage. CI run URLs are excluded from that identity because the live run window changes independently of a pinned source head; current workflow facts and mission evidence are still validated against every refreshed snapshot. A recovered architecture at the same head cannot reuse an incomplete topology guide. A prior-head guide may be shown with an explicit old/current head note, after removing districts or missions no longer supported by the current snapshot. These cache-only paths make no model request.
