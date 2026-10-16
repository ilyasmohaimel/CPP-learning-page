/** Administrator-invoked online backup; never exposed through HTTP. */
import { DatabaseSync, backup } from "node:sqlite";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const data = resolve(process.env.DATA_DIR ?? ".data");
const root = resolve(
  process.env.CFORGE_BACKUP_ROOT ?? join(data, "backups", "daily"),
);
mkdirSync(root, { recursive: true, mode: 0o700 });
if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())
  throw new Error("Backup root must be a real protected directory.");
chmodSync(root, 0o700);
const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const destination = join(root, `daily-${day}`);
if (existsSync(destination)) {
  if (
    !lstatSync(destination).isDirectory() ||
    lstatSync(destination).isSymbolicLink()
  )
    throw new Error(
      "Today's backup path is not a regular directory; preserved without changes.",
    );
  const manifest = JSON.parse(
    readFileSync(join(destination, "manifest.json"), "utf8"),
  ) as { format?: string; version?: number };
  if (manifest.format !== "c-forge-server-backup" || manifest.version !== 1)
    throw new Error(
      "Today's backup is not a recognized immutable snapshot; preserved without changes.",
    );
  const previous = new DatabaseSync(join(destination, "database.sqlite"), {
    readOnly: true,
  });
  try {
    if (
      previous.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
    )
      throw new Error(
        "Today's backup failed integrity verification; preserved without changes.",
      );
  } finally {
    previous.close();
  }
  console.log(
    "Today's verified immutable backup already exists; no duplicate backup was created.",
  );
  process.exit(0);
}
const sourcePath = process.env.DATABASE_PATH ?? join(data, "c-forge.sqlite");
const databaseBytes =
  BigInt(lstatSync(sourcePath).size) +
  (existsSync(`${sourcePath}-wal`)
    ? BigInt(lstatSync(`${sourcePath}-wal`).size)
    : 0n);
const space = statfsSync(root, { bigint: true });
if (space.bavail * space.bsize < 1073741824n + databaseBytes * 2n)
  throw new Error(
    "Not enough free space for a consistent backup and 1 GiB reserve; existing backups preserved.",
  );
mkdirSync(destination, { mode: 0o700 });
const source = new DatabaseSync(sourcePath, { readOnly: true });
try {
  await backup(source, join(destination, "database.sqlite"));
} finally {
  source.close();
}
chmodSync(join(destination, "database.sqlite"), 0o600);
const checked = new DatabaseSync(join(destination, "database.sqlite"), {
  readOnly: true,
});
try {
  if (checked.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
    throw new Error(
      "New backup failed SQLite integrity verification; retention was not run.",
    );
} finally {
  checked.close();
}
for (const name of ["bootstrap-secret", "export-key"])
  if (existsSync(join(data, name))) {
    copyFileSync(join(data, name), join(destination, name));
    chmodSync(join(destination, name), 0o600);
  }
writeFileSync(
  join(destination, "manifest.json"),
  JSON.stringify({
    format: "c-forge-server-backup",
    version: 1,
    createdAt: new Date().toISOString(),
  }),
  { mode: 0o600, flag: "wx" },
);
// Retention only examines this script's exact names and valid manifests. It
// keeps fourteen recent daily snapshots plus one snapshot per six months.
const candidates = readdirSync(root)
  .filter((name) => /^daily-\d{8}$/.test(name))
  .filter((name) => {
    const path = join(root, name);
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
      return false;
    try {
      const manifest: unknown = JSON.parse(
        readFileSync(join(path, "manifest.json"), "utf8"),
      );
      return (
        typeof manifest === "object" &&
        manifest !== null &&
        "format" in manifest &&
        manifest.format === "c-forge-server-backup" &&
        "version" in manifest &&
        manifest.version === 1
      );
    } catch {
      return false;
    }
  })
  .sort()
  .reverse();
const keep = new Set(candidates.slice(0, 14));
const months = new Set<string>();
for (const name of candidates) {
  const month = name.slice(6, 12);
  if (!months.has(month) && months.size < 6) {
    months.add(month);
    keep.add(name);
  }
}
let removed = 0;
for (const name of candidates)
  if (!keep.has(name)) {
    rmSync(join(root, name), { recursive: true });
    removed++;
  }
console.log(
  `Online SQLite backup verified; ${keep.size} daily/monthly restore points retained; ${removed} superseded snapshots removed.`,
);
