> Historical incubation record (2026-11-04), sanitized for publication. Current repository setup: [SETUP.md](SETUP.md).

# Browser QA

## Test lane task card

**目标**：隔离 Moonshot UI 的可重复 Playwright 回归证据。
**完成标准**：覆盖表单、导航、证据展示、五种视角、CI、guide、语言/窄屏、分享及 Canvas 操作；记录 pass/fail/skip 与真实链路缺口。
**边界**：仅 `e2e/**`、`test/fixtures/browser-world.ts`、`playwright.config.ts`、本文件；不修改组件、调用付费模型、读取凭据、开 PR、push 或派子任务。
**预算**：首批 40 分钟；父任务截止 2026-11-04 14:04 PT；模型支出 US$0。
**决策权**：测试实现自主；组件修复交回父任务；共享 checkout 由父任务统一提交。
**汇报**：给出实测计数、复跑命令、服务身份、失败证据与未测边界。

## Scope and failure contracts

These are **SYNTHETIC UI tests**, not GitHub/backend/provider acceptance. Every invented repository, event, guide and budget is explicitly labeled SYNTHETIC; `WorldSnapshot.source` is `demo`. No real repository is imported or analyzed by this suite.

| Risk                                                  | Observable proof                                                                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Duplicate/unclear generation and failed retry         | Empty submit disabled; one pending request disables input/submit; explicit error; successful retry navigates with the response identity and selected perspective. POST payload is checked against the documented API contract. |
| Gallery opens the wrong world/style                   | Fixture gallery item supplies its own identity and suggested perspective; navigation and selected perspective agree. No generation POST is made.                                                                               |
| Lost evidence during failed load/refresh              | Deferred fixture responses expose loading; retry recovers; a failed refresh keeps the existing canvas/evidence and sends only `{refresh:true}`.                                                                                |
| Style changes silently replace data                   | All five styles keep the same district labels, selected node and immutable source URL; no POST is issued.                                                                                                                      |
| Guesses or missing evidence look authoritative        | Observed/inferred badges, unknown node status, partial tree note, source links and illustrative-motion legend are asserted separately.                                                                                         |
| Skipped/empty CI appears passed                       | Success/failure/skipped rows keep distinct labels and icon tones; skipped is excluded from pass count; an empty CI window explicitly remains unknown. Source, draft PR, issue and commit links are preserved.                  |
| Rules fallback appears to be paid AI success          | Rules provider and fallback reason stay visible; fixture-only enrichment retains the notes; guide district/mission links remain usable.                                                                                        |
| Canvas controls only appear interactive               | Real mouse/keyboard inputs change the rendered camera transform; reset restores it; Escape deselects; pointer cancellation/lost capture stop a drag and allow the next one.                                                    |
| Sharing or responsive presentation blocks exploration | Clipboard denial offers a URL fallback; English/Chinese layouts at 390/768px have no document overflow; mobile submit retains an accessible name.                                                                              |

The camera probe observes standard `CanvasRenderingContext2D.setTransform` calls without altering them. Assertions compare relative movement/zoom and reset within a run, not fixed pixels or copied layout algorithms. Waiting observes completed draws, not arbitrary sleeps. Pointer cancellation/lost capture are dispatched browser events after a real captured mouse drag; physical touch hardware is not covered. No separate layout unit tests were added: the renderer lane owns layout, and this lane's distinct risk is end-user interaction.

## Run

From `code/moonshot`, with the parent-provided app already running:

```sh
bun --no-env-file x --bun --no-install tsc --noEmit -p e2e/tsconfig.json
bun --no-env-file x --bun --no-install playwright test
```

To target the final integrated build at another local port:

```sh
MOONSHOT_E2E_URL=http://127.0.0.1:4193 bun --no-env-file x --bun --no-install playwright test
```

Default URL: `http://127.0.0.1:4176`. Browser: `/usr/bin/google-chrome`, optionally overridden by `MOONSHOT_CHROME_PATH`. The configuration accepts loopback targets only, starts no server, loads no dotenv files and uses one worker with zero retries. The suite blocks service workers, fulfills only declared synthetic API routes, and fails on undeclared API/external requests. Google Fonts' CSS is explicitly fulfilled with empty local CSS, so layout uses system fonts and makes no external font request. Creation, refresh and blueprint POSTs must each be opted into by the test. These fixtures do not simulate database/auth semantics.

Ignored outputs: `artifacts/playwright/report/index.html`, `artifacts/playwright/results/**` (failure screenshot, trace and error context). Do not commit these artifacts.

## First delivery evidence — 2026-11-04 09:38 PT

- Playwright: **16 total, 15 passed, 1 failed, 0 skipped**, 16.8 seconds. The gate is red; the failure below is retained as an ordinary regression test, not skipped or marked expected-fail.
- Root app TypeScript check: passed. Dedicated E2E TypeScript check: passed after explicitly typing the canvas probe's `this` context.
- Google Chrome `153.0.8010.52`, Bun `1.4.4`, Playwright `1.64.1`.
- Test checkout baseline: `16dabc0fe3beeb77b04a54664057db1831b3677d`, plus this lane's uncommitted test files.
- Target: parent service `http://127.0.0.1:4176`, PID `2066469`, command `bun --no-env-file .output/server/index.mjs`, cwd `<private-local-path>`. No child server was started or stopped.
- Existing server entrypoint mtime: 2026-11-04 09:29:24 PT. The parent checkout had subsequently advanced to `e82802d997186082842854ad8993ef04ba2cadd5` with language-route edits in progress. **The running compiled build's exact source identity is unknown**; this result is explicitly against the supplied first UI build, not the parent's final integrated candidate. Parent must rebuild/restart and rerun at final delivery.
- Initial network-guard run failed 10/10 because the app requests external Google Fonts; test isolation was corrected to explicitly fulfill that CSS locally. Those initial failures are not UI success evidence. Final counts above supersede the intermediate runs.
- Paid calls: **0**. Real GitHub/backend requests from the browser suite: **0**. Real provider, persisted budget, authentication, server collection/cache/rate-limit semantics and production acceptance: **not tested**.

### Component finding returned to parent

At 390px, the landing form's submit button has accessible name `""` instead of `Generate world`. `src/styles.css` hides `.repo-form button span`, while `src/components/LandingPage.tsx` gives the icon-only button no `aria-label`. This is independently reproduced by `e2e/interaction.spec.ts`, test `SYNTHETIC mobile generate control keeps an accessible name when its visible text is hidden`.

Suggested parent fix: give the submit button an explicit localized accessible name that follows its normal/loading state, or keep its text available to assistive technology when visually hidden. This lane did not change components. Run the full suite after the parent fix and final rebuild.

Failure screenshot: `artifacts/playwright/results/interaction-SYNTHETIC-mobi-11ec3--its-visible-text-is-hidden/test-failed-1.png`; adjacent `trace.zip` and `error-context.md` contain replay evidence.

## Parent real-flow checklist — no fixture interception

These checks remain **NOT TESTED by this lane**. Execute them separately against the final Muse configuration; do not treat a green synthetic suite as these checks passing.

- Record final source SHA, build identity, serving worktree/PID/URL and time in PT. Verify a fresh final build, then rerun this suite at that URL.
- Open public `openclaw/openclaw`, `facebook/react` and `pingdotgg/t3code` through the real gallery/import paths. Confirm canonical identity, real capture timestamp/head, coverage, source links, and observed/inferred/unknown distinctions. Record each repository's collection failures, partial/truncated windows and cache status separately. Do not replace failures with fixture data.
- For each available real snapshot, inspect a district, switch all five styles while preserving node identity, and verify issue/PR/commit/workflow links against the captured GitHub response. Preserve failure, skipped and missing CI evidence. Decorative motion must remain labeled illustrative.
- Before any paid call, inspect the server's persisted shared budget ledger: cap US$50 across all providers/development/demo calls, spent/reserved/remaining, prior reservations and active requests. This child's fixture budget is unrelated to actual spending.
- Parent alone checks the explicit public-repo analyze flow/privacy disclosure and final Muse provider/model (`https://api.meta.ai/v1`, `muse-spark-1.3`). Record the actual response provider/model and charged estimate; a rules fallback must be reported as fallback. Do not send keys or private repository data to browser artifacts.
- Use only the parent's authorized bounded live smoke calls. Verify a cache hit/source refresh does not regenerate/spend, explicit AI generation is the only paid action, concurrent reservations persist, failures/refusals/invalid output release or reconcile reservations accurately, and no automatic paid retry occurs. Budget/concurrency require server-level proof from the owning lane, not UI fixtures.
- Confirm refresh/error/retry, real gallery availability, sharing, language persistence and small-screen interactions in the final build. Report unavailable API/provider/GitHub paths as failed or unknown with exact denominators, not as synthetic passes.
- Final handoff separates build/type checks, synthetic UI counts, real GitHub repo counts, Muse success/fallback counts, skipped/untested scope and actual cumulative cost. Stop by 2026-11-04 14:04 PT and the shared US$50 limit.

## Parent integration replay — 2026-11-04 09:44 PT

Mobile submit now has an explicit localized accessible name. Hydration-ready controls prevent SSR interactions from being lost, and concurrent client reads share one request so development effect replay does not discard the initial failure. The entire suite rerun against the development app on127.0.0.1:4178: **16 pass / 0 fail / 0 skip**,15.1s. This remains fixture UI evidence, not live GitHub/Muse acceptance or the final integrated build.

## Integrated regression additions

The integrated suite now also exercises a real zoom/pan followed by a synthetic GitHub facts refresh with a changed head. The selected district and rendered camera transform must remain unchanged, and no blueprint request may occur. The resulting suite has 17 tests; final source, results and real public-repository acceptance are recorded in `DELIVERY.md`.

A separate real production smoke exposed Bun's default 10-second idle timeout on a large repository survey. The isolated Nitro plugin now extends API requests to 180 seconds, covering the bounded 60-second GitHub survey and one bounded model call. The source network limits remain unchanged. Regression evidence is the failed production request plus a successful real production import lasting over 10 seconds; fixture tests alone do not prove this behavior.

The real refresh smoke also exposed CI run URLs inside the architecture cache identity. A new run could evict the same-head field guide even though paths and topology had not changed. The focused regression now replaces a node's observed run URL and proves cache reuse with exactly one total generation attempt; the distinct recovered-topology test still rejects reuse after an expanded survey.

## Local captured-source exploration candidate

The feature branch adds an optional local source challenge to cache-only Atlas journeys. A visitor chooses a captured repository, explicitly enters its world, matches an existing pinned directory source (or recorded commit with an author timestamp), and classifies the evidence limits. Discovery, entry and source-link clicks award nothing. A correct explicit submission may create one Exploration star per canonical repository on this browser; it does not verify reading, learning, contribution, current runtime health or GitHub stars.

Receipts retain the original completed head and capture independently of the current world. IndexedDB transactions serialize the permanent reward slot and reset generation across tabs. Capacity is bounded to 100 repositories, 2048 serialized UTF-8 bytes per record and 256 KiB of gameplay payload; earlier progress is never silently evicted. Unavailable, corrupt, unsupported or failed browser storage falls back visibly to session practice with unknown durable totals. Clear exploration progress confirms deletion of gameplay data only. No player data is added to public worlds, server storage, paid ledgers or a new API.

Offline browser acceptance uses labeled synthetic GitHub-shaped captures, real browser IndexedDB and denied upstream access. It tests the two-repository Atlas round trip, incorrect answers, replay and changed-capture idempotency, independent connection completion races, reset epochs, multi-tab reconciliation, retained corruption/capacity failures, aborted commits, unsupported schemas, commit fallback, narrow-screen keyboard access and shared pause control. These are synthetic acceptance boundaries. The feature is not deployed; real public gameplay, independent comprehension benefits, Safari/Firefox and physical devices remain unverified.

Review regressions retain request admission for cache-only full-world GETs without taking collection/AI allowance. Catalog, preview and direct cache reads preserve malformed rows and aliases; the same positive shape gate determines renderability. Rejected session updates leave prior payloads unchanged. Confirmed Clear can erase corrupt known-v1 gameplay rows while atomically advancing the reset generation; unsupported schemas, unknown metadata or invalid generation remain untouched. Saved Exploration stars and unsaved session stars are counted separately, and discovery/visit wording follows the persistence of the individual flag.

## Captured commit replay candidate

Cache-only explorer journeys can open Replay captured commits. The finite rail uses retained commit sources and UTC author timestamps, with deterministic date/SHA presentation order, explicit duplicate/conflict/rejection coverage, Play/Pause, seek, Previous/Next and four playback speeds. It starts paused and stops at the captured window's end. Hidden/offscreen panels pause their owned clock; reopening does not catch up elapsed hidden time. Style changes preserve the selected marker. Playback makes no network or progress writes.

The map remains explicitly Captured structure at its original head. Historical topology, ancestry, complete history and issue/PR lifecycles remain unavailable; a message containing “Merge” establishes no merge event. Marker pacing is presentation timing and gives no Exploration star. Empty eligible windows remain unknown. This increment does not implement first-parent tree frames, building births/deletions or runtime telemetry. At the replay checkpoint, WorldCanvas pause only froze motion parameters; that checkpoint did not verify zero idle/hidden RAF. Real public replay acceptance awaits a separately authorized release.


## WorldCanvas demand scheduling candidate

The current canvas cancels its pending RAF when hidden, outside the viewport or unmounted. Paused and reduced-motion scenes repaint on actual layout/source/style/selection/hover/camera/resize invalidation and schedule no continuous idle RAF. Visible normal motion retains bounded 30fps painting with one pending handle. Visibility restoration preserves the animation clock without hidden-time catch-up, and only an eligible real first paint can mark a cached visit.

Synthetic browser probes observe native RAF requests/cancellation/execution and real Canvas painting, including a hidden initial mount, dynamic media changes, pause/resume, offscreen restoration and input/source/camera regressions. These local measurements do not establish physical-device power savings, cross-browser behavior or public runtime adoption. Earlier replay/Atlas receipts retain their original limitations.
