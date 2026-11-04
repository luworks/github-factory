> Historical incubation record (2026-11-04), sanitized for publication. Current repository setup: [SETUP.md](SETUP.md).

# Twenty-world survey and model probe

Captured November 4, 2026 PT. This is a curated sample of popular public projects, not GitHub's literal global top twenty. All 20/20 produced a bounded graph and a valid Muse guide. Six path trees were fully returned and fourteen sampled; a full path tree is not an exhaustive source audit.

## Same-input model comparison

React, Segment Anything and T3 Code each supplied one frozen snapshot to all three models. Each model was explicitly generated once per repository with the same snapshot, strict schema and 4096 output-token cap. No paid retry. Per-case SHA-256, head, result and cost are preserved in the private report. All call deltas were exactly one.

| Model           | Strict-valid guides | Mean seconds | Mean estimated USD/call | Explained known districts |
| --------------- | ------------------- | ------------ | ----------------------- | ------------------------- |
| muse-spark-1.3  | 3/3                 | 10.915       | $0.011810               | 33/66                     |
| muse-spark-1.2  | 2/3                 | 7.310        | $0.014279               | 60/66                     |
| muse-wonder-1.0 | 3/3                 | 10.948       | $0.049365               | 60/66                     |

Spark 1.2's Segment Anything response failed the district contract. It fell back visibly to rules; its $0.008132 estimate remains included. Invalid results contribute zero AI-explained districts. All denominator cases and failures remain visible. Validity measures structure and source references, not independently judged semantic quality. The sample of three repositories is insufficient to establish a general model ranking. Different explanation lengths also affect cost and latency.

The deployed app retains Muse Spark 1.3 Standard. This preserves the existing working default; it is not a claim of universal superiority. Muse Wonder 1.0 and Spark 1.2 were tested separately without changing the service provider or splitting the budget ledger. Recognized Spark 1.1 pricing is verified but generation on that model was not tested.

## Cohort

| Repository                        | Districts | Edges | Path tree | Guide |
| --------------------------------- | --------- | ----- | --------- | ----- |
| openclaw/openclaw                 | 30        | 28    | truncated | muse  |
| pingdotgg/t3code                  | 30        | 28    | truncated | muse  |
| react/react                       | 30        | 28    | full      | muse  |
| pytorch/pytorch                   | 25        | 24    | truncated | muse  |
| facebookresearch/segment-anything | 6         | 5     | full      | muse  |
| meta-llama/llama-models           | 4         | 3     | full      | muse  |
| microsoft/vscode                  | 17        | 16    | truncated | muse  |
| torvalds/linux                    | 25        | 24    | truncated | muse  |
| kubernetes/kubernetes             | 15        | 14    | truncated | muse  |
| huggingface/transformers          | 14        | 13    | full      | muse  |
| rust-lang/rust                    | 12        | 14    | truncated | muse  |
| golang/go                         | 10        | 9     | truncated | muse  |
| python/cpython                    | 25        | 24    | full      | muse  |
| denoland/deno                     | 19        | 19    | truncated | muse  |
| oven-sh/bun                       | 30        | 29    | truncated | muse  |
| vercel/next.js                    | 30        | 28    | truncated | muse  |
| sveltejs/svelte                   | 13        | 12    | truncated | muse  |
| vuejs/core                        | 25        | 24    | full      | muse  |
| supabase/supabase                 | 30        | 28    | truncated | muse  |
| TanStack/router                   | 30        | 28    | truncated | muse  |

## Budget and evidence

The shared development/demo ledger was $0.828305 / $50 at 11:45 PT, with 49 total attempts and zero reservations. This includes the earlier project build and failures, rather than only this probe. Costs are provider token-usage estimates under conservative standard rates, not an invoice. Sources: [Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits), [Meta reasoning](https://dev.meta.ai/docs/reasoning). Contributor models were not used.

The standalone survey script is `scripts/survey-popular.ts`; `--compare` explicitly spends for nine comparison calls. It never changes the running provider configuration. Reuse the original absolute data directory and SQLite ledger. Run artifacts are under `<private-video-artifacts>/survey/`: `report.json`, `summary.json`, per-model blueprints and an interactive dashboard. Headless HTML-preview infrastructure timed out twice; an independent Chromium check verified the dashboard's metric switching, values and zero page errors.
