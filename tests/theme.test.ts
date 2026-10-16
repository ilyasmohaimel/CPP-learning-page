import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { Store } from "../server/db";
import { defaultPreferences } from "../shared/app";

test("light-default migration changes only untouched old defaults; explicit choices, identity and drafts survive and migration is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "c-forge-theme-"));
  const file = join(root, "learner.sqlite");
  try {
    const db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)",
    );
    for (const version of [1, 2]) {
      db.exec(readFileSync(`server/migrations/00${version}.sql`, "utf8"));
      db.prepare("INSERT INTO migrations VALUES(?,?)").run(
        version,
        "2026-10-14",
      );
    }
    const cases = [
      { id: "untouched", theme: "dark", revision: 0 },
      { id: "chosen-dark", theme: "dark", revision: 1 },
      { id: "chosen-system", theme: "system", revision: 2 },
      { id: "chosen-light", theme: "light", revision: 3 },
    ];
    for (const c of cases) {
      db.prepare("INSERT INTO owner VALUES(?,?,?,?,?)").run(
        c.id,
        c.id,
        "retained-hash-" + c.id,
        "2026-10-14",
        "learner",
      );
      db.prepare(
        "INSERT INTO learner(owner_id,preferences,preferences_revision,resume) VALUES(?,?,?,?)",
      ).run(
        c.id,
        JSON.stringify({
          ...defaultPreferences,
          theme: c.theme,
          proseSize: 22,
        }),
        c.revision,
        '{"lessonId":"retained"}',
      );
      db.prepare("INSERT INTO drafts VALUES(?,?,?,?,?,?)").run(
        c.id,
        "retained-exercise",
        1,
        7,
        '{"files":{"main.c":"private retained source"}}',
        "2026-10-14",
      );
    }
    const ownerBefore = db.prepare("SELECT * FROM owner ORDER BY id").all();
    const draftsBefore = db
      .prepare("SELECT * FROM drafts ORDER BY owner_id")
      .all();
    db.close();
    let store = new Store(file);
    assert.equal(defaultPreferences.theme, "light");
    for (const c of cases) {
      const row = store.get<{
        preferences: string;
        preferences_revision: number;
        resume: string;
      }>("SELECT * FROM learner WHERE owner_id=?", c.id)!;
      assert.deepEqual(JSON.parse(row.preferences), {
        ...defaultPreferences,
        theme: c.revision === 0 ? "light" : c.theme,
        proseSize: 22,
      });
      assert.equal(row.preferences_revision, c.revision === 0 ? 1 : c.revision);
      assert.equal(row.resume, '{"lessonId":"retained"}');
    }
    assert.deepEqual(store.all("SELECT * FROM owner ORDER BY id"), ownerBefore);
    assert.deepEqual(
      store.all("SELECT * FROM drafts ORDER BY owner_id"),
      draftsBefore,
    );
    assert.deepEqual(store.all("PRAGMA foreign_key_check"), []);
    const once = store.all("SELECT * FROM learner ORDER BY owner_id");
    store.close();
    store = new Store(file);
    assert.deepEqual(
      store.all("SELECT * FROM learner ORDER BY owner_id"),
      once,
    );
    assert.equal(
      store.get<{ n: number }>("SELECT count(*) n FROM migrations")!.n,
      3,
    );
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("actual pre-render theme script defaults to light, respects explicit cached choices, validates storage and scopes portable paths", () => {
  const source = readFileSync("public/theme-init.js", "utf8");
  for (const c of [
    { cached: null, darkOS: true, result: "light" },
    { cached: "dark", darkOS: false, result: "dark" },
    { cached: "light", darkOS: true, result: "light" },
    { cached: "system", darkOS: true, result: "dark" },
    { cached: "system", darkOS: false, result: "light" },
    { cached: "invalid", darkOS: true, result: "light" },
    { cached: "dark", darkOS: true, result: "light", blocked: true },
  ]) {
    for (const base of ["/", "/forge/"]) {
      const dataset: { theme?: string } = {};
      let chrome = "";
      runInNewContext(source, {
        URL,
        document: {
          currentScript: {
            src: "https://forge.example" + base + "theme-init.js",
          },
          documentElement: { dataset },
          querySelector: () => ({
            setAttribute: (_name: string, value: string) => {
              chrome = value;
            },
          }),
        },
        localStorage: {
          getItem: (key: string) => {
            assert.equal(key, "c-forge-theme:v1:" + base);
            if (c.blocked) throw Error("Storage blocked");
            return c.cached;
          },
        },
        window: { matchMedia: () => ({ matches: c.darkOS }) },
      });
      assert.equal(dataset.theme, c.result);
      assert.equal(chrome, c.result === "dark" ? "#1c1d22" : "#f5f4ef");
    }
  }
});
