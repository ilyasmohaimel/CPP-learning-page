/** Offline authoring utility. It never reads learner drafts or runs in the API. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Case, Curriculum, SourceFiles } from "../shared/content.js";
import type { RunnerOutcome, RunnerRequest } from "../shared/runner.js";
import { compilerFor, PodmanRunner } from "../runner/podman.js";
import { executeProcess } from "../runner/process.js";
import { LIMITS, matchesOutput, validateFiles } from "../runner/validation.js";

const cppCourse = process.argv.includes("--course=cpp20");
const compiler = compilerFor(cppCourse ? "cpp" : "c");
const harnessName = `__forge_harness${compiler.extension}`;
const syntaxOnly = process.argv.includes("--syntax-only");
const trustedAuthoring = process.argv.includes("--trusted-authoring");
if (
  process.argv
    .slice(2)
    .some(
      (arg) =>
        !["--syntax-only", "--trusted-authoring", "--course=cpp20"].includes(
          arg,
        ),
    )
)
  throw new Error(
    "Supported options: --syntax-only or --trusted-authoring. Content source is fixed to the version-controlled curriculum.",
  );
if (syntaxOnly && trustedAuthoring)
  throw new Error("Choose one verification mode.");
const curriculum = JSON.parse(
  await readFile(
    new URL(
      cppCourse
        ? "../content/cpp-curriculum.json"
        : "../content/curriculum.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Curriculum;
let syntaxChecks = 0,
  textChecks = 0,
  failures = 0,
  runtimeChecks = 0,
  deliberatelyBroken = 0;
const pending: { label: string; request: RunnerRequest }[] = [];
const root = await mkdtemp(join(tmpdir(), "c-forge-content-"));
const cleanEnv: NodeJS.ProcessEnv = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  HOME: root,
};

async function stage(files: SourceFiles, path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  for (const [name, code] of Object.entries(files))
    await writeFile(join(path, name), code, { mode: 0o600, flag: "wx" });
}
async function syntax(label: string, files: SourceFiles, harness?: string) {
  validateFiles(files, false, cppCourse ? "cpp" : "c");
  const path = join(root, `syntax-${syntaxChecks++}`);
  await stage(files, path);
  if (harness)
    await writeFile(join(path, harnessName), harness, { mode: 0o600 });
  const names = Object.keys(files)
    .filter((name) => name.endsWith(compiler.extension))
    .map((name) => join(path, name));
  if (harness) names.push(join(path, harnessName));
  const result = await executeProcess(
    compiler.command,
    [...compiler.flags, "-fsyntax-only", `-I${path}`, ...names],
    { timeoutMs: 15000, maxBytes: 65536, env: cleanEnv },
  );
  if (result.code !== 0 || result.timedOut || result.truncated) {
    failures++;
    console.error(`${label}: syntax failed\n${result.stderr}`);
  } else if (result.stderr.trim())
    console.log(
      `${label}: compiler warnings retained\n${result.stderr.trim()}`,
    );
}
async function add(label: string, request: RunnerRequest) {
  const harnesses = new Set(
    request.cases?.map((c) => c.harness ?? "") ?? [request.harness ?? ""],
  );
  for (const harness of harnesses)
    await syntax(label, request.files, harness || undefined);
  pending.push({
    label,
    request: { ...request, language: cppCourse ? "cpp" : "c" },
  });
}

/** Explicitly trusted, finite authored content only; NOT a sandbox or app runner. */
async function executeTrusted(request: RunnerRequest): Promise<RunnerOutcome> {
  const path = join(root, `trusted-${runtimeChecks}`);
  await mkdir(path, { mode: 0o700 });
  const cache = new Map<string, string>();
  let elapsed = 0,
    diagnostics = "",
    firstStdout = "",
    passed = 0;
  const cases: (Case | undefined)[] = request.cases ?? [undefined];
  for (const [index, c] of cases.entries()) {
    const harness = c?.harness ?? request.harness ?? "";
    let executable = cache.get(harness);
    if (!executable) {
      const source = join(path, `source-${index}`);
      await stage(request.files, source);
      if (harness)
        await writeFile(join(source, harnessName), harness, {
          mode: 0o600,
        });
      executable = join(source, "trusted-reference");
      const names = Object.keys(request.files)
        .filter((name) => name.endsWith(compiler.extension))
        .map((name) => join(source, name));
      if (harness) names.push(join(source, harnessName));
      const built = await executeProcess(
        compiler.command,
        [...compiler.flags, `-I${source}`, ...names, "-o", executable, "-lm"],
        { timeoutMs: 15000, maxBytes: 65536, env: cleanEnv },
      );
      elapsed += built.elapsedMs;
      diagnostics += built.stderr;
      if (built.code !== 0 || built.timedOut)
        return {
          state: "failed",
          stdout: "",
          stderr: "",
          diagnostics,
          exitCode: built.code,
          elapsedMs: elapsed,
          truncated: built.truncated,
          passed: false,
          feedback: "Authored solution failed to link.",
        };
      cache.set(harness, executable);
    }
    const cwd = join(path, `case-${index}`);
    await stage(c?.fixtures ?? request.fixtures ?? {}, cwd);
    // Ordinary authored examples only. Invalid, flooding, sanitizer and hostile
    // programs remain exclusively in the isolated integration test suite.
    const executed = await executeProcess(
      "prlimit",
      [
        "--cpu=3:4",
        "--as=536870912:536870912",
        "--fsize=8388608:8388608",
        "--nofile=64:64",
        "--",
        executable,
        ...(c?.args ?? request.args ?? []),
      ],
      {
        cwd,
        env: cleanEnv,
        input: c?.stdin ?? request.stdin,
        timeoutMs: LIMITS.runMs,
        maxBytes: LIMITS.outputBytes,
      },
    );
    elapsed += executed.elapsedMs;
    if (index === 0) firstStdout = executed.stdout;
    if (executed.code !== 0 || executed.timedOut || executed.truncated)
      return {
        state: executed.timedOut ? "timed_out" : "failed",
        stdout: executed.stdout,
        stderr: executed.stderr,
        diagnostics,
        exitCode: executed.code,
        elapsedMs: elapsed,
        truncated: executed.truncated,
        passed: false,
        feedback: "Authored example did not finish successfully.",
      };
    if (c && !matchesOutput(executed.stdout, c))
      return {
        state: "succeeded",
        stdout: executed.stdout,
        stderr: executed.stderr,
        diagnostics,
        exitCode: 0,
        elapsedMs: elapsed,
        truncated: false,
        passed: false,
        casesPassed: passed,
        casesTotal: cases.length,
        feedback: `Authored contract mismatch in case ${index + 1}.`,
      };
    if (c) passed++;
  }
  return {
    state: "succeeded",
    stdout: firstStdout,
    stderr: "",
    diagnostics,
    exitCode: 0,
    elapsedMs: elapsed,
    truncated: false,
    ...(request.cases
      ? { passed: true, casesPassed: passed, casesTotal: cases.length }
      : {}),
  };
}

try {
  for (const lesson of curriculum.lessons) {
    if (lesson.brokenExample) {
      deliberatelyBroken++;
      console.log(
        `${lesson.id}: deliberately broken teaching example; automatic ordinary execution excluded.`,
      );
      continue;
    }
    const meta = lesson as typeof lesson & {
      workedExampleInput?: {
        stdin: string;
        fixtures?: SourceFiles;
        args?: string[];
      };
    };
    await add(`lesson:${lesson.id}`, {
      files: lesson.workedExample,
      stdin: meta.workedExampleInput?.stdin ?? "",
      sanitize: false,
      fixtures: meta.workedExampleInput?.fixtures,
      args: meta.workedExampleInput?.args,
    });
  }
  for (const exercise of curriculum.exercises) {
    if (["prediction", "diagnosis", "reflection"].includes(exercise.type)) {
      const answer = Object.values(exercise.solution).join("\n").trim();
      if (
        !answer ||
        !exercise.tests.every((c) => c.expected.trim() === answer)
      ) {
        failures++;
        console.error(`${exercise.id}: textual reference/contract mismatch.`);
      }
      textChecks++;
      continue;
    }
    await add(`solution:${exercise.id}`, {
      files: exercise.solution,
      stdin: "",
      sanitize: false,
      cases: exercise.tests,
    });
  }
  for (const project of curriculum.projects) {
    const finalMilestone = project.milestones.at(-1),
      finalExercise = curriculum.exercises.find(
        (e) => e.id === finalMilestone?.exerciseId,
      );
    const meta = project as typeof project & {
      checks?: Case[];
      referenceInput?: {
        stdin: string;
        fixtures?: SourceFiles;
        args?: string[];
      };
    };
    const sameFiles =
      finalExercise &&
      ["stdout", "numeric"].includes(finalExercise.type) &&
      JSON.stringify(finalExercise.solution) ===
        JSON.stringify(project.reference);
    await add(`project:${project.id}`, {
      files: project.reference,
      stdin: meta.referenceInput?.stdin ?? "",
      sanitize: false,
      fixtures: meta.referenceInput?.fixtures,
      args: meta.referenceInput?.args,
      cases: meta.checks ?? (sameFiles ? finalExercise.tests : undefined),
    });
  }
  console.log(
    `Trusted ${curriculum.course.standard} syntax: ${syntaxChecks} checks; textual contracts: ${textChecks}; failures: ${failures}; deliberately broken examples excluded: ${deliberatelyBroken}. No learner code was read.`,
  );
  if (syntaxOnly) {
    console.log(
      "SYNTAX ONLY: linking, behavior, grading, isolation and sanitizer execution remain unverified.",
    );
    process.exitCode = failures ? 1 : 0;
  } else {
    let execute: (request: RunnerRequest) => Promise<RunnerOutcome>;
    if (trustedAuthoring) {
      console.log(
        "TRUSTED AUTHORING MODE: host execution of finite version-controlled examples/reference solutions only. This does NOT verify sandbox isolation or application execution.",
      );
      execute = executeTrusted;
    } else {
      const runner = new PodmanRunner({ image: process.env.RUNNER_IMAGE });
      const preflight = await runner.preflight();
      if (!preflight.available) {
        console.error(`BLOCKED: isolated execution gate: ${preflight.detail}`);
        process.exitCode = failures ? 1 : 2;
        execute = async () => {
          throw new Error("unavailable");
        };
      } else execute = (request) => runner.execute(request);
    }
    if (process.exitCode !== 2 && process.exitCode !== 1) {
      for (const item of pending) {
        runtimeChecks++;
        const result = await execute(item.request);
        if (
          result.state !== "succeeded" ||
          (item.request.cases && result.passed !== true)
        ) {
          failures++;
          console.error(
            `${item.label}: ${result.feedback ?? result.state}\n${result.diagnostics}\n${result.stderr}\nActual output: ${JSON.stringify(result.stdout)}`,
          );
        }
      }
      console.log(
        `${trustedAuthoring ? "Trusted authored" : "Isolated"} execution: ${runtimeChecks} programs/contracts; failures: ${failures}.`,
      );
      process.exitCode = failures ? 1 : 0;
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
