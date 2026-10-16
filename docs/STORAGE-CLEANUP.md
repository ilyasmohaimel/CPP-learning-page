# VPS storage recovery — 13 October 2026

The full `/srv` volume was recovered on the Ubuntu VPS at `51.170.138.252`. At the first check it had **0 available bytes, 100% use**. After repair it showed **34% use and approximately 93 GiB available**. Personal cloud files, Immich photographs/videos, the live PostgreSQL data directory, Docker volumes/images, and other applications were preserved.

## Cause and evidence

`immich-db-backup.timer` invoked `/usr/local/lib/china-proxy/immich-db-backup` every 30 minutes. Its existing script made consistent `pg_dump` backups with an atomic temporary-file publication and gzip verification, but **never expired old backups**.

There were **1,643 completed SQL gzip dumps totaling 103,037,601,207 bytes** under `/srv/immich/backups/oracle`, spanning 19 August to 22 September. This was unbounded SQL backup history, rather than a recursive image-save operation. Docker reported no reclaimable images or build cache, so no Docker prune was performed.

PostgreSQL was restarting repeatedly. Its log explicitly reported:

```text
FATAL: could not write lock file "postmaster.pid": No space left on device
```

The backup timer continued attempting runs after the last successful dump on 22 September, but those attempts failed because the database could not start. The storage guard was also in a failed warning state.

## Changes made on the server

- Temporarily stopped only the Immich database backup timer/service for maintenance.
- Saved the original backup script, timer, and service privately under `/root/c-forge-storage-repair`, with directory mode `0700` and saved-file mode `0600`.
- Added an exclusive `flock` to prevent overlapping backup invocations.
- Added a 5 GiB available-space preflight and a systemd `TimeoutStartSec=10min` override at `/etc/systemd/system/immich-db-backup.service.d/bounded-runtime.conf`.
- Installed `/usr/local/lib/china-proxy/immich-backup-retention`. After each successful backup it keeps the latest 48 restore points, the newest restore point in each of 14 daily, 8 weekly, and 6 monthly buckets, and the initial migration-era backup. Overlapping categories share files: the policy retains at most 77 ordinary dump files.
- Retention accepts only standalone regular, non-symlink files with exact `immich-db-YYYYMMDDTHHMMSSZ.sql.gz` names. It preserves unknown files, verifies the newest three and oldest dump using gzip CRC and completed PostgreSQL dump markers, records its deletion plan privately before deleting, and refuses changed files during removal.
- Removed only superseded SQL restore points covered by that policy. These are historical versions; they were not assumed to be byte-identical.
- Restarted the already-failing `immich_postgres` container after reclaiming space, generated a fresh successful database backup, resumed the existing 30-minute backup timer, and reran the storage guard.

The existing atomic backup publication, file ownership/read permissions, notification function, application data, and backup read-only access account were retained. Other timers, proxy services, and personal services were not stopped.

## Measured outcome

| Item                                         | Verified result                                                    |
| -------------------------------------------- | ------------------------------------------------------------------ |
| SQL restore points removed                   | 1,580                                                              |
| Archive bytes removed                        | 99,058,061,339 bytes, or 92.26 GiB                                 |
| Completed dumps remaining after fresh backup | 64                                                                 |
| Remaining dump size                          | 4,043,125,760 bytes, or 3.77 GiB                                   |
| Fresh backup                                 | `immich-db-20261013T084852Z.sql.gz`                                |
| Fresh compressed backup SHA-256              | `b4348a5781a5d3bc33705b0d904d7227757e0f3145b4ed9e726709713e066c76` |
| Backup service                               | `Result=success`, `ExecMainStatus=0`                               |
| Backup timer                                 | Active and waiting; next observed run 09:18:52 UTC                 |
| PostgreSQL container                         | Healthy                                                            |
| Immich local API                             | `/api/server/ping` returned `{"res":"pong"}`                       |
| Failed systemd units                         | None at the recovery check                                         |

The root filesystem remained approximately 40% used, with 28 GiB available. `/srv` still contains the live media and other personal data, which account for most remaining use.

## Actual verification

- Local retention tests verified deterministic selection, preservation of the latest 48 and initial backup, idempotency, and rejection of an incomplete SQL dump.
- Before removal, the newest three and initial backups passed gzip CRC and completed-dump validation; their hashes were recorded privately on the VPS.
- The fresh backup passed gzip CRC and completed-dump validation. It was then **restored successfully into a uniquely named disposable database inside the existing PostgreSQL container**, with `ON_ERROR_STOP=1`: gzip and psql exited 0, and the restored schema contained 66 public tables. The test database was dropped by an exit trap; a subsequent catalog query confirmed **0 disposable restore databases remaining**. SQL contents never left the VPS and were not printed to GitHub logs.
- A second retention invocation removed 0 files, confirming the retained set was stable.
- Container health, Immich API, timers, available space, and systemd failures were checked after recovery.

The private repository workflows authenticate with the existing SSH identity and saved host-key pins. Checkout is pinned, credential persistence is disabled, the key is copied with restrictive permissions into a temporary directory, and that directory is removed on exit. Credentials and application environment values are never printed. Future runs of the retained storage audit are read-only.

Private workflow evidence:

- [Initial storage audit](https://github.com/ilyasmohaimel/linux-setup-recovery/actions/runs/38371183620)
- [Backup source and integrity inspection](https://github.com/ilyasmohaimel/linux-setup-recovery/actions/runs/38371366424)
- [Repair and recovery](https://github.com/ilyasmohaimel/linux-setup-recovery/actions/runs/38371799880)
- [Actual backup restore and health verification](https://github.com/ilyasmohaimel/linux-setup-recovery/actions/runs/38372172448)
- [Final read-only health and temporary database cleanup check](https://github.com/ilyasmohaimel/linux-setup-recovery/actions/runs/38372357507)

## Ongoing checks

From an authorized SSH session:

```sh
df -h /srv
sudo systemctl list-timers immich-db-backup.timer china-proxy-storage-guard.timer
sudo systemctl show immich-db-backup.service -p Result -p ExecMainStatus
sudo /usr/local/lib/china-proxy/immich-backup-retention
sudo journalctl -u immich-db-backup.service -n 30 --no-pager
```

The retention command without `--prune` only previews; routine deletion already runs after a successful backup. Avoid manually changing or pruning this directory while a backup runs. The original maintenance and retention records are under `/root/c-forge-storage-repair` for the administrator.

A count bound prevents this recurrence for the observed database size; it does not make storage unlimited. Backup sizes grow with the database. The existing storage guard still warns below 20 GiB, and the new backup preflight refuses to start below 5 GiB. Live uploads can also fill a volume independently of backups. This local recovery does not prove the separate Frostserver offsite pull is healthy or that every retained historical dump has been restored; the fresh dump received the actual restore test.
