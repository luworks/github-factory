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
