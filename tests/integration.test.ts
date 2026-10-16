import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { backup } from "node:sqlite";
import { createApp, type AppOptions } from "../server/app";
import { loadContent } from "../server/content";
import { intervals } from "../server/learning";
import { explainDiagnostic } from "../shared/diagnostics";
import {
  defaultPreferences,
  type Draft,
  type DraftConflict,
  type DraftData,
  type LearnerState,
} from "../shared/app";
import type { RunnerLeaseResponse, RunnerOutcome } from "../shared/runner";

const content = loadContent();
const first = content.exercises[0];
const second = content.exercises[1];
const conceptual = content.exercises.find(
  (exercise) => exercise.type === "diagnosis",
)!;
const anotherConceptual = content.exercises.find(
  (exercise) => exercise.type === "diagnosis" && exercise.id !== conceptual.id,
)!;
const credentials = {
  username: "forge_test",
  password: "fictional-test-password-123!",
};
const bootstrapSecret = "fictional-bootstrap-secret-for-integration-tests";
const runnerSecret = "fictional-runner-secret-for-integration-tests";
const exportKey = "fictional-export-signing-key-for-integration-tests";

type Server = Awaited<ReturnType<typeof createApp>>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Method = "GET" | "POST" | "PUT" | "DELETE";
interface JobResponse {
  id: string;
  state: string;
  result: RunnerOutcome | null;
}
interface ExportData {
  preferences: LearnerState["preferences"];
  resume: LearnerState["resume"];
  drafts: Draft[];
  progress: LearnerState["progress"];
  attempts: {
    id: string;
    exerciseId: string;
    source: Record<string, unknown>;
    outcome: RunnerOutcome;
    helpUsed: boolean;
    createdAt: string;
  }[];
  hints: { exerciseId: string; level: number }[];
  reviews: {
    id: string;
    exerciseId: string;
    answer: string;
    correct: boolean;
    confidence: string;
    createdAt: string;
  }[];
}
interface LearnerExport {
  format: "c-forge";
  version: 1;
  exportedAt: string;
  signature?: string;
  data: ExportData;
}

async function fixture(t: TestContext, overrides: Partial<AppOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "c-forge-integration-"));
  const options: AppOptions = {
    databasePath: join(directory, "learner.sqlite"),
    bootstrapSecret,
    runnerSecret,
    exportKey,
    content,
    serveStatic: false,
    logger: false,
    ...overrides,
  };
  let current = await createApp(options);
  await current.app.ready();
  const servers: Server[] = [current];
  t.after(async () => {
    for (const server of servers) await server.app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    options,
    get app() {
      return current.app;
    },
    get store() {
      return current.store;
    },
    get ctx() {
      return current.ctx;
    },
    async reopen() {
      await current.app.close();
      current = await createApp(options);
      servers.push(current);
      await current.app.ready();
    },
    async openBackup(path: string) {
      const server = await createApp({ ...options, databasePath: path });
      servers.push(server);
      await server.app.ready();
      return server;
    },
  };
}

async function request<T = Record<string, unknown>>(
  f: Pick<Fixture, "app">,
  path: string,
  method: Method = "GET",
  body?: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) {
  const response = await f.app.inject({
    method,
    url: path,
    headers: {
      host: "forge.test",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  return { status: response.statusCode, body: response.json<T>(), response };
}

async function owner(f: Pick<Fixture, "app">) {
  const response = await request(f, "/api/auth/setup", "POST", {
    ...credentials,
    bootstrapSecret,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const header = response.response.headers["set-cookie"];
  assert.ok(header);
  return (Array.isArray(header) ? header[0] : header).split(";")[0];
}

function draftData(source = first.starter): DraftData {
  return {
    files: structuredClone(source),
    stdin: "7\n",
    activeFile: Object.keys(source)[0],
    step: 2,
    cursor: { anchor: 3, head: 6 },
    scrollAnchor: 120,
    paneSize: 61,
    notes: "Check the empty case.",
    prediction: "I expect one greeting line.",
    sanitize: true,
    mobileTab: "code",
    bookmark: true,
  };
}

function submission(exerciseId = first.id, mode: "run" | "check" = "check") {
  return {
    exerciseId,
    mode,
    files: structuredClone(
      content.exercises.find((exercise) => exercise.id === exerciseId)!.starter,
    ),
    stdin: "",
    sanitize: false,
    mutationId: randomUUID(),
  };
}

async function saveDraft(
  f: Fixture,
  cookie: string,
  exerciseId: string,
  data: DraftData,
  revision = 0,
  mutationId = randomUUID(),
) {
  const exercise = content.exercises.find((item) => item.id === exerciseId)!;
  return request<Draft | { error: string; conflict: DraftConflict }>(
    f,
    `/api/drafts/${exerciseId}`,
    "PUT",
    {
      revision,
      mutationId,
      contentVersion: exercise.version,
      data,
    },
    cookie,
  );
}

async function heartbeat(f: Fixture, workerId = "integration-worker") {
  const result = await request(
    f,
    "/internal/runner/heartbeat",
    "POST",
    {
      workerId,
      available: true,
      detail:
        "Mock transport heartbeat for queue tests; no compiler execution.",
    },
    undefined,
    { authorization: `Bearer ${runnerSecret}` },
  );
  assert.equal(result.status, 200);
}

async function lease(f: Fixture, workerId = "integration-worker") {
  return request<RunnerLeaseResponse>(
    f,
    "/internal/runner/lease",
    "POST",
    { workerId },
    undefined,
    { authorization: `Bearer ${runnerSecret}` },
  );
}

async function workerResult(
  f: Fixture,
  jobId: string,
  leaseToken: string,
  result: RunnerOutcome,
  workerId = "integration-worker",
) {
  return request(
    f,
    `/internal/runner/jobs/${jobId}/result`,
    "POST",
    { workerId, leaseToken, result },
    undefined,
    { authorization: `Bearer ${runnerSecret}` },
  );
}

const mockSuccess: RunnerOutcome = {
  state: "succeeded",
  stdout: "Mock worker result",
  stderr: "",
  diagnostics: "",
  exitCode: 0,
  elapsedMs: 1,
  truncated: false,
  passed: true,
  casesPassed: 1,
  casesTotal: 1,
  feedback:
    "Queue transaction test only; this result was not produced by a compiler.",
};

test("owner bootstrap requires the secret, permits one owner, and issues protected expiring sessions", async (t) => {
  const f = await fixture(t, { secureCookies: true });
  assert.equal((await request(f, "/api/auth/status")).body.setupRequired, true);
  assert.equal(
    (await request(f, "/api/auth/setup", "POST", credentials)).status,
    400,
  );
  assert.equal(
    (
      await request(f, "/api/auth/setup", "POST", {
        ...credentials,
        bootstrapSecret: "wrong-secret-long-enough",
      })
    ).status,
    403,
  );
  const result = await request(f, "/api/auth/setup", "POST", {
    ...credentials,
    bootstrapSecret,
  });
  assert.equal(result.status, 200);
  const header = String(result.response.headers["set-cookie"]);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/i);
  assert.match(header, /Secure/);
  assert.match(header, /Max-Age=1209600/);
  assert.equal(
    (
      await request(f, "/api/auth/setup", "POST", {
        ...credentials,
        bootstrapSecret,
      })
    ).status,
    409,
  );
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM owner")?.n,
    1,
  );
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM learner")?.n,
    1,
  );
  assert.equal(
    (await request(f, "/api/auth/status")).body.setupRequired,
    false,
  );
});

test("account data and runner APIs reject unauthenticated, cross-site, and forged pass requests", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/api/state",
    `/api/drafts/${first.id}`,
    `/api/jobs/${randomUUID()}`,
    "/api/data/export",
    "/api/bookmarks",
    "/api/runner",
  ]) {
    assert.equal((await request(f, path)).status, 401, path);
  }
  assert.equal(
    (await request(f, "/api/jobs", "POST", submission())).status,
    401,
  );
  assert.equal(
    (
      await request(f, "/internal/runner/heartbeat", "POST", {
        workerId: "fake",
        available: true,
        detail: "",
      })
    ).status,
    401,
  );
  const cookie = await owner(f);
  const crossSite = await request(
    f,
    "/api/preferences",
    "POST",
    { revision: 0, preferences: defaultPreferences },
    cookie,
    { origin: "https://other.test" },
  );
  assert.equal(crossSite.status, 403);
  assert.equal(
    (
      await request(
        f,
        "/api/jobs",
        "POST",
        { ...submission(), passed: true },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request(f, `/api/jobs/${randomUUID()}`, "GET", undefined, cookie))
      .status,
    404,
  );
  assert.equal(
    (
      await request(
        f,
        "/api/data/import",
        "POST",
        { payload: {}, mode: "replace" },
        cookie,
      )
    ).status,
    400,
  );
  const learner = await request<LearnerState>(
    f,
    "/api/state",
    "GET",
    undefined,
    cookie,
  );
  assert.equal(learner.body.progress.length, 0);
});

test("draft saves restore metadata, replay idempotently, and preserve stale conflicts until a deliberate choice", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  const local = draftData({
    "main.c": "first source",
    "helper.h": "int helper(void);",
  });
  local.activeFile = "helper.h";
  const mutation = randomUUID();
  const saved = await saveDraft(f, cookie, first.id, local, 0, mutation);
  assert.equal(saved.status, 200);
  assert.equal((saved.body as Draft).revision, 1);
  assert.deepEqual(
    (
      await request<Draft>(
        f,
        `/api/drafts/${first.id}`,
        "GET",
        undefined,
        cookie,
      )
    ).body.data,
    local,
  );
  const update = await saveDraft(
    f,
    cookie,
    first.id,
    { ...local, notes: "remote changed" },
    1,
  );
  assert.equal((update.body as Draft).revision, 2);
  const replay = await saveDraft(f, cookie, first.id, local, 0, mutation);
  assert.equal(replay.status, 200);
  assert.equal((replay.body as Draft).revision, 1);
  assert.equal(
    (
      await request<Draft>(
        f,
        `/api/drafts/${first.id}`,
        "GET",
        undefined,
        cookie,
      )
    ).body.revision,
    2,
  );
  assert.equal(
    (await saveDraft(f, cookie, second.id, local, 0, mutation)).status,
    409,
  );
  const conflict = await saveDraft(
    f,
    cookie,
    first.id,
    { ...local, notes: "local changed" },
    1,
  );
  assert.equal(conflict.status, 409);
  const versions = (conflict.body as { conflict: DraftConflict }).conflict;
  assert.equal(versions.local.data.notes, "local changed");
  assert.equal(versions.remote.data.notes, "remote changed");
  await saveDraft(
    f,
    cookie,
    first.id,
    { ...local, notes: "third device changed" },
    2,
  );
  const staleChoice = await request<{ conflict: DraftConflict }>(
    f,
    `/api/drafts/${first.id}/resolve`,
    "POST",
    { conflictId: versions.id, choice: "local", revision: 2 },
    cookie,
  );
  assert.equal(staleChoice.status, 409);
  assert.equal(
    staleChoice.body.conflict.remote.data.notes,
    "third device changed",
  );
  const chosen = await request<Draft>(
    f,
    `/api/drafts/${first.id}/resolve`,
    "POST",
    {
      conflictId: staleChoice.body.conflict.id,
      choice: "local",
      revision: 3,
    },
    cookie,
  );
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.revision, 4);
  assert.equal(chosen.body.data.notes, "local changed");
  const history = await request<{ draft: Draft; reason: string }[]>(
    f,
    `/api/drafts/${first.id}/history`,
    "GET",
    undefined,
    cookie,
  );
  assert.ok(
    history.body.some(
      (item) => item.draft.data.notes === "third device changed",
    ),
  );
  assert.ok(
    history.body.some((item) => item.reason === "conflicting local version"),
  );
  const state = await request<LearnerState>(
    f,
    "/api/state",
    "GET",
    undefined,
    cookie,
  );
  assert.deepEqual(state.body.resume, {
    lessonId: first.lessonId,
    exerciseId: first.id,
    step: 2,
  });
});

test("a stale revision for a missing draft returns an explicit conflict instead of a server error", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  const result = await saveDraft(f, cookie, first.id, draftData(), 9);
  assert.equal(result.status, 409);
  const conflict = (result.body as { conflict: DraftConflict }).conflict;
  assert.equal(conflict.local.revision, 9);
  assert.equal(conflict.remote.revision, 0);
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM drafts")?.n,
    0,
  );
});

test("logout, sign-in, API restart, and idempotent migration preserve account identity and drafts", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  const data = draftData();
  await saveDraft(f, cookie, first.id, data);
  const username = f.store.get<{ username: string; password_hash: string }>(
    "SELECT username,password_hash FROM owner",
  )!;
  await f.reopen();
  assert.equal(
    (await request(f, "/api/auth/status")).body.setupRequired,
    false,
  );
  assert.equal(
    (await request(f, "/api/auth/me", "GET", undefined, cookie)).status,
    200,
  );
  assert.deepEqual(
    f.store.get("SELECT username,password_hash FROM owner"),
    username,
  );
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM migrations")?.n,
    3,
  );
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM content_registry")?.n,
    content.lessons.length + content.exercises.length,
  );
  assert.deepEqual(
    (
      await request<Draft>(
        f,
        `/api/drafts/${first.id}`,
        "GET",
        undefined,
        cookie,
      )
    ).body.data,
    data,
  );
  assert.equal(
    (await request(f, "/api/auth/logout", "POST", {}, cookie)).status,
    200,
  );
  assert.equal(
    (await request(f, "/api/state", "GET", undefined, cookie)).status,
    401,
  );
  const login = await request(f, "/api/auth/login", "POST", credentials);
  assert.equal(login.status, 200);
  const newCookie = String(login.response.headers["set-cookie"]).split(";")[0];
  assert.deepEqual(
    (
      await request<Draft>(
        f,
        `/api/drafts/${first.id}`,
        "GET",
        undefined,
        newCookie,
      )
    ).body.data,
    data,
  );
});

test("trusted export/import round trip restores code, metadata, notes, preferences, progress, hints, and reviews", async (t) => {
  const source = await fixture(t);
  const cookie = await owner(source);
  const authored = draftData({
    "main.c": "int main(void) { return 0; }",
    "notes.txt": "private project notes",
  });
  await saveDraft(source, cookie, first.id, authored);
  await saveDraft(source, cookie, conceptual.id, draftData(conceptual.starter));
  await request(
    source,
    `/api/exercises/${conceptual.id}/hint`,
    "POST",
    { level: 2 },
    cookie,
  );
  const conceptualResult = await request<JobResponse>(
    source,
    "/api/jobs",
    "POST",
    {
      ...submission(conceptual.id),
      answer: conceptual.tests[0].expected,
    },
    cookie,
  );
  assert.equal(conceptualResult.status, 200);
  assert.equal(conceptualResult.body.result?.passed, true);
  const independentConcept = await request<JobResponse>(
    source,
    "/api/jobs",
    "POST",
    {
      ...submission(anotherConceptual.id),
      answer: anotherConceptual.tests[0].expected,
    },
    cookie,
  );
  assert.equal(independentConcept.status, 200);
  assert.equal(independentConcept.body.result?.passed, true);
  const retrieval = content.lessons.find(
    (lesson) => lesson.id === conceptual.lessonId,
  )!.retrieval.answer;
  const reviewMutation = randomUUID();
  const review = await request(
    source,
    `/api/review/${conceptual.id}`,
    "POST",
    { answer: retrieval, confidence: "easy", mutationId: reviewMutation },
    cookie,
  );
  assert.equal(review.status, 200);
  assert.equal(
    (
      await request(
        source,
        `/api/review/${conceptual.id}`,
        "POST",
        { answer: retrieval, confidence: "easy", mutationId: reviewMutation },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    source.store.get<{ n: number }>("SELECT count(*) n FROM review_events")?.n,
    1,
  );
  const preferences = {
    ...defaultPreferences,
    theme: "light",
    proseSize: 20,
    editorSize: 17,
    lineSpacing: 1.9,
    focusMode: true,
    sessionMinutes: 30,
  };
  assert.equal(
    (
      await request(
        source,
        "/api/preferences",
        "POST",
        { revision: 0, preferences },
        cookie,
      )
    ).status,
    200,
  );
  const exported = await request<LearnerExport>(
    source,
    "/api/data/export",
    "GET",
    undefined,
    cookie,
  );
  assert.equal(exported.status, 200);
  const hintedProgress = exported.body.data.progress.find(
    (item) => item.exerciseId === conceptual.id,
  )!;
  assert.equal(hintedProgress.completed, true);
  assert.equal(hintedProgress.proficient, false);
  assert.equal(hintedProgress.helpUsed, true);
  assert.equal(hintedProgress.reviewStage, 2);
  assert.equal(
    exported.body.data.progress.find(
      (item) => item.exerciseId === anotherConceptual.id,
    )?.proficient,
    true,
  );
  assert.ok(exported.body.signature);
  assert.deepEqual(Object.keys(exported.body).sort(), [
    "data",
    "exportedAt",
    "format",
    "signature",
    "version",
  ]);
  assert.ok(!JSON.stringify(exported.body).includes(credentials.password));
  assert.ok(!JSON.stringify(exported.body).includes(bootstrapSecret));
  assert.ok(!JSON.stringify(exported.body).includes(runnerSecret));
  assert.ok(!JSON.stringify(exported.body).includes(exportKey));
  const destination = await fixture(t);
  const destinationCookie = await owner(destination);
  const preview = await request<{
    counts: Record<string, number>;
    warnings: string[];
  }>(
    destination,
    "/api/data/import/preview",
    "POST",
    { payload: exported.body },
    destinationCookie,
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.body.counts.drafts, 2);
  assert.equal(preview.body.counts.notes, 2);
  const imported = await request(
    destination,
    "/api/data/import",
    "POST",
    { payload: exported.body, mode: "preserve" },
    destinationCookie,
  );
  assert.equal(imported.status, 200);
  assert.equal(imported.body.trusted, true);
  const roundTrip = await request<LearnerExport>(
    destination,
    "/api/data/export",
    "GET",
    undefined,
    destinationCookie,
  );
  assert.deepEqual(
    roundTrip.body.data.preferences,
    exported.body.data.preferences,
  );
  assert.deepEqual(roundTrip.body.data.resume, exported.body.data.resume);
  assert.deepEqual(roundTrip.body.data.progress, exported.body.data.progress);
  assert.deepEqual(roundTrip.body.data.attempts, exported.body.data.attempts);
  assert.deepEqual(roundTrip.body.data.hints, exported.body.data.hints);
  assert.deepEqual(roundTrip.body.data.reviews, exported.body.data.reviews);
  for (const draft of exported.body.data.drafts) {
    const restored = roundTrip.body.data.drafts.find(
      (item) => item.exerciseId === draft.exerciseId,
    )!;
    assert.deepEqual(restored.data, draft.data);
    assert.equal(restored.contentVersion, draft.contentVersion);
  }
  await request(
    destination,
    "/api/data/import",
    "POST",
    { payload: exported.body, mode: "preserve" },
    destinationCookie,
  );
  assert.equal(
    destination.store.get<{ n: number }>("SELECT count(*) n FROM attempts")?.n,
    exported.body.data.attempts.length,
  );
  assert.equal(
    destination.store.get<{ n: number }>("SELECT count(*) n FROM review_events")
      ?.n,
    exported.body.data.reviews.length,
  );
});

test("imports reject malformed paths and duplicate IDs, and do not trust forged proficiency", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  await saveDraft(f, cookie, first.id, draftData());
  const exported = (
    await request<LearnerExport>(
      f,
      "/api/data/export",
      "GET",
      undefined,
      cookie,
    )
  ).body;
  const badPath = structuredClone(exported);
  badPath.data.drafts[0].data.files = {
    "../escape.c": "int main(void) { return 0; }",
  };
  badPath.data.drafts[0].data.activeFile = "../escape.c";
  assert.equal(
    (
      await request(
        f,
        "/api/data/import/preview",
        "POST",
        { payload: badPath },
        cookie,
      )
    ).status,
    400,
  );
  const duplicates = structuredClone(exported);
  duplicates.data.drafts.push(structuredClone(duplicates.data.drafts[0]));
  assert.equal(
    (
      await request(
        f,
        "/api/data/import",
        "POST",
        { payload: duplicates, mode: "replace" },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        f,
        "/api/data/import",
        "POST",
        { payload: { ...exported, passed: true }, mode: "replace" },
        cookie,
      )
    ).status,
    400,
  );
  const forged = structuredClone(exported);
  delete forged.signature;
  forged.data.progress = [
    {
      exerciseId: first.id,
      lessonId: first.lessonId,
      completed: true,
      proficient: true,
      helpUsed: false,
      reviewStage: 0,
      dueAt: new Date().toISOString(),
      lastResult: "Forged pass",
    },
  ];
  const result = await request(
    f,
    "/api/data/import",
    "POST",
    { payload: forged, mode: "replace" },
    cookie,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.trusted, false);
  const state = (
    await request<LearnerState>(f, "/api/state", "GET", undefined, cookie)
  ).body;
  assert.equal(state.progress[0].proficient, false);
  assert.match(state.progress[0].lastResult, /new check/);
  const before = state.resume;
  const oversize = await f.app.inject({
    method: "POST",
    url: "/api/data/import",
    headers: { cookie, "content-type": "application/json" },
    payload: JSON.stringify({
      payload: "x".repeat(4 * 1024 * 1024 + 1),
      mode: "replace",
    }),
  });
  assert.equal(oversize.statusCode, 413);
  assert.deepEqual(
    (await request<LearnerState>(f, "/api/state", "GET", undefined, cookie))
      .body.resume,
    before,
  );
});

test("preserve import keeps existing code and replace advances revisions with recoverable history", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  const original = draftData({ "main.c": "original import snapshot" });
  await saveDraft(f, cookie, first.id, original);
  const exported = (
    await request<LearnerExport>(
      f,
      "/api/data/export",
      "GET",
      undefined,
      cookie,
    )
  ).body;
  await saveDraft(
    f,
    cookie,
    first.id,
    { ...original, files: { "main.c": "newer device work" } },
    1,
  );
  assert.equal(
    (
      await request(
        f,
        "/api/data/import",
        "POST",
        { payload: exported, mode: "preserve" },
        cookie,
      )
    ).status,
    200,
  );
  const preserved = (
    await request<Draft>(f, `/api/drafts/${first.id}`, "GET", undefined, cookie)
  ).body;
  assert.equal(preserved.data.files["main.c"], "newer device work");
  assert.equal(preserved.revision, 2);
  assert.equal(
    (
      await request(
        f,
        "/api/data/import",
        "POST",
        { payload: exported, mode: "replace" },
        cookie,
      )
    ).status,
    200,
  );
  const replaced = (
    await request<Draft>(f, `/api/drafts/${first.id}`, "GET", undefined, cookie)
  ).body;
  assert.equal(replaced.data.files["main.c"], "original import snapshot");
  assert.equal(replaced.revision, 3);
  const history = (
    await request<{ draft: Draft; reason: string }[]>(
      f,
      `/api/drafts/${first.id}/history`,
      "GET",
      undefined,
      cookie,
    )
  ).body;
  assert.ok(history.some((item) => item.reason === "imported alternate draft"));
  assert.ok(
    history.some(
      (item) =>
        item.reason === "before import replacement" &&
        item.draft.data.files["main.c"] === "newer device work",
    ),
  );
});

test("an unavailable isolated runner returns 503 without creating attempts or awarding completion", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  const availability = await request<{ available: boolean }>(
    f,
    "/api/runner",
    "GET",
    undefined,
    cookie,
  );
  assert.equal(availability.body.available, false);
  const result = await request(f, "/api/jobs", "POST", submission(), cookie);
  assert.equal(result.status, 503);
  assert.equal(f.store.get<{ n: number }>("SELECT count(*) n FROM jobs")?.n, 0);
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM attempts")?.n,
    0,
  );
  assert.equal(
    (await request<LearnerState>(f, "/api/state", "GET", undefined, cookie))
      .body.progress.length,
    0,
  );
});

test("mocked worker transport leases one job, stores canonical sources, and commits each outcome once", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  await heartbeat(f);
  await heartbeat(f, "second-worker");
  const body = submission();
  const editedDuringRun = draftData({
    "main.c": "int main(void){return 1;} /* edited after submitting */",
  });
  await saveDraft(f, cookie, first.id, editedDuringRun);
  const queued = await request<JobResponse>(
    f,
    "/api/jobs",
    "POST",
    body,
    cookie,
  );
  assert.equal(queued.status, 202);
  assert.equal(queued.body.state, "queued");
  const duplicate = await request<JobResponse>(
    f,
    "/api/jobs",
    "POST",
    body,
    cookie,
  );
  assert.equal(duplicate.body.id, queued.body.id);
  assert.equal(f.store.get<{ n: number }>("SELECT count(*) n FROM jobs")?.n, 1);
  const firstLease = await lease(f);
  assert.equal(firstLease.status, 200);
  assert.equal(firstLease.body.job?.id, queued.body.id);
  assert.deepEqual(firstLease.body.job?.request.cases, first.tests);
  assert.equal((await lease(f, "second-worker")).body.job, null);
  const leased = firstLease.body.job!;
  const status = await request(
    f,
    `/internal/runner/jobs/${leased.id}/status`,
    "POST",
    {
      workerId: "integration-worker",
      leaseToken: leased.leaseToken,
      state: "running",
    },
    undefined,
    { authorization: `Bearer ${runnerSecret}` },
  );
  assert.equal(status.status, 200);
  assert.equal(
    (await workerResult(f, leased.id, randomUUID(), mockSuccess)).status,
    404,
  );
  assert.equal(
    (await workerResult(f, leased.id, leased.leaseToken, mockSuccess)).status,
    200,
  );
  const successfulHistory = await request<{ draft: Draft; reason: string }[]>(
    f,
    `/api/drafts/${first.id}/history`,
    "GET",
    undefined,
    cookie,
  );
  assert.deepEqual(
    successfulHistory.body.find((v) => v.reason === "last successful check")
      ?.draft.data.files,
    body.files,
  );
  let revision = (
    await request<Draft>(f, `/api/drafts/${first.id}`, "GET", undefined, cookie)
  ).body.revision;
  for (let i = 0; i < 25; i++) {
    const saved = await saveDraft(
      f,
      cookie,
      first.id,
      { ...editedDuringRun, notes: `later save ${i}` },
      revision,
    );
    assert.equal(saved.status, 200);
    assert.ok("revision" in saved.body);
    revision = saved.body.revision;
  }
  const retained = await request<{ draft: Draft; reason: string }[]>(
    f,
    `/api/drafts/${first.id}/history`,
    "GET",
    undefined,
    cookie,
  );
  assert.equal(retained.body.length, 21);
  assert.deepEqual(
    retained.body.find((v) => v.reason === "last successful check")?.draft.data
      .files,
    body.files,
  );
  const prior = (
    await request<LearnerState>(f, "/api/state", "GET", undefined, cookie)
  ).body;
  assert.equal(prior.progress[0].completed, true);
  assert.equal(prior.progress[0].proficient, true);
  assert.equal(
    (await workerResult(f, leased.id, leased.leaseToken, mockSuccess)).status,
    200,
  );
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM attempts")?.n,
    1,
  );
  const next = (
    await request<LearnerState>(f, "/api/state", "GET", undefined, cookie)
  ).body;
  assert.deepEqual(next.progress, prior.progress);
  assert.equal(
    (
      await request<JobResponse>(
        f,
        `/api/jobs/${leased.id}`,
        "GET",
        undefined,
        cookie,
      )
    ).body.state,
    "succeeded",
  );
  const exported = (
    await request<LearnerExport>(
      f,
      "/api/data/export",
      "GET",
      undefined,
      cookie,
    )
  ).body;
  assert.deepEqual(Object.keys(exported.data.attempts[0].source).sort(), [
    "files",
    "sanitize",
    "stdin",
  ]);
  assert.ok(
    !JSON.stringify(exported.data.attempts[0].source).includes('"cases"'),
  );
  assert.ok(
    !JSON.stringify(exported.data.attempts[0].source).includes('"harness"'),
  );
});

test("job outcome and corresponding progress roll back together when a database write fails", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  await heartbeat(f);
  const queued = (
    await request<JobResponse>(f, "/api/jobs", "POST", submission(), cookie)
  ).body;
  const job = (await lease(f)).body.job!;
  f.store.db.exec(
    "CREATE TRIGGER integration_deny_progress BEFORE INSERT ON progress BEGIN SELECT RAISE(ABORT, 'integration transaction failure'); END;",
  );
  assert.equal(
    (await workerResult(f, job.id, job.leaseToken, mockSuccess)).status,
    500,
  );
  assert.equal(
    f.store.get<{ state: string; result: string | null }>(
      "SELECT state,result FROM jobs WHERE id=?",
      queued.id,
    )?.state,
    "compiling",
  );
  assert.equal(
    f.store.get<{ result: string | null }>(
      "SELECT result FROM jobs WHERE id=?",
      queued.id,
    )?.result,
    null,
  );
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM attempts")?.n,
    0,
  );
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM progress")?.n,
    0,
  );
  f.store.db.exec("DROP TRIGGER integration_deny_progress");
  assert.equal(
    (await workerResult(f, job.id, job.leaseToken, mockSuccess)).status,
    200,
  );
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM attempts")?.n,
    1,
  );
  assert.equal(
    f.store.get<{ n: number }>("SELECT count(*) n FROM progress")?.n,
    1,
  );
});

test("cancellation and expired leases remain terminal after restart and cannot accept late passes", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  await heartbeat(f);
  const queued = (
    await request<JobResponse>(f, "/api/jobs", "POST", submission(), cookie)
  ).body;
  assert.equal(
    (await request(f, `/api/jobs/${queued.id}/cancel`, "POST", {}, cookie))
      .status,
    200,
  );
  assert.equal(
    (await request(f, `/api/jobs/${queued.id}/cancel`, "POST", {}, cookie))
      .status,
    200,
  );
  assert.equal(
    (
      await request<JobResponse>(
        f,
        `/api/jobs/${queued.id}`,
        "GET",
        undefined,
        cookie,
      )
    ).body.state,
    "cancelled",
  );
  assert.equal(
    f.store.get<{ n: number }>(
      "SELECT count(*) n FROM attempts WHERE id=?",
      queued.id,
    )?.n,
    1,
  );
  const secondJob = (
    await request<JobResponse>(
      f,
      "/api/jobs",
      "POST",
      submission(second.id),
      cookie,
    )
  ).body;
  const leased = (await lease(f)).body.job!;
  assert.equal(leased.id, secondJob.id);
  f.store.run(
    "UPDATE jobs SET lease_expires_at=? WHERE id=?",
    new Date(Date.now() - 1000).toISOString(),
    leased.id,
  );
  await f.reopen();
  const recovered = await request<JobResponse>(
    f,
    `/api/jobs/${leased.id}`,
    "GET",
    undefined,
    cookie,
  );
  assert.equal(recovered.body.state, "infrastructure_error");
  assert.match(
    recovered.body.result?.feedback ?? "",
    /worker stopped responding/,
  );
  assert.equal(
    (await workerResult(f, leased.id, leased.leaseToken, mockSuccess)).status,
    200,
  );
  assert.equal(
    (
      await request<JobResponse>(
        f,
        `/api/jobs/${leased.id}`,
        "GET",
        undefined,
        cookie,
      )
    ).body.state,
    "infrastructure_error",
  );
  assert.equal(
    f.store.get<{ n: number }>(
      "SELECT count(*) n FROM attempts WHERE id=?",
      leased.id,
    )?.n,
    1,
  );
  assert.equal(
    (await request<LearnerState>(f, "/api/state", "GET", undefined, cookie))
      .body.progress.length,
    0,
  );
});

test("the personal runner queue is bounded and stale queued jobs fail explicitly", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  await heartbeat(f);
  const ids: string[] = [];
  for (let index = 0; index < 20; index += 1) {
    const result = await request<JobResponse>(
      f,
      "/api/jobs",
      "POST",
      submission(),
      cookie,
    );
    assert.equal(result.status, 202);
    ids.push(result.body.id);
  }
  assert.equal(
    (await request(f, "/api/jobs", "POST", submission(), cookie)).status,
    429,
  );
  f.store.run(
    "UPDATE jobs SET created_at=? WHERE id=?",
    new Date(Date.now() - 181000).toISOString(),
    ids[0],
  );
  const expired = await request<JobResponse>(
    f,
    `/api/jobs/${ids[0]}`,
    "GET",
    undefined,
    cookie,
  );
  assert.equal(expired.body.state, "infrastructure_error");
  assert.match(expired.body.result?.feedback ?? "", /not graded/);
  assert.equal(
    (await request(f, "/api/jobs", "POST", submission(), cookie)).status,
    202,
  );
});

test("SQLite online backup restores a live WAL database consistently with owner and learner state", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  const saved = draftData({
    "main.c": "int main(void) { return 0; }",
    "memo.txt": "backup includes notes",
  });
  await saveDraft(f, cookie, first.id, saved);
  assert.equal(
    f.store.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode,
    "wal",
  );
  assert.equal(existsSync(`${f.options.databasePath}-wal`), true);
  const backupPath = join(f.directory, "consistent-backup.sqlite");
  const copiedPages = await backup(f.store.db, backupPath);
  assert.ok(copiedPages > 0);
  const restored = await f.openBackup(backupPath);
  assert.equal(
    (await request(restored, "/api/auth/status")).body.setupRequired,
    false,
  );
  assert.equal(
    (await request(restored, "/api/auth/me", "GET", undefined, cookie)).status,
    200,
  );
  assert.deepEqual(
    (
      await request<Draft>(
        restored,
        `/api/drafts/${first.id}`,
        "GET",
        undefined,
        cookie,
      )
    ).body.data,
    saved,
  );
  assert.equal(
    restored.store.get<{ n: number }>("SELECT count(*) n FROM migrations")?.n,
    3,
  );
  assert.equal(
    restored.store.get<{ foreign_keys: number }>("PRAGMA foreign_keys")
      ?.foreign_keys,
    1,
  );
  assert.equal(
    restored.store.get<{ integrity_check: string }>("PRAGMA integrity_check")
      ?.integrity_check,
    "ok",
  );
});

test("deterministic review intervals and diagnostic explanations keep their documented meanings", () => {
  assert.deepEqual(intervals, [1, 3, 7, 14, 30]);
  assert.match(
    explainDiagnostic("main.c:3: error: expected ';' before '}' token")
      ?.explanation ?? "",
    /line just before/,
  );
  assert.match(
    explainDiagnostic("main.c:4: error: 'total' undeclared")?.explanation ?? "",
    /scope/,
  );
  assert.match(
    explainDiagnostic("warning: implicit declaration of function 'strlen'")
      ?.explanation ?? "",
    /header/,
  );
  assert.match(
    explainDiagnostic("undefined reference to `sum`")?.explanation ?? "",
    /compiled and linked/,
  );
  assert.match(
    explainDiagnostic("AddressSanitizer: heap-use-after-free")?.explanation ??
      "",
    /free/,
  );
  assert.match(
    explainDiagnostic("runtime error: signed integer overflow")?.explanation ??
      "",
    /undefined behavior/,
  );
  assert.equal(explainDiagnostic("an unfamiliar compiler diagnostic"), null);
});

test("subpath sessions use a distinct cookie name and clear the exact scoped cookie", async (t) => {
  const f = await fixture(t, {
    cookieName: "cforge_session",
    cookiePath: "/forge/",
    secureCookies: true,
  });
  const setup = await request(f, "/api/auth/setup", "POST", {
    ...credentials,
    bootstrapSecret,
  });
  assert.equal(setup.status, 200);
  const header = String(setup.response.headers["set-cookie"]);
  assert.match(header, /^cforge_session=/);
  assert.match(header, /Path=\/forge\//);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  const cookie = header.split(";")[0];
  const token = cookie.slice(cookie.indexOf("=") + 1);
  assert.equal(
    (await request(f, "/api/auth/me", "GET", undefined, `session=${token}`))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        f,
        "/api/auth/me",
        "GET",
        undefined,
        `session=another-application; ${cookie}`,
      )
    ).status,
    200,
  );
  const logout = await request(f, "/api/auth/logout", "POST", {}, cookie);
  assert.equal(logout.status, 200);
  assert.match(
    String(logout.response.headers["set-cookie"]),
    /^cforge_session=;/,
  );
  assert.match(String(logout.response.headers["set-cookie"]), /Path=\/forge\//);
  assert.equal(
    (await request(f, "/api/auth/me", "GET", undefined, cookie)).status,
    401,
  );
  const login = await request(f, "/api/auth/login", "POST", credentials);
  const secondCookie = String(login.response.headers["set-cookie"]).split(
    ";",
  )[0];
  const sessions = await request<{ id: string; current: boolean }[]>(
    f,
    "/api/auth/sessions",
    "GET",
    undefined,
    secondCookie,
  );
  const session = sessions.body.find((item) => item.current)!;
  const revoke = await request(
    f,
    `/api/auth/sessions/${session.id}`,
    "DELETE",
    undefined,
    secondCookie,
  );
  assert.equal(revoke.status, 200);
  assert.match(
    String(revoke.response.headers["set-cookie"]),
    /^cforge_session=;/,
  );
  assert.match(String(revoke.response.headers["set-cookie"]), /Path=\/forge\//);
});

test("loopback proxy trust accepts the forwarded public host and ignores headers from other peers", async (t) => {
  const f = await fixture(t, { trustProxyLoopback: true });
  const cookie = await owner(f);
  const headers = {
    host: "127.0.0.1:3030",
    cookie,
    "content-type": "application/json",
    origin: "https://forge.test:8445",
    "x-forwarded-host": "forge.test:8445",
    "x-forwarded-proto": "https",
    "x-forwarded-for": "198.51.100.20",
  };
  let revision = 0;
  for (const remoteAddress of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    const allowed = await f.app.inject({
      method: "POST",
      url: "/api/preferences",
      remoteAddress,
      headers,
      payload: JSON.stringify({
        revision: revision++,
        preferences: defaultPreferences,
      }),
    });
    assert.equal(allowed.statusCode, 200, remoteAddress);
  }
  const spoof = await f.app.inject({
    method: "POST",
    url: "/api/preferences",
    remoteAddress: "203.0.113.9",
    headers,
    payload: JSON.stringify({ revision, preferences: defaultPreferences }),
  });
  assert.equal(spoof.statusCode, 403);
  const wrongOrigin = await f.app.inject({
    method: "POST",
    url: "/api/preferences",
    remoteAddress: "127.0.0.1",
    headers: { ...headers, origin: "https://other.test:8445" },
    payload: JSON.stringify({ revision, preferences: defaultPreferences }),
  });
  assert.equal(wrongOrigin.statusCode, 403);
  const malformedOrigin = await f.app.inject({
    method: "POST",
    url: "/api/preferences",
    remoteAddress: "127.0.0.1",
    headers: { ...headers, origin: "not a URL" },
    payload: JSON.stringify({ revision, preferences: defaultPreferences }),
  });
  assert.equal(malformedOrigin.statusCode, 403);
});

test("forwarded hosts are ignored by default and unsafe cookie configuration is rejected", async (t) => {
  const f = await fixture(t);
  const cookie = await owner(f);
  const response = await f.app.inject({
    method: "POST",
    url: "/api/preferences",
    remoteAddress: "127.0.0.1",
    headers: {
      host: "127.0.0.1:3030",
      cookie,
      "content-type": "application/json",
      origin: "https://forge.test:8445",
      "x-forwarded-host": "forge.test:8445",
    },
    payload: JSON.stringify({ revision: 0, preferences: defaultPreferences }),
  });
  assert.equal(response.statusCode, 403);
  for (const cookieName of ["bad;name", "name with spaces", "x".repeat(65)]) {
    await assert.rejects(
      createApp({ ...f.options, cookieName }),
      /COOKIE_NAME/,
    );
  }
  for (const cookiePath of [
    "forge/",
    "/forge",
    "//forge/",
    "/forge/../",
    "/forge/;injected/",
  ]) {
    await assert.rejects(
      createApp({ ...f.options, cookiePath }),
      /COOKIE_PATH/,
    );
  }
});
