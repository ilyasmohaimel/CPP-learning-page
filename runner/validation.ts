import type { Case, SourceFiles } from "../shared/content.js";
import type { RunnerRequest } from "../shared/runner.js";

export const LIMITS = Object.freeze({
  files: 12,
  sourceBytes: 128 * 1024,
  stdinBytes: 8192,
  fixtureBytes: 64 * 1024,
  cases: 12,
  outputBytes: 65536,
  compileMs: 15000,
  runMs: 2500,
  sanitizedRunMs: 4000,
  jobMs: 100000,
});
const sourceName = /^(?:[A-Za-z][A-Za-z0-9_-]{0,63}\.(?:c|h|txt)|Makefile)$/;
const fixtureName = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export function validateFiles(
  files: unknown,
  fixtures = false,
): asserts files is SourceFiles {
  if (!files || typeof files !== "object" || Array.isArray(files))
    throw new Error("Files must be an object.");
  const entries = Object.entries(files);
  if ((!fixtures && entries.length === 0) || entries.length > LIMITS.files)
    throw new Error(`Provide 1–${LIMITS.files} files.`);
  let bytes = 0;
  for (const [name, value] of entries) {
    if (
      !(fixtures ? fixtureName : sourceName).test(name) ||
      name.startsWith("__forge") ||
      name.includes("..")
    )
      throw new Error(
        `Invalid filename: ${name}. Use a short relative filename without directories.`,
      );
    if (typeof value !== "string" || value.includes("\0"))
      throw new Error(`Invalid text in ${name}.`);
    bytes += Buffer.byteLength(value);
  }
  if (bytes > (fixtures ? LIMITS.fixtureBytes : LIMITS.sourceBytes))
    throw new Error("Files exceed the size limit.");
  if (!fixtures && !entries.some(([name]) => name.endsWith(".c")))
    throw new Error("Include at least one .c source file.");
}

export function validateCase(value: unknown): asserts value is Case {
  if (!value || typeof value !== "object")
    throw new Error("Invalid grading case.");
  const c = value as Partial<Case>;
  if (
    typeof c.stdin !== "string" ||
    Buffer.byteLength(c.stdin) > LIMITS.stdinBytes ||
    typeof c.expected !== "string" ||
    Buffer.byteLength(c.expected) > LIMITS.outputBytes ||
    typeof c.label !== "string" ||
    c.label.length > 200
  )
    throw new Error("Invalid grading input or expected output.");
  if (
    c.tolerance !== undefined &&
    (!Number.isFinite(c.tolerance) || c.tolerance < 0 || c.tolerance > 1)
  )
    throw new Error("Invalid numeric tolerance.");
  if (
    c.harness !== undefined &&
    (typeof c.harness !== "string" ||
      Buffer.byteLength(c.harness) > LIMITS.sourceBytes ||
      c.harness.includes("\0"))
  )
    throw new Error("Invalid function harness.");
  if (c.fixtures !== undefined) validateFiles(c.fixtures, true);
  if (
    c.args !== undefined &&
    (!Array.isArray(c.args) ||
      c.args.length > 12 ||
      c.args.some(
        (a) => typeof a !== "string" || a.length > 256 || a.includes("\0"),
      ))
  )
    throw new Error("Invalid program arguments.");
}

export function validateRequest(
  value: unknown,
): asserts value is RunnerRequest {
  if (!value || typeof value !== "object")
    throw new Error("Invalid runner request.");
  const r = value as Partial<RunnerRequest>;
  validateFiles(r.files);
  if (
    typeof r.stdin !== "string" ||
    Buffer.byteLength(r.stdin) > LIMITS.stdinBytes
  )
    throw new Error("Standard input exceeds 8 KiB.");
  if (typeof r.sanitize !== "boolean")
    throw new Error("Invalid diagnostics setting.");
  validateCase({
    stdin: r.stdin,
    expected: "",
    label: "Public Run scaffolding",
    harness: r.harness,
    fixtures: r.fixtures,
    args: r.args,
  });
  if (r.cases !== undefined) {
    if (
      !Array.isArray(r.cases) ||
      r.cases.length < 1 ||
      r.cases.length > LIMITS.cases
    )
      throw new Error("Invalid number of grading cases.");
    r.cases.forEach(validateCase);
  }
}

/** Normalize CRLF and final newline only. Spaces and internal blank lines remain meaningful. */
export function normalizeOutput(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

export function matchesOutput(actual: string, test: Case): boolean {
  if (test.tolerance === undefined)
    return normalizeOutput(actual) === normalizeOutput(test.expected);
  const a = actual.trim().split(/\s+/),
    e = test.expected.trim().split(/\s+/);
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  return (
    a.length === e.length &&
    a.every(
      (token, index) =>
        numeric.test(token) &&
        numeric.test(e[index]) &&
        Number.isFinite(Number(token)) &&
        Number.isFinite(Number(e[index])) &&
        Math.abs(Number(token) - Number(e[index])) <= test.tolerance!,
    )
  );
}
