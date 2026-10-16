import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { loadContent } from "../server/content.js";
function command(args: string[], dataDir: string, input = "") {
  return new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        DATA_DIR: dataDir,
      };
      delete environment.NODE_TEST_CONTEXT;
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/admin.ts", ...args],
        {
          env: environment,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (d) => (output += d.toString()));
      child.stderr.on("data", (d) => (output += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
      child.stdin.end(input);
    },
  );
}
test("documented backup, restore, and owner recovery commands retain work and invalidate old sessions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "c-forge-operations-")),
    source = join(directory, "source"),
    destination = join(directory, "restored"),
    backup = join(directory, "backup");
  const opts = {
    bootstrapSecret: "operations-bootstrap-test-only",
    exportKey: "operations-export-key-test-only",
    serveStatic: false,
  };
  const content = loadContent(),
    exercise = content.exercises[0];
  const sourceApp = await createApp({
    ...opts,
    databasePath: join(source, "c-forge.sqlite"),
  });
  let restored: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    writeFileSync(join(source, "bootstrap-secret"), opts.bootstrapSecret, {
      mode: 0o600,
    });
    writeFileSync(join(source, "export-key"), opts.exportKey, { mode: 0o600 });
    const credentials = {
      username: "operations-owner",
      password: "old-operations-password-only",
    };
    const setup = await sourceApp.app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { ...credentials, bootstrapSecret: opts.bootstrapSecret },
    });
    assert.equal(setup.statusCode, 200);
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const data = {
      files: exercise.starter,
      activeFile: Object.keys(exercise.starter)[0],
      stdin: "kept input",
      notes: "Retain this note through a consistent WAL backup.",
      bookmark: true,
      step: 2,
      cursor: { anchor: 0, head: 0 },
      scrollAnchor: 18,
      paneSize: 47,
    };
    assert.equal(
      (
        await sourceApp.app.inject({
          method: "PUT",
          url: `/api/drafts/${exercise.id}`,
          headers: { cookie },
          payload: {
            data,
            contentVersion: exercise.version,
            revision: 0,
            mutationId: randomUUID(),
          },
        })
      ).statusCode,
      200,
    );
    const copied = await command(["backup", backup], source);
    assert.equal(copied.code, 0, copied.output);
    assert.equal(
      readFileSync(join(backup, "export-key"), "utf8"),
      opts.exportKey,
    );
    await sourceApp.app.close();
    const restoredCommand = await command(["restore", backup], destination);
    assert.equal(restoredCommand.code, 0, restoredCommand.output);
    restored = await createApp({
      ...opts,
      databasePath: join(destination, "c-forge.sqlite"),
    });
    const login = await restored.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials,
    });
    assert.equal(login.statusCode, 200);
    const restoredCookie = String(login.headers["set-cookie"]).split(";")[0];
    const saved = await restored.app.inject({
      method: "GET",
      url: `/api/drafts/${exercise.id}`,
      headers: { cookie: restoredCookie },
    });
    assert.deepEqual(saved.json().data, data);
    await restored.app.close();
    restored = undefined;
    const recovery = await command(
      ["recover-owner"],
      destination,
      "new-operations-password-only",
    );
    assert.equal(recovery.code, 0, recovery.output);
    restored = await createApp({
      ...opts,
      databasePath: join(destination, "c-forge.sqlite"),
    });
    assert.equal(
      (
        await restored.app.inject({
          method: "GET",
          url: "/api/state",
          headers: { cookie: restoredCookie },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await restored.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: credentials,
        })
      ).statusCode,
      401,
    );
    const newLogin = await restored.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { ...credentials, password: "new-operations-password-only" },
    });
    assert.equal(newLogin.statusCode, 200);
    const newCookie = String(newLogin.headers["set-cookie"]).split(";")[0];
    const resumed = await restored.app.inject({
      method: "GET",
      url: `/api/drafts/${exercise.id}`,
      headers: { cookie: newCookie },
    });
    assert.deepEqual(resumed.json().data, data);
  } finally {
    await restored?.app.close();
    try {
      await sourceApp.app.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
