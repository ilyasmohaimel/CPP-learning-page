import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Case, SourceFiles } from "../shared/content.js";
import type {
  ExecutionResult,
  RunnerOutcome,
  RunnerRequest,
} from "../shared/runner.js";
import {
  executeProcess,
  type ProcessExecutor,
  type ProcessResult,
} from "./process.js";
import { LIMITS, matchesOutput, validateRequest } from "./validation.js";

export const TOOLCHAIN_IMAGE = "localhost/c-forge-toolchain:gcc14.2-v1";
export const COMPILER_FLAGS = [
  "-std=c17",
  "-x",
  "c",
  "-Wall",
  "-Wextra",
  "-Wpedantic",
  "-Wformat=2",
  "-g3",
  "-O0",
  "-fno-omit-frame-pointer",
  "-fdiagnostics-color=never",
];
export const CPP_COMPILER_FLAGS = [
  "-std=c++20",
  "-x",
  "c++",
  ...COMPILER_FLAGS.slice(3),
];
export function compilerFor(language: "c" | "cpp" = "c") {
  return language === "cpp"
    ? { command: "g++", extension: ".cpp", flags: CPP_COMPILER_FLAGS }
    : { command: "gcc", extension: ".c", flags: COMPILER_FLAGS };
}
export interface RunnerConfig {
  engine?: string;
  image?: string;
  execute?: ProcessExecutor;
}
export interface RunnerHooks {
  signal?: AbortSignal;
  state?: (state: "compiling" | "running") => Promise<void>;
}
export interface PreflightResult {
  available: boolean;
  detail: string;
}

/** Learner binaries are executed only by Podman, never by the worker host. */
export class PodmanRunner {
  readonly engine: string;
  readonly image: string;
  private readonly exec: ProcessExecutor;
  private ready = false;
  constructor(config: RunnerConfig = {}) {
    this.engine = config.engine ?? "podman";
    this.image = config.image ?? TOOLCHAIN_IMAGE;
    this.exec = config.execute ?? executeProcess;
  }

  commonArgs(name: string, sanitize = false, compiling = false): string[] {
    const uid = process.getuid?.() ?? 1000,
      gid = process.getgid?.() ?? 1000;
    return [
      "run",
      // Podman's maintained init forwards signals and reaps descendants, so
      // learner code is an ordinary child rather than Linux namespace PID 1.
      "--init",
      "--pull=never",
      "--name",
      name,
      "--label",
      "io.c-forge.runner=1",
      "--network=none",
      "--http-proxy=false",
      "--read-only",
      "--userns=keep-id",
      "--user",
      `${uid}:${gid}`,
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=64",
      "--cpus=1",
      `--memory=${sanitize ? "1024m" : "512m"}`,
      `--memory-swap=${sanitize ? "1024m" : "512m"}`,
      "--ulimit",
      `cpu=${compiling ? "12:13" : "3:4"}`,
      "--ulimit",
      "fsize=8388608:8388608",
      "--ulimit",
      "nofile=64:64",
      "--ulimit",
      "core=0:0",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
      "--tmpfs",
      "/work:rw,nosuid,nodev,size=16m,mode=1777",
      "--workdir=/work",
      "--env=HOME=/nonexistent",
      "--env=LANG=C.UTF-8",
      "--env=LC_ALL=C.UTF-8",
      "--env=PATH=/usr/local/bin:/usr/bin:/bin",
      // LSan's ptrace-based inspection fails under the retained default
      // seccomp boundary. ASan/UBSan remain enabled without leak detection.
      "--env=ASAN_OPTIONS=detect_leaks=0:halt_on_error=1",
      "--env=UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1",
    ];
  }

  private async cleanup(name: string): Promise<void> {
    const result = await this.exec(
      this.engine,
      ["rm", "--force", "--ignore", name],
      { timeoutMs: 5000, maxBytes: 4096 },
    );
    if (result.code !== 0 || result.timedOut)
      throw new Error(
        "Container cleanup failed; runner stopped accepting jobs.",
      );
  }

  private async container(
    args: string[],
    input: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    const name = args[args.indexOf("--name") + 1];
    try {
      const result = await this.exec(this.engine, args, {
        input,
        timeoutMs,
        maxBytes: LIMITS.outputBytes,
        signal,
        onTerminate: () => this.cleanup(name),
      });
      if (result.cancelled || result.timedOut || result.truncated)
        return result;
      // Podman uses 125–127 for CLI errors, while C may legitimately return the
      // same values. Inspect the actual container state before deleting it.
      const inspected = await this.exec(
        this.engine,
        ["container", "inspect", "--format", "{{json .State}}", name],
        { timeoutMs: 5000, maxBytes: 8192 },
      );
      if (inspected.code !== 0) return { ...result, infrastructureError: true };
      const state = JSON.parse(inspected.stdout) as {
        ExitCode?: number;
        Error?: string;
        OOMKilled?: boolean;
      };
      return {
        ...result,
        code: state.ExitCode ?? result.code,
        infrastructureError: !!state.Error,
        ...(state.OOMKilled
          ? {
              stderr:
                result.stderr +
                "\nProgram exceeded its container memory limit.\n",
            }
          : {}),
      };
    } finally {
      await this.cleanup(name);
    }
  }

  async preflight(): Promise<PreflightResult> {
    this.ready = false;
    try {
      if (process.getuid?.() === 0)
        throw new Error(
          "The dedicated worker must run as an unprivileged Linux user.",
        );
      const infoResult = await this.exec(
        this.engine,
        ["info", "--format=json"],
        { timeoutMs: 8000, maxBytes: 65536 },
      );
      if (infoResult.code !== 0)
        throw new Error(
          "Rootless Podman is unavailable or cannot create namespaces.",
        );
      const info = JSON.parse(infoResult.stdout) as {
        host?: { security?: { rootless?: boolean }; cgroupVersion?: string };
      };
      if (
        info.host?.security?.rootless !== true ||
        info.host?.cgroupVersion !== "v2"
      )
        throw new Error(
          "Rootless Podman with cgroup v2 is required for enforced memory and process limits.",
        );
      const image = await this.exec(
        this.engine,
        ["image", "inspect", this.image, "--format", "{{.Id}}"],
        { timeoutMs: 5000, maxBytes: 4096 },
      );
      // Podman 3.4 reports bare image IDs; later engines may prefix sha256.
      // Both forms must still contain the complete immutable 256-bit ID.
      if (
        image.code !== 0 ||
        !/^(?:sha256:)?[a-f0-9]{64}\s*$/.test(image.stdout)
      )
        throw new Error(
          `Build the pinned toolchain image ${this.image} before starting the worker.`,
        );
      const probeName = `c-forge-probe-${randomUUID()}`;
      const probe = await this.container(
        [...this.commonArgs(probeName), this.image, "/opt/c-forge/preflight"],
        "",
        10000,
      );
      if (
        probe.code !== 0 ||
        probe.stdout.trim() !== "c-forge-isolation-ok gcc-14.2.0"
      )
        throw new Error(
          "Isolation probe failed. Check cgroup delegation, seccomp, nonroot user, network and read-only filesystem.",
        );
      // Validate both ordinary and sanitizer toolchain invocation under actual resource limits.
      this.ready = true;
      for (const language of ["c", "cpp"] as const)
        for (const sanitize of [false, true]) {
          const result = await this.execute({
            language,
            files:
              language === "cpp"
                ? {
                    "main.cpp":
                      '#include <iostream>\nint main() { std::cout << "preflight-ok\\n"; }\n',
                  }
                : {
                    "main.c":
                      '#include <stdio.h>\nint main(void) { puts("preflight-ok"); return 0; }\n',
                  },
            stdin: "",
            sanitize,
          });
          if (
            result.state !== "succeeded" ||
            result.stdout !== "preflight-ok\n"
          )
            throw new Error(
              `${language === "cpp" ? "C++20" : "C17"}${sanitize ? " sanitizer" : ""} execution preflight failed.`,
            );
        }
      return {
        available: true,
        detail:
          "GCC 14.2.0 · C17 / C++20 · rootless Podman · cgroup v2 · isolated execution verified",
      };
    } catch (error) {
      this.ready = false;
      return {
        available: false,
        detail:
          error instanceof Error
            ? error.message
            : "Isolated compiler unavailable.",
      };
    }
  }

  async execute(
    request: RunnerRequest,
    hooks: RunnerHooks = {},
  ): Promise<RunnerOutcome> {
    validateRequest(request);
    if (!this.ready)
      return {
        state: "infrastructure_error",
        stdout: "",
        stderr: "",
        diagnostics: "",
        exitCode: null,
        elapsedMs: 0,
        truncated: false,
        feedback:
          "The isolated compiler is unavailable. Your draft is still saved; execution needs a configured rootless worker.",
      };
    const compiler = compilerFor(request.language);
    const harnessName = `__forge_harness${compiler.extension}`;
    const start = performance.now();
    const temporary = await mkdtemp(join(tmpdir(), "c-forge-runner-"));
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    hooks.signal?.addEventListener("abort", relayAbort, { once: true });
    if (hooks.signal?.aborted) controller.abort();
    const deadline = setTimeout(() => controller.abort(), LIMITS.jobMs);
    let diagnostics = "",
      last: ExecutionResult | undefined,
      passed = 0;
    const total = request.cases?.length ?? 0;
    try {
      await chmod(temporary, 0o700);
      const compiled = new Map<string, string>();
      const cases: (Case | undefined)[] = request.cases ?? [undefined];
      for (const [index, test] of cases.entries()) {
        if (controller.signal.aborted)
          return {
            state: hooks.signal?.aborted ? "cancelled" : "timed_out",
            stdout: "",
            stderr: "",
            diagnostics,
            exitCode: null,
            elapsedMs: Math.round(performance.now() - start),
            truncated: false,
            feedback: "Execution stopped before all checks completed.",
          };
        const harness = test?.harness ?? request.harness;
        const key = harness ?? "";
        let build = compiled.get(key);
        if (!build) {
          await hooks.state?.("compiling");
          const source = join(temporary, `source-${index}`);
          build = join(temporary, `build-${index}`);
          await mkdir(source, { mode: 0o700 });
          await mkdir(build, { mode: 0o700 });
          await this.writeFiles(source, request.files);
          if (harness)
            await writeFile(join(source, harnessName), harness, {
              flag: "wx",
              mode: 0o600,
            });
          const names = Object.keys(request.files)
            .filter((name) => name.endsWith(compiler.extension))
            .sort();
          if (harness) names.push(harnessName);
          const name = `c-forge-compile-${randomUUID()}`;
          const flags = request.sanitize
            ? [
                ...compiler.flags,
                "-fsanitize=address,undefined",
                "-fno-sanitize-recover=all",
              ]
            : compiler.flags;
          const compile = await this.container(
            [
              ...this.commonArgs(name, request.sanitize, true),
              "--volume",
              `${source}:/src:ro,Z`,
              "--volume",
              `${build}:/build:rw,Z`,
              this.image,
              compiler.command,
              ...flags,
              "-I/src",
              ...names.map((file) => `/src/${file}`),
              "-o",
              "/build/main",
              "-lm",
            ],
            "",
            LIMITS.compileMs,
            controller.signal,
          );
          diagnostics += compile.stderr + compile.stdout;
          const state = this.stateOf(compile);
          if (state !== "succeeded")
            return {
              state,
              stdout: "",
              stderr: "",
              diagnostics,
              exitCode: compile.code,
              elapsedMs: Math.round(performance.now() - start),
              truncated: compile.truncated,
              ...(compile.signal ? { signal: compile.signal } : {}),
              ...(total
                ? { passed: false, casesPassed: 0, casesTotal: total }
                : {}),
              feedback:
                state === "failed"
                  ? "Compilation stopped. Read the first diagnostic and check the marked source line."
                  : "Compilation did not finish within the runner limits.",
            };
          const executable = await lstat(join(build, "main"));
          if (
            !executable.isFile() ||
            executable.isSymbolicLink() ||
            executable.size > 8 * 1024 * 1024
          )
            throw new Error(
              "Compiler output is not a safe regular executable file.",
            );
          // Mount only the fixed executable, never compiler-created auxiliary files.
          compiled.set(key, build);
        }
        await hooks.state?.("running");
        const fixturePath = join(temporary, `fixtures-${index}`);
        await mkdir(fixturePath, { mode: 0o700 });
        await this.writeFiles(
          fixturePath,
          test?.fixtures ?? request.fixtures ?? {},
        );
        const name = `c-forge-execute-${randomUUID()}`;
        const run = await this.container(
          [
            ...this.commonArgs(name, request.sanitize),
            "--volume",
            `${join(build, "main")}:/program/main:ro,Z`,
            "--volume",
            `${fixturePath}:/fixtures:ro,Z`,
            "-i",
            this.image,
            "/opt/c-forge/run",
            ...(test?.args ?? request.args ?? []),
          ],
          test?.stdin ?? request.stdin,
          request.sanitize ? LIMITS.sanitizedRunMs : LIMITS.runMs,
          controller.signal,
        );
        const state = this.stateOf(run);
        const result: ExecutionResult = {
          state,
          stdout: run.stdout,
          stderr: run.stderr,
          diagnostics,
          exitCode: run.code,
          elapsedMs: Math.round(performance.now() - start),
          truncated: run.truncated,
          ...(run.signal ? { signal: run.signal } : {}),
        };
        last ??= result;
        if (state !== "succeeded")
          return {
            ...result,
            ...(total
              ? { passed: false, casesPassed: passed, casesTotal: total }
              : {}),
            feedback: run.truncated
              ? "Output reached the 64 KiB limit. The worker stopped the program and kept the beginning of its output."
              : state === "timed_out"
                ? "The program exceeded its execution budget. Check loop termination and input handling."
                : state === "infrastructure_error"
                  ? "The container could not run. This is a runner problem; your draft is preserved."
                  : state === "cancelled"
                    ? "Execution cancelled. Your draft is preserved."
                    : "The program exited unsuccessfully. Inspect stderr, its exit code, and diagnostics mode.",
          };
        if (test) {
          if (!matchesOutput(run.stdout, test))
            return {
              ...result,
              passed: false,
              casesPassed: passed,
              casesTotal: total,
              feedback: `Behavior check ${index + 1} did not match the contract. Review normal and boundary cases; the expected private test data is kept on the server.`,
            };
          passed++;
        }
      }
      return {
        ...last!,
        diagnostics,
        elapsedMs: Math.round(performance.now() - start),
        ...(total
          ? {
              passed: true,
              casesPassed: passed,
              casesTotal: total,
              feedback: `${passed} behavior checks passed. Passing tests does not prove correctness for every input.`,
            }
          : {
              feedback:
                "Program completed. Run does not assess exercise proficiency.",
            }),
      };
    } catch (error) {
      this.ready = false;
      return {
        state: "infrastructure_error",
        stdout: "",
        stderr: "",
        diagnostics,
        exitCode: null,
        elapsedMs: Math.round(performance.now() - start),
        truncated: false,
        feedback:
          error instanceof Error
            ? error.message
            : "Runner infrastructure failed.",
      };
    } finally {
      clearTimeout(deadline);
      hooks.signal?.removeEventListener("abort", relayAbort);
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async writeFiles(path: string, files: SourceFiles): Promise<void> {
    for (const [name, text] of Object.entries(files))
      await writeFile(join(path, name), text, { flag: "wx", mode: 0o600 });
  }
  private stateOf(result: ProcessResult): ExecutionResult["state"] {
    if (result.cancelled) return "cancelled";
    if (result.timedOut) return "timed_out";
    if (result.infrastructureError === true) return "infrastructure_error";
    return result.code === 0 && !result.truncated ? "succeeded" : "failed";
  }
}
