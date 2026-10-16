/** Real hosted accounts and compiler QA. Credentials/service token arrive via hidden stdin only. */
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Draft, LearnerState } from "../shared/app";
import type { RunnerOutcome } from "../shared/runner";
const parts: Buffer[] = [];
for await (const part of process.stdin) {
  const data = Buffer.from(part);
  parts.push(data);
  if (data.includes(10)) break;
}
const input = z
  .object({
    url: z.string().url(),
    token: z.string().optional(),
    existingAccounts: z.boolean().default(false),
    credentials: z
      .array(
        z.object({
          username: z.string().regex(/^cf_verify_[a-z0-9]+_[ab]$/),
          password: z.string().min(12),
        }),
      )
      .length(2),
  })
  .parse(JSON.parse(Buffer.concat(parts).toString()));
const base = new URL(input.url);
if (
  base.protocol !== "https:" ||
  !base.hostname.endsWith(".chatgpt.site") ||
  base.pathname !== "/"
)
  throw Error("Unexpected Site origin");
if (process.env.DEBUG || process.env.PWDEBUG)
  throw Error("Do not enable credential-bearing browser tracing.");
const checks: string[] = [];
const fixtures: { id: string; username: string }[] = [];
let stage = "launch";
const exercise = "source-to-program-guided";
const path = "/lesson/source-to-program?exercise=" + exercise;
const directory = "docs/screenshots/public-hosted";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY } }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
async function protect(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== base.origin)
      return route.abort();
    await route.continue({
      headers: {
        ...route.request().headers(),
        ...(input.token
          ? { "OAI-Sites-Authorization": "Bearer " + input.token }
          : {}),
      },
    });
  });
}
async function json<T>(
  page: Page,
  route: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
) {
  const cookie = (await page.context().cookies(base.href)).find(
    (c) => c.name === "cforge_session",
  );
  const me = fixtures.find((f) => f.username === awaitUsername.get(page));
  const response = await page.request.fetch(new URL(route, base).href, {
    method: init?.method ?? "GET",
    headers: {
      ...(input.token
        ? { "OAI-Sites-Authorization": "Bearer " + input.token }
        : {}),
      ...(cookie ? { cookie: cookie.name + "=" + cookie.value } : {}),
      ...(me ? { "x-cforge-account-id": me.id } : {}),
      origin: base.origin,
    },
    ...(init?.body === undefined ? {} : { data: init.body }),
  });
  return { status: response.status(), body: (await response.json()) as T };
}
const awaitUsername = new Map<Page, string>();
async function signup(
  page: Page,
  credential: { username: string; password: string },
) {
  await page.goto(base.href);
  if (!input.existingAccounts)
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
  await expect(page.getByLabel("Server bootstrap secret")).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill(credential.username);
  await page.getByLabel("Password", { exact: true }).fill(credential.password);
  if (!input.existingAccounts)
    await page.getByLabel("Repeat password").fill(credential.password);
  await page
    .getByRole("button", {
      name: input.existingAccounts ? "Continue learning" : "Create my workshop",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make something click." }),
  ).toBeVisible();
  const me = (
    await json<{ id: string; username: string }>(page, "/api/auth/me")
  ).body;
  if (me.username !== credential.username)
    throw Error("Unexpected fixture identity");
  fixtures.push(me);
  awaitUsername.set(page, credential.username);
  await writeFile(
    "/tmp/cforge-public-fixtures.json",
    JSON.stringify(fixtures),
    { mode: 0o600 },
  );
}
async function edit(page: Page, person: string, mobile = false) {
  await page.goto(new URL(path, base).href);
  if (mobile)
    await page.getByRole("tab", { name: "Code", exact: true }).click();
  const editor = page.getByLabel("Source code editor");
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(
    "#include <stdio.h>\n\n/* Private draft " +
      person +
      '. */\nint main(void) {\n    printf("Forge ready.\\n");\n    return 0;\n}\n',
  );
  await expect(page.locator(".save-status")).toHaveText(/Saved to account/);
}
async function screen(page: Page, name: string) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: directory + "/" + name,
    fullPage: true,
    animations: "disabled",
    mask: [page.locator(".sidebar-bottom")],
  });
}
async function submit(page: Page, mode: "run" | "check") {
  const started = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/jobs" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: mode === "run" ? "Run" : "Check",
      exact: true,
    })
    .click();
  const response = await started;
  if (!response.ok())
    throw Error("Compiler submission failed: " + response.status());
  const job = (await response.json()) as { id: string };
  let result: RunnerOutcome | null = null;
  await expect
    .poll(
      async () => {
        const reply = await json<{
          state: string;
          result: RunnerOutcome | null;
        }>(page, "/api/jobs/" + job.id);
        result = reply.body.result;
        return reply.body.state;
      },
      { timeout: 90000, intervals: [500, 1000, 2000] },
    )
    .toMatch(/^(succeeded|failed|timed_out|infrastructure_error|cancelled)$/);
  if (!result) throw Error("Missing canonical compiler result");
  return { id: job.id, result: result as RunnerOutcome };
}
try {
  stage = "independent_signup";
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: false,
  });
  await protect(desktop);
  const a = await desktop.newPage();
  a.setDefaultTimeout(20000);
  await signup(a, input.credentials[0]);
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: false,
  });
  await protect(phone);
  const b = await phone.newPage();
  b.setDefaultTimeout(20000);
  await signup(b, input.credentials[1]);
  if (fixtures[0].id === fixtures[1].id) throw Error("Shared account IDs");
  checks.push(
    input.existingAccounts
      ? "two_distinct_existing_accounts_no_platform_login_or_bootstrap"
      : "two_distinct_registered_accounts_no_bootstrap",
  );
  stage = "independent_persistence";
  await edit(a, "Alice");
  await edit(b, "Bob", true);
  const da = (await json<Draft>(a, "/api/drafts/" + exercise)).body;
  const db = (await json<Draft>(b, "/api/drafts/" + exercise)).body;
  if (
    !da.data.files["main.c"].includes("Alice") ||
    da.data.files["main.c"].includes("Bob") ||
    !db.data.files["main.c"].includes("Bob") ||
    db.data.files["main.c"].includes("Alice")
  )
    throw Error("Draft privacy failed");
  checks.push("independent_server_saved_code_same_exercise");
  stage = "native_compiler";
  const run = await submit(a, "run");
  if (
    run.result.state !== "succeeded" ||
    run.result.exitCode !== 0 ||
    run.result.stdout !== "Forge ready.\n" ||
    run.result.passed !== undefined
  )
    throw Error("Unexpected real Run result");
  const check = await submit(b, "check");
  if (check.result.state !== "succeeded" || check.result.passed !== true)
    throw Error("Native grading failed");
  const stateA = (await json<LearnerState>(a, "/api/state")).body;
  const stateB = (await json<LearnerState>(b, "/api/state")).body;
  if (
    stateA.progress.length !== 0 ||
    !stateB.progress.some((p) => p.exerciseId === exercise && p.proficient)
  )
    throw Error("Cross-account progress leak");
  if ((await json(a, "/api/jobs/" + check.id)).status !== 404)
    throw Error("Another account's job was visible");
  checks.push("real_isolated_c17_run_and_check_private_results_and_progress");
  stage = "fresh_login_resume";
  await screen(a, "desktop-private-draft.png");
  await screen(b, "phone-private-check.png");
  const reopened = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: false,
  });
  await protect(reopened);
  const fresh = await reopened.newPage();
  fresh.setDefaultTimeout(20000);
  await fresh.goto(base.href);
  await fresh
    .getByLabel("Username", { exact: true })
    .fill(input.credentials[0].username);
  await fresh
    .getByLabel("Password", { exact: true })
    .fill(input.credentials[0].password);
  await fresh
    .getByRole("button", { name: "Continue learning", exact: true })
    .click();
  await fresh.getByRole("link", { name: "Resume lesson" }).click();
  await expect(fresh.getByLabel("Source code editor")).toContainText(
    "Private draft Alice",
  );
  await expect(fresh.getByLabel("Source code editor")).not.toContainText(
    "Private draft Bob",
  );
  checks.push("fresh_context_restores_its_own_account_draft");
  if (
    await b.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
  )
    throw Error("Phone overflow");
  checks.push("phone_layout_no_overflow_trusted_tls");
  const report = {
    status: "passed",
    checks,
    fixtures,
    platformServiceAccess: !!input.token,
  };
  await writeFile(
    "/tmp/cforge-public-verification.json",
    JSON.stringify(report),
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      stage,
      category: error instanceof Error ? error.name : "unknown",
      checks,
      fixtures,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
