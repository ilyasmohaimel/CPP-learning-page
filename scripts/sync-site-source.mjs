/** Secure fallback for absent shared Sites CLI: credential is stdin/memory only. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
process.stdout.write(
  "Ready for Site source JSON on stdin (input is hidden).\n",
);
const input = [];
for await (const c of process.stdin) {
  input.push(c);
  if (input.reduce((n, x) => n + x.length, 0) > 65536)
    throw Error("Input too large");
  if (c.includes(10)) break;
}
const { credential, project_id } = JSON.parse(Buffer.concat(input).toString());
const manifest = JSON.parse(readFileSync(".openai/hosting.json", "utf8"));
if (
  project_id !== manifest.project_id ||
  credential.auth_mode !== "http_extra_header"
)
  throw Error("Unexpected Site credential binding/mode");
const remote = new URL(credential.remote_url);
if (
  remote.protocol !== "https:" ||
  remote.username ||
  remote.password ||
  !/^[-A-Za-z0-9_.]+$/.test(credential.branch)
)
  throw Error("Invalid source repository metadata");
const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0: "Authorization: Bearer " + credential.token,
};
for (const k of Object.keys(env))
  if (k.startsWith("GIT_TRACE") || k === "GIT_CURL_VERBOSE") delete env[k];
function git(args) {
  const r = spawnSync("git", args, {
    encoding: "utf8",
    env,
    maxBuffer: 1024 * 1024,
  });
  if (r.status !== 0) {
    const safe = (r.stderr || "").replaceAll(credential.token, "[redacted]");
    process.stderr.write(safe.slice(-1800));
    throw Error("Source operation failed: " + args[0]);
  }
  return r.stdout.trim();
}
git(["init", "-b", credential.branch]);
git(["config", "user.name", "C Forge"]);
git(["config", "user.email", "c-forge@local.invalid"]);
const remotes = git(["remote"]);
if (!remotes.split("\n").includes("origin"))
  git(["remote", "add", "origin", credential.remote_url]);
else if (git(["remote", "get-url", "origin"]) !== credential.remote_url)
  throw Error("Preserving a different existing origin");
const head = git(["ls-remote", "origin", "refs/heads/" + credential.branch]);
if (head) {
  const local = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    env,
    encoding: "utf8",
  });
  if (local.status === 0 && head.split(/\s+/)[0] !== local.stdout.trim())
    throw Error("Remote source changed; integrate it before publishing.");
  git(["fetch", "origin", credential.branch]);
  git(["reset", "--mixed", "FETCH_HEAD"]);
}
git(["add", "--all"]);
const status = git(["status", "--porcelain"]);
if (status)
  git([
    "commit",
    "-m",
    "Polish C Forge branding and remember the selected appearance",
  ]);
git(["push", "origin", "HEAD:refs/heads/" + credential.branch]);
const commit = git(["rev-parse", "HEAD"]);
const archive = resolve("c-forge-sites-deployment.tgz");
const packed = spawnSync(
  "tar",
  ["-czf", archive, ".openai/hosting.json", "dist"],
  { encoding: "utf8" },
);
if (packed.status !== 0) throw Error("Deployment packaging failed");
process.stdout.write(
  JSON.stringify({ project_id, commit_sha: commit, archive }) + "\n",
);
