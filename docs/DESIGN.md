# C Forge workshop redesign — 2026-10-16

The user requested Anthropic's design skill, retention of existing accounts and
saved work, and publication to the same ChatGPT Site. The official
[Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
was read directly from its upstream repository. Its process informed a
subject-specific design plan, critique, implementation and screenshot review.
The installed frontend build, React and testing guidance also informed the work.

## Visual system

Graphite `#1c1d22` and ink `#17181d` support focused reading; warm white `#f5f4ef`
is the light theme and account-form surface. Periwinkle `#b9c7ff` identifies the
resume area; cobalt `#4056c7` provides light-theme actions. Apricot, sage and
lavender distinguish chapter symbols and learning feedback. Functional borders,
not decorative gradients, organize the workspace.

Locally bundled Newsreader is used for display headings and the current chapter
number. Open Sans stays on prose/controls and DejaVu Sans Mono stays on code.
The new font's complete SIL Open Font License is in public/fonts. Browser assets
need no font CDN. Lesson/editor text size and spacing preferences still apply.

The main view keeps one prominent resume surface, an ordered course list,
actual session suggestions and honest review/activity states. The lesson keeps
its resizable instruction/editor split, run/check distinction, visible save
status and mobile Learn/Code/Results tabs. Public sign-in uses a quiet paper
form beside a static worked C example, whose output is explicitly labeled
expected output. The example was compiled with explicit C17 and warnings and
printed the expected text; it is not presented as a learner execution result.

## Design review

Three generated references covered home, lesson/editor and account entry. They
were inspected together with rendered screenshots using view_image, including
1440px desktop,768px tablet and390px phone layouts. The comparison covered:

- Typography: display hierarchy implemented; sans-serif lesson prose/controls
  deliberately retained for readability instead of the reference's serif body.
- Palette: graphite, warm-white and periwinkle surfaces reproduced; the dark
  resume numeral was adjusted to pass large-text contrast and its footer's old
  translucent background was removed to restore normal-text contrast.
- Layout: the quiet navigation rail, large resume area, course list, session
  rail and functional lesson split are retained. Actual learner state determines
  rows and progress, rather than the concept's invented lesson/session copy.
- Copy: real course titles, objectives, hints and CTA labels stay authoritative.
  The account story reads Small steps. Real programs.; no passing result or
  invented learner activity was added. Existing saved drafts are not replaced.
- Iconography: the original forge mark and established Lucide control meanings
  remain consistent; generated alternative brand/navigation symbols were not
  substituted. Chapter colours encode the ordered path.
- Responsive layout: small screens shorten the account story, keep the form
  readable and use existing mobile workspace tabs. A legacy negative button
  margin was removed and the recovery link gets its own line on phones.

These are intentional adaptations to preserve the working learning product;
there are no outstanding material layout, contrast or interaction mismatches
in the inspected views. Concepts and temporary comparison captures are QA
artifacts outside the source tree, not raster interfaces shipped to learners.

## Data boundary

Only presentation components, CSS and local font assets changed. All server,
shared contracts, database migrations, runner and Worker proxy code remain
unchanged. The Site's existing project ID, public audience and runtime bindings
are retained. Its frontend bundle is repackaged; no VPS update, account reset,
import, database restore, data deletion or credential rotation is performed.
The hosted /forge/ backend continues to own existing accounts and saved work.

## Verification

Browser skill was available as guidance, but no Browser runtime tool was
exposed, so the project's existing Playwright/Chromium workflow was used.
52 unit/integration tests passed;1 native-runtime test remains skipped in this
cloud workspace. All10 original browser journeys passed in49.6s; the separate
two-account desktop/phone journey passed in12.9s. Tests exercise actual account
saves, reopening, slow/offline saves, conflicts, import/export, failed conceptual
checks, isolated-runner unavailability, keyboard dialogs and scoped WCAG checks.

Additional Chromium inspection found no page errors, horizontal overflow at
768/390px or WCAG violations on the inspected account, home, lesson and mobile
results views after the two contrast corrections. Typecheck, lint, formatting,
curriculum audit and production build passed. Intermediate runs caught the
contrast issues; later test-directory/build races were resolved by isolating
output and finishing builds before browser runs. No test expectations were
weakened. Passing automated checks is not a complete accessibility certification.

Production native C execution was verified previously on the actual VPS; this
presentation update does not claim a new isolated compiler verification in the
cloud workspace. Physical phone keyboards and mainland-China reachability
remain unverified. Source mirror: ilyasmohaimel/projects, c-forge/.
