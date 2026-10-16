import {
  AlertTriangle,
  CheckCircle2,
  Terminal,
  Square,
  XCircle,
} from "lucide-react";
import type { RunnerOutcome, JobState } from "../../shared/runner";
import { explainDiagnostic } from "../../shared/diagnostics";
interface Props {
  job: { id: string; state: JobState; result: RunnerOutcome | null } | null;
  runner: { available: boolean; detail: string } | undefined;
  error: string;
  onLocation: (file: string, line: number, column: number) => void;
  onCancel: () => void;
}
export function Results({ job, runner, error, onLocation, onCancel }: Props) {
  const result = job?.result;
  const busy = job && ["queued", "compiling", "running"].includes(job.state);
  const message = result?.feedback;
  const help = result
    ? explainDiagnostic(`${result.diagnostics}\n${result.stderr}`)
    : null;
  return (
    <section className="results-panel" aria-labelledby="results-title">
      <div className="section-bar">
        <h3 id="results-title">
          <Terminal size={17} />
          Results
        </h3>
        {busy ? (
          <button className="secondary small" onClick={onCancel}>
            <Square size={12} />
            Cancel
          </button>
        ) : (
          <span className="muted">
            {job?.state.replaceAll("_", " ") ?? "Ready when you are"}
          </span>
        )}
      </div>
      <div className="results-body" role="status" aria-live="polite">
        {!runner?.available && !result ? (
          <div className="notice warning runner-notice">
            <AlertTriangle size={22} />
            <div>
              <strong>Runner unavailable</strong>
              <p>
                Drafts save here. Isolated C execution needs the self-hosted
                worker.
              </p>
              <details>
                <summary>Runner details</summary>
                <p>{runner?.detail ?? "Checking the worker connection…"}</p>
              </details>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p className="running-state">
            <span className="status-dot" />
            {job.state === "queued"
              ? "Waiting for the isolated worker…"
              : job.state === "compiling"
                ? "Compiling as C17…"
                : "Running within the resource limits…"}
          </p>
        ) : null}
        {result ? (
          <>
            <div
              className={`result-feedback ${result.passed === true ? "success" : result.passed === false || ["failed", "timed_out", "infrastructure_error"].includes(result.state) ? "error" : ""}`}
            >
              {result.passed === true ? (
                <CheckCircle2 size={21} />
              ) : result.passed === false ? (
                <XCircle size={21} />
              ) : (
                <Terminal size={21} />
              )}
              <div>
                <strong>
                  {result.passed === true
                    ? "Check passed"
                    : result.passed === false
                      ? "Check needs another attempt"
                      : result.state === "succeeded"
                        ? "Program ran"
                        : result.state.replaceAll("_", " ")}
                </strong>
                {message ? <p>{message}</p> : null}
              </div>
            </div>
            {help ? (
              <div className="notice">
                <strong>{help.title}</strong>
                <p>{help.explanation}</p>
              </div>
            ) : null}
            {result.diagnostics ? (
              <section>
                <h4>Original compiler diagnostics</h4>
                <div className="diagnostics">
                  {result.diagnostics.split("\n").map((line, i) => {
                    const m = line.match(/^([^\s:]+):(\d+):(\d+):/);
                    return m ? (
                      <button
                        key={i}
                        onClick={() =>
                          onLocation(m[1], Number(m[2]), Number(m[3]))
                        }
                      >
                        {line}
                      </button>
                    ) : (
                      <pre key={i}>{line}</pre>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <section>
              <h4>Standard output</h4>
              <pre className="output">
                {result.stdout || "(No standard output)"}
              </pre>
            </section>
            {result.stderr ? (
              <section>
                <h4>Standard error</h4>
                <pre className="output">{result.stderr}</pre>
              </section>
            ) : null}
            <p className="execution-meta">
              Exit code: {result.exitCode ?? "none"} ·{" "}
              {Math.round(result.elapsedMs)} ms
              {result.signal ? ` · ${result.signal}` : ""}
              {result.casesTotal !== undefined
                ? ` · ${result.casesPassed}/${result.casesTotal} checks`
                : ""}
            </p>
            {result.truncated ? (
              <p className="notice warning">
                Output was truncated at the runner’s limit.
              </p>
            ) : null}
          </>
        ) : runner?.available && !error && !busy ? (
          <div className="result-empty">
            <Terminal size={25} />
            <p>
              Run explores your program.
              <br />
              Check evaluates the exercise contract.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
