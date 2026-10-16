import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { loadCourses } from "../server/content";
import { defaultPreferences, type LearnerState } from "../shared/app";
import { validateRequest } from "../runner/validation";

const runnerSecret = "course-tests-private-worker-credential-only";
test("C and C++ have complete distinct registries with private assessment material", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "c-forge-courses-"));
  const options = {
    databasePath: join(directory, "test.sqlite"),
    bootstrapSecret: "course-test-bootstrap-only",
    exportKey: "course-test-export-key-only",
    runnerSecret,
    serveStatic: false,
  };
  let server = await createApp(options);
  t.after(async () => {
    await server.app.close();
    await rm(directory, { recursive: true, force: true });
  });
  let cookie = "";
  async function call(
    path: string,
    method: "GET" | "POST" | "PUT" = "GET",
    payload?: unknown,
    worker = false,
  ) {
    return server.app.inject({
      url: path,
      method,
      headers: {
        host: "forge.test",
        ...(cookie ? { cookie } : {}),
        ...(worker ? { authorization: `Bearer ${runnerSecret}` } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  }
  const setup = await call("/api/auth/setup", "POST", {
    bootstrapSecret: options.bootstrapSecret,
    username: "course_learner",
    password: "fictional-course-password-only",
  });
  assert.equal(setup.statusCode, 200);
  cookie = String(setup.headers["set-cookie"]).split(";")[0];
  const courses = loadCourses();
  for (const c of courses) {
    assert.equal(c.lessons.length, 48);
    assert.equal(c.exercises.length, 105);
    assert.equal(c.projects.length, 3);
    assert.equal(c.lessons.filter((l) => l.checkpoint).length, 12);
    const map = await call(`/api/course?course=${c.course.id}`);
    assert.equal(map.statusCode, 200);
    assert.equal(map.json().course.id, c.course.id);
    const publicLesson = (await call(`/api/lessons/${c.lessons[0].id}`)).json();
    assert(!("answer" in publicLesson.lesson.prediction));
    for (const exercise of publicLesson.exercises) {
      for (const key of ["tests", "solution", "hints", "explanation"])
        assert(!(key in exercise));
    }
    const refs = (await call(`/api/reference?course=${c.course.id}`)).json();
    assert(
      refs.every((ref: { lessonId: string }) =>
        c.lessons.some((l) => l.id === ref.lessonId),
      ),
    );
    for (const p of c.projects) {
      const result = (await call(`/api/projects/${p.id}`)).json();
      assert(!("reference" in result));
      assert(!("checks" in result));
    }
  }
  assert.equal((await call("/api/course?course=python")).statusCode, 404);
  // Save both languages, then restore their exact independent resume positions.
  for (const c of courses) {
    const e = c.exercises[0];
    const files = { ...e.starter };
    const activeFile = Object.keys(files)[0];
    files[activeFile] += `\n// private ${c.course.id} draft\n`;
    const data = {
      files,
      activeFile,
      stdin: "",
      step: c.course.id === "c17" ? 1 : 2,
      cursor: { anchor: 0, head: 0 },
      scrollAnchor: 0,
      paneSize: 46,
      notes: c.course.id,
      bookmark: true,
    };
    const saved = await call(`/api/drafts/${e.id}`, "PUT", {
      revision: 0,
      contentVersion: e.version,
      mutationId: randomUUID(),
      data,
    });
    assert.equal(saved.statusCode, 200, saved.body);
  }
  const pref = await call("/api/preferences", "POST", {
    revision: 0,
    preferences: { ...defaultPreferences, theme: "dark", courseId: "cpp20" },
  });
  assert.equal(pref.statusCode, 200);
  await server.app.close();
  server = await createApp(options);
  const state = (await call("/api/state")).json<LearnerState>();
  assert.equal(state.preferences.courseId, "cpp20");
  assert.equal(state.preferences.theme, "dark");
  assert.equal(state.courseResumes?.c17?.step, 1);
  assert.equal(state.courseResumes?.cpp20?.step, 2);
  for (const c of courses) {
    const saved = (await call(`/api/drafts/${c.exercises[0].id}`)).json();
    assert.equal(saved.data.notes, c.course.id);
    assert(
      saved.data.files[saved.data.activeFile].includes(
        `private ${c.course.id}`,
      ),
    );
  }
  // A legacy C-only heartbeat cannot advertise working C++ execution.
  await call(
    "/internal/runner/heartbeat",
    "POST",
    { workerId: "course-worker", available: true, detail: "C17 verified" },
    true,
  );
  assert.equal(
    (await call("/api/runner?course=cpp20")).json().available,
    false,
  );
  const cppExercise = courses[1].exercises[0];
  const submission = {
    exerciseId: cppExercise.id,
    mode: "check",
    files: cppExercise.starter,
    stdin: "",
    sanitize: false,
    mutationId: randomUUID(),
  };
  assert.equal((await call("/api/jobs", "POST", submission)).statusCode, 503);
  assert.equal(
    server.store.get<{ n: number }>("SELECT count(*) AS n FROM attempts")!.n,
    0,
  );
  await call(
    "/internal/runner/heartbeat",
    "POST",
    {
      workerId: "course-worker",
      available: true,
      detail: "C17 / C++20 verified",
    },
    true,
  );
  const queued = await call("/api/jobs", "POST", submission);
  assert.equal(queued.statusCode, 202, queued.body);
  const lease = (
    await call(
      "/internal/runner/lease",
      "POST",
      { workerId: "course-worker" },
      true,
    )
  ).json();
  assert.equal(lease.job.request.language, "cpp");
  assert.deepEqual(lease.job.request.cases, cppExercise.tests);
  const forged = await call("/api/jobs", "POST", {
    ...submission,
    mutationId: randomUUID(),
    language: "c",
  });
  assert.equal(forged.statusCode, 400);
  const mismatched = await call("/api/jobs", "POST", {
    ...submission,
    mutationId: randomUUID(),
    files: { "main.c": "int main(void) {}" },
  });
  assert.equal(mismatched.statusCode, 400);
  const conceptual = courses[1].exercises[1];
  const check = (
    await call("/api/jobs", "POST", {
      exerciseId: conceptual.id,
      mode: "check",
      files: conceptual.starter,
      answer: conceptual.tests[0].expected,
      stdin: "",
      sanitize: false,
      mutationId: randomUUID(),
    })
  ).json();
  assert.equal(check.result.passed, true);
  const exportResponse = await call("/api/data/export");
  assert.equal(exportResponse.statusCode, 200);
  const exported = exportResponse.json();
  assert.equal(exported.data.preferences.courseId, "cpp20");
  assert.equal(exported.data.drafts.length, 2);
});

test("C++ source validation preserves traversal, language, size and harness restrictions", () => {
  const valid = {
    language: "cpp",
    files: { "main.cpp": "int main() {}", "types.hpp": "#pragma once" },
    stdin: "",
    sanitize: false,
  };
  validateRequest(valid);
  for (const name of [
    "../main.cpp",
    "a/main.cpp",
    "-flag.cpp",
    "__forge_harness.cpp",
    "main.c",
    "main.py",
  ]) {
    assert.throws(() =>
      validateRequest({ ...valid, files: { [name]: "int main() {}" } }),
    );
  }
  assert.throws(() => validateRequest({ ...valid, language: "python" }));
  assert.throws(() =>
    validateRequest({ ...valid, files: { "main.cpp": "x".repeat(131073) } }),
  );
  assert.throws(() => validateRequest({ ...valid, language: "c" }));
});
