# Moon Factory · GitHub Factory

**Your codebase, a living world.** Turn a public GitHub repository into an explorable architecture map, with source-linked work, CI activity and an optional AI field guide.

Five original procedural perspectives share one world model: Moon Factory, Factorio inspired, Red Alert inspired, Red Alert 2 inspired, and Civilization inspired. English and Chinese are supported. Twenty curated public repositories are listed; a fresh checkout collects their data on demand and does not ship their source or cached snapshots.

## Development

Requires **Bun 1.4.4**. All product development now lives in this independent MIT repository.

```sh
bun --no-env-file install --frozen-lockfile --ignore-scripts
cp .env.example .env
bun run dev
# http://127.0.0.1:4178/github-factory/
```

No model credentials or paid calls are required. The default model budget is zero; deterministic architecture analysis works without a model. For authenticated GitHub collection or optional AI, configure server-only values in `.env`. Never use `VITE_` variables for credentials. Enabling paid generation needs an explicit budget and a persistent ledger; switching providers must preserve that ledger.

```sh
bun run check
bun run test
bun run build
HOST=127.0.0.1 PORT=4177 bun run start
# In another terminal, against your running app:
bunx --no-install playwright install chromium
bun run test:browser
```

`MOONSHOT_BASE_PATH` is a build-time setting, default `/github-factory/`. To serve the root instead, use `MOONSHOT_BASE_PATH=/ bun run build`. Rebuild when changing it. The router, assets, browser navigation and API calls use the same prefix. [Production acceptance](docs/PRODUCTION.md) records the current public delivery. [Deployment instructions](docs/DEPLOYMENT.md) cover persistent Bun hosting and the existing Cloudflare site.

## Product and trust boundaries

[Product design](docs/PRODUCT.md) · [AI and budget](docs/AI.md) · [Migration](docs/MIGRATION.md) · [Contributing](CONTRIBUTING.md)

The app reads bounded public GitHub metadata, paths and manifests. It never clones or executes an input repository. Untrusted repository text cannot become instructions. Architecture inference, observed source facts and unknown states stay distinct; moving particles illustrate relationships, not measured traffic. Each world carries its head, timestamp, source links and coverage. Refreshes do not regenerate paid guides.

Local development uses SQLite for world snapshots. Production can make Cloudflare D1 authoritative for public snapshots and aliases through a private fixed-operation Worker bridge. Spending reservations, cached model guides and admission quotas remain on the persistent Bun host in their existing SQLite files. The company Worker cannot execute `bun:sqlite`; the gateway forwards the product application to that host. See [deployment and migration controls](docs/DEPLOYMENT.md#authoritative-d1-world-storage).

The `docs/` directory retains sanitized, dated development reports. Their historical tests, costs and local delivery statements are not current production evidence. [SETUP.md](docs/SETUP.md) records this repository's checks. The code for the English three-minute film is in `media/film`; generated speech and the finished film are private artifacts and are not part of this MIT source release.

## License

[MIT](LICENSE), copyright 2026 CHAORDERS LLC. Dependencies and media boundaries: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Game names describe visual inspiration; no game assets or endorsement are included.
