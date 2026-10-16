import { DatabaseSync, backup } from "node:sqlite";
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve, join } from "node:path";
import argon2 from "argon2";
const [command, arg, ...flags] = process.argv.slice(2),
  dataDir = resolve(process.env.DATA_DIR ?? ".data"),
  database = process.env.DATABASE_PATH ?? join(dataDir, "c-forge.sqlite");
if (command === "backup") {
  if (!arg)
    throw new Error("Usage: npm run backup -- /absolute/backup-directory");
  const destination = resolve(arg);
  if (existsSync(join(destination, "database.sqlite")))
    throw new Error(
      "Backup destination already contains a database. Choose a new directory.",
    );
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(database, { readOnly: true });
  await backup(db, join(destination, "database.sqlite"));
  db.close();
  chmodSync(join(destination, "database.sqlite"), 0o600);
  const copy = new DatabaseSync(join(destination, "database.sqlite"), {
    readOnly: true,
  });
  if (copy.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
    throw new Error("Backup integrity check failed.");
  copy.close();
  for (const name of ["bootstrap-secret", "export-key"])
    if (existsSync(join(dataDir, name))) {
      copyFileSync(join(dataDir, name), join(destination, name));
      chmodSync(join(destination, name), 0o600);
    }
  writeFileSync(
    join(destination, "manifest.json"),
    JSON.stringify(
      {
        format: "c-forge-server-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        note: "Includes all learner data, password/session hashes. Protect this directory. Runner image is reproducibly built separately.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `Consistent SQLite backup verified in ${destination}. Protect the backup; it contains account hashes.`,
  );
} else if (command === "restore") {
  if (!arg)
    throw new Error(
      "Usage: node --import tsx scripts/admin.ts restore /backup-directory [--replace]. Stop the API and worker first.",
    );
  const source = resolve(arg);
  const manifest = JSON.parse(
    readFileSync(join(source, "manifest.json"), "utf8"),
  );
  if (manifest.format !== "c-forge-server-backup" || manifest.version !== 1)
    throw new Error("Unsupported backup format.");
  const db = new DatabaseSync(join(source, "database.sqlite"), {
    readOnly: true,
  });
  if (
    db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
    !db.prepare("SELECT version FROM migrations WHERE version=1").get()
  )
    throw new Error("Backup database is invalid.");
  db.close();
  if (existsSync(database) && !flags.includes("--replace"))
    throw new Error(
      "Database exists. Stop the application, make a backup, and explicitly pass --replace.",
    );
  if (existsSync(`${database}-wal`) || existsSync(`${database}-shm`))
    throw new Error(
      "WAL or SHM files exist. Cleanly stop the API and checkpoint the database before restoring. Never overwrite a live database.",
    );
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  copyFileSync(join(source, "database.sqlite"), `${database}.restoring`);
  chmodSync(`${database}.restoring`, 0o600);
  renameSync(`${database}.restoring`, database);
  for (const name of ["bootstrap-secret", "export-key"])
    if (existsSync(join(source, name))) {
      copyFileSync(join(source, name), join(dataDir, name));
      chmodSync(join(dataDir, name), 0o600);
    }
  console.log(
    "Server database and available persistent keys restored. Start the API, then the worker.",
  );
} else if (command === "recover-owner" || command === "recover-account") {
  let password = "";
  for await (const part of process.stdin) password += part;
  password = password.replace(/\r?\n$/, "");
  if (password.length < 12 || password.length > 128)
    throw new Error(
      "Supply a 12–128 character replacement password through stdin. Stop the service first.",
    );
  const db = new DatabaseSync(database);
  const user =
    command === "recover-owner"
      ? db.prepare("SELECT id FROM owner WHERE id='owner'").get()
      : db
          .prepare("SELECT id FROM owner WHERE username=? COLLATE NOCASE")
          .get(arg ?? "");
  if (!user) throw new Error("No matching account to recover.");
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE owner SET password_hash=? WHERE id=?").run(
      hash,
      user.id as string,
    );
    db.prepare("DELETE FROM sessions WHERE owner_id=?").run(user.id as string);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  db.close();
  console.log(
    "Selected account password replaced and its sessions revoked. Existing code and progress are preserved.",
  );
} else
  throw new Error(
    "Commands: backup DIRECTORY, restore DIRECTORY [--replace], recover-owner or recover-account USERNAME (password via stdin).",
  );
