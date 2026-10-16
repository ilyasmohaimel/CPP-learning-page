# Two-course architecture

The application loads separate C17 and C++20 curricula. Every C++ lesson,
exercise, project and reference uses a `cpp-` ID. The combined registry supports
existing drafts, histories, imports and jobs without changing the C IDs or data
schema. `/api/course?course=c17|cpp20` selects navigation; lesson and exercise
access still use stable IDs.

The current client requests `/api/state?allCourses=true`. The default state
response keeps C17-only resume, progress, review and activity for Classic and
older clients; both views use the same account data without resetting it.

The revision-checked `courseId` preference saves the selected course. The state
response includes a resume for each course, derived from its most recently saved
draft when the global resume belongs to the other course. Successful draft saves
invalidate the account-state cache so the dashboard reflects the acknowledged
resume position. Account ownership and conflict handling use the same paths for
both languages.

The server stamps each native job's language from its exercise contract. The
worker accepts only C or C++ payloads and matching source extensions. C uses GCC
with explicit C17 flags; C++ uses G++ with explicit C++20 flags. The compiler image,
container restrictions and limits are shared. A legacy C-only worker remains
available for C but cannot enable C++ jobs. The updated worker advertises C++ only
after both normal and sanitized preflight samples succeed.

The sections below document the existing account, storage and execution systems.
Historical host verification applies to the release described there; new C++
isolation still requires a configured worker host.

# Architecture and data ownership

C Forge uses React 19 + TypeScript + Vite, React Router, one server-state library
(TanStack Query), CodeMirror 6, Fastify 5, and SQLite through Node24's maintained
`node:sqlite` binding. A small typed prepared-query/migration layer replaces an
ORM: the single-server model needs explicit transactions and versioned
SQL migrations rather than a large abstraction. SQLite is deliberately
**development storage in the cloud workspace**, and durable application storage
on the mounted VPS volume. The public hosted Site hosts the existing React
frontend plus a small Worker API bridge; the Node/Fastify/SQLite backend and
isolated compiler stay on the VPS. Public Site access needs no platform login; C Forge sessions authorize learner data.
D1/R2 are unused because the existing transactional backend is retained. This
avoids replacing verified persistence with a static frontend or untested adapter.
The detailed Worker identity/cookie/secret boundary is in SITES.md.

`src` holds frontend features; `server` holds auth/progress/data/job APIs;
`shared` holds typed contracts; `content` holds a pre-authoring manifest and the
complete structured curriculum. Build audits validate membership/prerequisites/
versions/solutions/hints/tests. Lessons load individually. Answers, solutions,
project verification cases, and private test contracts remain on the server;
explicit reveal endpoints record help. The frontend bundle imports no curriculum
JSON. Larger editor/diagram/lesson components are lazy-loaded.

The workshop visual system uses graphite surfaces, a periwinkle resume area,
colour-coded chapter symbols, and a warm-white light theme. Newsreader display
headings give the academy its identity; Open Sans prose and DejaVu Sans Mono code
remain readable and independently adjustable. All three font families and their
licenses are bundled locally. The original bracket/flame logo stays consistent.
The initial October16 typography refresh was frontend-only. The subsequent
appearance audit adds migration003 solely for never-saved legacy defaults and
uses a non-sensitive early-paint theme cache; account sessions, draft formats
and the runner boundary are retained. See DESIGN.md and THEMES.md.

## Identity and authorization

Migration002 preserves legacy owner IDs, password hashes, sessions and saved
work while allowing independent UUID learner accounts. Public registration
never grants administrator status. Bootstrap setup remains protected by a
server-controlled secret and is blocked by the public Worker. Argon2id uses its
maintained library,64MiB/three iterations and bounded concurrency. Sessions are
high-entropy opaque tokens hashed in SQLite, with14-day expiry and HttpOnly
cookies. Portable HTTPS uses Secure/SameSite=Lax; the hosted iframe-compatible
bridge uses Secure/SameSite=None/Partitioned.

All account resources are selected by the server session, never a browser's
claimed ownership. Expected-account headers also reject stale shared-browser
tabs after cookie/account switching. Frontend query and recovery buffers are
account-scoped. Persistent rate limits survive restart; authenticated proxy
metadata controls visitor-IP bucketing. Public signup and compilation have
bounded account/global quotas. Worker APIs require their separate bearer
credential and are not forwarded publicly. Administrator-controlled account
recovery revokes only the selected account's sessions. No email/OAuth/reset
service exists. See PUBLIC-ACCOUNTS.md for defaults and operations.

## Saved work

`drafts` contains mutable source/metadata plus optimistic revision. `attempts`
contains immutable submitted source/result/content version. Progress completion,
independent proficiency, and scheduled review are distinct. Draft fields include
files, stdin, active file, selection, step, scroll, pane width, notes/bookmark, prediction text, diagnostics-mode choice, and mobile workspace tab.
SQLite uses foreign keys, indexes, WAL, FULL synchronous mode, busy timeout, and
transactions. Migration/content registry installation is idempotent.

IndexedDB provides per-owner, per-tab/mount buffers. Local writes are serialized;
server saves are coalesced, debounced with a bounded maximum scheduling delay.
An uncertain response retries the same mutation ID. Older acknowledged responses
cannot replace later local edits. The displayed save state follows actual local
or server acknowledgements. Browser failure before write completion remains a
residual risk. Refresh after an acknowledged account save uses server state;
an opened authenticated tab can recover cached content and pending local edits.

A stale server revision produces 409 and persists both versions. Conflict choice
requires the current revision; competing resolutions produce another conflict.
No source merge is attempted. Histories retain 20 ordinary versions plus the latest successful submission per exercise; explicit
device pre-reset snapshots also retain 20. Imported alternate versions and last
successful checks have meaningful labels. API/runner restarts do not recreate
accounts or discard drafts.

JSON export/import is versioned, validated, owner-only, and defaults preserve.
HMAC signatures use canonical serialization bound to the source account;
modified, foreign-account or foreign-installation exports cannot award trusted
proficiency or passing results. Legacy single-owner signatures remain valid only
for the retained legacy owner. Code and notes can still be explicitly imported.
Per-account receipts remap colliding attempt/review IDs and prevent duplicates. Keys remain
server-side and are included in protected server backups, never learner exports.
JSON import has a 4MiB HTTP size limit; malformed IDs/paths/duplicates fail.
Exports include the latest 1,000 attempts/reviews; full backups retain all rows.
Replacement is explicit and retains pre-import account history. Device recovery
is preserved by default, and replacement warns before clearing it.

## Grading and execution boundary

The web server never compiles/executes submitted source. SQLite is also the
bounded job queue (20 jobs, one active lease). A dedicated rootless Podman worker
pulls authenticated leases, validates sources, compiles as C17, runs isolated
containers, compares actual raw results, and reports terminal outcomes. The API
commits attempts and corresponding progress in one transaction, idempotently.
The browser cannot submit a passing flag or hidden test contract.

Worker availability expires after 30 seconds; jobs use 120-second renewable
leases. Cancellation and expired/interrupted jobs become explicit terminal
states. Terminal results cannot be overwritten by late worker messages.
Compilation failure, program failure, timeout, and infrastructure errors differ.
Run does not award mastery. Conceptual diagnosis answers are deterministic
server checks; they are labeled and do not pretend to execute C.

The runner preflight fails closed without rootless cgroup-v2 isolation and real
security/resource readbacks. Compilation/execution use separate network-free,
nonroot, read-only containers, fixed argument-array compiler commands, dropped
capabilities, NNP/seccomp, deadlines/memory/process/file/output budgets, and
cleanup/cancellation. No app database/home/secrets/socket is mounted. See the
runner document for exact limits and residual shared-kernel deployment scope.
The cloud workspace lacks the required rootless runtime, so it never executes
learner code. On the actual Ubuntu ARM64 VPS, Podman3.4.4/cgroupv2 isolation,
resource readbacks, native fault/isolation tests, and all 149 ordinary authored
behavior checks passed. ASan bounds and UBSan overflow diagnostics also passed.
LeakSanitizer is disabled under the retained seccomp boundary; diagnostic mode
does not detect leaks. Passing tests/sanitizers does not prove correctness.

## Teaching and review

The C17 course graph has 12 ordered modules, 48 substantive lessons, 105 exercises,
12 checkpoints, and three assessed projects. C17 is a deliberate baseline, not
the latest standard. C++ has a separate complete course and navigation model. Predictions, code edits/functions, diagnoses, memory reasoning,
progressive hints, and project milestones exercise distinct objectives.

The deterministic retrieval schedule uses 1/3/7/14/30-day intervals. A failed check
or helped pass schedules an immediate revisit; independent checks initially
schedule one day. Correct good/easy reviews advance one/two stages; wrong/again
returns to stage0 (one day). Review is not another proficiency award. Exact short
answer comparisons are openly labeled; expected reasoning is shown on mismatch.
The learner controls pace and may visit any lesson without hard locks.

Four hand-authored diagrams provide step/reset states with synchronized source,
variables/text equivalents: loop, array/boundary, pointers/alias/lifetime, and
ordinary call/pass-by-value. They are explicitly curated teaching simulations,
not arbitrary-code debugging. Passing tests or sanitizers does not prove safety.

## Operational boundary

Phone and Linux clients use the same HTTPS origin and learner account; only an
acknowledged server save becomes available on another device. The optional
Caddy2.11.7 Compose gateway handles TLS/redirects/compression, preserves Host for
origin checks, and blocks public `/internal` routes. Secure cookies are enabled
by that override. Existing gateways can use the additive Caddy/Nginx examples.
The web app remains on a loopback-published port; worker access bypasses the public
gateway and still requires its private credential. Certificate and database
volumes persist independently. The manifest/icons and address/copy controls are
local assets; home-screen installation is a browser shortcut, not an offline
native app or client-side compiler. See ACCESS.md for exact startup commands.

Local TLS/account-resume journeys ran against real Caddy. Actual hosted Site
journeys additionally used trusted HTTPS, independent desktop/phone contexts,
real database writes and native jobs. A guarded temporary account survived a real
API/worker restart and consistent online backup/restore. Its entire verification
state was then removed by restoring the verified empty baseline, leaving owner
setup ready. No real account or learner work was overwritten.

The numeric-IP upstream first produced Cloudflare1003; a dedicated hostname
with a valid certificate on the already-existing8445 gateway fixed it. Its SNI
virtual host is ordered after the original IP-address server to preserve that
server's default certificate. The separate ACME configuration cannot execute
existing certificate hooks. No Hiddify/tunnel, VPN listener or firewall changes
were made. Admin Actions workflows are returned to manual/read-only after verification.
The public release preserves legacy data during migration and removes only exact
verification-account UUID/name pairs; retained database rows remain unchanged.

Use SQLite's online backup API and persistent keys, not a live-file copy without
WAL. The bounded daily backup runs with the application identity and a lock,
keeps fourteen daily plus up to six monthly snapshots, verifies integrity before
retention, reserves disk space, and will not duplicate today's snapshot. These
backups live on this VPS; off-host disaster recovery is not provisioned.

Initial dependency/image downloads, hosted access and DNS need network
access. Mainland-China availability was not tested. All course functionality runs without a paid service.
Scoped WCAG scans, keyboard checks and responsive screenshots are evidence for
those views, not certification across every browser or assistive technology.
