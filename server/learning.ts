import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  LearnerState,
  Progress,
  Activity,
  ReviewItem,
} from "../shared/app.js";
import { requireOwner, now, type Context } from "./context.js";
import { publicExercise, publicLesson } from "./content.js";
import { parse, preferences } from "./validation.js";
import { readDraft, history } from "./drafts.js";
import type { SourceFiles } from "../shared/content.js";
import type { RunnerOutcome } from "../shared/runner.js";
export const intervals = [1, 3, 7, 14, 30];
export const normalizeAnswer = (s: string) =>
  s.trim().replace(/\s+/g, " ").toLowerCase();
export function recordAttempt(
  ctx: Context,
  owner: string,
  exerciseId: string,
  mode: string,
  source: unknown,
  result: RunnerOutcome,
  id: string = randomUUID(),
  contentVersion?: number,
) {
  const e = ctx.exercise(exerciseId);
  const help = !!ctx.store.get(
    "SELECT level FROM hints WHERE owner_id=? AND exercise_id=? LIMIT 1",
    owner,
    e.id,
  );
  ctx.store.run(
    "INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?,?)",
    id,
    owner,
    e.id,
    contentVersion ?? e.version,
    mode,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(source as Record<string, unknown>).filter(([k]) =>
          ["files", "stdin", "answer", "sanitize"].includes(k),
        ),
      ),
    ),
    JSON.stringify(result),
    help ? 1 : 0,
    now(),
  );
  if (mode === "check" && typeof result.passed === "boolean") {
    const old = ctx.store.get<{
      completed: number;
      proficient: number;
      review_stage: number;
    }>(
      "SELECT * FROM progress WHERE owner_id=? AND exercise_id=?",
      owner,
      e.id,
    );
    const passed = result.passed;
    ctx.store.run(
      "INSERT INTO progress VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,exercise_id) DO UPDATE SET completed=excluded.completed,proficient=excluded.proficient,help_used=excluded.help_used,due_at=excluded.due_at,last_result=excluded.last_result",
      owner,
      e.id,
      e.lessonId,
      passed ? 1 : (old?.completed ?? 0),
      passed && !help ? 1 : (old?.proficient ?? 0),
      help ? 1 : 0,
      old?.review_stage ?? 0,
      new Date(Date.now() + (passed && !help ? 86400000 : 0)).toISOString(),
      passed
        ? help
          ? "Passed with help — revisit independently."
          : "Passed independently."
        : "A check needs another attempt.",
    );
    if (passed) {
      const d = readDraft(ctx, owner, e.id);
      const submitted = source as {
        files?: SourceFiles;
        stdin?: string;
        sanitize?: boolean;
      };
      if (submitted.files) {
        const activeFile =
          d && Object.hasOwn(submitted.files, d.data.activeFile)
            ? d.data.activeFile
            : Object.keys(submitted.files)[0];
        history(
          ctx,
          owner,
          {
            exerciseId: e.id,
            revision: d?.revision ?? 0,
            contentVersion: contentVersion ?? e.version,
            updatedAt: now(),
            data: {
              ...(d?.data ?? {
                files: submitted.files,
                stdin: "",
                activeFile,
                step: 2,
                cursor: { anchor: 0, head: 0 },
                scrollAnchor: 0,
                paneSize: 46,
                notes: "",
                bookmark: false,
              }),
              files: submitted.files,
              stdin: submitted.stdin ?? d?.data.stdin ?? "",
              activeFile,
              cursor: { anchor: 0, head: 0 },
            },
          },
          "last successful check",
        );
      }
    }
  }
}
export function learnerState(ctx: Context, owner: string): LearnerState {
  const row = ctx.store.get<{
    preferences: string;
    preferences_revision: number;
    resume: string | null;
    enrolled: number;
  }>("SELECT * FROM learner WHERE owner_id=?", owner)!;
  const progress = ctx.store
    .all<{
      exercise_id: string;
      lesson_id: string;
      completed: number;
      proficient: number;
      help_used: number;
      review_stage: number;
      due_at: string;
      last_result: string;
    }>("SELECT * FROM progress WHERE owner_id=?", owner)
    .map(
      (p) =>
        ({
          exerciseId: p.exercise_id,
          lessonId: p.lesson_id,
          completed: !!p.completed,
          proficient: !!p.proficient,
          helpUsed: !!p.help_used,
          reviewStage: p.review_stage,
          dueAt: p.due_at,
          lastResult: p.last_result,
        }) satisfies Progress,
    );
  const activity = ctx.store
    .all<{
      id: string;
      exercise_id: string;
      mode: string;
      outcome: string;
      created_at: string;
    }>(
      "SELECT id,exercise_id,mode,outcome,created_at FROM attempts WHERE owner_id=? ORDER BY created_at DESC LIMIT 10",
      owner,
    )
    .map((a) => {
      const o = JSON.parse(a.outcome) as RunnerOutcome;
      return {
        id: a.id,
        exerciseId: a.exercise_id,
        mode: a.mode,
        state: o.state,
        passed: o.passed ?? null,
        createdAt: a.created_at,
      } satisfies Activity;
    });
  const reviews: ReviewItem[] = progress.map((p) => {
    const l = ctx.lesson(p.lessonId);
    return {
      exerciseId: p.exerciseId,
      lessonId: l.id,
      title: l.title,
      question: l.retrieval.question,
      dueAt: p.dueAt,
      stage: p.reviewStage,
      reason: p.helpUsed
        ? "You used a hint or solution. Retrieve the idea without it."
        : p.lastResult.startsWith("A check")
          ? "A previous check exposed a gap. Revisit the concept."
          : "Spaced retrieval after your earlier practice.",
    };
  });
  return {
    preferences: JSON.parse(row.preferences),
    preferencesRevision: row.preferences_revision,
    resume: row.resume ? JSON.parse(row.resume) : null,
    enrolled: !!row.enrolled,
    progress,
    activity,
    reviews,
  };
}
export function learningRoutes(ctx: Context) {
  const { app, store, content } = ctx;
  app.get("/api/course", async (req) => {
    requireOwner(req);
    return {
      course: content.course,
      modules: content.modules,
      lessons: content.lessons.map((l) => ({
        id: l.id,
        moduleId: l.moduleId,
        title: l.title,
        objective: l.objective,
        prerequisites: l.prerequisites,
        minutes: l.minutes,
        exerciseIds: l.exerciseIds,
        checkpoint: l.checkpoint,
      })),
      projects: content.projects.map(({ id, title, brief, prerequisites }) => ({
        id,
        title,
        brief,
        prerequisites,
      })),
    };
  });
  app.get("/api/state", async (req) => learnerState(ctx, requireOwner(req)));
  app.get<{ Params: { id: string } }>("/api/lessons/:id", async (req) => {
    requireOwner(req);
    const lesson = ctx.lesson(req.params.id);
    return {
      lesson: publicLesson(lesson),
      exercises: lesson.exerciseIds.map((id) =>
        publicExercise(ctx.exercise(id)),
      ),
    };
  });
  app.post<{ Params: { id: string } }>(
    "/api/lessons/:id/predict",
    async (req) => {
      requireOwner(req);
      const lesson = ctx.lesson(req.params.id),
        b = parse(
          z.object({ answer: z.string().max(2000) }).strict(),
          req.body,
        );
      return {
        correct:
          normalizeAnswer(b.answer) ===
          normalizeAnswer(lesson.prediction.answer),
        answer: lesson.prediction.answer,
        explanation: lesson.prediction.explanation,
      };
    },
  );
  app.post("/api/preferences", async (req, reply) => {
    const owner = requireOwner(req),
      body = parse(
        z.object({ revision: z.number().int().min(0), preferences }).strict(),
        req.body,
      );
    const r = store.run(
      "UPDATE learner SET preferences=?,preferences_revision=preferences_revision+1 WHERE owner_id=? AND preferences_revision=?",
      JSON.stringify(body.preferences),
      owner,
      body.revision,
    );
    if (!r.changes) {
      reply.code(409);
      return {
        error:
          "Preferences changed on another device. Reload settings before saving.",
      };
    }
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>(
    "/api/exercises/:id/hint",
    async (req) => {
      const owner = requireOwner(req),
        e = ctx.exercise(req.params.id),
        b = parse(
          z.object({ level: z.number().int().min(1).max(3) }).strict(),
          req.body,
        );
      store.run(
        "INSERT OR IGNORE INTO hints VALUES (?,?,?,?)",
        owner,
        e.id,
        b.level,
        now(),
      );
      return { hint: e.hints[b.level - 1], level: b.level };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/exercises/:id/solution",
    async (req) => {
      const owner = requireOwner(req),
        e = ctx.exercise(req.params.id);
      store.run(
        "INSERT OR IGNORE INTO hints VALUES (?,?,4,?)",
        owner,
        e.id,
        now(),
      );
      return { files: e.solution, explanation: e.explanation, helpUsed: true };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/exercises/:id/help",
    async (req) => {
      const owner = requireOwner(req),
        e = ctx.exercise(req.params.id);
      return store
        .all<{ level: number }>(
          "SELECT level FROM hints WHERE owner_id=? AND exercise_id=? ORDER BY level",
          owner,
          e.id,
        )
        .map((h) => ({
          level: h.level,
          text: h.level <= 3 ? e.hints[h.level - 1] : "Solution revealed",
        }));
    },
  );
  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req) => {
    requireOwner(req);
    const p = content.projects.find((p) => p.id === req.params.id);
    if (!p)
      throw Object.assign(new Error("Project not found."), { statusCode: 404 });
    const {
      reference: _,
      explanation: __,
      checks: ___,
      referenceInput: ____,
      ...publicProject
    } = p;
    return {
      ...publicProject,
      exercises: p.milestones.map((m) =>
        publicExercise(ctx.exercise(m.exerciseId)),
      ),
    };
  });
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/solution",
    async (req) => {
      const owner = requireOwner(req),
        p = content.projects.find((p) => p.id === req.params.id);
      if (!p)
        throw Object.assign(new Error("Project not found."), {
          statusCode: 404,
        });
      for (const m of p.milestones)
        store.run(
          "INSERT OR IGNORE INTO hints VALUES (?,?,4,?)",
          owner,
          m.exerciseId,
          now(),
        );
      return { reference: p.reference, explanation: p.explanation };
    },
  );
  app.get<{ Querystring: { q?: string } }>("/api/reference", async (req) => {
    requireOwner(req);
    const q = (req.query.q ?? "").slice(0, 200).toLowerCase();
    return content.references.filter((r) =>
      `${r.title} ${r.body} ${r.tags.join(" ")}`.toLowerCase().includes(q),
    );
  });
  app.post<{ Params: { id: string } }>("/api/review/:id", async (req) => {
    const owner = requireOwner(req),
      e = ctx.exercise(req.params.id),
      b = parse(
        z
          .object({
            answer: z.string().max(3000),
            confidence: z.enum(["again", "good", "easy"]),
            mutationId: z.string().uuid(),
          })
          .strict(),
        req.body,
      );
    return store.transaction(() => {
      const existing = store.get<{ response: string; resource: string }>(
        "SELECT response,resource FROM receipts WHERE owner_id=? AND mutation_id=?",
        owner,
        b.mutationId,
      );
      if (existing) {
        if (existing.resource !== `review:${e.id}`)
          throw Object.assign(new Error("Mutation ID already used."), {
            statusCode: 409,
          });
        return JSON.parse(existing.response);
      }
      const p = store.get<{ review_stage: number }>(
        "SELECT review_stage FROM progress WHERE owner_id=? AND exercise_id=?",
        owner,
        e.id,
      );
      if (!p)
        throw Object.assign(
          new Error("Practice this exercise before scheduling a review."),
          { statusCode: 400 },
        );
      const retrieval = ctx.lesson(e.lessonId).retrieval,
        correct =
          normalizeAnswer(b.answer) === normalizeAnswer(retrieval.answer);
      const stage =
        !correct || b.confidence === "again"
          ? 0
          : Math.min(
              intervals.length - 1,
              p.review_stage + (b.confidence === "easy" ? 2 : 1),
            );
      const dueAt = new Date(
        Date.now() + intervals[stage] * 86400000,
      ).toISOString();
      store.run(
        "UPDATE progress SET review_stage=?,due_at=? WHERE owner_id=? AND exercise_id=?",
        stage,
        dueAt,
        owner,
        e.id,
      );
      store.run(
        "INSERT INTO review_events VALUES (?,?,?,?,?,?,?)",
        b.mutationId,
        owner,
        e.id,
        b.answer,
        correct ? 1 : 0,
        b.confidence,
        now(),
      );
      const response = { correct, explanation: retrieval.answer, dueAt };
      store.run(
        "INSERT INTO receipts VALUES (?,?,?,?,?)",
        owner,
        b.mutationId,
        `review:${e.id}`,
        JSON.stringify(response),
        now(),
      );
      return response;
    });
  });
  const diagnostic = [
    {
      id: "compile",
      question: "Which step turns a C source file into a program?",
      options: ["Compilation", "Execution", "Printing"],
    },
    {
      id: "division",
      question: "What is 7 / 2 when both operands have type int?",
      options: ["3", "3.5", "4"],
    },
    {
      id: "array",
      question: "For int values[4], what is the last valid index?",
      options: ["3", "4", "Depends on int size"],
    },
  ];
  app.get("/api/diagnostic", async (req) => {
    requireOwner(req);
    return { questions: diagnostic };
  });
  app.post("/api/diagnostic", async (req) => {
    requireOwner(req);
    const b = parse(
        z.object({ answers: z.array(z.string().max(100)).length(3) }).strict(),
        req.body,
      ),
      correct = ["Compilation", "3", "3"];
    const count = b.answers.filter((a, i) => a === correct[i]).length;
    return {
      recommendations: [
        count === 3
          ? "parameters-and-results"
          : count >= 1
            ? "variables-and-types"
            : "source-to-program",
      ],
      explanation: `${count} of 3 foundations recalled. This suggests a starting point; it does not award lesson completion or prove proficiency. You can visit any chapter.`,
    };
  });
}
