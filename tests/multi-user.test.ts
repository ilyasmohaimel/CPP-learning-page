import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { createApp, type AppOptions } from "../server/app";
import {
  defaultPreferences,
  type Draft,
  type LearnerState,
  type DraftData,
} from "../shared/app";
import { loadContent } from "../server/content";
import { hashToken } from "../server/security";
const content = loadContent();
const exercise = content.exercises[0];
const password = "fictional-multi-user-password-only";
const secret = "fictional-bootstrap-and-worker-test-secret";
type Server = Awaited<ReturnType<typeof createApp>>;
const accountCookies = new Map<string, string>();
async function fixture(t: TestContext, options: Partial<AppOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), "c-forge-multi-"));
  const configuration = {
    databasePath: join(root, "db.sqlite"),
    bootstrapSecret: secret,
    exportKey: secret,
    runnerSecret: secret,
    publicRegistration: true,
    serveStatic: false,
    ...options,
  };
  let server = await createApp(configuration);
  await server.app.ready();
  t.after(async () => {
    await server.app.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    get server() {
      return server;
    },
    async reopen() {
      await server.app.close();
      server = await createApp(configuration);
      await server.app.ready();
    },
  };
}
async function call(
  server: Server,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) {
  const response = await server.app.inject({
    url: path,
    method,
    headers: {
      host: "forge.test",
      ...(cookie
        ? {
            cookie,
            ...(accountCookies.has(cookie)
              ? { "x-cforge-account-id": accountCookies.get(cookie)! }
              : {}),
          }
        : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  const responseBody = response.json();
  const resultCookie = String(response.headers["set-cookie"] ?? "").split(
    ";",
  )[0];
  if (
    responseBody &&
    typeof responseBody.id === "string" &&
    (path === "/api/auth/register" || path === "/api/auth/login")
  )
    accountCookies.set(resultCookie, responseBody.id);
  return {
    status: response.statusCode,
    body: responseBody,
    cookie: resultCookie,
  };
}
async function register(server: Server, username: string) {
  const result = await call(server, "/api/auth/register", "POST", {
    username,
    password,
  });
  assert.equal(result.status, 200);
  return { id: result.body.id as string, cookie: result.cookie };
}
function data(note: string): DraftData {
  return {
    files: { "main.c": exercise.starter["main.c"] + "\n/* " + note + " */\n" },
    stdin: note,
    activeFile: "main.c",
    step: 2,
    cursor: { anchor: 0, head: 0 },
    scrollAnchor: 25,
    paneSize: 50,
    notes: note,
    bookmark: true,
  };
}
async function save(
  server: Server,
  cookie: string,
  note: string,
  mutationId = randomUUID(),
  revision = 0,
) {
  return call(
    server,
    `/api/drafts/${exercise.id}`,
    "PUT",
    {
      contentVersion: exercise.version,
      revision,
      mutationId,
      data: data(note),
    },
    cookie,
  );
}
test("public registration creates distinct learner identities, rejects role injection and duplicate names, and preserves both logins after restart", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await call(f.server, "/api/auth/status")).body, {
    setupRequired: false,
    registrationOpen: true,
    bootstrapConfigured: true,
  });
  assert.equal(
    (
      await call(f.server, "/api/auth/register", "POST", {
        username: "alice",
        password,
        role: "admin",
      })
    ).status,
    400,
  );
  const a = await register(f.server, "Alice");
  const b = await register(f.server, "bob");
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, "owner");
  assert.equal(
    f.server.store.get<{ role: string }>(
      "SELECT role FROM owner WHERE id=?",
      a.id,
    )?.role,
    "learner",
  );
  assert.equal(
    (
      await call(f.server, "/api/auth/register", "POST", {
        username: "ALICE",
        password,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(f.server, "/api/auth/login", "POST", {
        username: "alice",
        password: "incorrect-password-only",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(f.server, "/api/auth/login", "POST", {
        username: "alice",
        password,
      })
    ).body.id,
    a.id,
  );
  await f.reopen();
  assert.equal(
    (await call(f.server, "/api/auth/me", "GET", undefined, a.cookie)).body.id,
    a.id,
  );
  assert.equal(
    (await call(f.server, "/api/auth/me", "GET", undefined, b.cookie)).body.id,
    b.id,
  );
  assert.equal(
    (
      await call(f.server, "/api/auth/setup", "POST", {
        username: "intruder",
        password,
      })
    ).status,
    400,
  );
  const privateServer = await fixture(t, { publicRegistration: false });
  assert.equal(
    (
      await call(privateServer.server, "/api/auth/register", "POST", {
        username: "newperson",
        password,
      })
    ).status,
    403,
  );
});
test("two learners keep separate drafts, histories, hints, progress, exports, conflicts and jobs; stale browser account scopes cannot write into another account", async (t) => {
  const f = await fixture(t);
  const a = await register(f.server, "learner_a");
  const b = await register(f.server, "learner_b");
  const sharedMutation = randomUUID();
  assert.equal(
    (
      await save(
        f.server,
        a.cookie,
        "Alice private code and note",
        sharedMutation,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await save(
        f.server,
        b.cookie,
        "Bob private code and note",
        sharedMutation,
      )
    ).status,
    200,
  );
  const path = `/api/drafts/${exercise.id}`;
  assert.equal(
    (await call(f.server, path, "GET", undefined, a.cookie)).body.data.notes,
    "Alice private code and note",
  );
  assert.equal(
    (await call(f.server, path, "GET", undefined, b.cookie)).body.data.notes,
    "Bob private code and note",
  );
  const stale = await save(
    f.server,
    a.cookie,
    "Alice conflicting copy",
    randomUUID(),
    0,
  );
  assert.equal(stale.status, 409);
  assert.equal(
    (
      await call(
        f.server,
        path + "/resolve",
        "POST",
        { conflictId: stale.body.conflict.id, choice: "local", revision: 1 },
        b.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.server,
        path,
        "PUT",
        {
          contentVersion: exercise.version,
          revision: 1,
          mutationId: randomUUID(),
          data: data("old-tab Alice must not overwrite Bob"),
        },
        b.cookie,
        { "x-cforge-account-id": a.id },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(f.server, "/api/state", "GET", undefined, b.cookie, {
        "x-cforge-account-id": a.id,
      })
    ).status,
    401,
  );
  assert.equal(
    (await call(f.server, path, "GET", undefined, b.cookie)).body.data.notes,
    "Bob private code and note",
  );
  assert.equal(
    (
      await call(
        f.server,
        `/api/exercises/${exercise.id}/hint`,
        "POST",
        { level: 1 },
        a.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        f.server,
        `/api/exercises/${exercise.id}/help`,
        "GET",
        undefined,
        a.cookie,
      )
    ).body.length,
    1,
  );
  assert.equal(
    (
      await call(
        f.server,
        `/api/exercises/${exercise.id}/help`,
        "GET",
        undefined,
        b.cookie,
      )
    ).body.length,
    0,
  );
  const conceptual = content.exercises.find((e) => e.type === "diagnosis")!;
  const job = await call(
    f.server,
    "/api/jobs",
    "POST",
    {
      exerciseId: conceptual.id,
      mode: "check",
      files: conceptual.starter,
      stdin: "",
      sanitize: false,
      answer: conceptual.tests[0].expected,
      mutationId: randomUUID(),
    },
    a.cookie,
  );
  assert.equal(job.status, 200);
  assert.equal(job.body.result.passed, true);
  assert.equal(
    (
      await call(
        f.server,
        `/api/jobs/${job.body.id}`,
        "GET",
        undefined,
        b.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.server,
        `/api/jobs/${job.body.id}/cancel`,
        "POST",
        {},
        b.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      (await call(f.server, "/api/state", "GET", undefined, b.cookie))
        .body as LearnerState
    ).progress.length,
    0,
  );
  const exported = (
    await call(f.server, "/api/data/export", "GET", undefined, a.cookie)
  ).body;
  assert(!JSON.stringify(exported).includes("Bob private"));
  assert(!JSON.stringify(exported).includes("password_hash"));
  const body = { payload: exported, mode: "preserve" };
  assert.equal(
    (
      await call(
        f.server,
        "/api/data/import/preview",
        "POST",
        { payload: exported },
        a.cookie,
      )
    ).body.warnings.some((message: string) =>
      message.includes("require new checks"),
    ),
    false,
  );
  assert.equal(
    (
      await call(
        f.server,
        "/api/data/import/preview",
        "POST",
        { payload: exported },
        b.cookie,
      )
    ).body.warnings.some((message: string) =>
      message.includes("require new checks"),
    ),
    true,
  );
  assert.equal(
    (await call(f.server, "/api/data/import", "POST", body, b.cookie)).status,
    200,
  );
  assert.equal(
    (await call(f.server, path, "GET", undefined, b.cookie)).body.data.notes,
    "Bob private code and note",
  );
  const imported = f.server.store.all<{ id: string }>(
    "SELECT id FROM attempts WHERE owner_id=?",
    b.id,
  );
  assert.equal(imported.length, 1);
  assert.equal(
    (
      (await call(f.server, "/api/state", "GET", undefined, b.cookie))
        .body as LearnerState
    ).progress.some((p) => p.proficient),
    false,
  );
  assert.notEqual(imported[0].id, job.body.id);
  await call(f.server, "/api/data/import", "POST", body, b.cookie);
  assert.equal(
    f.server.store.get<{ n: number }>(
      "SELECT count(*) n FROM attempts WHERE owner_id=?",
      b.id,
    )?.n,
    1,
  );
  assert.equal(
    (
      await call(f.server, path + "/history", "GET", undefined, a.cookie)
    ).body.some((v: { draft: Draft }) => v.draft.data.notes.includes("Bob")),
    false,
  );
  const sessions = (
    await call(f.server, "/api/auth/sessions", "GET", undefined, a.cookie)
  ).body;
  await call(
    f.server,
    `/api/auth/sessions/${sessions[0].id}`,
    "DELETE",
    undefined,
    b.cookie,
  );
  assert.equal(
    (await call(f.server, "/api/auth/me", "GET", undefined, a.cookie)).status,
    200,
  );
});
test("real version-one data migrates without changing legacy IDs, hashes, sessions or saved work", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "c-forge-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "legacy.sqlite");
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);",
  );
  db.exec(await readFile("server/migrations/001.sql", "utf8"));
  db.prepare("INSERT INTO migrations VALUES(1,?)").run(
    new Date().toISOString(),
  );
  const stamp = new Date().toISOString();
  const hash = await argon2.hash(password);
  const token = "fictional-legacy-session-token-long-enough";
  db.prepare("INSERT INTO owner VALUES(?,?,?,?)").run(
    "owner",
    "original_owner",
    hash,
    stamp,
  );
  db.prepare("INSERT INTO learner(owner_id,preferences) VALUES(?,?)").run(
    "owner",
    JSON.stringify(defaultPreferences),
  );
  db.prepare("INSERT INTO drafts VALUES(?,?,?,?,?,?)").run(
    "owner",
    exercise.id,
    exercise.version,
    7,
    JSON.stringify(data("Legacy code survives the migration")),
    stamp,
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(
    randomUUID(),
    "owner",
    hashToken(token),
    stamp,
    new Date(Date.now() + 86400000).toISOString(),
  );
  db.close();
  const options = {
    databasePath: path,
    bootstrapSecret: secret,
    exportKey: secret,
    publicRegistration: true,
    serveStatic: false,
  };
  let server = await createApp(options);
  await server.app.ready();
  assert.equal(
    (await call(server, "/api/auth/me", "GET", undefined, "session=" + token))
      .body.id,
    "owner",
  );
  assert.equal(
    (
      await call(
        server,
        `/api/drafts/${exercise.id}`,
        "GET",
        undefined,
        "session=" + token,
      )
    ).body.revision,
    7,
  );
  assert.equal(
    server.store.get<{ password_hash: string }>(
      "SELECT password_hash FROM owner WHERE id='owner'",
    )?.password_hash,
    hash,
  );
  assert.equal(
    server.store.get<{ role: string }>(
      "SELECT role FROM owner WHERE id='owner'",
    )?.role,
    "admin",
  );
  const friend = await register(server, "new_friend");
  assert.notEqual(friend.id, "owner");
  assert.equal(
    (
      await call(
        server,
        `/api/drafts/${exercise.id}`,
        "GET",
        undefined,
        friend.cookie,
      )
    ).body,
    null,
  );
  await server.app.close();
  server = await createApp(options);
  await server.app.ready();
  assert.equal(
    server.store.get<{ n: number }>("SELECT count(*) n FROM migrations")?.n,
    3,
  );
  assert.deepEqual(server.store.all("PRAGMA foreign_key_check"), []);
  assert.equal(
    (
      await call(
        server,
        `/api/drafts/${exercise.id}`,
        "GET",
        undefined,
        "session=" + token,
      )
    ).body.data.notes,
    "Legacy code survives the migration",
  );
  await server.app.close();
});
test("public compiler limits isolate per-account capacity and reject forged client-IP metadata", async (t) => {
  const f = await fixture(t, {
    siteProxySecret: "fictional-proxy-secret-at-least-32-characters",
  });
  const a = await register(f.server, "runner_a");
  const b = await register(f.server, "runner_b");
  await call(
    f.server,
    "/internal/runner/heartbeat",
    "POST",
    {
      workerId: "test-worker",
      available: true,
      detail: "Mocked transport for queue authorization only.",
    },
    undefined,
    { authorization: "Bearer " + secret },
  );
  const payload = () => ({
    exerciseId: exercise.id,
    mode: "run",
    files: exercise.starter,
    stdin: "",
    sanitize: false,
    mutationId: randomUUID(),
  });
  const first = await call(f.server, "/api/jobs", "POST", payload(), a.cookie);
  assert.equal(first.status, 202);
  assert.equal(
    (await call(f.server, "/api/jobs", "POST", payload(), a.cookie)).status,
    202,
  );
  assert.equal(
    (await call(f.server, "/api/jobs", "POST", payload(), a.cookie)).status,
    429,
  );
  assert.equal(
    (await call(f.server, "/api/jobs", "POST", payload(), b.cookie)).status,
    202,
  );
  assert.equal(
    (
      await call(
        f.server,
        `/api/jobs/${first.body.id}/cancel`,
        "POST",
        {},
        b.cookie,
      )
    ).status,
    404,
  );
  const attempts = { username: "wrong_user", password };
  for (let i = 0; i < 12; i++)
    await call(f.server, "/api/auth/login", "POST", attempts, undefined, {
      "x-cforge-client-ip": "203.0.113." + i,
      "x-cforge-proxy-secret": "incorrect",
    });
  assert.equal(
    (
      await call(f.server, "/api/auth/login", "POST", attempts, undefined, {
        "x-cforge-client-ip": "198.51.100.20",
        "x-cforge-proxy-secret": "incorrect",
      })
    ).status,
    429,
  );
});

test("administrator account recovery revokes only the selected learner's sessions and keeps both learners' code", async (t) => {
  const f = await fixture(t);
  const a = await register(f.server, "recovery_alice");
  const b = await register(f.server, "recovery_bob");
  await save(f.server, a.cookie, "Alice retained after recovery");
  await save(f.server, b.cookie, "Bob unaffected by recovery");
  await f.server.app.close();
  const { spawnSync } = await import("node:child_process");
  const replacement = "fictional-new-account-password-only";
  const recovered = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/admin.ts",
      "recover-account",
      "recovery_alice",
    ],
    {
      env: {
        ...process.env,
        DATABASE_PATH: join(f.root, "db.sqlite"),
        DATA_DIR: f.root,
      },
      input: replacement + "\n",
      encoding: "utf8",
    },
  );
  assert.equal(recovered.status, 0);
  assert(!recovered.stdout.includes(replacement));
  await f.reopen();
  assert.equal(
    (await call(f.server, "/api/auth/me", "GET", undefined, a.cookie)).status,
    401,
  );
  assert.equal(
    (await call(f.server, "/api/auth/me", "GET", undefined, b.cookie)).status,
    200,
  );
  const login = await call(f.server, "/api/auth/login", "POST", {
    username: "recovery_alice",
    password: replacement,
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.id, a.id);
  assert.equal(
    (
      await call(
        f.server,
        `/api/drafts/${exercise.id}`,
        "GET",
        undefined,
        login.cookie,
      )
    ).body.data.notes,
    "Alice retained after recovery",
  );
  assert.equal(
    (
      await call(
        f.server,
        `/api/drafts/${exercise.id}`,
        "GET",
        undefined,
        b.cookie,
      )
    ).body.data.notes,
    "Bob unaffected by recovery",
  );
});
