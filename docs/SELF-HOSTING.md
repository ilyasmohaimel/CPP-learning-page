# Self-hosting

C Forge needs Node.js 24+, a persistent SQLite directory, and HTTPS for access
from other devices. The compiler worker runs separately under an unprivileged
Linux account. Start with [local development](DEVELOPMENT.md), then follow
[RUNNER.md](RUNNER.md) for rootless Podman and the pinned toolchain.

## Application

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

Set `HOST=127.0.0.1`, a suitable `PORT`, and an absolute `DATA_DIR` in the private
server environment. Put the API behind an HTTPS reverse proxy and set
`COOKIE_SECURE=true`. Preserve the Host header and block external `/internal/`
requests. The worker contacts the loopback API using its separate credential.
See [ACCESS.md](ACCESS.md) for gateway examples.

`PUBLIC_REGISTRATION` defaults to `false`. Enable it deliberately if friends
should create independent accounts. The initial owner setup always requires the
server's bootstrap secret. Each password must have at least 12 characters.

A Compose application configuration and a systemd unit are included. Use a
persistent volume for the database and keys. Do not remove that volume during
an ordinary application update.

## Consistent backups

SQLite may have committed data in its WAL. Do not copy only the main database
file while the API is running. The backup command uses SQLite's online backup
API, checks integrity, and includes persistent signing and bootstrap keys.

```sh
DATA_DIR=/var/lib/c-forge npm run backup -- /private/backups/c-forge-snapshot
```

Backups contain private account data and password/session hashes. Restrict access
and keep protected off-host copies. Learner exports are useful for transferring
work but do not replace a full server backup.

Stop the API and worker before restoring. Preserve a backup of the current state.

```sh
DATA_DIR=/var/lib/c-forge node --import tsx scripts/admin.ts restore /private/backups/c-forge-snapshot --replace
```

## Password recovery

There is no public password-reset endpoint. An administrator can stop services,
make a consistent backup, and run `scripts/admin.ts recover-owner` or
`recover-account USERNAME`. Supply the new password through stdin, never a command
argument or repository file. Recovery revokes the selected account's sessions
while preserving its work. See [PUBLIC-ACCOUNTS.md](PUBLIC-ACCOUNTS.md).

## Updates

Back up, stop services, install the intended source, run `npm ci`, typecheck,
tests, content audit and build, then restart. Migrations and content registration
run idempotently. Updating the API and worker together is required for new runner
protocol features. C++ availability requires a worker that passes both C17 and
C++20 preflight checks; a legacy C-only heartbeat cannot enable C++ jobs.
