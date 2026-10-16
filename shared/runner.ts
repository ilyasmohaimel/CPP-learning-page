import type { SourceFiles, Case } from "./content.js";
export type JobState =
  | "queued"
  | "compiling"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "infrastructure_error";
export interface ExecutionResult {
  state: JobState;
  stdout: string;
  stderr: string;
  diagnostics: string;
  exitCode: number | null;
  elapsedMs: number;
  truncated: boolean;
  signal?: string;
}
export interface RunnerRequest {
  files: SourceFiles;
  stdin: string;
  sanitize: boolean;
  cases?: Case[];
  harness?: string;
  fixtures?: SourceFiles;
  args?: string[];
}
export interface RunnerOutcome extends ExecutionResult {
  passed?: boolean;
  feedback?: string;
  casesPassed?: number;
  casesTotal?: number;
}
export interface RunnerLease {
  id: string;
  leaseToken: string;
  request: RunnerRequest;
}
export interface RunnerLeaseResponse {
  job: RunnerLease | null;
}
export interface RunnerHeartbeat {
  workerId: string;
  available: boolean;
  detail: string;
}
export interface RunnerStatusUpdate {
  workerId: string;
  leaseToken: string;
  state: "compiling" | "running";
}
export interface RunnerResultUpdate {
  workerId: string;
  leaseToken: string;
  result: RunnerOutcome;
}
