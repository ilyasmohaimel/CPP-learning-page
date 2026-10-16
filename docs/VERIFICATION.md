# Published C17 and C++20 workshop, 2026-10-16

The primary workshop and the direct VPS application now run the C/C++ release
from source commit `55c0693`:

- [Public workshop](https://c-forge-workshop.tahuna-2388.chatgpt.site)
- [Direct VPS access](https://c-forge.51.170.138.252.sslip.io:8445/forge/)

The direct address reuses the existing free hostname, trusted TLS certificate
and port 8445. Both entry points share accounts and saved work. Each hostname
requires its own sign-in. No VPN, firewall, tunnel, certificate or unrelated
service configuration was changed. VPN-off reachability from the learner's
connection in mainland China remains untested.

| Published check | Observed result |
| --- | --- |
| Primary publication | Saved version 10 deployed successfully; public access policy revision 2 and runtime environment revision 3 retained |
| VPS application | Production subpath build installed; direct HTTPS application returns 200 with trusted TLS |
| Native C++ course gate | All 108 worked examples, reference solutions and project programs/contracts passed inside the rootless GCC/G++ 14.2.0 runtime, covering 176 behavioral cases |
| Native runner suite | Nine passed, zero failed, including C/C++, compiler failure, timeouts, excessive output, crash, cancellation, isolation and sanitizer diagnostics |
| Production data | Consistent online backup and all-table expected-delta audit passed; only the intended content registry changed |
| Published browser journey | Disposable account signup, canonical draft save, real C++ Run and successful Check passed on the primary workshop |
| Shared saved work | A separate browser signed into the direct VPS application and restored the exact C++ draft and selected course; native Run passed there |
| Rendered layout | Desktop and 390px screenshots inspected; no page overflow or application runtime errors in the live journey |

Classic retains its existing frontend deployment. The updated backend keeps its
default account-state response scoped to C17 for compatibility; the new frontend
explicitly requests both courses. A focused regression test covers that contract.

Both temporary browser-review accounts were removed by exact UUID, username and
learner-role checks after consistent backups. Every retained database row and
foreign key was verified. The temporary deployment workflow was removed; the
original manual, read-only health workflow remains unchanged.

The local checks below used disposable databases. Native production verification
is recorded separately above; the local native-suite skip is not a native pass.

---

# Local C17 and C++20 checks, 2026-10-16

The local repository now includes both complete course paths. C++20 has 12
modules, 48 lessons, 105 exercises (57 compiler-backed and 48 conceptual), 12
checkpoints, three projects and 48 reference entries. The C17 course IDs and
curriculum are unchanged. These local tests used no production account or database.

| Check | Observed result |
| --- | --- |
| Typecheck, lint and formatting | Pass |
| Unit/integration tests | 56 passed, one native isolation suite skipped |
| Course structural audit | Both courses pass schema, manifests, DAG, membership, language/file validation and assessment checks |
| C++ trusted authoring | 108 syntax checks and 108 fixed worked-example/reference programs or contracts pass; 48 textual contracts pass |
| Original browser journeys | 10 passed in 48.5 seconds |
| Account/theme browser journeys | Two passed in 15.1 seconds |
| Separate two-course journey | Passed with final mobile and conceptual-check coverage in 10.5 seconds |
| C++ workspace accessibility | No violations in the scoped axe scan |
| Desktop and 390px phone layout | Rendered screenshots inspected; no page-level horizontal overflow |
| Full local preview command | Build and Fastify/SQLite startup checked with `npm run preview` |

The two-course browser journey polls canonical server drafts for the exact new
source, switches languages, restores each resume position, and checks a fresh
browser login. It also verifies course-specific reference/project lists, editor
labels, a real conceptual check and honest runner-unavailable feedback. A stale dashboard cache found in
that journey was fixed by invalidating account state after acknowledged saves.
The course selector was widened and its labels shortened after phone screenshot
review. No test assertions were removed to hide those failures.

Local environment: Node 26.11.1, npm 12.2.0, system Chromium, GCC/G++ 16.2.1 using
explicit language-standard flags. Trusted authoring execution reads only fixed
version-controlled course examples and solutions. It is not learner execution
and does not verify the GCC 14.2.0 container, rootless isolation or sanitizers.
The opt-in native suite now includes C++ behavior, compilation failure and ASan
checks, but remains skipped locally because Podman is absent. The updated worker
must pass both C17 and C++20 preflight on its configured host before C++ execution
can be called verified. Older C-only worker heartbeats cannot enable C++ jobs.

README previews are actual application screenshots from disposable test data:
[desktop workspace](screenshots/preview-cpp-workspace.png),
[dashboard](screenshots/preview-home.png), and
[phone editor](screenshots/preview-mobile.png). Physical keyboards, other browser
engines and mainland-China connectivity remain untested. These local checks
preceded the primary publication recorded above.

Earlier release evidence follows and applies to the versions and hosts stated.

---

# Theme persistence and live-page review. 2026-10-16

See [appearance verification](THEMES.md). Light is the default; selected
appearance persists in the account and a non-sensitive early-paint cache.
The guarded VPS migration/backup audit passed with every existing account/data
row unchanged.55 unit/integration tests:54 pass,1 native cloud skip;12 browser
journeys pass, plus12-view scoped accessibility/overflow checks. Browser
extension runtime was not callable; cloud Chromium/Playwright inspected the
actual Site using isolated review accounts. Post-publication checks passed for
light defaults on dark OS, theme reload/fresh login, canonical server draft
restoration and390px editor/navigation, with no page errors. Cleanup run38879114849
removed only the two exact synthetic accounts after backup and confirmed all
retained rows unchanged. Admin workflow restored to manual/read-only.
Previous release evidence follows.

---

# Presentation update. 2026-10-16

The existing public workshop receives a frontend-only redesign guided by
the existing design system. Accounts and saved work remain on
the same VPS backend. Server, migrations, session/data contracts, runner, Worker
proxy and native runtime bindings are unchanged; no production data operation
is part of this release. [Design and QA notes](DESIGN.md) record the system and
intentional reference adaptations.

Current checks:52 unit/integration passes and1 explicit local native skip;
10 browser journeys pass in49.6s, plus the two-account mobile/desktop journey
in12.9s. Typecheck, lint, formatting, production build and curriculum audit pass.
The contrast issues found during redesign were fixed; inspected desktop/tablet/
phone views have no horizontal overflow or unexpected page errors. Existing
screenshots below are historical unless regenerated by the current local tests.
Native compiler, backup and VPS evidence below remains dated to those actual
operations; no new native-host test is implied by a CSS/component update.

---

# Verification report. public release, 2026-10-14

**Public workshop: https://c-forge-workshop.tahuna-2388.chatgpt.site**

Native Site access policy is PUBLIC, revision2. Anyone with the link can choose
Create account and use an independent C Forge username/password; no platform
login is required. React/API bridge run on Sites; durable account data and native
GCC run on the mounted Ubuntu VPS volume. Existing owner passwords, sessions and
saved work survived migration002. No Hiddify, tunnel, VPN, Nginx, firewall or
certificate changes were made during this account release.

## Current release checks

| Check                                                       | Actual outcome                                                                                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` after account-specific export signatures         | 52 passed,1 workspace native-runtime skip;53 total                                                                                                                    |
| `npm run typecheck`, `npm run lint`, `npm run format:check` | Pass                                                                                                                                                                  |
| `npm run build` / curriculum audit                          | Pass;48 lessons,105 exercises,12 checkpoints,3 projects,39 references                                                                                                 |
| Original `npm run test:browser`                             | 10 passed in49.2s, including replacement import after preserving the current account during recovery-buffer cleanup                                                   |
| `npm run test:multi-user`                                   | Pass; desktop and390px touch signup, independent code, account switching, stale-tab write rejection and correct resume                                                |
| Legacy database migration                                   | Pass; original ID/password/session/draft retained, foreign keys valid, idempotent restart                                                                             |
| Same-account versus shared export                           | Pass; own trusted progress restores, another learner's export requires a fresh proficiency check, colliding attempt IDs remapped idempotently                         |
| VPS upgrade run38499841337                                  | Pass; consistent backup, all12 legacy account-data table fingerprints unchanged, production rebuild and API/rootless worker healthy                                   |
| Hosted two-account browser QA                               | Pass; real server saves, native C17 Run/Check, distinct progress, cross-account job404 and fresh-login resume                                                         |
| Anonymous hosted browser QA                                 | Pass without platform service token or platform cookies; two existing independently registered accounts, trusted TLS, desktop1440px/phone390px, no horizontal overflow |
| Exact test-account cleanup run38503175837                   | Pass;4 matching UUID/name/learner-role fixtures removed, all retained database rows unchanged, foreign keys valid; no whole database restore                          |
| Final administrator workflow                                | Manual-only, read-only health checks; automatic source/deletion trigger removed                                                                                       |

Actual hosted screenshots: [desktop lesson](screenshots/public-hosted/desktop-private-draft.png)
and [phone check](screenshots/public-hosted/phone-private-check.png). Account names
are masked. Their filenames describe private account data, not Site audience.
Credentials arrived through hidden stdin, stayed out of logs/source/screenshots,
and browser requests were constrained to the exact Site origin. Cleanup was
preceded by a consistent online backup and rolled back on identity, active-job,
foreign-key or retained-row mismatch. The standalone cleanup also rejected an
incorrect fixture name and retained real accounts in its local SQLite check.

Account security tests cover ownership of drafts/history/conflicts/jobs/exports,
server-owned grading, forged role/IP/account scopes, login/registration limits,
per-account compiler capacity, targeted password recovery, sessions after restart
and shared-browser cache/recovery isolation. Public Run/Check retains rootless
network-free native isolation and the verified resource/fault checks below;
it is intended for a small study group, not hardened hostile multi-tenant hosting.

Remaining limits: mainland-China connectivity has not been tested; phone QA used
Chromium emulation rather than a physical iOS/Android keyboard; future certificate
rollover is scheduled but not yet observed; backups remain VPS-local rather than
off-host disaster recovery. The cloud workspace has no qualifying rootless
compiler runtime, so that one local test is explicitly skipped. Native execution
was verified on the actual VPS, not emulated or run unsafely on the cloud host.

The sections below retain the earlier foundation's measured results and history;
its owner-private audience and temporary empty-baseline cleanup were superseded
by the public multi-account release above.

---

# Foundation verification. 2026-10-13 (historical)

Published owner-private at **https://c-forge-workshop.tahuna-2388.chatgpt.site**.
The complete React frontend and API bridge are hosted by Sites. The real
Fastify/SQLite backend and isolated GCC worker run on the authorized Ubuntu VPS.
Learner data is on its mounted persistent `/srv` volume, not the cloud workspace.
Temporary hosted verification data was removed after a guarded empty-baseline
restore; initial owner setup is ready. Hiddify/tunnel configurations, VPN ports
and firewall rules were not changed. Admin workflows are now manual/read-only.

## Environment and architecture

Cloud: Node24.19.0, npm11.9.0, Chromium154.0.8037.57 on Linux; writable workspace,
package/network access and local Playwright available. No suitable rootless
compiler runtime exists there. Docker28.4.0 was used only for application
packaging, never as a substitute for the required rootless learner sandbox.
VPS: Ubuntu22.04.5 ARM64, Node24.21.0 in its separate application runtime,
Podman3.4.4 with cgroupv2/delegated user manager, immutable GCC14.2.0 image.

The existing Node transactions and durable database were preserved. Sites D1/R2
are unused; Worker ESM embeds the frontend assets and proxies same-origin API
requests over trusted HTTPS. Lessons load individually; hidden tests/solutions
are absent from the browser bundle. Source credentials/runtime secrets were
kept out of source and browser assets. At that foundation checkpoint, Sites sharing was owner-private.

## Commands and measured outcomes

| Command/check                                                                 | Actual outcome                                                                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh locked `npm ci --no-audit --no-fund` during foundation                  | Pass;222 packages installed                                                                                                                                    |
| `npm run lint` / `npm run typecheck` / `npm run format:check`                 | Pass after final source changes                                                                                                                                |
| `npm test`                                                                    | 47 passed,1 native suite skipped in this workspace;48 total, including6 Site proxy tests                                                                       |
| `npm run build` / `npm run content:audit`                                     | Pass;12 modules,48 lessons,105 exercises,12 checkpoints,3 projects,39 references                                                                               |
| `npm run test:browser`                                                        | 10 passed in48.5s after rebuilding portable React output and correcting the diagnostic test’s button selector                                                  |
| `playwright test tests/browser.spec.ts`                                       | Pass; actual multi-file editor navigation/cursor save from `/src/store.c`, ignores library/hidden-driver paths; mocked diagnostic transport explicitly labeled |
| `npm run test:https` (foundation)                                             | 2 passed against real Caddy HTTPS gateway                                                                                                                      |
| `npm run test:subpath` (foundation)                                           | 6 passed with scoped `/forge/` HTTPS cookies/routing                                                                                                           |
| Trusted authored syntax / behavior verification                               | 275 syntax checks and149 finite ordinary behavior/contracts,0 failures; deliberately broken activities verified separately                                     |
| VPS `CFORGE_RUNNER_TESTS=1` isolated operational suite                        | Pass on actual rootless host; see run38409763126                                                                                                               |
| VPS default `content:verify`                                                  | 149 ordinary authored runtime checks passed inside isolated containers,0 failures                                                                              |
| Native Site publication                                                       | Succeeded; exact source pushed to native repository and packaged Worker ESM validated                                                                          |
| Published Site `/api/health`                                                  | 200 JSON; real database healthy through same-origin HTTPS bridge                                                                                               |
| Hosted Playwright `vps-browser-verify.ts --first --sites`                     | Pass; desktop/phone account persistence, real Run/Check and compile failure                                                                                    |
| Real VPS API/worker restart and online backup/restore                         | Pass; run38423680141 and subsequent fresh Site browser sign-in                                                                                                 |
| Hosted `--after-restart --sites`                                              | Pass; exact code/step/stdin/notes/bookmark resume, worker recovery, native wrong-output rejection, hosted responsive screenshots                               |
| Guarded verification cleanup                                                  | Pass; run38424434115 restored the verified zero-owner baseline; setup ready, no real learner overwritten                                                       |
| Actual daily backup service, twice in one day                                 | Both runs succeeded; first integrity-verified snapshot, second reused immutable snapshot without duplication                                                   |
| Production Docker application build/restart/fresh-volume restore (foundation) | Pass; nonroot/read-only application, real auth/progress and online WAL backup                                                                                  |
| Owner recovery CLI and fresh migration/content installation                   | Pass; work preserved, old sessions/password revoked; idempotent registry/migrations                                                                            |

Mocked worker transport tests establish queue/lease/transaction behavior, not
native C execution. Real native execution is separately proven on the VPS.
The workspace skip is intentional and is not reported as a local native pass.

## Hosted learner journeys

A unique temporary owner was used only after confirming a consistent zero-owner
baseline. Screenshots mask identity; passwords/bootstrap/service tokens were not
logged. Platform service authorization was sent only to this exact private Site
origin. No visitor identity was fabricated.

1. Protected setup issued a Secure/HttpOnly/partitioned session over trusted TLS.
2. Desktop saved source, stdin, step, notes and bookmark to the real account.
3. A new390px touch browser context signed in independently and retrieved it.
4. The phone edited code/notes; desktop reload retrieved those exact edits.
5. Run compiled/executed C17, returned actual stdout/exit0, and did not award mastery.
6. Check evaluated the server's grading contract and transactionally recorded proficiency.
7. Missing-semicolon C failed compilation and displayed original GCC diagnostics.
8. API/worker restarted; an online SQLite backup was restored while both were stopped.
9. A fresh browser login recovered the exact phone draft/step/stdin/notes/bookmark.
10. A real wrong-output program ran successfully but failed the exercise contract.
11. Hosted home/path/capstone and390/768/1440 layouts had no page overflow or app runtime errors.
12. Only the guarded temporary account was cleared, leaving fresh setup available.

Independent local browser journeys additionally cover slow/reordered saves,
refresh, offline recovery without replaying Run, genuine two-tab revision
conflicts with both versions preserved, failed-save retry, validated export/import
and preserve/replace history, keyboard/dialog behavior, settings and scoped axe
WCAG2/2.1/2.2 A/AA scans on core screens in light/dark themes. Those outcomes are
not claims of certification across all browsers or assistive technologies.

## Native execution and boundaries

Actual preflight read back rootless cgroupv2, memory512MiB, process64, seccomp2,
zero effective capabilities, no-new-privileges, read-only base, nonroot identity
and loopback-only network. Both compilation/execution use disposable bounded
filesystems, fixed argument arrays, separate deadlines and whole-job cleanup.
Timeout, excessive output, crash, cancellation, network/filesystem isolation and
hardcoded sample-output rejection passed inside containers.

Podman's maintained `--init` correctly forwards signals to the learner process.
The current sanitizer configuration retains seccomp and supports actual ASan
bounds and UBSan signed-overflow diagnostics. **LeakSanitizer is disabled** because
its tracing is incompatible with this sandbox; diagnostic mode cannot find leaks.
A clean run never proves a program correct. The runner shares a host kernel,
not a claim of adversarial public multi-tenant sandbox security.

## Gateway, storage and maintenance evidence

- Initial Worker numeric-IP upstream failed with Cloudflare1003; a real DNS
  hostname and valid separate TLS certificate fixed it. Both hostname and
  original numeric-IP TLS routes subsequently passed verification.
- The C Forge SNI virtual host uses existing8445, ordered last so the old
  IP-address default certificate/SFTPGo routes remain. Existing443 TCP/UDP VPN
  listeners, Xray, Hysteria, Tailscale and WireGuard remained healthy.
- Dedicated ACME state and renewal timer cannot run existing VPN certificate
  hooks. Certificate issuance/TLS passed; a future renewal rollover is not claimed.
- Daily backup runs at04:20 Asia/Shanghai with jitter/lock/five-minute budget,
  online SQLite API/integrity checks,1GiB reserve and at most20 daily/monthly
  snapshots. Backups are VPS-local; off-host disaster recovery is not configured.
- Separate Immich repair removed1,580 superseded backups, reclaimed92.26GiB,
  retained64 restore points, and restored a fresh PostgreSQL dump into a
  disposable database with66 tables. Current `/srv` has about92GiB free.

Private operational evidence:

- [Native compiler/curriculum gate](https://github.com/ilyasmohaimel/linux-setup-recovery/actions/runs/38409763126)
- [Hostname and original-IP TLS verification](https://github.com/ilyasmohaimel/linux-setup-recovery/actions/runs/38422503346)
- [Real account restart/backup restore](https://github.com/ilyasmohaimel/linux-setup-recovery/actions/runs/38423680141)
- [Fixture cleanup and bounded backup duplicate check](https://github.com/ilyasmohaimel/linux-setup-recovery/actions/runs/38424434115)

## Visual review and performance

`view_image` inspected actual hosted home/desktop/phone screenshots. Local core
screens in both themes were also reviewed during refinement. Earlier full-page
captures at a scrolled position displaced sticky elements inside the image;
review captures now reset document scroll before capture. No UI geometry was
changed to compensate for a screenshot artifact. The crafted workshop uses a
local forge/bracket logo, warm dark surfaces, mint Run, purple Check, blue
concept/source accents, amber caution and readable bundled prose/code fonts.

- [Hosted home](screenshots/sites/sites-home.png)
- [Hosted lesson after restart](screenshots/sites/vps-after-restart-account-resume.png)
- [Hosted failed native check](screenshots/sites/sites-native-failed-check.png)
- [Hosted learning path](screenshots/sites/sites-learning-path.png)
- [Hosted multi-file capstone](screenshots/sites/sites-capstone-workspace.png)
- [Hosted mobile code](screenshots/sites/sites-mobile-code.png) / [learn](screenshots/sites/sites-mobile-learn.png)
- [Hosted tablet](screenshots/sites/sites-tablet-workspace.png)
- [Local conflict](screenshots/draft-conflict.png) / [save failure](screenshots/save-failure.png)

Earlier production-local measurements on Chromium154/Linux, without throttling:
one Home heading/fonts observation250ms, first lesson/editor863ms, about1.46MB/
1.92MB observed transfers including TTF/editor assets. These are single local
observations, not Lighthouse scores or China connectivity measurements.
Latest React bundle: core369.61KB (114.53KB gzip estimate), lazy editor419.88KB
(136.94KB), lesson42.04KB, diagram11KB, CSS58.36KB. Editor/diagrams are lazy;
course/test/solution corpus is not downloaded on first load. Build gzip figures
are estimates, not measurements of the hosted network.

## Gate outcome and remaining verification limits

A: Actual content/editor/account/save/resume/native Run/Check vertical slice passed.
B: Save/conflict/recovery/import/access/queue/transactions and real fault/isolation
checks passed; real restart/backup restore passed locally and on the VPS.
C: Full authored path, structural/manual transition audits, runnable examples and
reference contracts passed on the native isolated toolchain.
D: Review/projects/search/settings, four clearly labeled teaching simulations,
keyboard/scoped accessibility checks and responsive visual review completed.
E: Source/lockfile/migration/docs, checks/build/packaging, hosted publication,
production startup/restart, consistent backup/restore and guarded recovery verified.

Remaining limits: no physical iOS/Android or actual onscreen-keyboard test;
no independent end-user platform OAuth login performed by automation (private
service access was used); no mainland-China reachability measurement; no future
certificate renewal rollover; no off-host disaster recovery; no LeakSanitizer.
Offline reading covers already opened/cached material, not the whole course or
server execution.  These limits are not completed features.
