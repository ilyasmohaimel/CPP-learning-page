import { spawn } from "node:child_process";

export interface ProcessResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  timedOut: boolean;
  truncated: boolean;
  cancelled: boolean;
  infrastructureError?: boolean;
}
export interface ProcessOptions {
  input?: string;
  timeoutMs: number;
  maxBytes?: number;
  signal?: AbortSignal;
  onTerminate?: () => Promise<void>;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}
export type ProcessExecutor = (
  command: string,
  args: string[],
  options: ProcessOptions,
) => Promise<ProcessResult>;

/** No shell and no inherited stdin. Bytes are capped while streams continue draining until cleanup. */
export const executeProcess: ProcessExecutor = (command, args, options) =>
  new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      cwd: options.cwd,
      env: options.env,
    });
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0),
      bytes = 0,
      truncated = false,
      timedOut = false,
      cancelled = false,
      termination: Promise<void> | undefined;
    const stop = () => {
      if (termination) return;
      termination = (async () => {
        try {
          await options.onTerminate?.();
        } catch {
          /* The owner repeats cleanup and reports any failure. */
        } finally {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      })();
    };
    const append = (chunk: Buffer, output: "stdout" | "stderr") => {
      const cap = options.maxBytes ?? 65536;
      const accepted = chunk.subarray(0, Math.max(0, cap - bytes));
      if (output === "stdout") stdout = Buffer.concat([stdout, accepted]);
      else stderr = Buffer.concat([stderr, accepted]);
      bytes += accepted.length;
      if (accepted.length < chunk.length) {
        truncated = true;
        stop();
      }
    };
    child.stdout.on("data", (chunk: Buffer) => append(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => append(chunk, "stderr"));
    // A compiler can exit before the complete input has been consumed.
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const abort = () => {
      cancelled = true;
      stop();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.once("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", async (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      await termination;
      resolve({
        code,
        signal,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        elapsedMs: Math.round(performance.now() - start),
        timedOut,
        truncated,
        cancelled,
      });
    });
  });
