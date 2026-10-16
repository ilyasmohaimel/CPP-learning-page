# C Forge

This repository contains the **current redesigned workshop**, including the
light default and remembered account theme. It is the C17 application despite
the repository name; C++ is a separate language and course.

## Continue on your Linux PC

Install Node.js24+ and npm, then run:

```sh
git clone https://github.com/ilyasmohaimel/CPP-learning-page.git
cd CPP-learning-page
npm ci
cp .env.example .env
npm run dev
```

Open **http://127.0.0.1:5173**. After the server starts, open another terminal in
this directory and run `cat .data/bootstrap-secret`. Use that secret in the
one-time account setup screen, then choose a username/password. Keep `.data`
and `.env` private. No production credentials are needed for local development.

Local development creates a separate database; your existing online accounts
and saved work stay on the live server. See [local handoff](docs/LOCAL-HANDOFF.md)
for data transfer, verification and isolated compiler setup. Until that worker
is configured, local Run/Check honestly reports the compiler as unavailable;
it does not execute learner programs directly on your PC.

The historical hosting/verification notes below describe the cloud and VPS
release. They are evidence from that environment, not a claim that your new
machine is already configured.

A self-hostable C17 coding academy with separate learner accounts: 48 focused lessons, 105 exercises,
12 chapter checkpoints, three guided projects, and 39 reference entries. Includes
an accessible lesson/editor workspace, staged hints, deterministic review,
server-saved progress, device recovery, and a separate isolated compiler worker.
C and C++ are distinct languages. This release contains the complete C course.

## Open the workshop

**Workshop:** https://c-forge-workshop.tahuna-2388.chatgpt.site

The public release offers **Create account** and **Sign in**. Each
person chooses a username/password and receives their own code, notes, projects,
progress, preferences, hints and reviews. No email or ChatGPT account is needed
by the C Forge application. Existing owner IDs/passwords/sessions/saves are
preserved by migration002; new registrations never become administrators.

Use the same C Forge account on your phone and Linux PC, and wait for **Saved to
account** before switching devices. The Site hosts React plus a same-origin API
bridge; real GCC compilation/grading and SQLite progress remain on the Ubuntu
VPS mounted `/srv/apps/c-forge/data` volume. This is separate from ephemeral
cloud development storage. Automatic backups have bounded retention; off-host
disaster recovery still needs protected backup copies elsewhere.

Public signup has resource limits suitable for a small study group:500 accounts,
30 registrations/hour globally,10/hour per connection, bounded password work,
and per-account compiler limits (two pending jobs,10/minute,200/day UTC). The
private rootless worker has a shared host kernel; this is not a hardened hostile
multi-tenant code-hosting service. See [public accounts](docs/PUBLIC-ACCOUNTS.md),
[verification](docs/VERIFICATION.md), [Sites](docs/SITES.md) and
[VPS operations](docs/VPS.md).

Bundled fonts, icons, editor and course need no external CDN, AI, paid API or
email service. The public Site uses C Forge username/password sign-in; portable hosting uses
the same account model. Mainland-China reachability of Sites, initial downloads
and the free backend DNS hostname is **not verified**. Browser phone viewports
were tested; physical iOS/Android devices were not available.

The server's full disk was repaired: bounded Immich backup retention reclaimed
**92.26 GiB**, and a fresh PostgreSQL backup successfully restored. Hiddify,
tunnel configurations, VPN ports and firewall rules were not changed. See the
[storage report](docs/STORAGE-CLEANUP.md).

## Install and develop

Use Node **24 or newer**, npm, and GCC 14+ for optional trusted curriculum
verification. Installed dependencies are pinned in one `package-lock.json`.

```sh
cd /path/to/c-forge
npm ci
cp .env.example .env
npm run dev
```

Development serves Vite at `http://127.0.0.1:5173`; its `/api` proxy points to
Fastify on port 3000. Use the Vite address for development. API and production
frontend share one origin in production. The default API binds locally.
The app reads `.env` when launched with the documented npm scripts.

For the production-style local app:

```sh
npm run build
npm start
# Open http://127.0.0.1:3000
```

On first startup, the server writes a random bootstrap secret and export signing
key under `DATA_DIR` (default `.data`) with restrictive permissions. Read the
bootstrap secret **on your server**, then enter it in the owner setup form:

```sh
cat .data/bootstrap-secret
```

Choose a username and a password of at least 12 characters. Setup requires the
secret and can run only once; an arbitrary first internet visitor cannot become
the owner. No email, OAuth, AI key, or hosted service is required. Secrets are
never returned by the API, included in learner exports, or printed by startup.

## Phone and Linux PC access

Use one HTTPS URL on your Ubuntu server and sign in from both browsers.
The ready-to-use gateway configuration and exact commands are in
[docs/ACCESS.md](docs/ACCESS.md). It includes persistent data volumes, free TLS,
private worker-route blocking, and phone home-screen metadata. Actual deployment
is waiting on the real domain/server connection; localhost is not a device URL.

## Persistent self-hosting

The simplest app container configuration uses a named data volume and binds its
published port to loopback. The runner is a separate host user/service, not a
socket mounted into the web application.

```sh
cd /path/to/c-forge
cp .env.example .env
# Edit .env locally; leave credentials out of version control.
docker compose up --build -d
curl --fail http://127.0.0.1:3000/api/health
docker compose exec app cat /data/bootstrap-secret
```

`cforge-data` stores SQLite, WAL, and persistent keys. Do not use
`docker compose down -v` unless intentionally destroying all application data.
The app container runs as a nonroot user, read-only except its data volume/tmpfs,
with dropped capabilities. After this session's permissions changed, the cloud
production image build and nonroot/read-only container startup were verified,
including exact draft restoration after restart and a live WAL backup restored
into a fresh volume. Actual Ubuntu/VPS startup still needs a working SSH path.

For a repeatable disposable production-packaging check:

```sh
docker build -t c-forge:cloud-verified .
npm run test:docker
```

In Codex's managed cloud, use its provided proxy CA as a temporary BuildKit
secret for the build (not copied into an image layer):

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t c-forge:cloud-verified .
```

The packaging check creates unique test containers/volumes and removes only
those fixtures. It never runs learner C or touches the real learner database.

To host without Docker, create a separate `cforge` application user, install
Node 24+, copy source to `/opt/c-forge`, install locked dependencies and build.
Give that user exclusive write access to `/var/lib/c-forge`, and use
[deploy/c-forge.service](deploy/c-forge.service). `/etc/c-forge/app.env` should
include:

```dotenv
HOST=127.0.0.1
PORT=3000
DATA_DIR=/var/lib/c-forge
COOKIE_SECURE=true
# RUNNER_SECRET=<administrator-generated 32+ character secret>
```

Install/start the systemd service as administrator:

```sh
sudo cp deploy/c-forge.service /etc/systemd/system/c-forge.service
sudo systemctl daemon-reload
sudo systemctl enable --now c-forge
```

For a personal-only installation, restrict access with a trusted VPN, SSH tunnel, or authenticated HTTPS
reverse proxy. For remote devices, use HTTPS and `COOKIE_SECURE=true`; preserve
the original `Host` header in the proxy. Local HTTP development uses false.
Block external reverse-proxy access to `/internal/`; the private worker calls the loopback API directly.
The same learner account retrieves server-saved work from another device. Device
recovery alone is not cross-device sync. No telemetry or third-party login exists.

### Enable real C execution

Follow [docs/RUNNER.md](docs/RUNNER.md): a separate unprivileged Linux account,
rootless Podman, cgroup v2 delegation, and the fixed GCC 14.2.0 image are required.
Build the image and record its immutable local image ID. Set the same private
`RUNNER_SECRET` in API and worker environments; give the worker no application
DB/home access. Never expose internal runner APIs or a container socket publicly.

```sh
# In the dedicated runner user's login session, after host preparation:
cd /opt/c-forge
podman build --pull=always -f runner/Dockerfile -t localhost/c-forge-toolchain:gcc14.2-v1 .
podman image inspect localhost/c-forge-toolchain:gcc14.2-v1 --format '{{.Id}}'
# Set RUNNER_IMAGE to that image ID in /etc/c-forge/runner.env.
node --env-file=/etc/c-forge/runner.env --import tsx runner/worker.ts
```

Run preflight/operational tests before trusting execution:

```sh
CFORGE_RUNNER_TESTS=1 node --env-file=/etc/c-forge/runner.env --import tsx tests/runner.test.ts
node --env-file=/etc/c-forge/runner.env --import tsx scripts/verify-content.ts
```

Worker compilation is explicitly `-std=c17 -x c`, with useful warnings and
separate compile/run limits. Run uses batch stdin; Check uses server-owned
behavioral contracts, numeric tolerances or function drivers. Makefiles are
teaching files: the worker never runs learner Makefile/shell commands.

## Tests and content verification

```sh
npm run lint
npm run typecheck
npm run test
npm run content:audit
node --import tsx scripts/verify-content.ts --syntax-only
node --import tsx scripts/verify-content.ts --trusted-authoring
npm run build
npm run test:browser
npm run format:check
```

`--trusted-authoring` executes only fixed, version-controlled, finite course
examples/reference solutions. It is never an application fallback and does not
verify learner isolation. The default `content:verify` requires a rootless
runtime and exits with a blocked status if unavailable. Adversarial infinite
loops, flood/crash/isolation/sanitizer tests run **only inside the isolated host
suite**, never directly on the development host.

Browser tests use a separate temporary SQLite database, fictional credentials,
and Chromium. `/usr/bin/chromium` is selected when installed; otherwise install
Playwright Chromium with `npx playwright install chromium`. Test reports/traces
are ignored. Requested evidence screenshots are in `docs/screenshots`.

## Save, resume, and recovery

The server SQLite database is the source of truth. IndexedDB is a per-account
local recovery buffer and pending draft queue. Each draft has a server revision;
writes are serialized/coalesced, normally debounce 600 ms and have a 2-second
maximum scheduling delay. Local writes are ordered. Acknowledged saves are
shown explicitly as device or account saves. There remains a small risk if a
browser crashes before a local write finishes; no zero-loss guarantee is made.

Conflicting revisions retain both versions and require an explicit choice. The
losing version is recoverable from history; incompatible source is not merged.
The account retains 20 ordinary draft versions plus the latest successful submission per exercise, with additional explicit
device reset snapshots (20 per exercise). Pre-reset and last successful checks
are labeled. Immutable submitted attempts are separate from current drafts.

Offline drafting works in an authenticated, already-open tab, using cached
opened lessons and local editor assets. A fresh offline load cannot authenticate
or fetch uncached lessons. Reconnect retries drafts with idempotency/backoff.
Runs are never queued or replayed on reconnect. Local buffers clear on explicit
logout. Replacement import explicitly warns before clearing device recovery;
preserving import keeps existing work and alternate account history.

Settings provides a versioned JSON export/import preview. Exports omit password
hashes, sessions, runner credentials, private grading tests, and unrevealed
reference solutions. Same-installation signatures preserve verified outcomes;
exports from another installation restore work while requiring fresh checks for
proficiency. JSON imports are schema/ID/size validated; the UI limits files to 2 MiB and the API request limit is 4 MiB.
Exports include the latest 1,000 attempts/review events. Server backups include
the entire database. For very large accounts, use the full backup procedure.

## Consistent server backup and restore

A live SQLite database may contain committed data in WAL. **Do not copy only its
main file while the service is running.** The provided command uses SQLite's
online backup API, then verifies the copied database with `integrity_check`.
It copies persistent bootstrap/export keys, and writes a manifest.
Backups contain account/password/session hashes: protect them and store off-host. If you supply bootstrap/export keys through external environment settings, back up that protected administrator configuration separately; the command does not scrape environment secrets.

Bare Node deployment:

```sh
cd /opt/c-forge
DATA_DIR=/var/lib/c-forge npm run backup -- /private/backups/c-forge-2026-10-13
# Stop API and worker before restore; keep a backup of current data first.
DATA_DIR=/var/lib/c-forge node --import tsx scripts/admin.ts restore /private/backups/c-forge-2026-10-13 --replace
npm start
```

For the app container, run a consistent backup while it is live, then copy out:

```sh
docker compose exec app node --import tsx scripts/admin.ts backup /data/backup-2026-10-13
docker compose cp app:/data/backup-2026-10-13 /private/backups/c-forge-2026-10-13
```

Container restore, with the API stopped and the persistent volume mounted:

```sh
docker compose stop app
# Copy your protected backup into the data volume using an administrator-controlled tool.
docker compose run --rm --no-deps app node --import tsx scripts/admin.ts restore /data/backup-2026-10-13 --replace
docker compose up -d app
# Restart the dedicated runner after verifying app health.
```

Restore refuses live WAL/SHM files; a clean API shutdown checkpoints/removes
these. It validates format/integrity, writes a temporary database and renames it.
The online WAL backup/restore round trip is tested with actual learner state.
Container/systemd operational execution remains host setup work.

## Administrator-controlled owner recovery

There is no unauthenticated password-reset endpoint. Stop the API and worker,
make a consistent backup, then provide a new password through stdin. The command
replaces the Argon2id hash, revokes sessions, and preserves code/progress.
Do not put the password into command-line arguments or shell history.

```sh
cd /opt/c-forge
read -r -s -p 'New owner password: ' CFORGE_RECOVERY_PASSWORD
printf '%s' "$CFORGE_RECOVERY_PASSWORD" | DATA_DIR=/var/lib/c-forge node --import tsx scripts/admin.ts recover-owner
unset CFORGE_RECOVERY_PASSWORD
# Restart API/worker. Sign in using the existing username and new password.
```

For a container deployment, with its API stopped, pipe the same input into
`docker compose run --rm -T --no-deps app node --import tsx scripts/admin.ts recover-owner`.
Server administrator access is required; no arbitrary account creation/reset is
possible through the UI.

## Updates and architecture

Back up first. Stop services, install updated source and run `npm ci`,
`npm run content:audit`, `npm run typecheck`, `npm run test`, and `npm run build`;
then start the API and worker. SQL migrations and content-registry installation
run idempotently at API startup. Stable IDs preserve drafts/completion on title
changes; attempts record content versions. Changed exercises preserve old drafts
and present an explicit retry path for the current version.

See [architecture](docs/ARCHITECTURE.md), [curriculum map](docs/CURRICULUM.md),
[runner boundary](docs/RUNNER.md), and [verification](docs/VERIFICATION.md).
Fonts, icons, editor, and course content are local. Initial npm/container/host
package downloads need network access. Mainland-China connectivity has not been
tested; the installed app requires no Google Fonts, CDN, telemetry, video host,
remote AI, social login, or model API. No clinically validated learning or
medical claims are made.
