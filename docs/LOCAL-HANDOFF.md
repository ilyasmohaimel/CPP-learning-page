# Continue locally

This root-level source is copied from the current redesigned C Forge Site
commit a3ba3faf90bd2e5dce866a062e10e5100592c877. It is not the Classic comparison.
The dependency lockfile, course, API, migrations, editor, runner integration,
self-hosting configuration and existing tests are included.

## Development

Use Node.js24+ and npm. Run the clone/install/start commands at the top of README.
The Vite development URL is http://127.0.0.1:5173; Fastify listens on port3000.
The default browser API proxy connects to your local server. It does not use
live Site accounts. The initial download requires npm registry access; access
from mainland China has not been verified. Assets are bundled after installation.

After the server starts, read .data/bootstrap-secret in a separate terminal
and complete owner setup. The value is private and is generated on your machine.
Development data is kept in .data. Stop/start preserves it; removing that folder
removes the local account and saved work. All database files, dependencies,
local environment files and runtime credentials are excluded by .gitignore.

## Existing online saves

Existing online data remains on the VPS. A source-code clone does not copy it.
Use Settings / Data on the live workshop to export learner data, then preview
and import it into your local account. Preserve existing work by default.
Exports are private learner data: store them securely and keep them out of Git.
A different installation cannot authenticate the original export signing key,
so imported proficiency may need a fresh check. Follow the application's import
preview and docs/PUBLIC-ACCOUNTS.md; never copy server passwords or signing keys
into a public repository. For a complete server move, use the documented
consistent database backup/restore procedure and protected secret transfer.

## Real C execution

Follow docs/RUNNER.md for a dedicated unprivileged worker user, rootless Podman,
cgroup limits, a pinned toolchain image and a private runner credential.
Compilation and execution remain unavailable until preflight succeeds. Do not
replace isolation with direct host execution of arbitrary learner code.
The app, reading, editor and saving work without compiler setup.

## Checks

    npm run typecheck
    npm test
    npm run content:audit
    npm run build
    npx playwright install chromium
    npm run test:browser

Previous verified results for the transferred source are in docs/THEMES.md and
docs/VERIFICATION.md. This handoff changes documentation only; the source tree
was compared with the exact Site commit. No test result on the user's machine
is implied. Production startup, HTTPS, migrations, backup/restore and account
recovery commands remain in README and the linked deployment documents.

## Hosting identity

.openai/hosting.json identifies the existing redesigned Site. It has no secret,
but intentionally publishing through Sites updates that project. Local npm
development and self-hosting do not publish it. Keep the original live Site and
Classic comparison unchanged unless you intend to deploy an update.
