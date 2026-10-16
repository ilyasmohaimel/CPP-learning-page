import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { defaultPreferences } from "../shared/app";

test("profiles remain private, survive restart, reject unsafe pictures and preserve revision checks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "c-forge-profile-"));
  const options = {
    databasePath: join(directory, "profile.sqlite"),
    bootstrapSecret: "profile-bootstrap-secret-only",
    exportKey: "profile-export-secret-only",
    publicRegistration: true,
    serveStatic: false,
  };
  let server = await createApp(options);
  t.after(async () => {
    await server.app.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function register(username: string) {
    const result = await server.app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { host: "forge.test" },
      payload: { username, password: "fictional-profile-test-password" },
    });
    assert.equal(result.statusCode, 200);
    return {
      id: result.json().id as string,
      cookie: String(result.headers["set-cookie"]).split(";")[0],
    };
  }
  const first = await register("profile-first"),
    second = await register("profile-second");
  const picture = `data:image/png;base64,${(await readFile("public/icons/forge-192.png")).toString("base64")}`;
  function state(account: typeof first) {
    return server.app.inject({
      url: "/api/state",
      headers: {
        host: "forge.test",
        cookie: account.cookie,
        "x-cforge-account-id": account.id,
      },
    });
  }
  function save(revision: number, profile: object) {
    return server.app.inject({
      method: "POST",
      url: "/api/preferences",
      headers: {
        host: "forge.test",
        cookie: first.cookie,
        "x-cforge-account-id": first.id,
      },
      payload: { revision, preferences: { ...defaultPreferences, ...profile } },
    });
  }
  assert.equal(
    (
      await save(0, {
        displayName: "  Workshop learner  ",
        avatarDataUrl: picture,
      })
    ).statusCode,
    200,
  );
  let saved = (await state(first)).json();
  assert.equal(saved.preferences.displayName, "Workshop learner");
  assert.equal(saved.preferences.avatarDataUrl, picture);
  assert.equal(
    (await state(second)).json().preferences.avatarDataUrl,
    undefined,
  );
  assert.equal((await state(second)).json().preferences.displayName, undefined);
  assert.equal(
    (await save(0, { displayName: "Stale profile", avatarDataUrl: null }))
      .statusCode,
    409,
  );
  for (const avatarDataUrl of [
    "https://example.com/photo.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,ZmFrZQ==",
    `data:image/png;base64,${"A".repeat(65536)}`,
  ]) {
    assert.equal((await save(1, { avatarDataUrl })).statusCode, 400);
  }
  assert.equal(
    (await save(1, { displayName: "x".repeat(61) })).statusCode,
    400,
  );
  const anonymous = await server.app.inject({ url: "/api/state" });
  assert.equal(anonymous.statusCode, 401);
  const forged = await server.app.inject({
    url: "/api/state",
    headers: {
      host: "forge.test",
      cookie: first.cookie,
      "x-cforge-account-id": second.id,
    },
  });
  assert.equal(forged.statusCode, 401);
  await server.app.close();
  server = await createApp(options);
  saved = (await state(first)).json();
  assert.equal(saved.preferences.displayName, "Workshop learner");
  assert.equal(saved.preferences.avatarDataUrl, picture);
  assert.equal(
    (await save(1, { displayName: "", avatarDataUrl: null })).statusCode,
    200,
  );
  saved = (await state(first)).json();
  assert.equal(saved.preferences.avatarDataUrl, null);
  assert.equal(saved.preferences.displayName, "");
  assert.equal(
    (
      await server.app.inject({
        url: "/api/auth/me",
        headers: { cookie: first.cookie },
      })
    ).json().username,
    "profile-first",
  );
});
