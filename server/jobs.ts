import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  RunnerRequest,
  RunnerOutcome,
  JobState,
} from "../shared/runner.js";
import { requireOwner, now, type Context, notFound } from "./context.js";
import { safeEqual } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { parse, files, outcome } from "./validation.js";
import { validateFiles } from "../runner/validation.js";
import { recordAttempt, normalizeAnswer } from "./learning.js";
const terminal = new Set<JobState>([
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "infrastructure_error",
]);
interface JobRow {
  id: string;
  owner_id: string;
  exercise_id: string;
  content_version: number;
  mode: string;
  state: JobState;
  payload: string;
  result: string | null;
  lease_token: string | null;
  worker_id: string | null;
  cancelled: number;
}
export function runnerAvailability(ctx: Context, language: "c" | "cpp" = "c") {
  const w = ctx.store.get<{
    available: number;
    detail: string;
    heartbeat_at: string;
  }>("SELECT * FROM workers ORDER BY heartbeat_at DESC LIMIT 1");
  const supported = language === "c" || !!w?.detail.includes("C++20");
  return {
    available:
      supported &&
      !!w?.available &&
      Date.parse(w.heartbeat_at) > Date.now() - 30000,
    detail:
      !supported && w
        ? "This worker has not verified C++20. Update and restart the isolated worker before running C++ exercises."
        : (w?.detail ??
          "No isolated worker is connected. Drafts and lessons work; C/C++ execution requires the self-hosted rootless worker."),
    toolchain: "GCC 14.2.0 · C17 / C++20",
  };
}
export function expireJobs(ctx: Context) {
  const expired = ctx.store.all<JobRow>(
    "SELECT * FROM jobs WHERE state IN ('compiling','running') AND lease_expires_at<?",
    now(),
  );
  for (const j of expired)
    finish(ctx, j, {
      state: "infrastructure_error",
      stdout: "",
      stderr: "",
      diagnostics: "",
      exitCode: null,
      elapsedMs: 0,
      truncated: false,
      feedback:
        "The worker stopped responding. Your draft is intact; submit again when the worker is available.",
    });
  const queued = ctx.store.all<JobRow>(
    "SELECT * FROM jobs WHERE state='queued' AND created_at<?",
    new Date(Date.now() - 180000).toISOString(),
  );
  for (const j of queued)
    finish(ctx, j, {
      state: "infrastructure_error",
      stdout: "",
      stderr: "",
      diagnostics: "",
      exitCode: null,
      elapsedMs: 0,
      truncated: false,
      feedback:
        "The queue could not start this job within three minutes. It was not graded.",
    });
}
function finish(ctx: Context, j: JobRow, result: RunnerOutcome) {
  ctx.store.transaction(() => {
    const current = ctx.store.get<JobRow>(
      "SELECT * FROM jobs WHERE id=?",
      j.id,
    )!;
    if (terminal.has(current.state)) return;
    ctx.store.run(
      "UPDATE jobs SET state=?,result=?,updated_at=? WHERE id=?",
      result.state,
      JSON.stringify(result),
      now(),
      j.id,
    );
    recordAttempt(
      ctx,
      j.owner_id,
      j.exercise_id,
      j.mode,
      JSON.parse(j.payload),
      result,
      j.id,
      j.content_version,
    );
  });
}
export function jobRoutes(ctx: Context) {
  const { app, store } = ctx;
  app.get<{ Querystring: { course?: string } }>("/api/runner", async (req) => {
    requireOwner(req);
    return runnerAvailability(ctx, req.query.course === "cpp20" ? "cpp" : "c");
  });
  app.post("/api/jobs", async (req, reply) => {
    const owner = requireOwner(req),
      b = parse(
        z
          .object({
            exerciseId: z.string().max(100),
            mode: z.enum(["run", "check"]),
            files,
            stdin: z.string().max(8192),
            sanitize: z.boolean().default(false),
            answer: z.string().max(5000).optional(),
            mutationId: z.string().uuid(),
          })
          .strict(),
        req.body,
      ),
      e = ctx.exercise(b.exerciseId);
    const existing = store.get<JobRow>(
      "SELECT * FROM jobs WHERE owner_id=? AND mutation_id=?",
      owner,
      b.mutationId,
    );
    if (existing) {
      if (existing.exercise_id !== e.id)
        throw Object.assign(new Error("Mutation ID already used."), {
          statusCode: 409,
        });
      return {
        id: existing.id,
        state: existing.state,
        result: existing.result ? JSON.parse(existing.result) : null,
      };
    }
    if (req.accountRole === "learner")
      rateLimit(
        ctx,
        "job-submit:" + owner,
        20,
        60000,
        "Too many checks or runs at once. Try again in a minute.",
      );
    const conceptual = ["prediction", "diagnosis", "reflection"].includes(
      e.type,
    );
    if (b.mode === "check" && conceptual) {
      if (!b.answer?.trim())
        throw Object.assign(new Error("Enter your answer before checking."), {
          statusCode: 400,
        });
      const passed = e.tests.some(
        (t) => normalizeAnswer(b.answer!) === normalizeAnswer(t.expected),
      );
      const r: RunnerOutcome = {
        state: "succeeded",
        stdout: "",
        stderr: "",
        diagnostics: "",
        exitCode: 0,
        elapsedMs: 0,
        truncated: false,
        ...(e.type !== "reflection" ? { passed } : {}),
        feedback:
          e.type === "reflection"
            ? "Reflection recorded. Compare your reasoning with the rubric; this is not independent behavioral mastery."
            : passed
              ? e.explanation
              : "The key idea needs another look. Use a conceptual hint or revisit the explanation.",
      };
      const id = randomUUID();
      store.transaction(() => {
        store.run(
          "INSERT INTO jobs(id,owner_id,exercise_id,content_version,mode,mutation_id,state,payload,result,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          id,
          owner,
          e.id,
          e.version,
          b.mode,
          b.mutationId,
          r.state,
          JSON.stringify({ answer: b.answer, files: b.files }),
          JSON.stringify(r),
          now(),
          now(),
        );
        recordAttempt(
          ctx,
          owner,
          e.id,
          b.mode,
          { answer: b.answer, files: b.files },
          r,
          id,
        );
      });
      return { id, state: r.state, result: r };
    }
    // Language belongs to the exercise contract, never to the browser payload.
    try {
      validateFiles(b.files, false, e.language ?? "c");
    } catch (error) {
      throw Object.assign(error as Error, { statusCode: 400 });
    }
    if (req.accountRole === "learner") {
      expireJobs(ctx);
      const pending = store.get<{ n: number }>(
        "SELECT count(*) AS n FROM jobs WHERE owner_id=? AND state IN ('queued','compiling','running')",
        owner,
      )!.n;
      if (pending >= 2)
        throw Object.assign(
          new Error(
            "You already have two compiler jobs waiting or running. Let one finish or cancel it.",
          ),
          { statusCode: 429 },
        );
      const minute = new Date(Date.now() - 60000).toISOString();
      const recent = store.get<{ n: number }>(
        "SELECT count(*) AS n FROM jobs WHERE owner_id=? AND created_at>?",
        owner,
        minute,
      )!.n;
      const day = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
      const daily = store.get<{ n: number }>(
        "SELECT count(*) AS n FROM jobs WHERE owner_id=? AND created_at>=?",
        owner,
        day,
      )!.n;
      if (recent >= 10 || daily >= 200)
        throw Object.assign(
          new Error(
            daily >= 200
              ? "Today's 200 compiler jobs are used. Continue drafting; execution resets at midnight UTC."
              : "Compiler submission limit reached. Try again in a minute.",
          ),
          { statusCode: 429 },
        );
    }
    if (!runnerAvailability(ctx, e.language ?? "c").available) {
      reply.code(503);
      return {
        error:
          "Runner unavailable. Your code is saved separately; this submission has not been run or graded.",
        runner: runnerAvailability(ctx, e.language ?? "c"),
      };
    }
    expireJobs(ctx);
    const queued = store.get<{ n: number }>(
      "SELECT count(*) AS n FROM jobs WHERE state IN ('queued','compiling','running')",
    )!.n;
    if (queued >= 20)
      throw Object.assign(
        new Error(
          "The runner queue is full. Try again after an existing job finishes.",
        ),
        { statusCode: 429 },
      );
    const id = randomUUID(),
      payload: RunnerRequest = {
        language: e.language ?? "c",
        files: b.files,
        stdin: b.stdin,
        sanitize: b.sanitize,
        ...(b.mode === "check"
          ? { cases: e.tests }
          : {
              harness: e.examples[0]?.harness,
              fixtures: e.examples[0]?.fixtures,
              args: e.examples[0]?.args,
            }),
      };
    store.run(
      "INSERT INTO jobs(id,owner_id,exercise_id,content_version,mode,mutation_id,state,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id,
      owner,
      e.id,
      e.version,
      b.mode,
      b.mutationId,
      "queued",
      JSON.stringify(payload),
      now(),
      now(),
    );
    reply.code(202);
    return { id, state: "queued", result: null };
  });
  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req) => {
    const owner = requireOwner(req);
    expireJobs(ctx);
    const j = store.get<JobRow>(
      "SELECT * FROM jobs WHERE id=? AND owner_id=?",
      req.params.id,
      owner,
    );
    if (!j) notFound("Job");
    return {
      id: j.id,
      state: j.state,
      result: j.result ? JSON.parse(j.result) : null,
    };
  });
  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (req) => {
    const owner = requireOwner(req),
      j = store.get<JobRow>(
        "SELECT * FROM jobs WHERE id=? AND owner_id=?",
        req.params.id,
        owner,
      );
    if (!j) notFound("Job");
    store.run("UPDATE jobs SET cancelled=1 WHERE id=?", j.id);
    finish(ctx, j, {
      state: "cancelled",
      stdout: "",
      stderr: "",
      diagnostics: "",
      exitCode: null,
      elapsedMs: 0,
      truncated: false,
      feedback: "Cancelled. This attempt was not graded.",
    });
    return { ok: true };
  });
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/internal/")) {
      const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (!ctx.runnerSecret || !safeEqual(token, ctx.runnerSecret))
        throw Object.assign(new Error("Runner authentication failed."), {
          statusCode: 401,
        });
    }
  });
  app.post("/internal/runner/heartbeat", async (req) => {
    const b = parse(
      z
        .object({
          workerId: z.string().min(1).max(100),
          available: z.boolean(),
          detail: z.string().max(3000),
        })
        .strict(),
      req.body,
    );
    store.run(
      "INSERT INTO workers VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET available=excluded.available,detail=excluded.detail,heartbeat_at=excluded.heartbeat_at",
      b.workerId,
      b.available ? 1 : 0,
      b.detail,
      now(),
    );
    return { ok: true };
  });
  app.post("/internal/runner/lease", async (req) => {
    const b = parse(
      z.object({ workerId: z.string().min(1).max(100) }).strict(),
      req.body,
    );
    expireJobs(ctx);
    return store.transaction(() => {
      const w = store.get<{ available: number; heartbeat_at: string }>(
        "SELECT * FROM workers WHERE id=?",
        b.workerId,
      );
      if (!w?.available || Date.parse(w.heartbeat_at) < Date.now() - 30000)
        return { job: null };
      if (
        store.get(
          "SELECT id FROM jobs WHERE state IN ('compiling','running') LIMIT 1",
        )
      )
        return { job: null };
      const j = store.get<JobRow>(
        "SELECT * FROM jobs WHERE state='queued' AND cancelled=0 ORDER BY created_at LIMIT 1",
      );
      if (!j) return { job: null };
      const leaseToken = randomUUID();
      store.run(
        "UPDATE jobs SET state='compiling',worker_id=?,lease_token=?,lease_expires_at=?,updated_at=? WHERE id=?",
        b.workerId,
        leaseToken,
        new Date(Date.now() + 120000).toISOString(),
        now(),
        j.id,
      );
      return { job: { id: j.id, leaseToken, request: JSON.parse(j.payload) } };
    });
  });
  const leaseBase = z.object({
    workerId: z.string().max(100),
    leaseToken: z.string().uuid(),
  });
  function validateLease(id: string, worker: string, token: string) {
    const j = store.get<JobRow>(
      "SELECT * FROM jobs WHERE id=? AND worker_id=? AND lease_token=?",
      id,
      worker,
      token,
    );
    if (!j) notFound("Lease");
    return j;
  }
  app.post<{ Params: { id: string } }>(
    "/internal/runner/jobs/:id/status",
    async (req) => {
      const b = parse(
          leaseBase
            .extend({ state: z.enum(["compiling", "running"]) })
            .strict(),
          req.body,
        ),
        j = validateLease(req.params.id, b.workerId, b.leaseToken);
      if (!terminal.has(j.state))
        store.run(
          "UPDATE jobs SET state=?,lease_expires_at=?,updated_at=? WHERE id=?",
          b.state,
          new Date(Date.now() + 120000).toISOString(),
          now(),
          j.id,
        );
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/internal/runner/jobs/:id/result",
    async (req) => {
      const b = parse(leaseBase.extend({ result: outcome }).strict(), req.body),
        j = validateLease(req.params.id, b.workerId, b.leaseToken);
      if (!terminal.has(b.result.state))
        throw Object.assign(new Error("A result must have a terminal state."), {
          statusCode: 400,
        });
      finish(ctx, j, b.result);
      return { ok: true };
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { leaseToken: string; workerId: string };
  }>("/internal/runner/jobs/:id/control", async (req) => {
    const b = parse(leaseBase, req.query),
      j = validateLease(req.params.id, b.workerId, b.leaseToken);
    if (!terminal.has(j.state))
      store.run(
        "UPDATE jobs SET lease_expires_at=? WHERE id=?",
        new Date(Date.now() + 120000).toISOString(),
        j.id,
      );
    return { cancelled: !!j.cancelled || terminal.has(j.state) };
  });
}
