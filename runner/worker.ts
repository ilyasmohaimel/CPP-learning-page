import { randomUUID } from "node:crypto";
import { lstat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  RunnerHeartbeat,
  RunnerLeaseResponse,
  RunnerOutcome,
  RunnerResultUpdate,
  RunnerStatusUpdate,
} from "../shared/runner.js";
import { PodmanRunner } from "./podman.js";
import { executeProcess } from "./process.js";

const secret = process.env.RUNNER_SECRET ?? "";
if (secret.length < 32)
  throw new Error(
    "Set RUNNER_SECRET to the same administrator-generated 32+ character secret as the API.",
  );
const api = new URL(process.env.RUNNER_API_URL ?? "http://127.0.0.1:3000");
if (
  api.username ||
  api.password ||
  !["http:", "https:"].includes(api.protocol) ||
  api.pathname !== "/"
)
  throw new Error(
    "RUNNER_API_URL must be an HTTP(S) origin without credentials or path.",
  );
const workerId = `worker-${randomUUID()}`;
const runner = new PodmanRunner({ image: process.env.RUNNER_IMAGE });
let stopping = false,
  active: AbortController | undefined;
let health = { available: false, detail: "Checking isolated compiler." };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(path, api), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Runner API returned ${response.status}.`);
  return (await response.json()) as T;
}

async function heartbeat() {
  const payload: RunnerHeartbeat = { workerId, ...health };
  await request("/internal/runner/heartbeat", payload);
}

async function cleanupAbandoned() {
  const listed = await executeProcess(
    runner.engine,
    [
      "ps",
      "--all",
      "--filter",
      "label=io.c-forge.runner=1",
      "--format",
      "{{.Names}}",
    ],
    { timeoutMs: 8000, maxBytes: 8192 },
  );
  if (listed.code !== 0) return;
  const names = listed.stdout
    .trim()
    .split("\n")
    .filter((name) =>
      /^c-forge-(?:compile|execute|probe)-[a-f0-9-]{36}$/.test(name),
    );
  if (names.length) {
    const removed = await executeProcess(
      runner.engine,
      ["rm", "--force", "--ignore", ...names],
      { timeoutMs: 10000, maxBytes: 8192 },
    );
    if (removed.code !== 0)
      throw new Error("Could not clean abandoned job containers.");
  }
  for (const name of await readdir(tmpdir())) {
    if (!/^c-forge-runner-[A-Za-z0-9]{6}$/.test(name)) continue;
    const path = join(tmpdir(), name),
      info = await lstat(path);
    if (
      info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid?.()
    )
      await rm(path, { recursive: true, force: true });
  }
}

async function runLease(lease: NonNullable<RunnerLeaseResponse["job"]>) {
  active = new AbortController();
  let apiLost = false;
  let polling = false;
  const poll = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const query = new URLSearchParams({
        workerId,
        leaseToken: lease.leaseToken,
      });
      const state = await request<{ cancelled: boolean }>(
        `/internal/runner/jobs/${encodeURIComponent(lease.id)}/control?${query}`,
      );
      if (state.cancelled) active?.abort();
      if (Date.now() - lastHeartbeat > 10000) {
        await heartbeat();
        lastHeartbeat = Date.now();
      }
    } catch {
      apiLost = true;
      active?.abort();
    } finally {
      polling = false;
    }
  }, 750);
  let result: RunnerOutcome;
  try {
    result = await runner.execute(lease.request, {
      signal: active.signal,
      state: async (state) => {
        const payload: RunnerStatusUpdate = {
          workerId,
          leaseToken: lease.leaseToken,
          state,
        };
        await request(
          `/internal/runner/jobs/${encodeURIComponent(lease.id)}/status`,
          payload,
        );
      },
    });
    if (apiLost)
      result = {
        ...result,
        state: "infrastructure_error",
        passed: false,
        feedback:
          "Worker lost its API lease. The job was stopped; your draft is preserved.",
      };
  } catch (error) {
    result = {
      state: "infrastructure_error",
      stdout: "",
      stderr: "",
      diagnostics: "",
      exitCode: null,
      elapsedMs: 0,
      truncated: false,
      feedback: error instanceof Error ? error.message : "Invalid leased job.",
    };
  } finally {
    clearInterval(poll);
    active = undefined;
  }
  const payload: RunnerResultUpdate = {
    workerId,
    leaseToken: lease.leaseToken,
    result,
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await request(
        `/internal/runner/jobs/${encodeURIComponent(lease.id)}/result`,
        payload,
      );
      break;
    } catch {
      if (attempt === 4)
        console.error(
          "Could not acknowledge result; API lease recovery will fail this job explicitly.",
        );
      else await wait(250 * 2 ** attempt);
    }
  }
  if (result.state === "infrastructure_error")
    health = {
      available: false,
      detail: result.feedback ?? "Runner failed its infrastructure checks.",
    };
}

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    active?.abort();
  });
let lastPreflight = 0,
  lastHeartbeat = 0;
while (!stopping) {
  if (!health.available && Date.now() - lastPreflight > 30000) {
    try {
      await cleanupAbandoned();
      health = await runner.preflight();
    } catch (error) {
      health = {
        available: false,
        detail: error instanceof Error ? error.message : "Cleanup unavailable.",
      };
    }
    lastPreflight = Date.now();
    console.log(
      health.available
        ? "Isolated runner ready."
        : `Runner unavailable: ${health.detail}`,
    );
  }
  try {
    if (Date.now() - lastHeartbeat > 10000) {
      await heartbeat();
      lastHeartbeat = Date.now();
    }
    if (health.available) {
      const leased = await request<RunnerLeaseResponse>(
        "/internal/runner/lease",
        { workerId },
      );
      if (leased.job) {
        await runLease(leased.job);
        continue;
      }
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Runner API unavailable.",
    );
  }
  await wait(1000);
}
health = { available: false, detail: "Worker shut down." };
await heartbeat().catch(() => {});
