import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Draft, DraftConflict } from "../shared/app.js";
import { requireOwner, now, type Context, notFound } from "./context.js";
import { parse, draftSave, draftData } from "./validation.js";
interface DraftRow {
  exercise_id: string;
  content_version: number;
  revision: number;
  data: string;
  updated_at: string;
}
export function readDraft(
  ctx: Context,
  owner: string,
  id: string,
): Draft | null {
  const d = ctx.store.get<DraftRow>(
    "SELECT * FROM drafts WHERE owner_id=? AND exercise_id=?",
    owner,
    id,
  );
  return d
    ? {
        exerciseId: d.exercise_id,
        contentVersion: d.content_version,
        revision: d.revision,
        data: JSON.parse(d.data),
        updatedAt: d.updated_at,
      }
    : null;
}
export function history(ctx: Context, owner: string, d: Draft, reason: string) {
  if (reason === "last successful check")
    ctx.store.run(
      "DELETE FROM draft_versions WHERE owner_id=? AND exercise_id=? AND reason='last successful check'",
      owner,
      d.exerciseId,
    );
  ctx.store.run(
    "INSERT INTO draft_versions VALUES (?,?,?,?,?,?,?)",
    randomUUID(),
    owner,
    d.exerciseId,
    JSON.stringify(d),
    d.revision,
    reason,
    now(),
  );
  ctx.store.run(
    "DELETE FROM draft_versions WHERE owner_id=? AND exercise_id=? AND reason<>'last successful check' AND id NOT IN (SELECT id FROM draft_versions WHERE owner_id=? AND exercise_id=? AND reason<>'last successful check' ORDER BY created_at DESC LIMIT 20)",
    owner,
    d.exerciseId,
    owner,
    d.exerciseId,
  );
}
export function createConflict(
  ctx: Context,
  owner: string,
  local: Draft,
  remote: Draft,
): DraftConflict {
  const id = randomUUID();
  ctx.store.run(
    "INSERT INTO conflicts(id,owner_id,exercise_id,local,remote,created_at) VALUES (?,?,?,?,?,?)",
    id,
    owner,
    local.exerciseId,
    JSON.stringify(local),
    JSON.stringify(remote),
    now(),
  );
  return { id, local, remote };
}
export function persistDraft(ctx: Context, owner: string, d: Draft) {
  ctx.store.run(
    "INSERT INTO drafts VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id,exercise_id) DO UPDATE SET content_version=excluded.content_version,revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at",
    owner,
    d.exerciseId,
    d.contentVersion,
    d.revision,
    JSON.stringify(d.data),
    d.updatedAt,
  );
  const exercise = ctx.exercise(d.exerciseId);
  ctx.store.run(
    "UPDATE learner SET resume=?,enrolled=1 WHERE owner_id=?",
    JSON.stringify({
      lessonId: exercise.lessonId,
      exerciseId: d.exerciseId,
      step: d.data.step,
    }),
    owner,
  );
}
export function draftRoutes(ctx: Context) {
  const { app, store } = ctx;
  app.get<{ Params: { id: string } }>("/api/drafts/:id", async (req) => {
    const owner = requireOwner(req);
    ctx.exercise(req.params.id);
    return readDraft(ctx, owner, req.params.id);
  });
  app.put<{ Params: { id: string } }>("/api/drafts/:id", async (req, reply) => {
    const owner = requireOwner(req),
      e = ctx.exercise(req.params.id),
      body = parse(draftSave, req.body);
    if (body.contentVersion !== e.version)
      throw Object.assign(
        new Error(
          "This exercise was updated. Your code is preserved; explicitly retry with the current content version.",
        ),
        { statusCode: 422 },
      );
    return store.transaction(() => {
      const receipt = store.get<{ response: string; resource: string }>(
        "SELECT response,resource FROM receipts WHERE owner_id=? AND mutation_id=?",
        owner,
        body.mutationId,
      );
      if (receipt) {
        if (receipt.resource !== e.id)
          throw Object.assign(
            new Error("Mutation ID was used for another resource."),
            { statusCode: 409 },
          );
        return JSON.parse(receipt.response);
      }
      const remote = readDraft(ctx, owner, e.id);
      const local: Draft = {
        exerciseId: e.id,
        contentVersion: body.contentVersion,
        revision: body.revision,
        data: body.data,
        updatedAt: now(),
      };
      if ((remote?.revision ?? 0) !== body.revision) {
        const conflict = createConflict(
          ctx,
          owner,
          local,
          remote ?? {
            exerciseId: e.id,
            contentVersion: e.version,
            revision: 0,
            updatedAt: now(),
            data: {
              files: e.starter,
              stdin: "",
              activeFile: Object.keys(e.starter)[0],
              step: 0,
              cursor: { anchor: 0, head: 0 },
              scrollAnchor: 0,
              paneSize: 46,
              notes: "",
              bookmark: false,
            },
          },
        );
        reply.code(409);
        return { error: "Draft conflict", conflict };
      }
      if (remote) history(ctx, owner, remote, "autosave");
      const saved = { ...local, revision: body.revision + 1 };
      persistDraft(ctx, owner, saved);
      store.run(
        "INSERT INTO receipts VALUES (?,?,?,?,?)",
        owner,
        body.mutationId,
        e.id,
        JSON.stringify(saved),
        now(),
      );
      return saved;
    });
  });
  app.post<{ Params: { id: string } }>(
    "/api/drafts/:id/archive",
    async (req) => {
      const owner = requireOwner(req),
        e = ctx.exercise(req.params.id),
        b = parse(
          z.object({ data: draftData, reason: z.string().max(100) }).strict(),
          req.body,
        );
      const d = readDraft(ctx, owner, e.id);
      history(
        ctx,
        owner,
        {
          exerciseId: e.id,
          contentVersion: e.version,
          revision: d?.revision ?? 0,
          data: b.data,
          updatedAt: now(),
        },
        b.reason,
      );
      return { ok: true };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/drafts/:id/history",
    async (req) => {
      const owner = requireOwner(req);
      ctx.exercise(req.params.id);
      return store
        .all<{ id: string; data: string; reason: string; created_at: string }>(
          "SELECT id,data,reason,created_at FROM draft_versions WHERE owner_id=? AND exercise_id=? ORDER BY created_at DESC LIMIT 21",
          owner,
          req.params.id,
        )
        .map((v) => ({
          id: v.id,
          draft: JSON.parse(v.data),
          reason: v.reason,
          createdAt: v.created_at,
        }));
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/drafts/:id/resolve",
    async (req, reply) => {
      const owner = requireOwner(req);
      const body = parse(
        z
          .object({
            conflictId: z.string().uuid(),
            choice: z.enum(["local", "remote"]),
            revision: z.number().int().min(0),
          })
          .strict(),
        req.body,
      );
      return store.transaction(() => {
        const c = store.get<{ local: string; remote: string }>(
          "SELECT local,remote FROM conflicts WHERE id=? AND owner_id=? AND exercise_id=? AND resolved=0",
          body.conflictId,
          owner,
          req.params.id,
        );
        if (!c) notFound("Conflict");
        const selected = JSON.parse(c[body.choice]) as Draft;
        const remote =
          readDraft(ctx, owner, req.params.id) ??
          (JSON.parse(c.remote) as Draft);
        if (body.revision !== remote.revision) {
          reply.code(409);
          return {
            error: "Draft conflict",
            conflict: createConflict(ctx, owner, selected, remote),
          };
        }
        history(ctx, owner, remote, "before conflict resolution");
        history(ctx, owner, JSON.parse(c.local), "conflicting local version");
        const result = {
          ...selected,
          revision: remote.revision + 1,
          updatedAt: now(),
        };
        persistDraft(ctx, owner, result);
        store.run(
          "UPDATE conflicts SET resolved=1 WHERE id=?",
          body.conflictId,
        );
        return result;
      });
    },
  );
  app.get("/api/bookmarks", async (req) => {
    const owner = requireOwner(req);
    return store
      .all<DraftRow>("SELECT * FROM drafts WHERE owner_id=?", owner)
      .map((d) => ({
        exerciseId: d.exercise_id,
        lessonId: ctx.exercise(d.exercise_id).lessonId,
        ...JSON.parse(d.data),
      }))
      .filter((d) => d.bookmark || d.notes);
  });
}
