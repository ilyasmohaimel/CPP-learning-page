# Appearance and live-page review. 2026-10-16

The public Site was inspected in cloud Chromium using a dedicated review
account: home, learning path, projects/capstone, reference, settings and lesson
workspace, plus mobile editor/navigation. The Browser skill was available but
no callable extension runtime was exposed, so the existing Playwright workflow
was used. Synthetic review accounts are removed by exact UUID/name/learner-role
guards after checks; real accounts are never used as test fixtures.

## Changes from the inspection

Light is the default regardless of OS appearance. A chosen light/dark/system
preference remains server-saved per account and restores on another device.
A tiny, locally served script applies the remembered appearance before React and
CSS paint, preventing the old dark loading flash on repeat visits. The cache
contains only an allowlisted theme string, is versioned/scoped to the app path,
and is never learner identity or progress storage. If browser storage is blocked,
the app starts light and still restores the server preference after sign-in.

System is an explicit opt-in and now reacts to OS changes. Header actions name
the actual destination theme and wait for preference saving before allowing
another action. Changes that fail authorization or revision checks do not
silently replace the saved choice. Theme icons reflect the resolved appearance.

Sign-in now follows both themes instead of keeping fixed dark/paper panels.
The original forge mark is slightly larger, small brand captions are clearer,
and the favicon uses the current cobalt/apricot palette. Session suggestions
have less empty vertical space; project/chapter labels use sentence case.
All assets stay local; no new remote API or runtime dependency is introduced.

## Existing accounts

New accounts are created with light preferences. Migration003 adjusts an old
stored dark default only if preferences_revision is zero, meaning preferences
were never saved. It changes only that JSON theme property and advances the
revision to reject stale settings forms. Any saved/customized preferences,
including dark or system, are preserved. There is no account, draft, history,
progress, note or project reset.

The actual VPS upgrade (Actions run38877267430) took a consistent online backup,
applied migration003 and compared every non-migration table against its expected
exact delta. In the live database zero accounts required default conversion;
all existing account data and explicit choices were unchanged. Foreign keys,
API, worker and pre-existing VPN/tunnel services were healthy. No network,
firewall, Nginx or certificate configuration was changed. The administrator
workflow is returned to manual/read-only after exact fixture cleanup.

## Verification

55 unit/integration tests:54 pass,1 native-runtime skip in the cloud workspace.
New tests cover the actual early-paint script, invalid/blocked storage, /forge/
path scoping, untouched-versus-explicit migration behavior, idempotence and
retention of identity/drafts. The12 browser journeys include both existing
saved-work journeys and a new theme journey: dark OS still defaults light,
selected dark paints correctly while the account request is held, a fresh login
restores the account choice, system mode responds to media changes, explicit
mode overrides OS, and accounts retain separate preferences.

The original10 journeys passed in52.5s. The two-account/theme suite passed in
16.5s after scoping the sign-out locator to its navigation control. Additional
12-view light/dark/mobile scans reported no WCAG violations, overflow or page
errors. Typecheck, lint, formatting, curriculum audit and production build pass.
Physical phone keyboards, other browser engines, blocked-storage first-paint
consistency and mainland-China connectivity are not verified. Native C execution
is unchanged and was not rerun unsafely on the cloud host.

## Actual public Site after publication

Cloud Chromium verified a new account starts light on a dark OS, dark survives
reload, a fresh browser restores server dark, and light remains after changing
back and reloading. The guided exercise was saved and polled through the real
same-origin API, then restored after reload and a fresh login. The390px editor
and navigation had no page-level horizontal overflow; no page errors occurred.
Home, path, projects/capstone, reference, settings and lesson were visited.

An earlier review script used an implicit exercise route and checked an already
visible save label; its later editor assertion failed. That assertion is not
counted as a pass. A guarded read of only that synthetic account confirmed the
review marker remained in its guided draft. The final journey specifies the
exercise ID and verifies canonical server code before navigating away.

Cleanup run38879114849 backed up the database, removed only the two matching
UUID/name/learner-role fixtures, and verified every retained row fingerprint and
foreign key. The administrator workflow was restored to manual/read-only.

Screenshots: [light home](screenshots/theme-review/home-light.png),
[dark lesson](screenshots/theme-review/lesson-dark.png),
[phone lesson](screenshots/theme-review/lesson-mobile-light.png).
Pink rectangles in desktop screenshots mask the synthetic account controls;
they are screenshot privacy masks, not interface elements.
