# Public ChatGPT Site and learner accounts

Site: https://c-forge-workshop.tahuna-2388.chatgpt.site. Its existing project ID
stays in `.openai/hosting.json`; the release retains the original source/site.
The user explicitly requested public access and separate friends' accounts.

The Site hosts the full React workshop, locally bundled assets, and a standard
Worker ESM same-origin `/api/` proxy. The durable Fastify/SQLite backend and
isolated native GCC worker stay on the VPS. D1/R2 remain unused; existing verified
transactions, saved work and native execution were retained.

C Forge account sessions own learner data. Public registration assigns random
UUIDs, initializes independent preferences/progress and never grants admin rights.
No platform identity is fabricated or used to claim a learner account. ChatGPT
visitor headers do not authorize administrator setup. The Worker rejects
`/api/auth/setup` unconditionally; its old bootstrap secret binding is removed.

Native runtime configuration: `CFORGE_BACKEND_URL`, `CFORGE_SITE_ORIGIN` and a
secret `CFORGE_PROXY_SECRET` independently generated on the backend. The proxy
passes only C Forge's session cookie and expected account ID, consumes platform
service authorization without forwarding it, and authenticates its server-side
visitor-IP header using that separate credential. The backend ignores spoofed
visitor-IP headers without the correct proxy secret. Raw IPs are not stored in
the rate-limit table; bounded expiring SHA256 keys are used.

Original origins are checked before forwarding writes; redirects are not
followed, request bodies are bounded, and upstream failure has honest feedback.
Cookies stay Secure/HttpOnly, scoped to Site root, SameSite=None/Partitioned for
modern iframe contexts. Browser partitioning can require separate logins in
embedded and top-level views; the same account still retrieves server saves.

Browser code supplies its expected account ID. The authenticated server session
remains authoritative; mismatches reject old tabs instead of copying one
learner's code into another's account. New learner API requests require this
scope. Legacy owner clients retain compatibility while the updated frontend
loads. Device buffers and server-state query caches also use account IDs.

The backend uses its verified sslip.io HTTPS hostname on existing8445. Its own
certificate/configuration does not change VPN/tunnel services. China reachability,
physical-device keyboard behavior and future certificate rollover remain
unverified. Backups are VPS-local, not off-host disaster recovery.

The shared Sites CLI was absent in this environment. The previously documented
fallback passes native repository credentials only through hidden stdin and
process-only Git headers, pushes exact source and packages the matching build.
Do not persist these credentials or change Site identity when republishing.

```sh
npm ci
npm run build
npm test
npm run test:browser
npm run test:multi-user
npm run build:site
```

Portable browser checks run before Site packaging: the Worker starter replaces
`dist` with a server entrypoint. `build:site` embeds18 frontend assets; lessons
load individually and hidden tests/solutions stay on the backend. The native Site policy is now PUBLIC; anonymous access, account saves and native
Run/Check have been verified without platform service authorization. Source
updates use save_site_version followed by deploy_site_version with exact
server-returned IDs, preserving that public audience. Backend operations are in VPS.md and PUBLIC-ACCOUNTS.md.
