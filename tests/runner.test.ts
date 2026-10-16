import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COMPILER_FLAGS, PodmanRunner } from "../runner/podman.js";
import type { ProcessExecutor, ProcessResult } from "../runner/process.js";
import {
  LIMITS,
  matchesOutput,
  normalizeOutput,
  validateFiles,
  validateRequest,
} from "../runner/validation.js";

const ok: ProcessResult = {
  code: 0,
  signal: null,
  stdout: "",
  stderr: "",
  elapsedMs: 1,
  timedOut: false,
  truncated: false,
  cancelled: false,
};
test("runner validates payloads before execution and rejects traversal, flags, reserved files and excessive payloads", () => {
  validateRequest({
    files: { "main.c": "int main(void) { return 0; }" },
    stdin: "",
    sanitize: false,
  });
  for (const filename of [
    "../main.c",
    "sub/main.c",
    "/tmp/main.c",
    "-plugin.c",
    "__forge_harness.c",
    "main.cpp",
    "a..c",
  ])
    assert.throws(() =>
      validateFiles({ [filename]: "int main(void) { return 0; }" }),
    );
  assert.throws(() =>
    validateFiles({ "main.c": "x".repeat(LIMITS.sourceBytes + 1) }),
  );
  assert.throws(() =>
    validateFiles(
      Object.fromEntries(
        Array.from({ length: 13 }, (_, i) => [`file${i}.c`, ""]),
      ),
    ),
  );
  assert.throws(() =>
    validateRequest({
      files: { "main.c": "" },
      stdin: "x".repeat(8193),
      sanitize: false,
    }),
  );
  assert.throws(() =>
    validateRequest({
      files: { "main.c": "" },
      stdin: "",
      sanitize: false,
      cases: [
        {
          stdin: "",
          expected: "",
          label: "case",
          fixtures: { "../secret": "x" },
        },
      ],
    }),
  );
});
test("stdout normalization preserves meaningful spaces and internal empty lines", () => {
  assert.equal(normalizeOutput("hello\r\n"), "hello");
  assert(
    matchesOutput("hello\n", {
      stdin: "",
      expected: "hello",
      label: "greeting",
    }),
  );
  assert(
    !matchesOutput(" hello\n", {
      stdin: "",
      expected: "hello",
      label: "greeting",
    }),
  );
  assert(
    !matchesOutput("hello\n\n", {
      stdin: "",
      expected: "hello\n",
      label: "greeting",
    }),
  );
});
test("numeric grading compares all finite output tokens using absolute tolerance", () => {
  const value = {
    stdin: "",
    expected: "2.5 -3",
    label: "numbers",
    tolerance: 0.01,
  };
  assert(matchesOutput("2.501 -3.001\n", value));
  for (const output of [
    "2.6 -3",
    "2.5",
    "NaN -3",
    "Infinity -3",
    "0x2 -3",
    "2.5 -3 extra",
  ])
    assert(!matchesOutput(output, value));
});
test("unavailable runner never invokes a compiler or executes learner code", async () => {
  let calls = 0;
  const execute: ProcessExecutor = async () => {
    calls++;
    throw new Error("Podman unavailable");
  };
  const runner = new PodmanRunner({ execute });
  const health = await runner.preflight();
  assert.equal(health.available, false);
  const result = await runner.execute({
    files: { "main.c": "int main(void){return 0;}" },
    stdin: "",
    sanitize: false,
  });
  assert.equal(result.state, "infrastructure_error");
  assert.equal(calls, 1);
});
test("rootful or cgroup-v1 engines are rejected before creating containers", async () => {
  for (const host of [
    { security: { rootless: false }, cgroupVersion: "v2" },
    { security: { rootless: true }, cgroupVersion: "v1" },
  ]) {
    const commands: string[][] = [];
    const execute: ProcessExecutor = async (_command, args) => {
      commands.push(args);
      return { ...ok, stdout: JSON.stringify({ host }) };
    };
    assert.equal(
      (await new PodmanRunner({ execute }).preflight()).available,
      false,
    );
    assert.equal(commands.length, 1);
  }
});
test("container security arguments retain all enforced boundary controls", () => {
  const args = new PodmanRunner().commonArgs("c-forge-test");
  for (const required of [
    "--init",
    "--network=none",
    "--http-proxy=false",
    "--read-only",
    "--userns=keep-id",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=64",
    "--cpus=1",
    "--memory=512m",
    "--memory-swap=512m",
    "--pull=never",
  ])
    assert(args.includes(required));
  assert(args.includes("--user"));
  assert(args.includes("--env=ASAN_OPTIONS=detect_leaks=0:halt_on_error=1"));
  assert(
    args.includes("--env=UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1"),
  );
  assert(
    !args.some(
      (arg) => arg.includes("SYS_PTRACE") || arg.includes("seccomp=unconfined"),
    ),
  );
  assert(!args.includes("--privileged"));
  assert(!args.some((a) => a.includes("socket")));
  assert(COMPILER_FLAGS.includes("-std=c17"));
  assert(COMPILER_FLAGS.includes("-x"));
  assert(COMPILER_FLAGS.includes("c"));
});

test("mocked orchestration grades raw output on worker side and distinguishes C return 125 from infrastructure errors", async () => {
  let learnerOutput = "preflight-ok\n",
    learnerExit = 0;
  let imagePrefix = "sha256:";
  const state = new Map<string, number>(),
    calls: string[][] = [];
  const execute: ProcessExecutor = async (_command, args) => {
    calls.push(args);
    if (args[0] === "info")
      return {
        ...ok,
        stdout: JSON.stringify({
          host: { security: { rootless: true }, cgroupVersion: "v2" },
        }),
      };
    if (args[0] === "image")
      return { ...ok, stdout: `${imagePrefix}${"a".repeat(64)}\n` };
    if (args[0] === "rm") return ok;
    if (args[0] === "container")
      return {
        ...ok,
        stdout: JSON.stringify({
          ExitCode: state.get(args.at(-1)!) ?? 0,
          Error: "",
        }),
      };
    const name = args[args.indexOf("--name") + 1];
    if (args.includes("/opt/c-forge/preflight")) {
      state.set(name, 0);
      return { ...ok, stdout: "c-forge-isolation-ok gcc-14.2.0\n" };
    }
    if (args.includes("gcc") || args.includes("g++")) {
      const mount = args.find((a) => a.includes(":/build:"))!;
      await writeFile(
        join(mount.split(":/build:")[0], "main"),
        "mock binary, never executed",
        { mode: 0o700 },
      );
      state.set(name, 0);
      return ok;
    }
    state.set(name, learnerExit);
    return { ...ok, code: learnerExit, stdout: learnerOutput };
  };
  const runner = new PodmanRunner({ execute });
  assert.equal((await runner.preflight()).available, true);
  imagePrefix = "";
  assert.equal(
    (await runner.preflight()).available,
    true,
    "Podman 3.4 bare full image IDs remain valid",
  );
  learnerOutput = "cpp-ok\n";
  const cpp = await runner.execute({
    language: "cpp",
    files: { "main.cpp": "int main() {}" },
    stdin: "",
    sanitize: false,
    cases: [{ stdin: "", expected: "cpp-ok\n", label: "C++ contract" }],
  });
  assert.equal(cpp.passed, true);
  const cppCompile = calls.findLast((args) => args.includes("g++"))!;
  assert(cppCompile.includes("-std=c++20"));
  assert(cppCompile.includes("c++"));
  assert(cppCompile.includes("/src/main.cpp"));
  assert(!cppCompile.includes("-std=c17"));
  learnerOutput = "wrong\n";
  const statuses: string[] = [];
  const checked = await runner.execute(
    {
      files: { "main.c": "int main(void){return 0;}" },
      stdin: "",
      sanitize: false,
      cases: [{ stdin: "", expected: "correct\n", label: "contract" }],
    },
    {
      state: async (state) => {
        statuses.push(state);
      },
    },
  );
  assert.equal(checked.state, "succeeded");
  assert.equal(checked.passed, false);
  assert.deepEqual(statuses, ["compiling", "running"]);
  learnerExit = 125;
  const returned = await runner.execute({
    files: { "main.c": "int main(void){return 125;}" },
    stdin: "",
    sanitize: false,
  });
  assert.equal(returned.state, "failed");
  assert.equal(returned.exitCode, 125);
  assert(
    calls.some((args) => args[0] === "container" && args.includes("inspect")),
  );
});

test("preflight rejects short, non-hex and non-sha256 image IDs before running a container", async () => {
  for (const id of [
    `sha256:${"a".repeat(63)}`,
    `sha256:${"g".repeat(64)}`,
    `sha1:${"a".repeat(64)}`,
  ]) {
    let calls = 0;
    const execute: ProcessExecutor = async (_command, args) => {
      calls++;
      return {
        ...ok,
        stdout:
          args[0] === "info"
            ? JSON.stringify({
                host: { security: { rootless: true }, cgroupVersion: "v2" },
              })
            : `${id}\n`,
      };
    };
    assert.equal(
      (await new PodmanRunner({ execute }).preflight()).available,
      false,
    );
    assert.equal(calls, 2);
  }
});

// These programs NEVER execute on the host. Opt-in tests fail when isolation
// preflight fails; they are skipped only when the operator did not request them.
test(
  "isolated host execution: run, compile failure, deadline, output cap, crash and boundaries",
  { skip: process.env.CFORGE_RUNNER_TESTS !== "1", timeout: 120000 },
  async () => {
    const runner = new PodmanRunner({ image: process.env.RUNNER_IMAGE });
    const preflight = await runner.preflight();
    assert(preflight.available, preflight.detail);
    const cpp = await runner.execute({
      language: "cpp",
      files: {
        "main.cpp":
          '#include <iostream>\nint main() { int n{}; std::cin >> n; std::cout << n * 2 << "\\n"; }',
      },
      stdin: "",
      sanitize: false,
      cases: [
        { stdin: "4\n", expected: "8\n", label: "normal" },
        { stdin: "-3\n", expected: "-6\n", label: "negative" },
      ],
    });
    assert.equal(cpp.passed, true);
    const cppInvalid = await runner.execute({
      language: "cpp",
      files: { "main.cpp": "int main() { invalid C++ }" },
      stdin: "",
      sanitize: false,
    });
    assert.equal(cppInvalid.state, "failed");
    const cppBounds = await runner.execute({
      language: "cpp",
      files: {
        "main.cpp":
          "#include <cstddef>\nint main() { volatile std::size_t count = 1; int* values = new int[count]; values[count] = 7; delete[] values; }",
      },
      stdin: "",
      sanitize: true,
    });
    assert.equal(cppBounds.state, "failed");
    assert.match(cppBounds.stderr, /AddressSanitizer: heap-buffer-overflow/);
    const run = (source: string) =>
      runner.execute({
        files: { "main.c": source },
        stdin: "",
        sanitize: false,
      });
    assert.equal(
      (await run('#include <stdio.h>\nint main(void){puts("hello");return 0;}'))
        .stdout,
      "hello\n",
    );
    assert.equal((await run("int main(void) { invalid C }")).state, "failed");
    assert.equal(
      (await run("int main(void) { for (;;) {} }")).state,
      "timed_out",
    );
    const flood = await run(
      '#include <stdio.h>\nint main(void){for(;;)puts("bounded output");}',
    );
    assert(flood.truncated);
    assert(
      Buffer.byteLength(flood.stdout + flood.stderr) <= LIMITS.outputBytes,
    );
    const crash = await run(
      "#include <signal.h>\nint main(void){raise(SIGSEGV);return 0;}",
    );
    assert.equal(crash.state, "failed");
    assert.notEqual(crash.exitCode, 0);
    const boundaries = await run(
      '#include <stdio.h>\n#include <unistd.h>\n#include <sys/socket.h>\n#include <netinet/in.h>\nint main(void){FILE *f=fopen("/etc/c-forge-write","w"); if(f){fclose(f);return 1;} if(access("/var/run/docker.sock",F_OK)==0 || access("/data/c-forge.db",F_OK)==0 || getuid()==0)return 2; int s=socket(AF_INET,SOCK_STREAM,0); struct sockaddr_in a={0}; a.sin_family=AF_INET; a.sin_port=htons(53); a.sin_addr.s_addr=htonl(0x08080808); if(s>=0 && connect(s,(struct sockaddr *)&a,sizeof a)==0)return 3; puts("isolated"); return 0;}',
    );
    assert.equal(boundaries.state, "succeeded");
    assert.equal(boundaries.stdout, "isolated\n");
    const cancellation = new AbortController();
    setTimeout(() => cancellation.abort(), 1000);
    const cancelled = await runner.execute(
      {
        files: { "main.c": "int main(void){for(;;){}}" },
        stdin: "",
        sanitize: false,
      },
      { signal: cancellation.signal },
    );
    assert.equal(cancelled.state, "cancelled");
    const bounds = await runner.execute({
      files: {
        "main.c":
          "#include <stdlib.h>\n#include <stddef.h>\nint main(void){volatile size_t count=1;int *values=malloc(count*sizeof *values);if(!values)return 1;values[count]=7;free(values);return 0;}\n",
      },
      stdin: "",
      sanitize: true,
    });
    assert.equal(bounds.state, "failed");
    assert.notEqual(bounds.exitCode, 0);
    assert.match(bounds.stderr, /AddressSanitizer: heap-buffer-overflow/);
    const overflow = await runner.execute({
      files: {
        "main.c":
          "#include <limits.h>\nint main(void){volatile int maximum=INT_MAX;volatile int result=maximum+1;(void)result;return 0;}\n",
      },
      stdin: "",
      sanitize: true,
    });
    assert.equal(overflow.state, "failed");
    assert.notEqual(overflow.exitCode, 0);
    assert.match(overflow.stderr, /runtime error: signed integer overflow/);
    const checked = await runner.execute({
      files: {
        "main.c":
          '#include <stdio.h>\nint main(void){int n; if(scanf("%d", &n)!=1)return 1; printf("%d\\n",n*2);return 0;}',
      },
      stdin: "",
      sanitize: false,
      cases: [
        { stdin: "4\n", expected: "8\n", label: "normal" },
        { stdin: "-5\n", expected: "-10\n", label: "negative" },
      ],
    });
    assert.equal(checked.passed, true);
    const hardcoded = await runner.execute({
      files: {
        "main.c": '#include <stdio.h>\nint main(void){puts("8");return 0;}',
      },
      stdin: "",
      sanitize: false,
      cases: [
        { stdin: "4\n", expected: "8\n", label: "sample" },
        { stdin: "-5\n", expected: "-10\n", label: "additional" },
      ],
    });
    assert.equal(hardcoded.passed, false);
  },
);
