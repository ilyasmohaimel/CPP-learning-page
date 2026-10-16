import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Curriculum } from "../shared/content.js";
import { validateFiles } from "../runner/validation.js";

const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const words = z.string().min(8);
const filenames = z
  .string()
  .regex(/^(?:[A-Za-z][A-Za-z0-9_-]*\.(?:c|h|cpp|hpp|txt)|Makefile)$/);
const files = z
  .record(filenames, z.string().max(128 * 1024))
  .refine(
    (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 16,
    "one to sixteen files required",
  );
const sample = z.object({
  stdin: z.string().max(8192),
  expected: z.string(),
  label: z.string().min(1),
  tolerance: z.number().nonnegative().optional(),
  harness: z.string().optional(),
  fixtures: z.record(filenames, z.string()).optional(),
  args: z.array(z.string().max(256)).max(12).optional(),
});
const input = z.object({
  stdin: z.string().max(8192),
  fixtures: z.record(filenames, z.string()).optional(),
  args: z.array(z.string()).optional(),
});
const prediction = z.object({
  question: words,
  answer: z.string().min(1),
  explanation: words,
});
const lesson = z.object({
  id,
  version: z.number().int().positive(),
  moduleId: id,
  title: words,
  objective: words,
  prerequisites: z.array(id),
  minutes: z.number().min(5).max(12),
  concepts: z.array(words.or(z.string().min(1))).min(1),
  explanation: z.array(words).min(2),
  workedExample: files,
  workedExampleInput: input.optional(),
  walkthrough: z.array(words).min(2),
  prediction,
  recap: words,
  retrieval: z.object({ question: words, answer: z.string().min(1) }),
  exerciseIds: z.array(id).min(2),
  visualization: z.enum(["loop", "array", "pointer", "function"]).optional(),
  checkpoint: z.boolean().optional(),
  brokenExample: z.boolean().optional(),
});
const exercise = z.object({
  language: z.enum(["c", "cpp"]).optional(),
  id,
  version: z.number().int().positive(),
  lessonId: id,
  prerequisites: z.array(id),
  objective: words,
  type: z.enum([
    "stdout",
    "numeric",
    "function",
    "prediction",
    "diagnosis",
    "reflection",
  ]),
  prompt: words,
  starter: files,
  allowedInputs: words,
  examples: z.array(sample).min(1),
  tests: z.array(sample).min(1).max(12),
  hints: z.tuple([words, words, words]),
  solution: files,
  explanation: words,
  concepts: z.array(z.string().min(1)).min(1),
  prediction: prediction.optional(),
});
const project = z.object({
  id,
  title: words,
  brief: words,
  prerequisites: z.array(id).min(1),
  starter: files,
  milestones: z
    .array(
      z.object({
        id,
        title: words,
        requirements: z.array(words).min(1),
        exerciseId: id,
      }),
    )
    .min(3),
  rubric: z.array(words).min(3),
  reference: files,
  explanation: z.array(words).min(2),
  checks: z.array(sample).optional(),
  referenceInput: input.optional(),
});
const schema = (standard: "C17" | "C++20") =>
  z.object({
    version: z.number().int().positive(),
    course: z.object({ id, title: words, standard: z.literal(standard) }),
    modules: z
      .array(
        z.object({
          id,
          title: words,
          objective: words,
          prerequisites: z.array(id),
          lessonIds: z.array(id).min(1),
        }),
      )
      .length(12),
    lessons: z.array(lesson).min(40),
    exercises: z.array(exercise).min(80),
    projects: z.array(project).min(3),
    references: z
      .array(
        z.object({
          id,
          title: words,
          body: words,
          example: z.string().min(1),
          lessonId: id,
          tags: z.array(z.string().min(1)).min(1),
        }),
      )
      .min(20),
  });
for (const source of ["curriculum", "cpp-curriculum"]) {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../content/${source}.json`, import.meta.url), "utf8"),
  );
  const parsed = schema(source === "curriculum" ? "C17" : "C++20").safeParse(
    raw,
  );
  if (!parsed.success) {
    console.error("Curriculum schema validation failed:", parsed.error.issues);
    process.exit(1);
  }
  const content = parsed.data as Curriculum;
  const errors: string[] = [];
  const assert = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
  };
  const unique = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const value of ids) {
      assert(!seen.has(value), `Duplicate ${kind} ID: ${value}`);
      seen.add(value);
    }
  };
  unique(
    "module",
    content.modules.map((m) => m.id),
  );
  unique(
    "lesson",
    content.lessons.map((l) => l.id),
  );
  unique(
    "exercise",
    content.exercises.map((e) => e.id),
  );
  unique(
    "project",
    content.projects.map((p) => p.id),
  );
  unique(
    "reference",
    content.references.map((r) => r.id),
  );
  const modules = new Map(content.modules.map((m) => [m.id, m]));
  const lessons = new Map(content.lessons.map((l) => [l.id, l]));
  const exercises = new Map(content.exercises.map((e) => [e.id, e]));
  const position = new Map(content.lessons.map((l, i) => [l.id, i]));
  const detectCycles = (
    kind: string,
    nodes: Map<string, { prerequisites: string[] }>,
  ) => {
    const visited = new Set<string>(),
      active = new Set<string>();
    const visit = (key: string) => {
      if (active.has(key)) {
        errors.push(`${kind} prerequisite cycle at ${key}`);
        return;
      }
      if (visited.has(key)) return;
      const node = nodes.get(key);
      if (!node) {
        errors.push(`Missing ${kind} prerequisite: ${key}`);
        return;
      }
      active.add(key);
      for (const prerequisite of node.prerequisites) visit(prerequisite);
      active.delete(key);
      visited.add(key);
    };
    for (const key of nodes.keys()) visit(key);
  };
  detectCycles("module", modules);
  detectCycles("lesson", lessons);
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        source === "curriculum"
          ? "../content/manifest.json"
          : "../content/cpp-manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { modules: { id: string; lessons: string[] }[] };
  for (const [index, m] of content.modules.entries()) {
    const planned = manifest.modules[index];
    assert(m.id === planned?.id, `Module order differs from manifest: ${m.id}`);
    assert(
      JSON.stringify(m.lessonIds) === JSON.stringify(planned?.lessons),
      `Stable lesson IDs differ from manifest: ${m.id}`,
    );
    assert(
      m.lessonIds.every((lid) => lessons.get(lid)?.moduleId === m.id),
      `Invalid lesson membership in ${m.id}`,
    );
    for (const prerequisite of m.prerequisites)
      assert(
        content.modules.findIndex((other) => other.id === prerequisite) < index,
        `Module prerequisite not earlier: ${m.id} -> ${prerequisite}`,
      );
    assert(
      m.lessonIds.some((lid) => lessons.get(lid)?.checkpoint),
      `Missing checkpoint: ${m.id}`,
    );
  }
  const objectives = new Set<string>();
  for (const l of content.lessons) {
    assert(modules.has(l.moduleId), `Missing module for ${l.id}`);
    assert(!objectives.has(l.objective), `Duplicate lesson objective: ${l.id}`);
    objectives.add(l.objective);
    for (const prerequisite of l.prerequisites)
      assert(
        (position.get(prerequisite) ?? Infinity) < (position.get(l.id) ?? -1),
        `Lesson prerequisite must already be introduced: ${l.id} -> ${prerequisite}`,
      );
    for (const eid of l.exerciseIds)
      assert(
        exercises.get(eid)?.lessonId === l.id,
        `Missing/mismatched exercise ${eid} in ${l.id}`,
      );
    assert(
      new Set(l.exerciseIds).size === l.exerciseIds.length,
      `Repeated exercise in ${l.id}`,
    );
  }
  const unsafeCode = [
    /\bvoid\s+main\s*\(/,
    /\bgets\s*\(/,
    /\bfflush\s*\(\s*stdin\s*\)/,
    /\bscanf\s*\(\s*"%s"/,
    /\bstd::/,
    /\b(?:cout|cin)\s*<</,
  ];
  const checkCode = (owner: string, source: Record<string, string>) => {
    for (const [name, code] of Object.entries(source)) {
      assert(!code.includes("\u0000"), `NUL byte in ${owner}/${name}`);
      if (name.endsWith(".c") || name.endsWith(".h"))
        for (const pattern of unsafeCode)
          assert(
            !pattern.test(code),
            `Banned unsafe/non-C pattern in ${owner}/${name}: ${pattern.source}`,
          );
    }
  };
  for (const l of content.lessons) checkCode(`lesson:${l.id}`, l.workedExample);
  for (const e of content.exercises) {
    const language = content.course.standard === "C++20" ? "cpp" : "c";
    assert(
      (e.language ?? "c") === language,
      `Exercise language differs from course: ${e.id}`,
    );
    if (["stdout", "numeric", "function"].includes(e.type)) {
      for (const files of [e.starter, e.solution]) {
        try {
          validateFiles(files, false, language);
        } catch (error) {
          errors.push(`${e.id}: ${(error as Error).message}`);
        }
      }
    }
    assert(lessons.has(e.lessonId), `Missing lesson for ${e.id}`);
    assert(
      new Set(e.hints).size === 3,
      `Hints must be distinct stages: ${e.id}`,
    );
    for (const prerequisite of e.prerequisites)
      assert(
        lessons.has(prerequisite),
        `Missing exercise prerequisite: ${e.id} -> ${prerequisite}`,
      );
    if (e.type === "function")
      assert(
        e.tests.every((t) => t.harness && /\bmain\s*\(/.test(t.harness)),
        `Function contract lacks a runnable harness: ${e.id}`,
      );
    if (["prediction", "diagnosis", "reflection"].includes(e.type))
      assert(
        e.tests.every(
          (t) =>
            Object.values(e.solution).join("\n").trim() === t.expected.trim(),
        ),
        `Conceptual solution/contract differs: ${e.id}`,
      );
    assert(
      e.tests.every((t) => t.label.trim().length > 0),
      `Missing case label: ${e.id}`,
    );
    assert(
      new Set(e.tests.map((t) => JSON.stringify(t))).size === e.tests.length,
      `Duplicate grading case: ${e.id}`,
    );
    checkCode(`solution:${e.id}`, e.solution);
    for (const test of e.tests)
      if (test.harness)
        checkCode(`harness:${e.id}`, { "main.c": test.harness });
  }
  for (const p of content.projects) {
    unique(
      `milestone in ${p.id}`,
      p.milestones.map((m) => m.id),
    );
    for (const prerequisite of p.prerequisites)
      assert(
        lessons.has(prerequisite),
        `Missing project prerequisite: ${p.id} -> ${prerequisite}`,
      );
    for (const milestone of p.milestones)
      assert(
        exercises.has(milestone.exerciseId),
        `Missing assessed milestone ${p.id}/${milestone.id}`,
      );
    checkCode(`project:${p.id}`, p.reference);
  }
  for (const r of content.references)
    assert(lessons.has(r.lessonId), `Missing reference lesson: ${r.id}`);
  for (const visualization of (source === "curriculum"
    ? ["loop", "array", "pointer", "function"]
    : []) as ("loop" | "array" | "pointer" | "function")[])
    assert(
      content.lessons.some((l) => l.visualization === visualization),
      `Missing visualization lesson: ${visualization}`,
    );
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  const cExercises = content.exercises.filter((e) =>
    ["stdout", "numeric", "function"].includes(e.type),
  );
  console.log(
    `PASS ${content.course.standard}: ${content.modules.length} ordered modules; ${content.lessons.length} substantive lessons; ${content.exercises.length} exercises (${cExercises.length} compiler-backed, ${content.exercises.length - cExercises.length} explicit conceptual); ${content.lessons.filter((l) => l.checkpoint).length} checkpoints; ${content.projects.length} guided projects; ${content.references.length} references.`,
  );
  console.log(
    "Validated schema, stable manifest IDs, membership, prerequisite order/DAG, staged hints, behavioral harnesses, project assessment references, and prohibited source patterns. This structural audit does not prove pedagogy or runtime correctness.",
  );
}
