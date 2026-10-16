#!/usr/bin/env bash
# Owner-authorized native deployment; preserves existing data and other services.
set -euo pipefail
test "$(id -u)" -eq 0 || { echo 'Run this installer as the server administrator.' >&2; exit 1; }
cforge_source="${1:?Provide the extracted, verified C Forge source directory}"
cforge_node_version=v24.21.0
cforge_app=/opt/c-forge
cforge_data=/srv/apps/c-forge/data
cforge_runtime=/opt/c-forge-runtime
cforge_node="$cforge_runtime/bin/node"
test -f "$cforge_source/package-lock.json"
test -f "$cforge_source/server/migrations/001.sql"
mountpoint -q /srv || { echo 'Persistent /srv mount is required.' >&2; exit 1; }
test "$(stat -fc %T /sys/fs/cgroup)" = cgroup2fs
test "$(df -B1 --output=avail /var/lib | tail -n1 | tr -d ' ')" -gt 4294967296 || { echo 'Need4 GiB free on the application filesystem.' >&2; exit 1; }
test "$(df -B1 --output=avail /srv | tail -n1 | tr -d ' ')" -gt 1073741824 || { echo 'Need1 GiB free for application data.' >&2; exit 1; }
if [ -d "$cforge_app" ] && [ ! -f "$cforge_app/.c-forge-managed" ] && [ -n "$(find "$cforge_app" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo 'Existing /opt/c-forge is not managed by this installer; preserving it.' >&2; exit 1
fi
if ! id cforge >/dev/null 2>&1; then
  useradd --system --home-dir "$cforge_data" --shell /usr/sbin/nologin cforge
fi
install -d -m 700 -o cforge -g cforge "$cforge_data"
install -d -m 700 -o cforge -g cforge /var/cache/c-forge-npm
install -d -m 755 /etc/c-forge "$cforge_app" /var/backups/c-forge
install -d -m 700 -o cforge -g cforge /var/backups/c-forge/learner
cforge_tmp="$(mktemp -d /var/tmp/c-forge-install.XXXXXX)"
trap 'rm -rf "$cforge_tmp"' EXIT
if [ ! -x "$cforge_node" ]; then
  case "$(uname -m)" in aarch64) cforge_arch=arm64;; x86_64) cforge_arch=x64;; *) echo 'Unsupported Node architecture.' >&2; exit 1;; esac
  cforge_archive="node-${cforge_node_version}-linux-${cforge_arch}.tar.xz"
  curl --fail --silent --show-error --location --max-time 180 "https://nodejs.org/dist/$cforge_node_version/$cforge_archive" -o "$cforge_tmp/$cforge_archive"
  curl --fail --silent --show-error --location --max-time 60 "https://nodejs.org/dist/$cforge_node_version/SHASUMS256.txt" -o "$cforge_tmp/SHASUMS256.txt"
  (cd "$cforge_tmp"; awk -v name="$cforge_archive" '$2 == name {print}' SHASUMS256.txt > selected.sha256; test -s selected.sha256; sha256sum --check selected.sha256)
  install -d -m 755 "$cforge_runtime"
  tar -xJf "$cforge_tmp/$cforge_archive" --strip-components=1 -C "$cforge_runtime"
  chown -R root:root "$cforge_runtime"
fi
"$cforge_node" -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
if [ -f /etc/c-forge/app.env ]; then
  cp -p /etc/c-forge/app.env "$cforge_tmp/previous-app.env"
fi
if [ -f "$cforge_app/.c-forge-managed" ]; then
  if systemctl is-active --quiet c-forge; then
    (cd "$cforge_app"; runuser -u cforge -- env DATA_DIR="$cforge_data" "$cforge_node" --import tsx scripts/admin.ts backup "$cforge_data/backups/pre-update-$(date -u +%Y%m%dT%H%M%SZ)")
  fi
  tar --exclude=node_modules --exclude=dist --exclude=.data --exclude=.env -czf "/var/backups/c-forge/source-$(date -u +%Y%m%dT%H%M%SZ).tgz" -C "$cforge_app" .
fi
systemctl stop c-forge.service 2>/dev/null || true
rsync -a --delete --exclude=node_modules --exclude=dist --exclude=.c-forge-managed --exclude=.data --exclude=.env "$cforge_source/" "$cforge_app/"
touch "$cforge_app/.c-forge-managed"
chown -R cforge:cforge "$cforge_app"
(cd "$cforge_app"; runuser -u cforge -- env PATH="$cforge_runtime/bin:/usr/bin:/bin" CFORGE_BASE_PATH=/forge/ "$cforge_runtime/bin/npm" ci --cache /var/cache/c-forge-npm --no-audit --no-fund; runuser -u cforge -- env PATH="$cforge_runtime/bin:/usr/bin:/bin" CFORGE_BASE_PATH=/forge/ "$cforge_runtime/bin/npm" run build)
chown -R root:root "$cforge_app"
chmod -R a+rX "$cforge_app"
CFORGE_APP_ENV=/etc/c-forge/app.env "$cforge_node" --input-type=module <<'CFORGE_ENV'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
const path=process.env.CFORGE_APP_ENV;
const previous=existsSync(path)?parseEnv(readFileSync(path,'utf8')):{};
const env={...previous, HOST:'127.0.0.1', PORT:'3030', DATA_DIR:'/srv/apps/c-forge/data', COOKIE_SECURE:'true', COOKIE_NAME:'cforge_session', COOKIE_PATH:'/forge/', TRUST_PROXY_LOOPBACK:'true', RUNNER_SECRET:previous.RUNNER_SECRET||randomBytes(32).toString('base64url')};
if(!/^[A-Za-z0-9_-]{32,}$/.test(env.RUNNER_SECRET))throw Error('Existing runner credential has an unsupported format; preserving it and aborting.');
writeFileSync(path,Object.entries(env).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600});chmodSync(path,0o600);
CFORGE_ENV
chown cforge:cforge /etc/c-forge/app.env
cat > /etc/systemd/system/c-forge.service <<'CFORGE_UNIT'
[Unit]
Description=C Forge learning application
After=network.target
RequiresMountsFor=/srv/apps/c-forge/data
[Service]
Type=simple
User=cforge
Group=cforge
WorkingDirectory=/opt/c-forge
EnvironmentFile=/etc/c-forge/app.env
ExecStart=/opt/c-forge-runtime/bin/node --import tsx server/index.ts
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/apps/c-forge/data
[Install]
WantedBy=multi-user.target
CFORGE_UNIT
cat > /etc/systemd/system/c-forge-backup.service <<'CFORGE_BACKUP_UNIT'
[Unit]
Description=C Forge consistent bounded learner backup
RequiresMountsFor=/srv/apps/c-forge/data
[Service]
Type=oneshot
User=cforge
Group=cforge
WorkingDirectory=/opt/c-forge
Environment=DATA_DIR=/srv/apps/c-forge/data
Environment=CFORGE_BACKUP_ROOT=/var/backups/c-forge/learner
ExecStart=/usr/bin/flock -n /srv/apps/c-forge/data/.backup.lock /opt/c-forge-runtime/bin/node --import tsx scripts/daily-backup.ts
TimeoutStartSec=2min
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/apps/c-forge/data /var/backups/c-forge/learner
CFORGE_BACKUP_UNIT
cat > /etc/systemd/system/c-forge-backup.timer <<'CFORGE_BACKUP_TIMER'
[Unit]
Description=C Forge daily protected backup
[Timer]
OnCalendar=*-*-* 02:30:00 UTC
RandomizedDelaySec=30min
Persistent=true
Unit=c-forge-backup.service
[Install]
WantedBy=timers.target
CFORGE_BACKUP_TIMER
systemctl daemon-reload
systemctl enable --now c-forge.service
systemctl enable --now c-forge-backup.timer
for cforge_attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3030/api/health > "$cforge_tmp/health.json"; then break; fi
  sleep 1
done
"$cforge_node" -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1]));if(v.status!=="ok"||!v.database)process.exit(1)' "$cforge_tmp/health.json"
echo 'C Forge started on private loopback3030 with persistent mounted data storage and protected owner setup.'
