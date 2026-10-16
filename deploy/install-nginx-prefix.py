"""Add only the C Forge location to the existing TLS8445 server; validate/rollback."""
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

if os.geteuid() != 0:
    raise SystemExit('Administrator identity required.')
configuration = subprocess.run(['nginx', '-T'], check=True, capture_output=True, text=True).stdout
current = None
owners = set()
for line in configuration.splitlines():
    file_match = re.match(r'# configuration file (/.+):$', line)
    if file_match:
        current = Path(file_match.group(1)).resolve()
    elif re.match(r'\s*listen\s+8445(?:\s|;)', line) and current is not None:
        owners.add(current)
if len(owners) != 1:
    raise SystemExit('Expected one existing configuration file owning TLS8445; preserving the gateway.')
site = owners.pop()
if not site.is_file() or not site.is_relative_to('/etc/nginx'):
    raise SystemExit('The existing listener must use a regular file under /etc/nginx.')
snippet = Path('/etc/nginx/snippets/c-forge-location.conf')
text = site.read_text()
lines = text.splitlines(keepends=True)
matches = [i for i, line in enumerate(lines) if re.match(r'\s*listen\s+8445(?:\s|;)', line)]
if len(matches) != 1:
    raise SystemExit('Expected exactly one existing IPv4 TLS8445 listener; preserving the gateway.')
include = '    include /etc/nginx/snippets/c-forge-location.conf;\n'
if include.strip() not in text:
    lines.insert(matches[0] + 1, include)
previous = snippet.read_bytes() if snippet.exists() else None
snippet.parent.mkdir(parents=True, exist_ok=True)
snippet.write_text('''# C Forge own prefix only; all other existing locations remain in their server.
location = /forge { return 308 /forge/; }
location = /forge/internal { return 404; }
location ^~ /forge/internal/ { return 404; }
location ^~ /forge/ {
    proxy_pass http://127.0.0.1:3030/;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 4m;
}
''')
with tempfile.NamedTemporaryFile(dir=site.parent, delete=False) as f:
    staged = Path(f.name)
    f.write(''.join(lines).encode())
os.chmod(staged, 0o644)
backup = site.with_name(site.name + '.pre-cforge-backup')
if not backup.exists():
    shutil.copy2(site, backup)
original = site.read_bytes()
os.replace(staged, site)
try:
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except BaseException:
    site.write_bytes(original)
    if previous is None:
        snippet.unlink(missing_ok=True)
    else:
        snippet.write_bytes(previous)
    subprocess.run(['nginx', '-t'], check=False)
    raise
print('Added /forge/ to existing TLS8445 gateway; other locations and certificate renewal unchanged.')
