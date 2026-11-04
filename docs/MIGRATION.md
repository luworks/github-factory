# Standalone migration — 2026-11-04

This repository imports the complete independent `code/moonshot` product from incubation commit `6220ff64e03dcabf6d0cfb3e0bfde4c07af6ede3`, plus its existing independent Bun lockfile. It starts a clean Git history so unrelated private parent files and history are never published.

Included: TanStack Start frontend/API, GitHub collection, analysis, SQLite cache and budget code, AI adapters, five procedural renderers, English/Chinese experience, all product tests, twenty-project catalog, local installation and survey scripts, product/design/QA documents, and the authored film tooling/storyboard/narration/vector artwork.

Excluded from Git: credentials, runtime databases, paid budget ledger, screenshots, footage, generated speech, final film and private operational handoff. Original documents and deliverables remain preserved privately. The earlier internal `apps/factory` dashboard is a separate parent application and is not a dependency of this public product.

Changes for independence: MIT license, public contribution instructions, generic local paths, a tracked independent lockfile, repeatable CI/container configuration, separate `github-factory-web` service on port 4177, zero paid budget by default, and build-time `/github-factory/` support for routing/assets/APIs.

The incumbent private Moonshot service keeps its original code, data and cumulative spending ledger. No incumbent service is restarted by migration. Future product source changes belong only here. Historical source identity and test reports remain dated evidence; this repo's new checks are recorded separately.
