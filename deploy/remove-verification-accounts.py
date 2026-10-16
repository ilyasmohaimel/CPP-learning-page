"""Admin-only fixture cleanup: explicit UUID/name pairs, never a database restore.

Take a consistent server backup first. Pass database path and fixture JSON path.
No password/session/source content is written to output.
"""
import hashlib
import json
import re
import sqlite3
import sys
import uuid
from pathlib import Path

fixtures = json.loads(Path(sys.argv[2]).read_text())
if not isinstance(fixtures, list) or not 1 <= len(fixtures) <= 10:
    raise SystemExit("Invalid fixture count; nothing changed.")
for item in fixtures:
    if set(item) != {"id", "username"}:
        raise SystemExit("Invalid fixture fields; nothing changed.")
    if str(uuid.UUID(item["id"])) != item["id"] or not re.fullmatch(
        r"cf_verify_[a-z0-9]+_[ab]", item["username"]
    ):
        raise SystemExit("Refusing non-verification account; nothing changed.")
ids = [item["id"] for item in fixtures]
if len(set(ids)) != len(ids):
    raise SystemExit("Repeated fixture IDs; nothing changed.")
with sqlite3.connect(sys.argv[1], timeout=15) as db:
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("BEGIN IMMEDIATE")
    tables = [row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )]
    if not all(re.fullmatch(r"[a-z_]+", table) for table in tables):
        raise RuntimeError("Unexpected table names; nothing changed.")
    columns = {table: [row[1] for row in db.execute('PRAGMA table_info("' + table + '")')]
               for table in tables}
    placeholders = ",".join("?" for _ in ids)

    def retained_fingerprints():
        result = {}
        for table in tables:
            scope = "id" if table == "owner" else "owner_id" if "owner_id" in columns[table] else None
            sql = 'SELECT * FROM "' + table + '"'
            if scope:
                sql += ' WHERE "' + scope + '" NOT IN (' + placeholders + ')'
            rows = db.execute(sql, ids if scope else []).fetchall()
            encoded = sorted(json.dumps(row, ensure_ascii=True, separators=(",", ":")) for row in rows)
            result[table] = hashlib.sha256("\n".join(encoded).encode()).hexdigest()
        return result

    for item in fixtures:
        account = db.execute("SELECT username,role FROM owner WHERE id=?", (item["id"],)).fetchone()
        if account != (item["username"], "learner"):
            raise RuntimeError("Fixture identity or role mismatch; nothing changed.")
        active = db.execute(
            "SELECT count(*) FROM jobs WHERE owner_id=? AND state IN ('queued','compiling','running')",
            (item["id"],)
        ).fetchone()[0]
        if active:
            raise RuntimeError("Fixture has an active job; nothing changed.")
    before = retained_fingerprints()
    for table in tables:
        if "owner_id" in columns[table]:
            db.execute('DELETE FROM "' + table + '" WHERE owner_id IN (' + placeholders + ')', ids)
    db.execute('DELETE FROM owner WHERE id IN (' + placeholders + ')', ids)
    if db.execute("PRAGMA foreign_key_check").fetchall() or before != retained_fingerprints():
        raise RuntimeError("Integrity/preservation verification failed; transaction rolled back.")
    print(json.dumps({"removedVerifiedFixtures": len(fixtures), "retainedRowsUnchanged": True,
                      "foreignKeysValid": True, "databaseRestored": False}))
