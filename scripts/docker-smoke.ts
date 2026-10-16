/** Production packaging check. Uses only disposable, uniquely named test volumes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadContent } from "../server/content.js";
import type { Draft, DraftData } from "../shared/app.js";

const image = process.env.CFORGE_DOCKER_IMAGE ?? "c-forge:cloud-verified";
const prefix = `c-forge-smoke-${randomUUID().slice(0, 8)}`;
const source = `${prefix}-source`,
  restored = `${prefix}-restored`;
const sourceVolume = `${prefix}-data`,
  restoredVolume = `${prefix}-restore-data`;
const containers: string[] = [],
  volumes: string[] = [];
function docker(...args: string[]) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function makeVolume(name: string) {
  docker("volume", "create", name);
  volumes.push(name);
}
function currentOrigin(name: string) {
  const published = docker("port", name, "3000/tcp");
  assert.match(published, /^127\.0\.0\.1:\d+$/);
  return `http://${published}`;
}
function start(name: string, volume: string) {
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--read-only",
    "--tmpfs",
    "/tmp:size=64m,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "256",
    "--memory",
    "512m",
    "-p",
    "127.0.0.1::3000",
    "-e",
    "COOKIE_SECURE=false",
    "--mount",
    `type=volume,src=${volume},dst=/data`,
    image,
  );
  containers.push(name);
  const inspect = JSON.parse(docker("inspect", name))[0];
  assert.equal(inspect.Config.User, "node");
  assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
  assert.ok(inspect.HostConfig.CapDrop.includes("ALL"));
  assert.ok(inspect.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.equal(inspect.HostConfig.PidsLimit, 256);
  assert.ok(
    inspect.Mounts.every(
      (mount: { Destination: string }) =>
        !mount.Destination.endsWith("docker.sock"),
    ),
  );
  return currentOrigin(name);
}
async function ready(origin: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok && (await response.json()).database === true) return;
    } catch {
      /* A freshly started container may not yet be listening. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    "Production container did not become ready within30 seconds.",
  );
}
async function api(
  origin: string,
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response;
}
const credentials = {
  username: "container-test-owner",
  password: "container-test-password-only",
};
const exercise = loadContent().exercises[0];
const data: DraftData = {
  files: exercise.starter,
  activeFile: Object.keys(exercise.starter)[0],
  stdin: "7\n",
  notes:
    "Keep source, notes and resume metadata through container recreation and WAL backup.",
  bookmark: true,
  step: 2,
  cursor: { anchor: 3, head: 3 },
  scrollAnchor: 24,
  paneSize: 47,
};
try {
  docker("image", "inspect", image);
  makeVolume(sourceVolume);
  makeVolume(restoredVolume);
  let origin = start(source, sourceVolume);
  await ready(origin);
  assert.equal((await api(origin, "/api/state")).status, 401);
  const bootstrapSecret = docker(
    "exec",
    source,
    "cat",
    "/data/bootstrap-secret",
  );
  const setup = await api(origin, "/api/auth/setup", "POST", {
    ...credentials,
    bootstrapSecret,
  });
  assert.equal(setup.status, 200);
  let cookie = setup.headers.get("set-cookie")!.split(";")[0];
  const saved = await api(
    origin,
    `/api/drafts/${exercise.id}`,
    "PUT",
    {
      data,
      contentVersion: exercise.version,
      revision: 0,
      mutationId: randomUUID(),
    },
    cookie,
  );
  assert.equal(saved.status, 200);
  const html = await fetch(`${origin}/lesson/source-to-program`);
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes("/manifest.webmanifest"));
  docker("restart", source);
  // Docker may reassign an automatically allocated host port on restart.
  // The deployment configurations use fixed ports; this disposable test does not.
  origin = currentOrigin(source);
  await ready(origin);
  const resumed = (await (
    await api(origin, `/api/drafts/${exercise.id}`, "GET", undefined, cookie)
  ).json()) as Draft;
  assert.deepEqual(resumed.data, data);
  assert.equal(resumed.revision, 1);
  assert.equal(
    (await (await api(origin, "/api/auth/status")).json()).setupRequired,
    false,
  );
  docker(
    "exec",
    source,
    "node",
    "--import",
    "tsx",
    "scripts/admin.ts",
    "backup",
    "/data/smoke-backup",
  );
  docker("stop", source);
  docker(
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:size=32m,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--mount",
    `type=volume,src=${sourceVolume},dst=/source,readonly`,
    "--mount",
    `type=volume,src=${restoredVolume},dst=/data`,
    image,
    "node",
    "--import",
    "tsx",
    "scripts/admin.ts",
    "restore",
    "/source/smoke-backup",
  );
  const restoredOrigin = start(restored, restoredVolume);
  await ready(restoredOrigin);
  const login = await api(
    restoredOrigin,
    "/api/auth/login",
    "POST",
    credentials,
  );
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const restoredDraft = (await (
    await api(
      restoredOrigin,
      `/api/drafts/${exercise.id}`,
      "GET",
      undefined,
      cookie,
    )
  ).json()) as Draft;
  assert.deepEqual(restoredDraft.data, data);
  assert.equal(restoredDraft.revision, 1);
  console.log(
    "PASS: nonroot/read-only production container; real setup/auth/SPA/API; exact account draft after restart; online WAL backup and fresh-volume restore. No learner C was executed.",
  );
} finally {
  for (const container of containers.reverse()) {
    try {
      docker("rm", "-f", container);
    } catch {
      /* Retain the original failure. */
    }
  }
  for (const volume of volumes.reverse()) {
    try {
      docker("volume", "rm", volume);
    } catch {
      /* Never remove unrelated volumes. */
    }
  }
}
