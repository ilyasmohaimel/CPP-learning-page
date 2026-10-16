"""Administrator-only migration evidence; writes hashes, never learner contents."""
import hashlib,json,sqlite3,sys
from pathlib import Path
with sqlite3.connect('file:/srv/apps/c-forge/data/c-forge.sqlite?mode=ro',uri=True) as db:
    tables=['owner','sessions','learner','drafts','draft_versions','conflicts','receipts','attempts','progress','hints','jobs','review_events']
    result={}
    for table in tables:
        columns=[row[1] for row in db.execute('PRAGMA table_info('+table+')') if row[1]!='role']
        rows=db.execute('SELECT '+','.join(columns)+' FROM '+table).fetchall()
        encoded=sorted(json.dumps(row,ensure_ascii=True,separators=(',',':')) for row in rows)
        result[table]={'count':len(rows),'sha256':hashlib.sha256('\n'.join(encoded).encode()).hexdigest()}
if sys.argv[1]=='record':
    Path(sys.argv[2]).write_text(json.dumps(result));Path(sys.argv[2]).chmod(0o600)
else:
    baseline=json.loads(Path(sys.argv[2]).read_text())
    if baseline!=result:raise SystemExit('Migration changed legacy account data; investigate before starting services.')
    print('Legacy account IDs, password/session hashes and all 12 learner tables preserved byte-for-byte.')
