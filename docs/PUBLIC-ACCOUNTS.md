# Public registration and account isolation — 2026-10-14

The owner requested a public link where friends create accounts and keep their
own saves. The release uses the existing Site and durable VPS database.

Migration002 rebuilds the legacy `owner` table using SQLite's documented
foreign-keys-off/transaction/foreign-key-check procedure. Its name and `owner_id`
columns remain for compatibility, but IDs now identify separate learner
accounts. Legacy IDs, password hashes, session hashes and every existing
learner-data row are retained. New accounts get UUIDs and the learner role;
initial web registration cannot claim the administrator ID or role.

Server sessions select the account for drafts, revisions, history, conflicts,
notes/bookmarks, attempts/jobs, projects, preferences, reviews and exports.
Expected-account headers prevent old shared-browser tabs from writing under a
new cookie. Missing scopes for new-account API requests are rejected. React
query caches and IndexedDB recovery are scoped by account, and unauthorized
requests cannot reveal another account's data. Import receipts remap foreign
attempt/review IDs per account and make repeated imports idempotent. Export signatures are bound to the account;
importing another learner's export can restore code/notes, but does not certify
your independent proficiency. Legacy owner exports remain compatible.

Passwords use maintained Argon2id with64MiB and three iterations; at most two
operations run concurrently. Signup/login limits use expiring database buckets
and survive restart. Defaults:500 accounts,30 registrations/hour globally,
10/hour per authenticated proxy connection,60 auth attempts/minute globally,
20/minute per connection and12/minute per normalized username. The Site signs
its visitor-IP metadata with a separate server credential; browser-spoofed IP
headers do not bypass these limits. Closing signup preserves existing logins.

The global compiler queue remains20 with one active isolated job. Learner
accounts can have two pending/running jobs,10 native submissions/minute and200
per UTC day; all checks/runs additionally have a20/minute submission ceiling.
Existing administrator compatibility is retained. Run remains separate from
server-owned grading, and each result/progress transition belongs to its account.
The sandbox retains rootless operation, no network, read-only base, limits,
seccomp/NNP/capability restrictions and cleanup. Containers share a host kernel;
use this for a small trusted study group, not as a hardened hostile-code service.

## Portable configuration and recovery

Set `PUBLIC_REGISTRATION=true` in the protected server environment for open
signup. It defaults false for portable personal installations. The bootstrap
remains administrator-controlled on the backend; public Site setup is blocked
and its old native bootstrap binding is removed. No email/OAuth is required.

Before account recovery, stop app/worker and make a consistent backup. Supply the
replacement password through stdin, never arguments/history:

```sh
cd /opt/c-forge
sudo runuser -u cforge -- env -C /opt/c-forge DATA_DIR=/srv/apps/c-forge/data \
  /opt/c-forge-runtime/bin/node --import tsx scripts/admin.ts recover-account USERNAME
```

This revokes only that account's sessions and preserves all accounts' drafts.
`recover-owner` remains compatible for the legacy administrator. There is no
public password-reset endpoint. Existing online backup/restore and bounded
backup timer cover all accounts; off-host copies are still administrator work.

## Verification checkpoint

Local migration/auth/data/queue tests and a real desktop/390px touch-browser
journey passed for two accounts. Shared-browser switching rejects the stale
account's write. The full10 original browser journeys pass after keeping the
current authenticated account during replacement-import recovery cleanup.

Actual VPS upgrade run38499841337 passed: consistent pre-update backup,
foreign-key checks, byte-for-byte legacy data fingerprints across12 account
metadata/data tables, production frontend rebuild, public-registration status
and application/worker health. Hiddify/Xray/Hysteria/Tailscale/WireGuard stayed
active; no Nginx, VPN, tunnel, firewall or certificate changes were made.

The published Site policy is PUBLIC (revision2). Two fresh temporary accounts
registered with no bootstrap field. A subsequent two-account browser journey
used no ChatGPT cookies or platform authorization header: distinct server code,
real isolated GCC Run/Check, private results/proficiency, fresh-login resume and
390px touch layout all passed over trusted HTTPS. Automated test accounts are
removed only by UUID/name/learner-role guards and a transaction comparing all
retained database rows. No live database baseline is restored.

`npm test`:52 passed,1 local native-runtime skip (53 total). All10 original
browser journeys and the additional two-account browser journey passed.
Typecheck/lint/format passed. Native operational/curriculum evidence from the
actual VPS remains recorded in VERIFICATION.md. Mainland-China reachability,
physical phone keyboard behavior and off-host backups remain unverified.
