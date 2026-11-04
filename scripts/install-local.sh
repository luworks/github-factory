#!/usr/bin/env bash
# Isolated, reversible user service. No parent factory service or ACL changes.
set -euo pipefail
moonshot_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
moonshot_port="${MOONSHOT_PORT:-4177}"
moonshot_bind="${MOONSHOT_BIND:-127.0.0.1}"
moonshot_bun="$(command -v bun)"
moonshot_unit="$HOME/.config/systemd/user/github-factory-web.service"
moonshot_release="$HOME/.local/share/github-factory/releases/$(date -u +%Y%m%dT%H%M%SZ)"
[[ -f "$moonshot_root/.env" ]] || { echo 'Missing project-local .env'; exit 1; }
git -C "$moonshot_root" diff --quiet HEAD -- "$moonshot_root" || { echo 'Commit the Moonshot candidate before installing'; exit 1; }
[[ -z "$(git -C "$moonshot_root" ls-files --others --exclude-standard -- "$moonshot_root")" ]] || { echo 'Untracked Moonshot source files must be committed first'; exit 1; }
if [[ "${MOONSHOT_SKIP_BUILD:-0}" != 1 ]]; then
  (cd "$moonshot_root" && "$moonshot_bun" --no-env-file run build)
fi
[[ -f "$moonshot_root/.output/server/index.mjs" ]] || { echo 'Missing production build'; exit 1; }
mkdir -p "$moonshot_release" "$(dirname "$moonshot_unit")"
cp -R "$moonshot_root/.output" "$moonshot_release/.output"
cp "$moonshot_root/.env" "$moonshot_release/.env"
chmod 600 "$moonshot_release/.env"
printf '%s\n' "$(git -C "$moonshot_root" rev-parse HEAD)" > "$moonshot_release/SOURCE_SHA"
cat > "$moonshot_unit" <<UNIT
[Unit]
Description=GitHub Factory (Moonshot)
After=network-online.target
[Service]
WorkingDirectory=$moonshot_release
Environment=HOST=$moonshot_bind
Environment=PORT=$moonshot_port
Environment=PATH=$(dirname "$moonshot_bun"):/usr/local/bin:/usr/bin:/bin
ExecStart=$moonshot_bun --no-env-file $moonshot_release/.output/server/index.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable github-factory-web.service
systemctl --user restart github-factory-web.service
printf 'Moonshot release: %s\nURL: http://%s:%s\n' "$moonshot_release" "$moonshot_bind" "$moonshot_port"
