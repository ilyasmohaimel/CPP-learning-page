# Existing Ubuntu VPS deployment

C Forge is installed at `/opt/c-forge` on the owner-authorized Ubuntu22.04 ARM64
server. Its application API listens only on `127.0.0.1:3030`; the existing Nginx
TLS8445 service forwards the `/forge/` prefix. Existing SFTPGo routes remain at
the root of that server. No firewall rule, VPN port, public IP, global Node
installation, or other application gateway was replaced.

The primary address is the public ChatGPT Site:
**https://c-forge-workshop.tahuna-2388.chatgpt.site**. Its same-origin API bridge
connects to **https://c-forge.51.170.138.252.sslip.io:8445/forge/**.
Both database routing and real native Run/Check passed through the actual Site.
The original numeric-IP gateway also retains its own certificate and routes.
A dedicated hostname virtual host was added on the same8445 listener, ordered
last so numeric-IP clients retain their original default certificate. No new
VPN listener, firewall rule or tunnel was created.

Learner identity, drafts, history, notes, attempts and progress reside in
`/srv/apps/c-forge/data/c-forge.sqlite` on the mounted persistent `/srv` disk.
This is VPS application storage, separate from the ephemeral cloud-development
SQLite file. It survives application/service restarts and is shared by the same
learner account on phone and PC. Deleting the VPS volume still deletes that data;
consistent off-host backups are necessary for disaster recovery.

## Installation and startup

These installers are specifically for the inspected existing VPS. They require
an administrator, a mounted `/srv` disk, systemd/cgroupv2, and an existing TLS8445
Nginx virtual host. Use the portable Compose/existing-gateway options in the
README for a different host. The source directory must be a clean verified copy
of this repository, without dependencies, generated assets, data or secrets.

```sh
sudo bash /absolute/source/c-forge/deploy/setup-app.sh /absolute/source/c-forge
sudo python3 /opt/c-forge/deploy/install-nginx-prefix.py
sudo bash /opt/c-forge/deploy/setup-runner.sh
sudo systemctl start c-forge.service
curl --fail https://51.170.138.252:8445/forge/api/health
```

Node24.21.0 is installed separately at `/opt/c-forge-runtime`, downloaded from
nodejs.org and checked against the official SHA256 manifest. The server's older
global Node remains unchanged. The app uses locked dependencies and a
`CFORGE_BASE_PATH=/forge/` production build. Configuration is protected in
`/etc/c-forge/app.env`; no real environment values belong in this repository.

The `cforge` application user owns only its private learner-data directory. The
separate unprivileged `cforge-runner` user cannot traverse that directory or read
app.env or the Docker socket. Its rootless image storage and disposable jobs
reside on the boot filesystem under `/var/lib/c-forge-runner`, with user-manager
cgroup delegation. The worker starts only after real isolation preflight,
operational tests, and isolated curriculum verification pass. Its immutable
image ID and root-only setup reports are stored in that dedicated worker state.
See [RUNNER.md](RUNNER.md) for exact resource limits and residual risk.

```sh
cforge_uid=$(id -u cforge-runner)
sudo runuser -u cforge-runner -- env -C /opt/c-forge \
  HOME=/var/lib/c-forge-runner/home XDG_RUNTIME_DIR=/run/user/$cforge_uid \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$cforge_uid/bus \
  systemctl --user status c-forge-runner.service
```

## Accounts and normal access

Open the public Site and choose **Create account**. Each learner has their own
username/password, drafts, progress and preferences. Sign into the same C Forge
account on phone and Linux to retrieve acknowledged server saves. No ChatGPT
login, email or OAuth service is needed. The public Worker blocks administrator
setup; platform visitor headers cannot grant administrator privileges.

The protected VPS environment has `PUBLIC_REGISTRATION=true`. Turning it off
closes signup while retaining existing logins and all saved work. Portable
personal installations default to closed signup and administrator-controlled
bootstrap setup. Do not publish bootstrap, export, session or runner secrets.

Only **Saved to account** acknowledges cross-device availability. Conflicts
preserve alternatives for an explicit choice. A browser crash before a local
write completes still has a residual loss window. Targeted account recovery is
in [PUBLIC-ACCOUNTS.md](PUBLIC-ACCOUNTS.md); it preserves code and revokes only
that account's sessions.

The original IP certificate/renewal stays unchanged. The C Forge-only hostname
has its own ACME state in `/etc/c-forge/acme`, its own certificate valid through
2027-01-11 at issuance, and a `c-forge-acme.timer` renewal check. It uses the
existing port80 ACME webroot and8445 SNI gateway. It never reads or changes VPN
configuration or runs existing certificate deploy hooks. Hostname issuance and
trusted TLS passed; an actual future renewal rollover has not been observed.
Free sslip.io DNS points this hostname at the supplied current IP. A later IP
change needs an updated backend hostname/certificate and Sites runtime value;
a stable owner-controlled domain is preferable when available. China DNS/Sites
availability remains untested.

Direct numeric-IP C Forge and SFTPGo share an origin; their cookies/recovery
buffers are scoped separately. The primary public Site is a separate origin
and forwards only C Forge's session cookie. See SITES.md for partitioned cookies.

## Consistent backup and recovery

From the installed source directory, create a consistent online SQLite backup
rather than copying a live database file without its WAL:

```sh
cd /opt/c-forge
sudo runuser -u cforge -- env DATA_DIR=/srv/apps/c-forge/data \
  /opt/c-forge-runtime/bin/node --import tsx scripts/admin.ts backup \
  /srv/apps/c-forge/data/backups/manual-$(date -u +%Y%m%dT%H%M%SZ)
```

Backups include account/password/session hashes and persistent application keys;
protect them, keep a bounded history, and copy them off-host. Protect
`/etc/c-forge/app.env` and runner.env separately. Before restoring, stop the
worker with the user-manager command above (replace `status` with `stop`), then:

```sh
sudo systemctl stop c-forge.service
sudo runuser -u cforge -- env -C /opt/c-forge DATA_DIR=/srv/apps/c-forge/data \
  /opt/c-forge-runtime/bin/node --import tsx scripts/admin.ts restore \
  /absolute/protected-backup-directory --replace
sudo systemctl start c-forge.service
```

Then start the worker and confirm database/worker health. Restore refuses live
WAL/SHM files. Preserve a pre-restore backup. For owner recovery, stop both
services, create a backup, and pass a replacement password through stdin to the
same isolated Node runtime's `scripts/admin.ts recover-owner` command, using
`DATA_DIR=/srv/apps/c-forge/data`. Recovery revokes existing sessions and
preserves drafts/progress. Never place the password in shell arguments/history.

Updates use the same setup-app source command. It makes a consistent database
backup before replacing managed application source, preserves account data and
protected configuration, performs the locked build and reapplies idempotent
migrations. Rerun the worker setup after runner/toolchain changes. Both installers
fail rather than overwrite unrelated directories or use weaker isolation.

The separate [storage recovery report](STORAGE-CLEANUP.md) documents the Immich
backup-loop repair, retained restore history and actual database restore test.

## Bounded automatic backups

`c-forge-backup.timer` is enabled at04:20 Asia/Shanghai with up to20minutes of
jitter. The unprivileged service takes a consistent online snapshot under
`/var/backups/c-forge/learner`, with a lock, a five-minute budget, a1GiB space
reserve and validated retention. It keeps14 recent daily snapshots plus one
per month for six months (at most20). Running it twice on the same day does not
make another snapshot; both actual service runs passed. This is VPS-local
backup, not off-host disaster recovery.

```sh
sudo systemctl status c-forge-backup.timer c-forge-acme.timer
sudo systemctl start c-forge-backup.service
sudo journalctl -u c-forge-backup.service --since today
```

The source command is `scripts/daily-backup.ts`; server recovery still follows
the guarded stop/online-backup/restore procedure above. Do not replace a real
owner account with verification data. The initial single-owner verification restored an empty baseline only after
confirming its temporary owner guard. Public-release verification removes only
explicit temporary UUID/name pairs in a checked transaction, with every retained
row fingerprint unchanged; it never restores the whole live database.
