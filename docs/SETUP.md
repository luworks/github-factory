# Standalone environment verification — 2026-11-04

## Integrated local candidate

- Bun 1.4.4; isolated dependencies; committed independent `bun.lock`; frozen install passes.
- TypeScript check passes.
- Unit suite: **173 passed, 0 failed, 0 skipped** (8 files; 57,596 assertions).
- Production build passes. Upstream bundler emits `use client` directive warnings; build succeeds.
- Production Chromium fixture suite at `/github-factory/`: **18 passed, 0 failed, 0 skipped**. Covers repository input/retry, direct navigation, five perspectives, source inspection, status evidence, English/Chinese, responsive layouts, camera input/cancellation, refresh and guide behavior. Fixtures block undeclared external/API requests; these tests do not prove live GitHub or Muse availability.
- HTTP checks: prefixed landing, health, gallery, favicon and all initial JS/CSS resources return 200.
- Docker Compose parses; isolated Docker image builds successfully. A network-isolated container ran successfully as the non-root `bun` user; landing, health and budget returned 200, with source SHA matching the image input and zero model calls. It was then removed. The default Docker config was unreadable on the setup host, so the build used a task-local `DOCKER_CONFIG`; no shared Docker settings were changed.
- Prepublication source scan: 93 files, zero credential-pattern findings and no matches against three original private credential values. `.env`, data, generated output and unrelated parent history are excluded.
- Registered as the independent T3 project **GitHub Factory**, rooted at the new repository, with install/dev/check/build actions. No new thread is created automatically.

## Runtime and delivery boundaries

The original private runtime remains untouched. The new environment uses no GitHub/model credentials and has zero paid budget. No paid API calls occurred during setup. All historical spend stays in its incumbent ledger.

Production defaults to `http://127.0.0.1:4177/github-factory/`; `bun run dev` uses port 4178 so both can run together. The independent `github-factory-web.service` is enabled and running on loopback; its health reports the installed source SHA, no credentials and a zero-call budget. The incumbent service remains active with the same PID and no additional restarts. The target public URL is `https://chaorders.com/github-factory`; production domain/gateway routing is not yet installed. Local checks, public-repository publication, hosted CI, container execution and public deployment are separate facts.

Not verified by this setup: live paid provider behavior, fresh twenty-repository collection, public reverse proxy/DNS, physical mobile devices, film redistribution rights. Historical live evidence is retained in dated documents and private artifacts.
