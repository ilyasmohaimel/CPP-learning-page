import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
export class Store {
  db: DatabaseSync;
  constructor(public path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
    this.migrate();
  }
  migrate() {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    for (const version of [1, 2, 3]) {
      if (this.get("SELECT version FROM migrations WHERE version=?", version))
        continue;
      if (version === 2) this.db.exec("PRAGMA foreign_keys=OFF");
      try {
        this.transaction(() => {
          this.db.exec(
            readFileSync(
              resolve(
                `server/migrations/${String(version).padStart(3, "0")}.sql`,
              ),
              "utf8",
            ),
          );
          if (this.all("PRAGMA foreign_key_check").length)
            throw new Error("Migration would break account data references.");
          this.run(
            "INSERT INTO migrations VALUES (?,?)",
            version,
            new Date().toISOString(),
          );
        });
      } finally {
        if (version === 2) this.db.exec("PRAGMA foreign_keys=ON");
      }
    }
  }

  get<T = Record<string, unknown>>(
    sql: string,
    ...params: SQLInputValue[]
  ): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T = Record<string, unknown>>(
    sql: string,
    ...params: SQLInputValue[]
  ): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
