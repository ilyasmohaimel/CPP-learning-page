#!/usr/bin/env bash
# Administrator setup for the private Ubuntu runner. No learner code is ever
# executed on the host. Run AFTER the app/Node 24 installation, as root.
set -Eeuo pipefail
umask 077

if [[ ${1:-} == --help ]]; then
  printf '%s\n' 'Usage: sudo bash /opt/c-forge/deploy/setup-runner.sh' \
    'Requires the installed app, Node 24+, and existing /etc/c-forge/app.env.' \
    'Installs only the dedicated rootless worker; all execution gates must pass.'
  exit 0
fi
[[ $# == 0 ]] || { printf '%s\n' 'No arguments are supported except --help.' >&2; exit 2; }
[[ $EUID == 0 ]] || { printf '%s\n' 'Run this setup as the host administrator.' >&2; exit 2; }

readonly CFORGE_APP=/opt/c-forge
readonly CFORGE_NODE=/opt/c-forge-runtime/bin/node
readonly CFORGE_ACCOUNT=cforge-runner
readonly CFORGE_STATE=/var/lib/c-forge-runner
readonly CFORGE_USER_HOME=$CFORGE_STATE/home
readonly CFORGE_JOBS=$CFORGE_STATE/jobs
readonly CFORGE_STORAGE=$CFORGE_STATE/storage
readonly CFORGE_APP_ENV=/etc/c-forge/app.env
readonly CFORGE_APP_DATA=/srv/apps/c-forge/data
readonly CFORGE_WORKER_ENV=/etc/c-forge/runner.env
readonly CFORGE_API=http://127.0.0.1:3030
readonly CFORGE_TAG=localhost/c-forge-toolchain:gcc14.2-v1
readonly CFORGE_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
readonly CFORGE_LOG_DIR="/var/log/c-forge-runner-setup/$CFORGE_RUN_ID"
CFORGE_STEP=initial-checks
CFORGE_VERIFIED=0
CFORGE_UID=
CFORGE_GID=
CFORGE_RUNTIME=
CFORGE_CANDIDATE=

exec 9>/run/c-forge-runner-setup.lock
flock -n 9 || { printf '%s\n' 'Another C Forge runner setup is active.' >&2; exit 2; }
install -d -m 0700 "$CFORGE_LOG_DIR"

fail() { printf '%s\n' "$1" >&2; exit 1; }
no_symlinks() {
  local cforge_path=$1 cforge_part cforge_cursor=
  local -a cforge_parts
  IFS=/ read -r -a cforge_parts <<<"$cforge_path"
  for cforge_part in "${cforge_parts[@]}"; do
    [[ -n $cforge_part ]] || continue
    cforge_cursor+="/$cforge_part"
    [[ ! -L $cforge_cursor ]] || fail 'A managed setup path is a symlink; no target data was changed.'
  done
}
step() {
  local cforge_name=$1 cforge_budget=$2
  shift 2
  CFORGE_STEP=$cforge_name
  printf 'RUNNER_SETUP_STEP %s\n' "$cforge_name"
  /usr/bin/timeout --signal=TERM --kill-after=15 "$cforge_budget" \
    /bin/bash -c '"$@"' c-forge-step "$@" \
    >"$CFORGE_LOG_DIR/$cforge_name.log" 2>&1
}
as_runner() {
  /usr/sbin/runuser --user "$CFORGE_ACCOUNT" -- /usr/bin/env -i -C "$CFORGE_APP" \
    HOME="$CFORGE_USER_HOME" USER="$CFORGE_ACCOUNT" LOGNAME="$CFORGE_ACCOUNT" \
    SHELL=/bin/bash PATH=/opt/c-forge-runtime/bin:/usr/local/bin:/usr/bin:/bin \
    TMPDIR="$CFORGE_JOBS" XDG_RUNTIME_DIR="$CFORGE_RUNTIME" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$CFORGE_RUNTIME/bus" "$@"
}
user_systemctl() { as_runner /usr/bin/systemctl --user "$@"; }
user_job() {
  local cforge_label=$1 cforge_budget=$2
  shift 2
  # A real user-manager unit supplies delegated cgroups even when setup arrived
  # through noninteractive SSH. The inner timeout also bounds a lost SSH client.
  as_runner /usr/bin/systemd-run --user --quiet --wait --pipe --collect \
    --unit="c-forge-setup-$CFORGE_RUN_ID-$cforge_label" \
    --property=Delegate=yes --property=TimeoutStopSec=15 \
    --property=KillMode=control-group --working-directory="$CFORGE_APP" \
    --setenv="HOME=$CFORGE_USER_HOME" \
    --setenv=PATH=/opt/c-forge-runtime/bin:/usr/local/bin:/usr/bin:/bin \
    --setenv="TMPDIR=$CFORGE_JOBS" --setenv="XDG_RUNTIME_DIR=$CFORGE_RUNTIME" \
    --setenv="DBUS_SESSION_BUS_ADDRESS=unix:path=$CFORGE_RUNTIME/bus" \
    /usr/bin/timeout --signal=TERM --kill-after=15 "$cforge_budget" "$@"
}
# The timeout wrapper invokes exported functions with their argument arrays.
# These settings contain paths and identity only; credentials stay in files.
export -f as_runner user_systemctl user_job
export CFORGE_APP CFORGE_ACCOUNT CFORGE_USER_HOME CFORGE_JOBS CFORGE_RUN_ID CFORGE_RUNTIME
finish() {
  local cforge_status=$?
  trap - EXIT
  if [[ -n $CFORGE_CANDIDATE && -f $CFORGE_CANDIDATE ]]; then
    rm -f -- "$CFORGE_CANDIDATE"
  fi
  if [[ $CFORGE_VERIFIED != 1 ]]; then
    # Never leave a newly installed worker serving jobs after a failed gate.
    if [[ -n $CFORGE_RUNTIME && -S $CFORGE_RUNTIME/bus ]]; then
      /usr/bin/timeout --kill-after=5 15 /usr/sbin/runuser --user "$CFORGE_ACCOUNT" -- \
        /usr/bin/env -i -C "$CFORGE_APP" HOME="$CFORGE_USER_HOME" XDG_RUNTIME_DIR="$CFORGE_RUNTIME" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=$CFORGE_RUNTIME/bus" \
        /usr/bin/systemctl --user stop c-forge-runner.service \
        >"$CFORGE_LOG_DIR/stop-after-failure.log" 2>&1 || true
      if [[ -x /usr/bin/podman && -x $CFORGE_NODE ]]; then
        # A killed verification process may not have reached its finally block.
        # Remove only this dedicated user's specifically labelled UUID jobs.
        /usr/bin/timeout --kill-after=5 30 /usr/sbin/runuser --user "$CFORGE_ACCOUNT" -- \
          /usr/bin/env -i -C "$CFORGE_APP" HOME="$CFORGE_USER_HOME" XDG_RUNTIME_DIR="$CFORGE_RUNTIME" \
          PATH=/usr/bin:/bin TMPDIR="$CFORGE_JOBS" \
          DBUS_SESSION_BUS_ADDRESS="unix:path=$CFORGE_RUNTIME/bus" \
          "$CFORGE_NODE" --input-type=module - \
          >"$CFORGE_LOG_DIR/cleanup-after-failure.log" 2>&1 <<'CFORGE_CLEANUP_JS' || true
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute = promisify(execFile);
const result = await execute('/usr/bin/podman',['ps','--all','--filter','label=io.c-forge.runner=1','--format','{{.Names}}'],{timeout:8000,maxBuffer:65536});
const names = result.stdout.trim().split('\n').filter(name=>/^c-forge-(?:compile|execute|probe)-[a-f0-9-]{36}$/.test(name));
if(names.length) await execute('/usr/bin/podman',['rm','--force','--ignore',...names],{timeout:15000,maxBuffer:65536});
console.log(`Dedicated-worker interrupted job containers removed: ${names.length}.`);
CFORGE_CLEANUP_JS
      fi
    fi
    printf 'RUNNER_SETUP_FAILED step=%s logs=%s\n' "$CFORGE_STEP" "$CFORGE_LOG_DIR" >&2
  fi
  exit "$cforge_status"
}
trap finish EXIT

[[ -x $CFORGE_NODE ]] || fail 'Install the isolated Node 24 runtime before the worker.'
[[ -f $CFORGE_APP/runner/podman.ts && -d $CFORGE_APP/node_modules/tsx ]] || fail 'Install the C Forge source and locked dependencies first.'
[[ -f $CFORGE_APP_ENV && ! -L $CFORGE_APP_ENV ]] || fail 'An existing regular app.env with the administrator-generated runner credential is required.'
[[ -d $CFORGE_APP_DATA ]] || fail 'The reviewed private application-data directory must exist before worker setup.'
no_symlinks /etc/c-forge
[[ -d /run/systemd/system && $(stat -fc %T /sys/fs/cgroup) == cgroup2fs ]] || fail 'The worker requires systemd and cgroup v2; no weaker fallback is supported.'
[[ $("$CFORGE_NODE" -p 'Number(process.versions.node.split(".")[0])') -ge 24 ]] || fail 'The dedicated runtime must be Node 24 or newer.'
[[ $(uname -m) == aarch64 || $(uname -m) == x86_64 ]] || fail 'This setup supports native ARM64 and x86-64 Linux images only.'
[[ $(stat -c %d /var/lib) == $(stat -c %d /) ]] || fail '/var/lib must use the boot filesystem for this deployment; /srv storage is intentionally unused.'
[[ $(df -PB1 /var/lib | awk 'NR == 2 {print $4}') -ge 6442450944 ]] || fail 'Keep at least 6 GiB free on the boot filesystem before pulling the toolchain.'
[[ $(awk '$1 == "FROM" {print $2}' "$CFORGE_APP/runner/Dockerfile") == docker.io/library/gcc:14.2.0-bookworm ]] || fail 'The toolchain recipe must use the reviewed fixed GCC 14.2.0 image.'

step api-health 15 "$CFORGE_NODE" --input-type=module - <<'CFORGE_HEALTH_JS'
const response = await fetch('http://127.0.0.1:3030/api/health', {signal: AbortSignal.timeout(8000)});
if (!response.ok) throw new Error('The installed private API health check failed.');
const body = await response.json();
if (body.status !== 'ok' || body.database !== true) throw new Error('The private API has no verified database health.');
console.log('Private API and database health passed.');
CFORGE_HEALTH_JS

step apt-update 300 /usr/bin/env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l \
  apt-get -o DPkg::Lock::Timeout=120 update
step apt-install 600 /usr/bin/env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l \
  apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends \
  podman crun catatonit uidmap slirp4netns fuse-overlayfs dbus-user-session acl gcc

CFORGE_STEP=worker-identity
[[ ! -L $CFORGE_STATE ]] || fail 'The dedicated worker state directory must not be a symlink.'
install -d -m 0711 "$CFORGE_STATE"
if ! getent passwd "$CFORGE_ACCOUNT" >/dev/null; then
  useradd --user-group --create-home --home-dir "$CFORGE_USER_HOME" --shell /bin/bash "$CFORGE_ACCOUNT"
fi
CFORGE_UID=$(id -u "$CFORGE_ACCOUNT")
CFORGE_GID=$(id -g "$CFORGE_ACCOUNT")
readonly CFORGE_UID CFORGE_GID
[[ $CFORGE_UID -ge 1000 && $CFORGE_UID != "$(id -u cforge)" ]] || fail 'The worker must have its own unprivileged identity, separate from cforge.'
[[ $(getent passwd "$CFORGE_ACCOUNT" | cut -d: -f6) == "$CFORGE_USER_HOME" ]] || fail 'Existing worker home differs from the dedicated boot-filesystem location; no account or data was moved.'
[[ $(id -G "$CFORGE_ACCOUNT") == "$CFORGE_GID" ]] || fail 'The worker must not belong to app, Docker, sudo, or other supplementary groups.'
for cforge_subordinate in /etc/subuid /etc/subgid; do
  awk -F: -v account="$CFORGE_ACCOUNT" '$1 == account && $3 >= 65536 {found=1} END {exit !found}' \
    "$cforge_subordinate" || fail 'The dedicated user needs a normal nonoverlapping 65,536+ subordinate UID/GID allocation. No mappings were overwritten.'
done
for cforge_directory in "$CFORGE_USER_HOME" "$CFORGE_JOBS" "$CFORGE_STORAGE"; do
  no_symlinks "$cforge_directory"
  install -d -m 0700 -o "$CFORGE_UID" -g "$CFORGE_GID" "$cforge_directory"
  [[ $(stat -c %d "$cforge_directory") == $(stat -c %d /) ]] || fail 'Worker storage must remain on the boot filesystem.'
done
CFORGE_RUNTIME="/run/user/$CFORGE_UID"
readonly CFORGE_RUNTIME
no_symlinks "$CFORGE_USER_HOME/.config/containers"
no_symlinks "$CFORGE_USER_HOME/.config/systemd/user"
install -d -m 0700 -o "$CFORGE_UID" -g "$CFORGE_GID" \
  "$CFORGE_USER_HOME/.config/containers" "$CFORGE_USER_HOME/.config/systemd/user"

# Grant only traversal to the shared configuration directory. app.env remains
# unreadable to the worker; its contents and permissions are never changed.
setfacl -m "u:$CFORGE_ACCOUNT:--x" /etc/c-forge
as_runner /usr/bin/test ! -r "$CFORGE_APP_ENV" || fail 'The worker can read app.env; fix app-secret permissions before continuing.'
as_runner /usr/bin/test ! -x "$CFORGE_APP_DATA" || fail 'The worker can traverse application data; deployment separation failed.'
as_runner /usr/bin/test ! -r /var/run/docker.sock || fail 'The worker can read the Docker socket; rootful orchestration access is prohibited.'
as_runner /usr/bin/test ! -w /var/run/docker.sock || fail 'The worker can write the Docker socket; rootful orchestration access is prohibited.'
as_runner /usr/bin/test -r "$CFORGE_APP/runner/worker.ts" || fail 'The worker must be able to read the installed code.'
as_runner /usr/bin/test ! -w "$CFORGE_APP/runner/worker.ts" || fail 'Installed worker code must be administrator-owned and read-only to the worker.'

CFORGE_STEP=worker-storage-config
cforge_storage_config="$CFORGE_USER_HOME/.config/containers/storage.conf"
no_symlinks "$cforge_storage_config"
cforge_storage_staged="$CFORGE_LOG_DIR/storage.conf"
cat >"$cforge_storage_staged" <<CFORGE_STORAGE_CONF
# Managed by C Forge's dedicated-worker setup. No rootful Docker storage.
[storage]
driver = "overlay"
runroot = "$CFORGE_RUNTIME/containers"
graphroot = "$CFORGE_STORAGE"
[storage.options.overlay]
mount_program = "/usr/bin/fuse-overlayfs"
CFORGE_STORAGE_CONF
if [[ -e $cforge_storage_config ]]; then
  [[ ! -L $cforge_storage_config ]] && cmp -s "$cforge_storage_staged" "$cforge_storage_config" \
    || fail 'Existing worker storage configuration differs; no storage was reset or overwritten.'
else
  install -m 0600 -o "$CFORGE_UID" -g "$CFORGE_GID" "$cforge_storage_staged" "$cforge_storage_config"
fi

CFORGE_STEP=user-cgroup-delegation
cforge_dropin_dir="/etc/systemd/system/user@$CFORGE_UID.service.d"
install -d -m 0755 "$cforge_dropin_dir"
cat >"$CFORGE_LOG_DIR/delegation.conf" <<'CFORGE_DELEGATION_CONF'
[Service]
Delegate=cpu cpuset io memory pids
CFORGE_DELEGATION_CONF
cforge_delegation_changed=0
if ! cmp -s "$CFORGE_LOG_DIR/delegation.conf" "$cforge_dropin_dir/90-c-forge-runner.conf"; then
  install -m 0644 "$CFORGE_LOG_DIR/delegation.conf" "$cforge_dropin_dir/90-c-forge-runner.conf"
  cforge_delegation_changed=1
fi
step systemd-reload 30 systemctl daemon-reload
step enable-worker-linger 30 loginctl enable-linger "$CFORGE_ACCOUNT"
if [[ $cforge_delegation_changed == 1 ]] && systemctl is-active --quiet "user@$CFORGE_UID.service"; then
  step restart-dedicated-user-manager 45 systemctl restart "user@$CFORGE_UID.service"
else
  step start-dedicated-user-manager 45 systemctl start "user@$CFORGE_UID.service"
fi
[[ -S $CFORGE_RUNTIME/bus ]] || fail 'The dedicated systemd user bus did not start.'
step stop-worker-during-verification 30 user_systemctl stop c-forge-runner.service || \
  [[ ! -e $CFORGE_USER_HOME/.config/systemd/user/c-forge-runner.service ]]

step podman-info 30 as_runner /usr/bin/podman info --format=json
step host-toolchain-versions 15 /usr/bin/env /bin/bash -c \
  '/usr/bin/podman --version; /usr/bin/gcc --version; /opt/c-forge-runtime/bin/node --version; uname -m'

CFORGE_STEP=toolchain-context
readonly CFORGE_CONTEXT="$CFORGE_STATE/build-context"
[[ ! -L $CFORGE_CONTEXT ]] || fail 'The toolchain context must not be a symlink.'
no_symlinks "$CFORGE_CONTEXT/runner"
no_symlinks "$CFORGE_CONTEXT/Containerfile"
no_symlinks "$CFORGE_CONTEXT/runner/run.sh"
no_symlinks "$CFORGE_CONTEXT/runner/preflight.sh"
install -d -m 0700 -o "$CFORGE_UID" -g "$CFORGE_GID" "$CFORGE_CONTEXT" "$CFORGE_CONTEXT/runner"
# Ubuntu 22.04 ships older Buildah. COPY+RUN chmod is equivalent to COPY
# --chmod without requiring a newer Dockerfile frontend. No privileges are
# relaxed and only these three public toolchain files enter the build context.
awk '
  /^COPY --chmod=755 / {sub(/^COPY --chmod=755 /,"COPY ")}
  /^USER / {print "RUN chmod 0755 /opt/c-forge/run /opt/c-forge/preflight"}
  {print}
' "$CFORGE_APP/runner/Dockerfile" >"$CFORGE_CONTEXT/Containerfile"
install -m 0755 -o "$CFORGE_UID" -g "$CFORGE_GID" "$CFORGE_APP/runner/run.sh" "$CFORGE_CONTEXT/runner/run.sh"
install -m 0755 -o "$CFORGE_UID" -g "$CFORGE_GID" "$CFORGE_APP/runner/preflight.sh" "$CFORGE_CONTEXT/runner/preflight.sh"
chown "$CFORGE_UID:$CFORGE_GID" "$CFORGE_CONTEXT/Containerfile"
chmod 0600 "$CFORGE_CONTEXT/Containerfile"
CFORGE_SOURCE_HASH=$(sha256sum "$CFORGE_APP/runner/Dockerfile" "$CFORGE_APP/runner/run.sh" "$CFORGE_APP/runner/preflight.sh" | sha256sum | cut -d' ' -f1)
readonly CFORGE_SOURCE_HASH
cforge_cached_hash=
no_symlinks "$CFORGE_STATE/toolchain-source.sha256"
no_symlinks "$CFORGE_STATE/toolchain-image-id"
[[ ! -f $CFORGE_STATE/toolchain-source.sha256 ]] || read -r cforge_cached_hash <"$CFORGE_STATE/toolchain-source.sha256"
if [[ $cforge_cached_hash != "$CFORGE_SOURCE_HASH" ]] || \
  ! as_runner /usr/bin/podman image exists "$CFORGE_TAG"; then
  # Podman 3.4's build option is --pull-always, not --pull=always.
  step build-fixed-toolchain 1200 user_job build 1150 /usr/bin/podman build \
    --pull-always --network=none --force-rm --file "$CFORGE_CONTEXT/Containerfile" \
    --tag "$CFORGE_TAG" "$CFORGE_CONTEXT"
fi
CFORGE_STEP=immutable-image-id
cforge_image_id=$(as_runner /usr/bin/podman image inspect --format '{{.Id}}' "$CFORGE_TAG")
[[ $cforge_image_id =~ ^(sha256:)?[a-f0-9]{64}$ ]] || fail 'The rootless image did not return a full immutable SHA-256 ID.'
CFORGE_IMAGE="sha256:${cforge_image_id#sha256:}"
readonly CFORGE_IMAGE
# Resolve the exact normalized immutable ID through the installed engine before
# using it in an environment file. It must not become a remote registry name.
step verify-local-image-id 30 as_runner /usr/bin/podman image inspect "$CFORGE_IMAGE"
[[ $(df -PB1 /var/lib | awk 'NR == 2 {print $4}') -ge 2147483648 ]] || fail 'Fewer than 2 GiB remain after the toolchain build; execution remains disabled.'

CFORGE_STEP=stage-worker-environment
CFORGE_CANDIDATE="/etc/c-forge/.runner-candidate-$CFORGE_RUN_ID.env"
"$CFORGE_NODE" --input-type=module - "$CFORGE_APP_ENV" "$CFORGE_WORKER_ENV" \
  "$CFORGE_CANDIDATE" "$CFORGE_IMAGE" "$CFORGE_UID" "$CFORGE_GID" <<'CFORGE_ENV_JS'
import {readFileSync,writeFileSync,existsSync,lstatSync,chownSync} from 'node:fs';
import {parseEnv} from 'node:util';
const [appPath,workerPath,candidate,image,uid,gid] = process.argv.slice(2);
const app = parseEnv(readFileSync(appPath,'utf8'));
const secret = app.RUNNER_SECRET;
// Administrator-generated hex/base64/url-safe credentials. Never print the
// value, put it in argv, source shell text, or alter the existing app config.
if (!secret || !/^[A-Za-z0-9+/_=-]{32,512}$/.test(secret)) throw new Error('The existing API runner credential is absent or not a supported generated token; no credential was overwritten.');
let text = '# Dedicated private worker settings. No application-data access.\n';
if (existsSync(workerPath)) {
  if (!lstatSync(workerPath).isFile() || lstatSync(workerPath).isSymbolicLink()) throw new Error('runner.env must be a regular file.');
  text = readFileSync(workerPath,'utf8');
  const old = parseEnv(text), allowed = new Set(['RUNNER_SECRET','RUNNER_API_URL','RUNNER_IMAGE']);
  if (Object.keys(old).some(k=>!allowed.has(k))) throw new Error('Existing worker environment contains extra settings; no configuration was overwritten.');
  for (const key of allowed) if ((text.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, 'gm'))??[]).length>1) throw new Error('Duplicate worker configuration key; no configuration was overwritten.');
  if (old.RUNNER_SECRET && old.RUNNER_SECRET!==secret) throw new Error('Existing worker/API credentials differ; no secret was overwritten.');
  if (old.RUNNER_API_URL && old.RUNNER_API_URL!=='http://127.0.0.1:3030') throw new Error('Existing worker origin differs from the reviewed private API; no configuration was overwritten.');
}
const old = parseEnv(text);
for (const [key,value] of Object.entries({RUNNER_API_URL:'http://127.0.0.1:3030',RUNNER_SECRET:secret,RUNNER_IMAGE:image})) {
  if (old[key]!==undefined) text = text.replace(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'm'), `${key}=${value}`);
  else text += `${text.endsWith('\n')?'':'\n'}${key}=${value}\n`;
}
writeFileSync(candidate,text,{flag:'wx',mode:0o600});
chownSync(candidate,Number(uid),Number(gid));
CFORGE_ENV_JS

step isolation-preflight 180 user_job preflight 150 "$CFORGE_NODE" \
  --env-file="$CFORGE_CANDIDATE" --import tsx --input-type=module - <<'CFORGE_PREFLIGHT_JS'
import {PodmanRunner} from '/opt/c-forge/runner/podman.ts';
const result = await new PodmanRunner({image:process.env.RUNNER_IMAGE}).preflight();
console.log(JSON.stringify(result));
if (!result.available) process.exitCode=1;
CFORGE_PREFLIGHT_JS
step isolated-operational-tests 210 user_job tests 180 /usr/bin/env CFORGE_RUNNER_TESTS=1 \
  "$CFORGE_NODE" --env-file="$CFORGE_CANDIDATE" --import tsx tests/runner.test.ts
step isolated-curriculum-verification 1230 user_job curriculum 1200 "$CFORGE_NODE" \
  --env-file="$CFORGE_CANDIDATE" --import tsx scripts/verify-content.ts
step isolated-cpp-curriculum-verification 1230 user_job curriculum-cpp 1200 "$CFORGE_NODE" \
  --env-file="$CFORGE_CANDIDATE" --import tsx scripts/verify-content.ts --course=cpp20

CFORGE_STEP=install-verified-worker
no_symlinks "$CFORGE_USER_HOME/.config/systemd/user/c-forge-runner.service"
if [[ -f $CFORGE_WORKER_ENV ]]; then
  # A recoverable root-only copy preserves pre-update settings without exposing
  # them as CI artifacts or allowing the worker to read application secrets.
  install -m 0600 -o root -g root "$CFORGE_WORKER_ENV" \
    "/etc/c-forge/.runner-before-$CFORGE_RUN_ID.env"
fi
mv -f -- "$CFORGE_CANDIDATE" "$CFORGE_WORKER_ENV"
CFORGE_CANDIDATE=
chmod 0600 "$CFORGE_WORKER_ENV"
chown "$CFORGE_UID:$CFORGE_GID" "$CFORGE_WORKER_ENV"
printf '%s\n' "$CFORGE_SOURCE_HASH" >"$CFORGE_STATE/toolchain-source.sha256"
printf '%s\n' "$CFORGE_IMAGE" >"$CFORGE_STATE/toolchain-image-id"
chmod 0600 "$CFORGE_STATE/toolchain-source.sha256" "$CFORGE_STATE/toolchain-image-id"
cat >"$CFORGE_LOG_DIR/c-forge-runner.service" <<CFORGE_UNIT
[Unit]
Description=C Forge private isolated compiler worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$CFORGE_APP
EnvironmentFile=$CFORGE_WORKER_ENV
Environment=PATH=/opt/c-forge-runtime/bin:/usr/local/bin:/usr/bin:/bin
Environment=TMPDIR=$CFORGE_JOBS
Environment=HOME=$CFORGE_USER_HOME
Environment=XDG_RUNTIME_DIR=$CFORGE_RUNTIME
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=$CFORGE_RUNTIME/bus
ExecStart=$CFORGE_NODE --import tsx runner/worker.ts
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20
UMask=0077
Delegate=yes

[Install]
WantedBy=default.target
CFORGE_UNIT
install -m 0644 -o "$CFORGE_UID" -g "$CFORGE_GID" "$CFORGE_LOG_DIR/c-forge-runner.service" \
  "$CFORGE_USER_HOME/.config/systemd/user/c-forge-runner.service"
step reload-worker-user-units 30 user_systemctl daemon-reload
step enable-verified-worker 45 user_systemctl enable --now c-forge-runner.service
step verify-worker-active 15 user_systemctl is-active c-forge-runner.service

# Root-only readback inspects the worker heartbeat table, never learner records.
# This proves the actual service authenticated to the private API and persisted
# its availability. The worker itself is still unable to open this database.
step verify-api-worker-heartbeat 75 "$CFORGE_NODE" --input-type=module - "$CFORGE_APP_ENV" "$CFORGE_APP_DATA" <<'CFORGE_HEARTBEAT_JS'
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as pause} from 'node:timers/promises';
const app = parseEnv(readFileSync(process.argv[2],'utf8'));
const approvedData = process.argv[3];
const databasePath = resolve(app.DATABASE_PATH || join(app.DATA_DIR || approvedData,'c-forge.sqlite'));
if (!databasePath.startsWith(`${approvedData}/`)) throw new Error('Application database location differs from the reviewed private deployment.');
const db = new DatabaseSync(databasePath,{readOnly:true});
try {
  for(let attempt=0;attempt<60;attempt++) {
    const row = db.prepare('SELECT id,available,detail,heartbeat_at FROM workers ORDER BY heartbeat_at DESC LIMIT 1').get();
    if(row?.id?.startsWith('worker-') && row.available===1 && Date.parse(row.heartbeat_at)>Date.now()-30000) {
      console.log('Verified service heartbeat: isolated worker authenticated and available.');
      process.exitCode=0;
      break;
    }
    if(attempt===59) throw new Error('No fresh available worker heartbeat reached the application database.');
    await pause(1000);
  }
} finally {db.close();}
CFORGE_HEARTBEAT_JS
step worker-journal-readback 15 as_runner /usr/bin/journalctl --user \
  --unit=c-forge-runner.service --no-pager --lines=30
CFORGE_STEP=final-permission-checks
as_runner /usr/bin/test ! -r "$CFORGE_APP_ENV" || fail 'Worker unexpectedly gained access to app.env.'
as_runner /usr/bin/test ! -x "$CFORGE_APP_DATA" || fail 'Worker unexpectedly gained access to application data.'
as_runner /usr/bin/test ! -w /var/run/docker.sock || fail 'Worker unexpectedly gained access to Docker orchestration.'
printf '{"status":"verified","arch":"%s","image":"%s","sourceHash":"%s","rootlessPreflight":true,"isolatedOperationalTests":true,"isolatedCurriculumVerification":true,"apiWorkerHeartbeat":true,"applicationDataReadableByWorker":false}\n' \
  "$(uname -m)" "$CFORGE_IMAGE" "$CFORGE_SOURCE_HASH" >"$CFORGE_LOG_DIR/report.json"
CFORGE_VERIFIED=1
printf 'RUNNER_SETUP_VERIFIED report=%s/report.json logs=%s\n' "$CFORGE_LOG_DIR" "$CFORGE_LOG_DIR"
