import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireOwner, now, type Context } from "./context.js";
import { draftData, preferences, outcome, parse } from "./validation.js";
import { safeEqual } from "./auth.js";
import { readDraft, history, persistDraft } from "./drafts.js";
const draftSchema = z
  .object({
    exerciseId: z.string().max(100),
    contentVersion: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    data: draftData,
    updatedAt: z.string().datetime(),
  })
  .strict();
const progressSchema = z
  .object({
    exerciseId: z.string().max(100),
    lessonId: z.string().max(100),
    completed: z.boolean(),
    proficient: z.boolean(),
    helpUsed: z.boolean(),
    reviewStage: z.number().int().min(0).max(4),
    dueAt: z.string().datetime(),
    lastResult: z.string().max(1000),
  })
  .strict();
const attemptSchema = z
  .object({
    id: z.string().uuid(),
    exerciseId: z.string().max(100),
    contentVersion: z.number().int().positive(),
    mode: z.enum(["run", "check"]),
    source: z
      .object({
        files: draftData.shape.files.optional(),
        stdin: z.string().max(8192).optional(),
        answer: z.string().max(5000).optional(),
        sanitize: z.boolean().optional(),
      })
      .strict(),
    outcome,
    helpUsed: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();
const reviewSchema = z
  .object({
    id: z.string().uuid(),
    exerciseId: z.string().max(100),
    answer: z.string().max(3000),
    correct: z.boolean(),
    confidence: z.enum(["again", "good", "easy"]),
    createdAt: z.string().datetime(),
  })
  .strict();
const payloadSchema = z
  .object({
    format: z.literal("c-forge"),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    signature: z.string().max(128).optional(),
    data: z
      .object({
        preferences,
        resume: z
          .object({
            lessonId: z.string(),
            exerciseId: z.string(),
            step: z.number().int().min(0).max(8),
          })
          .strict()
          .nullable(),
        drafts: z.array(draftSchema).max(200),
        progress: z.array(progressSchema).max(200),
        attempts: z.array(attemptSchema).max(1000),
        hints: z
          .array(
            z
              .object({
                exerciseId: z.string().max(100),
                level: z.number().int().min(1).max(4),
              })
              .strict(),
          )
          .max(800),
        reviews: z.array(reviewSchema).max(1000),
      })
      .strict(),
  })
  .strict();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function dataRoutes(ctx: Context, exportKey: string) {
  const { app, store } = ctx;
  const signature = (
    v: { data: unknown; exportedAt: string },
    owner?: string,
  ) =>
    createHmac("sha256", exportKey)
      .update(
        JSON.stringify(
          canonical({
            ...(owner ? { owner } : {}),
            exportedAt: v.exportedAt,
            data: v.data,
          }),
        ),
      )
      .digest("hex");
  const trustedFor = (
    v: { data: unknown; exportedAt: string; signature?: string },
    owner: string,
  ) =>
    !!v.signature &&
    (safeEqual(v.signature, signature(v, owner)) ||
      (owner === "owner" && safeEqual(v.signature, signature(v))));
  function validate(value: unknown) {
    const payload = parse(payloadSchema, value);
    for (const d of payload.data.drafts) ctx.exercise(d.exerciseId);
    for (const p of payload.data.progress) {
      const e = ctx.exercise(p.exerciseId);
      if (e.lessonId !== p.lessonId)
        throw Object.assign(
          new Error("Progress has an invalid lesson reference."),
          { statusCode: 400 },
        );
    }
    for (const a of payload.data.attempts) ctx.exercise(a.exerciseId);
    for (const h of payload.data.hints) ctx.exercise(h.exerciseId);
    for (const r of payload.data.reviews) ctx.exercise(r.exerciseId);
    if (payload.data.resume) {
      ctx.lesson(payload.data.resume.lessonId);
      if (
        ctx.exercise(payload.data.resume.exerciseId).lessonId !==
        payload.data.resume.lessonId
      )
        throw Object.assign(
          new Error("Resume lesson does not match exercise."),
          { statusCode: 400 },
        );
    }
    for (const name of ["drafts", "progress", "attempts", "reviews"] as const) {
      const items = payload.data[name];
      const ids = items.map((v) =>
        "exerciseId" in v && (name === "drafts" || name === "progress")
          ? v.exerciseId
          : "id" in v
            ? v.id
            : "",
      );
      if (new Set(ids).size !== ids.length)
        throw Object.assign(new Error(`Duplicate ${name} in import.`), {
          statusCode: 400,
        });
    }
    return payload;
  }
  app.get("/api/data/export", async (req) => {
    const owner = requireOwner(req),
      learner = store.get<{ preferences: string; resume: string | null }>(
        "SELECT * FROM learner WHERE owner_id=?",
        owner,
      )!;
    const data = {
      preferences: JSON.parse(learner.preferences),
      resume: learner.resume ? JSON.parse(learner.resume) : null,
      drafts: store
        .all<{ exercise_id: string }>(
          "SELECT exercise_id FROM drafts WHERE owner_id=?",
          owner,
        )
        .map((d) => readDraft(ctx, owner, d.exercise_id)),
      progress: store
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
        .map((p) => ({
          exerciseId: p.exercise_id,
          lessonId: p.lesson_id,
          completed: !!p.completed,
          proficient: !!p.proficient,
          helpUsed: !!p.help_used,
          reviewStage: p.review_stage,
          dueAt: p.due_at,
          lastResult: p.last_result,
        })),
      attempts: store
        .all<{
          id: string;
          exercise_id: string;
          content_version: number;
          mode: string;
          source: string;
          outcome: string;
          help_used: number;
          created_at: string;
        }>(
          "SELECT * FROM attempts WHERE owner_id=? ORDER BY created_at DESC LIMIT 1000",
          owner,
        )
        .map((a) => ({
          id: a.id,
          exerciseId: a.exercise_id,
          contentVersion: a.content_version,
          mode: a.mode,
          source: JSON.parse(a.source),
          outcome: JSON.parse(a.outcome),
          helpUsed: !!a.help_used,
          createdAt: a.created_at,
        })),
      hints: store
        .all<{ exercise_id: string; level: number }>(
          "SELECT * FROM hints WHERE owner_id=?",
          owner,
        )
        .map((h) => ({ exerciseId: h.exercise_id, level: h.level })),
      reviews: store
        .all<{
          id: string;
          exercise_id: string;
          answer: string;
          correct: number;
          confidence: string;
          created_at: string;
        }>(
          "SELECT * FROM review_events WHERE owner_id=? ORDER BY created_at DESC LIMIT 1000",
          owner,
        )
        .map((r) => ({
          id: r.id,
          exerciseId: r.exercise_id,
          answer: r.answer,
          correct: !!r.correct,
          confidence: r.confidence,
          createdAt: r.created_at,
        })),
    };
    const payload = { format: "c-forge", version: 1, exportedAt: now(), data };
    return { ...payload, signature: signature(payload, owner) };
  });
  app.post("/api/data/import/preview", async (req) => {
    const owner = requireOwner(req);
    const b = parse(z.object({ payload: z.unknown() }).strict(), req.body),
      p = validate(b.payload),
      trusted = trustedFor(p, owner);
    return {
      counts: {
        drafts: p.data.drafts.length,
        attempts: p.data.attempts.length,
        progress: p.data.progress.length,
        notes: p.data.drafts.filter((d) => d.data.notes).length,
        reviews: p.data.reviews.length,
      },
      warnings: [
        ...(trusted
          ? []
          : [
              "This export cannot be verified for this account on this installation. Code and notes will restore; imported proficiency and passed results will require new checks.",
            ]),
        "Preserve keeps existing drafts and places differing imported drafts in recoverable history. Replace keeps a pre-import draft history entry.",
      ],
    };
  });
  app.post("/api/data/import", async (req) => {
    const owner = requireOwner(req),
      b = parse(
        z
          .object({
            payload: z.unknown(),
            mode: z.enum(["preserve", "replace"]),
          })
          .strict(),
        req.body,
      ),
      p = validate(b.payload),
      trusted = trustedFor(p, owner);
    function importId(kind: "attempt" | "review", original: string) {
      const receipt = store.get<{ stored_id: string }>(
        "SELECT stored_id FROM import_receipts WHERE owner_id=? AND kind=? AND source_id=?",
        owner,
        kind,
        original,
      );
      if (receipt) return receipt.stored_id;
      const table = kind === "attempt" ? "attempts" : "review_events";
      const existing = store.get<{ owner_id: string }>(
        `SELECT owner_id FROM ${table} WHERE id=?`,
        original,
      );
      const id =
        existing && existing.owner_id !== owner ? randomUUID() : original;
      store.run(
        "INSERT INTO import_receipts VALUES (?,?,?,?)",
        owner,
        kind,
        original,
        id,
      );
      return id;
    }
    const originalLearner = store.get<{
      resume: string | null;
      preferences_revision: number;
      enrolled: number;
    }>(
      "SELECT resume,preferences_revision,enrolled FROM learner WHERE owner_id=?",
      owner,
    )!;
    const fresh =
      !originalLearner.resume &&
      !originalLearner.enrolled &&
      originalLearner.preferences_revision === 0;
    store.transaction(() => {
      for (const imported of p.data.drafts) {
        const current = readDraft(ctx, owner, imported.exerciseId);
        if (current) {
          if (b.mode === "preserve") {
            if (JSON.stringify(current.data) !== JSON.stringify(imported.data))
              history(ctx, owner, imported, "imported alternate draft");
            continue;
          }
          history(ctx, owner, current, "before import replacement");
        }
        persistDraft(ctx, owner, {
          ...imported,
          revision: (current?.revision ?? 0) + 1,
          updatedAt: now(),
        });
      }
      for (const v of p.data.progress) {
        if (
          b.mode === "preserve" &&
          store.get(
            "SELECT exercise_id FROM progress WHERE owner_id=? AND exercise_id=?",
            owner,
            v.exerciseId,
          )
        )
          continue;
        store.run(
          "INSERT INTO progress VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,exercise_id) DO UPDATE SET completed=excluded.completed,proficient=excluded.proficient,help_used=excluded.help_used,review_stage=excluded.review_stage,due_at=excluded.due_at,last_result=excluded.last_result",
          owner,
          v.exerciseId,
          v.lessonId,
          v.completed ? 1 : 0,
          trusted && v.proficient ? 1 : 0,
          v.helpUsed ? 1 : 0,
          v.reviewStage,
          v.dueAt,
          trusted
            ? v.lastResult
            : "Imported progress. Run a new check to verify proficiency.",
        );
      }
      for (const a of p.data.attempts) {
        const r = trusted
          ? a.outcome
          : {
              ...a.outcome,
              passed: undefined,
              feedback: "Imported unverified attempt.",
            };
        store.run(
          "INSERT OR IGNORE INTO attempts VALUES (?,?,?,?,?,?,?,?,?)",
          importId("attempt", a.id),
          owner,
          a.exerciseId,
          a.contentVersion,
          a.mode,
          JSON.stringify(a.source),
          JSON.stringify(r),
          a.helpUsed ? 1 : 0,
          a.createdAt,
        );
      }
      for (const h of p.data.hints)
        store.run(
          "INSERT OR IGNORE INTO hints VALUES (?,?,?,?)",
          owner,
          h.exerciseId,
          h.level,
          now(),
        );
      for (const r of p.data.reviews)
        store.run(
          "INSERT OR IGNORE INTO review_events VALUES (?,?,?,?,?,?,?)",
          importId("review", r.id),
          owner,
          r.exerciseId,
          r.answer,
          trusted && r.correct ? 1 : 0,
          r.confidence,
          r.createdAt,
        );
      if (b.mode === "replace" || fresh)
        store.run(
          "UPDATE learner SET preferences=?,preferences_revision=preferences_revision+1,resume=?,enrolled=1 WHERE owner_id=?",
          JSON.stringify(p.data.preferences),
          p.data.resume ? JSON.stringify(p.data.resume) : null,
          owner,
        );
    });
    return { ok: true, trusted };
  });
}
