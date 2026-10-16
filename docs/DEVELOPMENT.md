# Local development

Use Node.js 24+ and the locked npm dependencies. The application lives at the
repository root.

```sh
npm ci
cp .env.example .env
npm run dev
```

Vite serves http://127.0.0.1:5173 and proxies `/api` to Fastify on port 3000.
Fastify initializes SQLite and its persistent keys in `.data`. Complete the
one-time owner setup using the private `.data/bootstrap-secret` file. Restarting
preserves accounts and saved work; deleting `.data` removes that local data.

The local database is independent of the hosted workshop. To move learner work,
export it from Settings, preview the import, and preserve existing work by
default. A different installation cannot verify the original export signature,
so imported proficiency may require fresh checks. Keep exports out of Git.

## Course content

C17 content is in `content/curriculum.json`; C++20 content is in
`content/cpp-curriculum.json`. Each has a stable manifest. Prefix new C++ IDs
with `cpp-` and preserve existing IDs when changing titles or presentation.
The server combines registries for saves and selects a course for navigation.
Solutions, hidden cases and model answers remain server-side until revealed.

Run the structural audit after changing content:

```sh
npm run content:audit
```

For fixed, trusted course examples and reference solutions only:

```sh
node --import tsx scripts/verify-content.ts --trusted-authoring
node --import tsx scripts/verify-content.ts --course=cpp20 --trusted-authoring
```

These authoring commands do not read learner drafts and do not verify isolation.
Learner programs must use the separate rootless worker in [RUNNER.md](RUNNER.md).

## Browser checks

Build the normal React output before browser tests. `build:site` replaces `dist`
with a hosting artifact, so run `npm run build` again before local browser tests.
Finish builds before starting tests. Browser fixtures use temporary databases.

Use explicit lesson and exercise IDs when checking saves. Poll the canonical
`/api/drafts/:id` response for the new text; a pre-existing save label does not
prove that a later edit reached the account.

## Hosting

`.openai/hosting.json` identifies the primary hosted workshop. Local development
and Git pushes do not publish it. Publishing through Sites updates that project;
use the correct source and build artifact and preserve the separate Classic site.
See [SITES.md](SITES.md) for hosting details.
