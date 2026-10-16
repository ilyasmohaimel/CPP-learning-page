import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { draftData, preferences, outcome } from "./validation.js";
const draft = z
  .object({
    exerciseId: z.string(),
    contentVersion: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    data: draftData,
    updatedAt: z.string().datetime(),
  })
  .strict();
const progress = z
  .object({
    exerciseId: z.string(),
    lessonId: z.string(),
    completed: z.boolean(),
    proficient: z.boolean(),
    helpUsed: z.boolean(),
    reviewStage: z.number().int().min(0).max(4),
    dueAt: z.string().datetime(),
    lastResult: z.string(),
  })
  .strict();
const state = z
  .object({
    preferences,
    preferencesRevision: z.number().int().nonnegative(),
    resume: z
      .object({
        lessonId: z.string(),
        exerciseId: z.string(),
        step: z.number().int(),
      })
      .strict()
      .nullable(),
    progress: z.array(progress),
    activity: z.array(
      z
        .object({
          id: z.string().uuid(),
          exerciseId: z.string(),
          mode: z.string(),
          state: z.string(),
          passed: z.boolean().nullable(),
          createdAt: z.string().datetime(),
        })
        .strict(),
    ),
    reviews: z.array(
      z
        .object({
          exerciseId: z.string(),
          lessonId: z.string(),
          title: z.string(),
          question: z.string(),
          dueAt: z.string().datetime(),
          stage: z.number().int(),
          reason: z.string(),
        })
        .strict(),
    ),
    enrolled: z.boolean(),
    courseResumes: z
      .record(
        z.string(),
        z
          .object({
            lessonId: z.string(),
            exerciseId: z.string(),
            step: z.number().int(),
          })
          .nullable(),
      )
      .optional(),
  })
  .strict();
const job = z
  .object({
    id: z.string().uuid(),
    state: outcome.shape.state,
    result: outcome.nullable(),
  })
  .strict();
export function installResponseValidation(app: FastifyInstance) {
  app.addHook("preSerialization", async (req, reply, payload) => {
    if (reply.statusCode >= 400) return payload;
    const path = req.url.split("?")[0];
    let schema: z.ZodType | undefined;
    if (path === "/api/state") schema = state;
    else if (/^\/api\/drafts\/[^/]+$/.test(path)) schema = draft.nullable();
    else if (
      path === "/api/jobs" ||
      (/^\/api\/jobs\/[^/]+$/.test(path) && req.method === "GET")
    )
      schema = job;
    else if (path === "/api/auth/me")
      schema = z
        .object({
          id: z.union([z.literal("owner"), z.string().uuid()]),
          username: z.string(),
        })
        .strict();
    else if (path === "/api/runner")
      schema = z
        .object({
          available: z.boolean(),
          detail: z.string(),
          toolchain: z.string(),
        })
        .strict();
    if (schema) {
      const result = schema.safeParse(payload);
      if (!result.success)
        throw new Error("Response contract validation failed.");
      return result.data;
    }
    return payload;
  });
}
