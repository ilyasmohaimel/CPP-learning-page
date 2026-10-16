# Release notes

## Profiles and sidebar course choices

C and C++ are visible in the sidebar with local vector logos and a selected
state. The header dropdown is removed. The phone navigation contains the same
two choices. Switching preserves each course's drafts and progress.

The bottom-left profile opens an editor for a display name and picture. Photos
are cropped and resized before saving to the account. The sign-in username stays
unchanged. Main screens now use shorter labels and less introductory text.

## Two-course workshop

The repository includes separate C17 and C++20 courses, each with 12 modules,
48 lessons, 105 exercises, 12 checkpoints and three guided projects. Course
choices use revision-checked account preferences. Draft IDs, histories,
reviews and resume positions remain separate between the two courses.

C++ jobs use server-selected G++ and explicit C++20 flags. Worker preflight checks
both ordinary and sanitized C17/C++20 samples within the existing isolation
boundary. A worker that has not verified C++20 cannot accept C++ submissions.

Repository screenshots show the application with a disposable demonstration
account. The source change does not update the hosted workshop or Classic site.
See [VERIFICATION.md](VERIFICATION.md) for the actual checks and remaining limits.

## Appearance and account saves

Light is the default. Explicit light/dark/system choices persist in the account.
A small allowlisted local theme cache restores appearance before the first paint.
Existing account IDs, saved drafts and customized preferences are preserved.

Public learner registration is optional in portable self-hosting. Separate
accounts have private drafts, progress, preferences, exports and jobs. Backend
ownership checks and optimistic revisions remain authoritative.
