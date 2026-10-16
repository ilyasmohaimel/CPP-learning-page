# C execution boundary

The API never executes submitted C. A separate, unprivileged Linux account runs
the worker and rootless Podman. The cloud preview has no usable Podman runtime;
execution is deliberately unavailable there. Local GCC can check **trusted,
version-controlled course syntax**; learner submissions never use host GCC.

The fixed image uses GCC **14.2.0**, explicitly `-std=c17 -x c` for C or `-std=c++20 -x c++` through G++ for C++. C17 is the
course baseline, not the latest C standard. GCC's [C standards support](https://gcc.gnu.org/projects/c-status.html)
and [language standards](https://gcc.gnu.org/onlinedocs/gcc/Standards.html)
document explicit C17 selection. Warnings use `-Wall -Wextra -Wpedantic
-Wformat=2`; they are not universally errors. Debug flags are `-g3 -O0
-fno-omit-frame-pointer`. No learner-controlled compiler flags or Makefile
commands run. Course Makefiles are educational files; the worker compiles the
validated `.c` files directly and links `-lm`.

## Isolation and limits

Compilation and execution each use a new container. Both use network `none`,
the maintained Podman default seccomp profile, all capabilities dropped,
`no-new-privileges`, a nonroot mapped user, read-only image, 64 processes, one CPU,
64 open descriptors, disabled core dumps and 8 MiB file-size limit. A preflight
checks both GCC and G++ 14.2.0 and actual seccomp/capability/NNP state, cgroup memory and process limits,
network interfaces, read-only base and compiler version. Rootless **cgroup v2**
is required; unsupported hosts fail closed.

Compilation has a 15 second wall budget and 12 second CPU budget, 512 MiB memory,
64 MiB temporary storage and disposable writable output directory. Source is
mounted read-only. The fixed binary is checked with `lstat` as a regular,
non-symlink file before it is mounted read-only into a different execution
container. No learner-program writable host directory exists at execution.
Fixtures are validated regular text files copied into a disposable 16 MiB
`/work` tmpfs. Podman's maintained `--init` process (catatonit) forwards signals
and reaps descendants. Learner programs run as ordinary child processes rather
than namespace PID 1, whose special signal behavior can ignore software-raised
signals. The trusted startup script `exec`s the learner binary; neither it nor
the init holds grading state or credentials. See the supported
[Podman 3.4 init options](https://docs.podman.io/en/v3.4.4/markdown/podman-run.1.html#init).

Execution has a 2.5 second wall budget, 3 second CPU limit and 512 MiB memory.
Diagnostic mode uses supported `-fsanitize=address,undefined` and
`-fno-sanitize-recover=all`, 4 seconds and 1 GiB memory. It deliberately avoids
`RLIMIT_AS` because AddressSanitizer reserves large virtual address ranges.
Preflight compiles and runs normal and sanitized samples for both C17 and
C++20 under these limits. A clean sanitizer run does not prove correctness. See the official
[GCC instrumentation options](https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html).

`ASAN_OPTIONS=detect_leaks=0:halt_on_error=1` disables **LeakSanitizer only**.
The ARM64 Ubuntu rootless probe confirmed that its ptrace-based inspection exits
with a fatal error under the retained isolation restrictions. ASan bounds and
lifetime checks and UBSan undefined-behavior checks stay enabled. The worker
does not add ptrace capabilities or relax seccomp to support leak inspection.
Diagnostic mode therefore does **not** detect memory leaks. Review ownership and
matching `free` calls, and use a dedicated leak checker such as Valgrind on a
trusted reference or your own program on your development machine when needed.
These additional host checks are separate from application grading.

Stdout plus stderr is capped at 64 KiB per stage. Crossing the cap stops and
removes the entire container, retaining the beginning with a truncation notice.
Cancellation and deadlines force-remove the container, including child
processes, then terminate the Podman client process group. Cleanup is repeated
in `finally`; a cleanup failure disables execution. The worker removes its
labelled abandoned containers and owned temporary directories at startup.
The API explicitly fails expired leases instead of keeping interrupted jobs
spinning indefinitely.

Each payload permits at most 12 flat filenames (`.c`, `.h`, `.cpp`, `.hpp`, `.txt`, or
`Makefile`), 128 KiB total source, 8 KiB stdin, 12 test cases and 64 KiB fixtures
per case. Paths, traversal, reserved harness filenames and NUL text are rejected.
Program arguments come from authored server contracts, not unrestricted browser
flags. Per-job total wall time is 100 seconds. Queue capacity is 20 and worker
concurrency is one.

Public registration is enabled for a small study group. This is not a hardened
hostile-code service: containers share a host kernel. Rootless operation reduces privileges
but cannot eliminate kernel/compiler/container-runtime vulnerabilities. Keep
Podman, the host and the toolchain security-maintained; use a dedicated VM for broader adversarial audiences, apply registration limits and do not expose the runner or its socket.
No application database, home directory, secrets, container socket or network
credentials are mounted into learner containers. The rootless worker account
must be separate from the application/database account. Do not give that account
sudo or access to application data.

## Prepare an Ubuntu host

For the installed native Ubuntu deployment (`/opt/c-forge`, isolated Node 24
under `/opt/c-forge-runtime`, API `127.0.0.1:3030`, private application data at
`/srv/apps/c-forge/data`), use:

```sh
sudo bash /opt/c-forge/deploy/setup-runner.sh
```

This administrator script preserves the API's existing runner credential and
prepares a dedicated `cforge-runner` account. Its home, rootless image storage
and disposable jobs live on the boot filesystem under
`/var/lib/c-forge-runner`; it does not use or change rootful Docker storage.
It grants cgroup delegation only to that user's systemd manager, gives the
worker traversal to its own environment file while denying application secrets
and data, and stages an equivalent build recipe compatible with Ubuntu 22.04's
Podman 3.4 / Buildah. The immutable full image ID is resolved locally before use.

Preflight, the opt-in isolated operational suite, and the complete isolated
course verifier must pass before the worker is enabled. A final root-only read
of the **worker heartbeat table** checks that the actual service authenticated
to the API; the worker itself cannot open the application database. Failed gates
stop the worker and clean up only its labelled interrupted containers. Existing
app settings and learner data are preserved. Stage budgets cap apt operations,
image build, tests and verification. Root-private results go to
`/var/log/c-forge-runner-setup/<UTC run ID>/`, with no secret values printed or
included in the report. Preparation and local syntax checks do not establish
that these operational gates passed on a host; use its actual report.

Install Node 24+ and the application's locked npm dependencies as documented in
the root README. Rootless Podman requires subordinate UID/GID mappings and
delegated cgroup v2; use the distribution's supported setup and inspect
`podman info`. See [Podman run documentation](https://docs.podman.io/en/latest/markdown/podman-run.1.html).
Do not disable seccomp, switch to privileged containers, or add host networking
to make a preflight pass.

```sh
sudo apt-get update
sudo apt-get install podman crun catatonit uidmap slirp4netns fuse-overlayfs
sudo useradd --create-home --shell /bin/bash cforge-runner
sudo loginctl enable-linger cforge-runner
sudo install -d -m 0700 -o cforge-runner -g cforge-runner /var/lib/c-forge-runner/jobs
```

Ensure the dedicated user has at least 65,536 subordinate UIDs/GIDs in
`/etc/subuid` and `/etc/subgid` using the host administrator's normal allocation
procedure. `/opt/c-forge` and installed dependencies must be readable by the
worker but application data must not be. Run the following commands in that
user's real login session, which supplies its systemd user manager and runtime
directory:

```sh
cd /opt/c-forge
podman info
podman build --pull=always -f runner/Dockerfile -t localhost/c-forge-toolchain:gcc14.2-v1 .
podman image inspect localhost/c-forge-toolchain:gcc14.2-v1 --format '{{.Id}}'
```

Set `RUNNER_IMAGE` to the returned local `sha256:...` image ID in the worker
environment for immutable operation. The version tag pins the compiler release;
the recorded built image ID pins its complete local filesystem. The image is
never implicitly pulled when running learner jobs. Initial image and npm
downloads require outbound network; mainland-China availability has not been
tested. The installed app does not need external downloads to execute C.

Generate a separate 32+ character `RUNNER_SECRET` with the host's secure secret
generator. Put the same value in API and worker environments, with restrictive
permissions, and keep it out of learner exports/logs. `/etc/c-forge/runner.env`
contains only worker settings:

```dotenv
RUNNER_API_URL=http://127.0.0.1:3000
RUNNER_SECRET=replace-with-administrator-generated-secret
RUNNER_IMAGE=localhost/c-forge-toolchain:gcc14.2-v1
```

For a first foreground check:

```sh
cd /opt/c-forge
set -a
. /etc/c-forge/runner.env
set +a
node --import tsx runner/worker.ts
```

After confirming the API reports a verified runner, install
`runner/c-forge-runner.service` into the worker user's
`~/.config/systemd/user/`, then run `systemctl --user daemon-reload` and
`systemctl --user enable --now c-forge-runner`. It is deliberately a user
service with cgroup delegation, rather than a privileged Compose service or a
Docker socket mounted into the application. Only one worker should use this
dedicated identity and job directory.

## API protocol

All paths below require `Authorization: Bearer RUNNER_SECRET`. The secret is
only on the private worker/API boundary. Browser users cannot lease jobs,
provide passing results, or obtain another account's results.

- `POST /internal/runner/heartbeat`: `{workerId, available, detail}`.
- `POST /internal/runner/lease`: `{workerId}` returns `{job:null}` or
  `{job:{id,leaseToken,request}}`.
- `POST /internal/runner/jobs/:id/status`:
  `{workerId,leaseToken,state:"compiling"|"running"}`.
- `GET /internal/runner/jobs/:id/control?workerId=...&leaseToken=...`:
  `{cancelled:boolean}`. Polling refreshes the lease.
- `POST /internal/runner/jobs/:id/result`:
  `{workerId,leaseToken,result}`. Retrying the same lease result is idempotent.

The API owns database leases, cancellation, ownership and atomic attempts /
progress changes. Leases last 120 seconds and renew during status/control
calls. Availability expires after 30 seconds without heartbeat. The worker
sends heartbeat every 10 seconds and polls cancellation every 750 ms. It aborts
execution if its lease/control API is lost.

`Run` executes with learner stdin and any public authored function harness,
fixtures or arguments. It does not mark proficiency. `Check` executes the
server's cases and grades actual behavior in the worker host after the container
exits. Normalization changes CRLF and removes **one final newline only**;
spaces and internal blank lines matter. Numeric cases compare all finite numeric
tokens using the contract's absolute tolerance. Function harnesses compile
alongside submitted function sources. Each case runs with a fresh filesystem.
Private expected outputs and reference solutions stay server-side until an
explicit reveal. Hidden cases are an instructional aid, not anti-cheating DRM.

## Verification

Cloud-verified unit checks:

```sh
node --import tsx tests/runner.test.ts
```

On the prepared rootless host, with its pinned image:

```sh
CFORGE_RUNNER_TESTS=1 node --import tsx tests/runner.test.ts
node --import tsx scripts/verify-content.ts
node --import tsx scripts/verify-content.ts --course=cpp20
```

The opt-in test compiles/runs valid C, invalid C, an infinite loop, output flood,
crash, cancellation, ASan out-of-bounds and UBSan signed-overflow diagnostics,
boundary probes, behavior checks and a hardcoded incorrect
solution, **inside containers only**. It fails if preflight fails. These
operational tests cannot run in the cloud workspace; their existence is not
evidence they passed. The content verifier separately offers `--syntax-only`
for trusted authored content and reports that execution remains unverified.

For curriculum authoring, `node --import tsx scripts/verify-content.ts
node --import tsx scripts/verify-content.ts --course=cpp20
--trusted-authoring` links and executes only the finite, version-controlled
ordinary examples and reference solutions on the authoring host, with bounded
process/output/file limits. It does not read learner submissions and is never
imported by the application. Deliberately broken examples and adversarial
resource/sanitizer cases are excluded. This check can establish authored example
behavior while isolation is unavailable, but cannot verify the application
runner, container security, or sanitizer execution. The default verifier remains
fail-closed and requires the isolated toolchain.


## Actual hosted verification

Private VPS Actions run38409763126 passed the real rootless preflight, operational
suite, ASan/UBSan probes and149 ordinary curriculum/reference checks on Ubuntu
ARM64/Podman3.4.4/GCC14.2.0. Through the then-private hosted Site, real Run,
Check, wrong-output rejection and GCC compilation failure additionally passed.
The API and isolated worker restarted and remained available with restored data.
The workspace test suite still skips native execution because it lacks that
rootless host; it does not silently substitute host GCC or rootful Docker.
