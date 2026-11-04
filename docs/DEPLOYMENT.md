# Deployment

Target: `https://chaorders.com/github-factory`.

## Bun application

The app needs Bun 1.4.4, a persistent SQLite directory and a single active serving instance per mounted data directory. Default path is `/github-factory/` and default local port is 4177. Create a private `.env` from the example and leave the paid budget at zero unless paid use is authorized. Keep data and ledger across releases. Never fork an active paid ledger or point a second model-enabled deployment at a fresh budget.

```sh
bun --no-env-file install --frozen-lockfile --ignore-scripts
MOONSHOT_BASE_PATH=/github-factory/ bun run build
HOST=127.0.0.1 PORT=4177 bun run start
curl --fail http://127.0.0.1:4177/github-factory/api/health
```

After committing a validated candidate, `MOONSHOT_SKIP_BUILD=1 scripts/install-local.sh` installs a versioned independent user service. It does not modify the incumbent `moonshot-web` service. Configure an **absolute** `MOONSHOT_DATA_DIR` in the private `.env` before service installation so release changes preserve the same cache and ledger. Inspect with `systemctl --user status github-factory-web`. The service records its exact source SHA.

Alternatively, `docker compose up --build -d` runs the Bun image on loopback with a persistent volume. Copy `.env.example` first; Docker reads `.env` server-side and never builds it into the image. Host filesystem paths in `MOONSHOT_DATA_DIR` are overridden by `/app/.data` inside the container. For rollback use the prior image/source with the **same** data volume and matching path; never delete the volume to reset spending.

## Existing Cloudflare site

The company site uses Cloudflare Workers. Bun SQLite cannot run inside that existing Worker. Deploy the Bun app on an authorized persistent host, expose an HTTPS origin through an authorized gateway/tunnel, then route only `/github-factory` and `/github-factory/*` to it. Keep the path prefix intact. Preserve the browser's original Host/Origin at the trusted reverse proxy, or validate an exact configured public origin server-side before allowing writes. Do not trust arbitrary forwarded headers.

`deploy/nginx-location.conf` is an example for a trusted same-host reverse proxy. The snippet preserves the Host and uses a 190-second proxy timeout to accommodate bounded repository collection and generation. Existing domain/Worker routing still needs to send this prefix to that proxy; copying the snippet does not make the domain live.

## Acceptance before claiming public deployment

- The exact repo head passes CI and its installed source SHA matches health.
- Public landing page, direct world deep link, scripts/CSS/favicon and prefixed APIs return usable responses.
- Pasting a public repo, changing perspective, source inspection and refreshing work on the public origin.
- Failed/partial/stale collection stays visible; any optional paid provider has a separately recorded real acceptance and ledger delta.
- Existing company paths still work and the origin is reachable with the intended access boundary.

Local checks are distinct from public DNS, gateway configuration, production rollout and live provider acceptance. No production-origin route or DNS change is performed by the setup scripts.

## Independent Cloudflare path gateway

`deploy/gateway.ts` is an independent Worker forwarding to `FACTORY_ORIGIN`, an HTTPS tunnel origin backed by the persistent Bun host. Build it with `bun build deploy/gateway.ts --target=browser --outfile=/tmp/github-factory-gateway.mjs`. Deploy it separately from the company-site Worker with the zone route `chaorders.com/github-factory*` and a `COMPANY_SITE` service binding to the existing `chaorders-site` Worker. Cloudflare matches query strings as part of its route selection: two exact path routes miss `/github-factory?style=...`. The gateway handles only the exact product path and its slash-prefixed children; adjacent paths such as `/github-factory-other` pass the original request and response through the company binding. The bare product path redirects to its trailing slash and retains the query string. No company-site source is bundled or modified.

Create a dedicated named tunnel and connector for this app; do not repurpose an existing shared connector. Its ingress must preserve `/github-factory/`, forward to loopback port 4177, and reject other paths. The app's server-only environment must set `MOONSHOT_PUBLIC_ORIGIN=https://chaorders.com`. The gateway retains that browser Origin, removes caller-supplied Host/forwarded headers, cookies and Authorization, and uses the tunnel's own HTTPS host upstream. Cross-origin POSTs are rejected at both layers. Never forward or expose the model keys through the Worker.

Rollback the public cutover by removing only the recorded product route; the existing company-site Worker remains deployed. To roll back the Bun app, restore the previous `github-factory-web.service` unit and restart that service, retaining the same absolute data directory. Preserve all SQLite files and paid ledger history. Keep the prior release and gateway/tunnel identities in a private deployment record. A rollback of a failed first cutover restores the pre-existing product 404; it does not create a previous public product release.

## GitHub Actions configuration

The repository uses `CLOUDFLARE_API_TOKEN` as an Actions Secret. Required permissions are target-account Workers Scripts Edit and Cloudflare Tunnel Edit, and `chaorders.com` Zone Read, DNS Edit and Workers Routes Edit. Never print it or put it in Variables, application `.env`, client bundles or build arguments.

Non-secret repository Variables are `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `FACTORY_ORIGIN`, `MOONSHOT_BASE_PATH`, `MOONSHOT_PUBLIC_ORIGIN` and `MOONSHOT_BUDGET_USD` (zero). `FACTORY_ORIGIN` points to the dedicated HTTPS tunnel hostname. These Variables are configuration records: storing them does not itself deploy a Worker or change the persistent host environment. The current app host is deployed separately with `scripts/install-local.sh`; existing CI performs checks and synthetic tests only. No model credentials or connector token belong in the frontend build.

## Public collection and model limits

`MOONSHOT_GITHUB_REQUESTS_PER_HOUR` defaults to **45 upstream HTTP attempts per UTC hour**, deployment-wide, persisted in `public-quota.sqlite` in the data directory. Retries count; cached reads do not. Admission is atomic across SQLite connections and survives service restarts. Zero disables collection. This is independent of the paid model ledger and does not imply that GitHub grants this many requests: unauthenticated limits can also be shared by other applications on the host. Upstream 403/429 and partial collection remain visible. At most two collections run concurrently; fresh data is cached for 90 seconds and forced refresh has a 15-second minimum interval. Public mutations also retain their shared eight-per-minute operation limit. An exhausted allowance leaves previous source evidence visible as stale; it is not reported as fresh success.

Importing a repository, refreshing facts and changing styles do not request a new paid guide from the browser. AI generation has its own explicit action, disabled when the provider is unconfigured or no budget remains. Production must retain zero budget and empty model credentials until separately authorized; no historical paid ledger is moved, copied or reset by this cutover.
