import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ShieldCheck,
  Terminal,
  BookOpen,
  Lightbulb,
} from "lucide-react";
import { api } from "../lib/api";
import { Brand } from "./Brand";
export function Auth({ onSuccess }: { onSuccess: () => void }) {
  const status = useQuery({
    queryKey: ["auth-status"],
    queryFn: () =>
      api<{
        setupRequired: boolean;
        bootstrapConfigured: boolean;
        registrationOpen?: boolean;
      }>("/api/auth/status"),
  });
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"login" | "register">("login"),
    [repeat, setRepeat] = useState("");
  const registration = !!status.data?.registrationOpen && mode === "register";
  const setup = !!status.data?.setupRequired && !status.data?.registrationOpen;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (registration && password !== repeat) {
      setError("Passwords do not match. Check both fields.");
      return;
    }
    setBusy(true);
    try {
      await api(
        registration
          ? "/api/auth/register"
          : setup
            ? "/api/auth/setup"
            : "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            username,
            password,
            ...(setup ? { bootstrapSecret: secret } : {}),
          }),
        },
      );
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div className="auth-story-content">
          <h1>
            Small steps.
            <br /> Real programs.
          </h1>
          <p>
            Learn C by understanding an idea, trying it, and making something
            work.
          </p>
          <div className="auth-example">
            <div className="auth-code">
              <span>
                main.c <small>A worked C17 example</small>
              </span>
              <pre>
                <code>
                  <span className="sample-line">
                    <span className="sample-meta">#include</span>{" "}
                    <span className="sample-string">&lt;stdio.h&gt;</span>
                    {"\n"}
                  </span>
                  <span className="sample-line">{"\n"}</span>
                  <span className="sample-line">
                    <span className="sample-keyword">int</span>
                    {" main("}
                    <span className="sample-keyword">void</span>
                    {") {\n"}
                  </span>
                  <span className="sample-line">
                    {"    printf("}
                    <span className="sample-string">
                      {'"Ready to build.\\n"'}
                    </span>
                    {");\n"}
                  </span>
                  <span className="sample-line">
                    {"    "}
                    <span className="sample-keyword">return</span>{" "}
                    <span className="sample-number">0</span>
                    {";\n"}
                  </span>
                  <span className="sample-line">{"}"}</span>
                </code>
              </pre>
            </div>
            <div className="auth-example-output">
              <span>Expected output</span>
              <pre>Ready to build.</pre>
            </div>
          </div>
          <div className="auth-features">
            <div>
              <BookOpen size={26} strokeWidth={1.5} />
              <p>
                <strong>Learn</strong>
                <span>Understand one idea.</span>
              </p>
            </div>
            <div>
              <Lightbulb size={26} strokeWidth={1.5} />
              <p>
                <strong>Predict</strong>
                <span>Think it through.</span>
              </p>
            </div>
            <div>
              <Terminal size={26} strokeWidth={1.5} />
              <p>
                <strong>Build</strong>
                <span>Write, test, and debug.</span>
              </p>
            </div>
          </div>
        </div>
        <dl className="auth-course-facts" aria-label="Course contents">
          <div>
            <dt>2</dt>
            <dd>C and C++ courses</dd>
          </div>
          <div>
            <dt>96</dt>
            <dd>focused lessons</dd>
          </div>
          <div>
            <dt>6</dt>
            <dd>guided projects</dd>
          </div>
        </dl>
      </section>
      <section className="auth-form">
        <div>
          <ShieldCheck
            className="auth-form-mark"
            size={34}
            strokeWidth={1.4}
            aria-hidden="true"
          />
          <h2>
            {status.isPending
              ? "Opening your workshop…"
              : status.error
                ? "Connection unavailable"
                : registration
                  ? "Create your workshop"
                  : setup
                    ? "Open your workshop"
                    : "Welcome back."}
          </h2>
          <p className="muted">
            {status.isPending
              ? "Checking your account connection."
              : status.error
                ? "Your saved account is on the server. Reconnect to continue."
                : registration
                  ? "Choose a username and password. Your code, notes and progress stay private to your account."
                  : setup
                    ? "Administrator setup requires the server bootstrap secret."
                    : "Sign in to pick up exactly where you left off."}
          </p>
          {status.isLoading ? (
            <p role="status">Connecting to the application…</p>
          ) : status.error ? (
            <div className="notice error">
              Cannot reach the API. Check the server and try again.
              <button onClick={() => void status.refetch()}>Retry</button>
            </div>
          ) : (
            <form onSubmit={submit}>
              {status.data?.registrationOpen ? (
                <div
                  className="auth-mode-switch"
                  role="group"
                  aria-label="Account access"
                >
                  <button
                    type="button"
                    className={mode === "login" ? "selected" : "secondary"}
                    aria-pressed={mode === "login"}
                    onClick={() => {
                      setMode("login");
                      setError("");
                      setRepeat("");
                    }}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className={mode === "register" ? "selected" : "secondary"}
                    aria-pressed={mode === "register"}
                    onClick={() => {
                      setMode("register");
                      setError("");
                    }}
                  >
                    Create account
                  </button>
                </div>
              ) : null}
              {setup ? (
                <label>
                  Server bootstrap secret
                  <input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    required
                    minLength={16}
                    autoComplete="off"
                  />
                  <small>
                    Read .data/bootstrap-secret on the server. This prevents an
                    internet visitor from claiming your account.
                  </small>
                </label>
              ) : null}
              <label>
                Username
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9_.-]+"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  aria-label="Password"
                  aria-describedby="forge-password-help"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete={
                    setup || registration ? "new-password" : "current-password"
                  }
                />
                <small id="forge-password-help">
                  {setup || registration
                    ? "Use at least 12 characters. No email account is required."
                    : "Account recovery is controlled by the server administrator."}
                </small>
              </label>
              {registration ? (
                <label>
                  Repeat password
                  <input
                    type="password"
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              ) : null}
              {error ? (
                <p role="alert" className="notice error">
                  {error}
                </p>
              ) : null}
              <button className="button primary" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : setup || registration
                    ? "Create my workshop"
                    : "Continue learning"}
                <ArrowRight size={18} />
              </button>
            </form>
          )}
          <p className="auth-storage">
            <strong>Your code. Your pace.</strong>
            Use the same workshop address and account on your phone and Linux
            PC. Wait for “Saved to account” before switching devices.
          </p>
        </div>
      </section>
    </main>
  );
}
