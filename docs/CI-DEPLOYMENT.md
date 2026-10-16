# Supported CI deployment path

Direct SSH from the managed cloud executor cannot reach the VPS. Standard
GitHub Actions in the owner's private recovery repository provides a supported
connection: authentication with the existing SSH identity and pinned host keys
was verified, and actual VPS operations have succeeded. No cloud network policy
or host-key verification was bypassed. The owner explicitly authorized these
repository commits and deployment/maintenance changes.

Checkout is pinned to an official action commit and sparse-limited to the
specific existing key/pins and clean source artifacts. The token is read-only,
credential persistence is disabled, temporary key copies are mode600 inside a
mode700 directory, and cleanup removes them. The key stays out of application
source and the VPS application/worker mounts. Commands use fixed argument arrays
and strict SSH host verification; public TLS checks keep certificate validation.
Only trusted owner pushes/manual runs trigger these workflows; untrusted PRs do
not receive the SSH identity.

Deployment and storage repair share concurrency group `c-forge-vps-admin` with
cancellation disabled. Source archives/patches have byte-exact SHA256 checks
before installation. The existing VPS is Ubuntu22.04 ARM64: Node24 is isolated
under `/opt/c-forge-runtime`, application source is `/opt/c-forge`, persistent
learner data is on mounted `/srv`, and rootless worker state stays on the boot
filesystem. Existing root-level HTTPS/VPN/services and firewall rules remain.

The real-server browser fixture uses protected temporary credentials and TLS
validation. It only begins when a consistent baseline has zero owners, records
its unique test owner, and restores that baseline only if the current identity
still matches the fixture. It tests actual public account saves, a fresh phone
context, native Run/Check/diagnostics, and service restart/consistent backup
restore. Test progress is cleared before handing the application to its real
owner. Screenshot artifacts mask identity; no passwords, tokens or bootstrap
secrets are printed in logs or included in source.

One-time owner setup material is delivered as a short-lived artifact in the
private repository, separately from sanitized screenshots. It can also be read
locally by the VPS administrator, as documented in [VPS.md](VPS.md). Repository
access/Actions usage limits apply; no new hosting provider was provisioned.
Actual run links and any remaining failures are in [VERIFICATION.md](VERIFICATION.md).

After verification, `c-forge-connect.yml` has only `workflow_dispatch` and performs
read-only health checks. No push-triggered deployment or cleanup remains active.
The guarded fixture was cleared only when its unique identity still matched.
Private Sites now authorizes real-user initial setup server-side; the bootstrap
secret stays in native runtime secrets. The portable app's normal bootstrap form
and administrator recovery remain available without ChatGPT/OAuth.
