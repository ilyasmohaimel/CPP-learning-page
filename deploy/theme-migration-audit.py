"""Admin-only expected-delta audit: permits only the untouched-theme migration."""
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

recording = sys.argv[1] == "record"
with sqlite3.connect('file:/srv/apps/c-forge/data/c-forge.sqlite?mode=ro', uri=True) as db:
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'migrations'")]
    fingerprints = {}
    count = 0
    for table in tables:
        if not re.fullmatch(r'[a-z_]+', table):
            raise RuntimeError('Unexpected table name.')
        columns = [r[1] for r in db.execute('PRAGMA table_info("' + table + '")')]
        rows = [list(r) for r in db.execute('SELECT * FROM "' + table + '"')]
        if table == 'learner' and recording:
            p, revision = columns.index('preferences'), columns.index('preferences_revision')
            for row in rows:
                if row[revision] == 0 and json.loads(row[p]).get('theme') == 'dark':
                    row[p] = db.execute("SELECT json_set(?, '$.theme', 'light')", (row[p],)).fetchone()[0]
                    row[revision] += 1
                    count += 1
        encoded = sorted(json.dumps(r, ensure_ascii=True, separators=(',', ':')) for r in rows)
        fingerprints[table] = {'count': len(rows), 'sha256': hashlib.sha256('\n'.join(encoded).encode()).hexdigest()}
    if recording:
        target = Path(sys.argv[2])
        target.write_text(json.dumps({'fingerprints': fingerprints, 'untouchedDefaults': count}))
        target.chmod(0o600)
    else:
        expected = json.loads(Path(sys.argv[2]).read_text())
        if fingerprints != expected['fingerprints']:
            raise RuntimeError('Unexpected learner-data change; preserve the backup and investigate.')
        if db.execute('PRAGMA foreign_key_check').fetchall() or not db.execute('SELECT version FROM migrations WHERE version=3').fetchone():
            raise RuntimeError('Migration/foreign-key verification failed.')
        print(json.dumps({'migration': 3, 'updatedUntouchedDefaults': expected['untouchedDefaults'], 'explicitChoicesAndAllOtherDataUnchanged': True, 'foreignKeysValid': True}))
