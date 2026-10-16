# Use C Forge on your phone and Linux PC

The currently published workshop is [the public ChatGPT Site](https://c-forge-workshop.tahuna-2388.chatgpt.site). Open it in your browser on phone or Linux. Choose Create account, or sign into your existing C Forge account; no ChatGPT login is required. Its saved work and compiler are on the persistent VPS. See [SITES.md](SITES.md) and [VPS.md](VPS.md); the commands below remain portable self-hosting alternatives.

Run C Forge once on your Ubuntu server. Open **the same HTTPS address** in your
phone browser and your Linux browser, and sign in with the same learner account.
Neither client needs Node, GCC, Docker, an AI key, or a VPN. The server handles
saved work and, after worker setup, compilation. A public URL has not yet been
deployed: the actual domain/server connection still needs to be supplied.

The cloud computer's `127.0.0.1:3000` is not reachable from your phone or PC.
Your Ubuntu deployment uses a normal hostname such as your chosen subdomain,
with a valid HTTPS certificate. The address shown below in example files is
reserved documentation DNS, **not a working C Forge address**.

## First deployment on Ubuntu

Use this option when the server does **not** already have a gateway on ports80/443.
Docker Engine plus its Compose plugin is required. Use a DNS A record for the
server's public IPv4 (and an AAAA record only if its IPv6 is reachable). DNS,
router/NAT and the server firewall must route ports80/443 to this server.
Do not change unrelated websites or firewall rules blindly.

Copy the supplied source to the server. From its project directory:

```sh
cp --no-clobber .env.example .env
cp --no-clobber .env.https.example .env.https
# Edit .env.https: set CFORGE_DOMAIN to YOUR real hostname, without scheme/path.
# Optional: set the private runner credential in .env; keep it out of source control.
docker compose --env-file .env.https -f compose.yaml -f deploy/compose.https.yaml config --quiet
docker compose --env-file .env.https -f compose.yaml -f deploy/compose.https.yaml up --build -d
# Read the bootstrap secret ON THE SERVER; enter it in the one-time setup form.
docker compose --env-file .env.https -f compose.yaml -f deploy/compose.https.yaml exec app cat /data/bootstrap-secret
```

Caddy2.11.7 terminates HTTPS, redirects HTTP, renews free public certificates, and
compresses responses. It forwards both the frontend and `/api` to the app under
one origin and blocks `/internal` worker routes. The app port remains bound to
server loopback. The worker connects directly to this private API port, never
through the public gateway. Secure HttpOnly cookies are enabled by the override.

`cforge-data` retains SQLite, WAL and application keys. `cforge-caddy-data` retains
certificate/account material; `cforge-caddy-config` retains gateway configuration.
Use the same Compose project directory/name on updates. Do not run `down -v`.
Back up the learner database with the README's online SQLite backup procedure;
protect any additional gateway/configuration backups containing private keys.

After startup, check the actual hostname from both your PC and phone:

```sh
# Replace YOUR_HOST with the configured real hostname.
curl --fail https://YOUR_HOST/api/health
```

The response must be JSON with `status:"ok"` and `database:true`; a static HTML
page alone does not establish a working backend. Sign in on one device, edit a
lesson, wait for **Saved to account**, then sign in/open it on the other device.
Use refresh after another device edits; conflicting edits require a version choice.
Device-only recovery has not synchronized until the account acknowledgement.

## If your server already hosts websites

Keep its existing gateway. Run only the app with `COOKIE_SECURE=true` in its
protected `.env`, then add a virtual host for your chosen hostname.

For existing Caddy, [deploy/Caddyfile](../deploy/Caddyfile) is the reusable site
block: use `CFORGE_UPSTREAM=127.0.0.1:3000`, and integrate its site into the existing
configuration without replacing unrelated sites. Use Caddy's supported validation
and reload procedure after inspecting the current service.

For Nginx, [deploy/nginx-https.conf.example](../deploy/nginx-https.conf.example)
is an additive TLS virtual-host example with original Host preservation and
private worker route blocking. It assumes a valid certificate has already been
issued for the chosen hostname. Actual certificate issuance/reload should use
the server's existing mechanism. This template has not been executed against an
actual Nginx host in the cloud.

### Existing services using ports3000 or443

Inspect listeners and the existing gateway before choosing a public port. If
port3000 is in use, this override publishes **only** loopback3030; it replaces
the base mapping rather than appending a conflicting binding. It requires
Compose2.24.4 or newer (`!override` is documented by Docker):

```sh
docker compose -f compose.yaml -f deploy/compose.existing-gateway.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.existing-gateway.yaml up --build -d
curl --fail http://127.0.0.1:3030/api/health
```

Set the dedicated worker's `RUNNER_API_URL=http://127.0.0.1:3030` in this setup.
Do not combine this override with the new Caddy gateway configuration.

If443 is dedicated to another service, reuse the existing Nginx TLS gateway on
a confirmed free and reachable service port. An additive template is
[deploy/nginx-alternate-port.conf.example](../deploy/nginx-alternate-port.conf.example).
Port8448 is an **example**, not an assertion that the live host has it available.
It uses certificate paths inspected on the server. A public IP can be used only
when its current valid certificate explicitly covers that IP; changing the IP
requires updating the certificate and address. Never disable certificate checks.

The ordinary browser address is then `https://YOUR_SERVER_IP:YOUR_SERVICE_PORT`.
Validate `nginx -t` before reload and verify existing services afterward. Actual
port allocation, firewall access and certificate validity must be checked on the
live host; this template has not yet been executed there.

## Normal daily use

1. Open your server's HTTPS address on either device.
2. Sign in with your C Forge username/password.
3. Resume the named lesson/exercise. Account saves restore files, input, notes,
   step, selection, pane width, prediction text, and mobile view.
4. On a phone, use browser **Add to Home Screen** / **Install app** if supported.
   On iPhone, this is usually Safari's Share menu. On Android/Chromium, use its
   browser menu. Linux Chromium may also offer an install action; bookmarking
   works in ordinary Firefox and other browsers.

Local PNG icons, a web manifest, standalone display, and an Apple touch icon are
included. OS installation behavior varies by browser and was not tested on a
physical phone. This shortcut does not install a native compiler or make all
lessons available offline. A fresh session still needs your server connection.
Existing opened-tab offline recovery remains as documented in the README.
Settings → “Your phone and Linux PC” shows the current workshop address and a
copy action, with an explicit warning for localhost-only addresses.

The installed application loads no third-party fonts/CDNs/AI. DNS, certificate
issuance, initial image/package downloads and the server's route from mainland
China still need real network verification; no China-accessibility claim has
been made. After initial hosting, clients reach your server directly over HTTPS,
without a third-party tunnel or VPN dependency.

## Compiler worker

Normal browser access is separate from isolated execution. On Ubuntu, configure
the dedicated rootless Podman worker and run its operational checks per
[RUNNER.md](RUNNER.md). It remains unavailable until preflight actually passes.
Do not mount a Docker socket in the web app, expose the worker, or enable host
compilation as a shortcut. The HTTPS gateway does not alter that boundary.

## Local verification

With production assets built and a Caddy2.11.7 binary installed:

```sh
npm run build
CADDY_BINARY=/path/to/caddy npm run test:https
```

This suite uses a disposable local SQLite database and Caddy internal test CA.
Chromium trusts that fixture only via its test configuration; production clients
use normally trusted public certificates. It checks secure sessions, actual
HTTPS/API proxying, desktop↔phone-sized account saves, route isolation,
compression, redirects, and locally served manifest/icon dimensions. Passing
this local suite is not evidence of deployment to your actual Ubuntu server.
