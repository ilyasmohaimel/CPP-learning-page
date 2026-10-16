/**
 * Manually invoked, real-server browser verification. No production defaults
 * for credentials. The operator backs up a zero-owner baseline before --first
 * and restores it after verification so these real attempts are not learner data.
 *
 * CFORGE_VERIFY_CREDENTIALS_FILE: protected JSON { username, password }
 * CFORGE_VERIFY_BOOTSTRAP_FILE: protected bootstrap secret (required for --first)
 * CFORGE_VERIFY_URL: HTTPS installation directory; defaults to the requested VPS.
 * CFORGE_VERIFY_SCREENSHOTS_DIR: optional safe artifact directory.
 * CFORGE_VERIFY_CHROMIUM: optional installed Chromium executable.
 *
 * node --import tsx scripts/vps-browser-verify.ts --first
 * node --import tsx scripts/vps-browser-verify.ts --after-restart
 * Add --sites to read {url,token,username,password,bootstrap?} from hidden stdin.
 * Platform service authorization is sent only to that exact private Site origin.
 *
 * Never enable DEBUG=pw:* around this script: Playwright debug logging can
 * include credentials entered into forms. TLS errors must be corrected on the
 * server; this script never ignores them or supplies certificate-bypass flags.
 */
import {
  chromium,
  expect as baseExpect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { constants, existsSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Draft, LearnerState } from "../shared/app.js";
import type { JobState, RunnerOutcome } from "../shared/runner.js";

type Mode = "--first" | "--after-restart";
interface Credentials {
  username: string;
  password: string;
}
interface Job {
  id: string;
  state: JobState;
  result: RunnerOutcome | null;
}
interface Runner {
  available: boolean;
  toolchain: string;
}
const exerciseId = "source-to-program-guided";
const desktopCode =
  '#include <stdio.h>\n\nint main(void) {\n    printf("Forge ready.\\n");\n    return 0;\n}\n';
const phoneCode =
  '#include <stdio.h>\n\n/* Saved from a separate phone browser. */\nint main(void) {\n    printf("Forge ready.\\n");\n    return 0;\n}\n';
const brokenCode =
  '#include <stdio.h>\n\nint main(void) {\n    printf("Forge ready.\\n")\n    return 0;\n}\n';
const desktopNote =
  "VPS verification: compilation builds a program; execution runs it.";
const phoneNote =
  "VPS verification: this note and source were saved from a fresh phone context.";
const stdin = "12\n34\n";
const expect = baseExpect.configure({ timeout: 15_000 });
let siteMode = false;
let serviceToken = "";
let sensitiveValues: string[] = [];
let lastAPIError: { path: string; status: number; error?: string } | null =
  null;
let stage = "configuration";
async function protectedSiteContext(context: BrowserContext, base: URL) {
  if (!siteMode) return;
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== base.origin)
      return route.abort();
    await route.continue({
      headers: {
        ...route.request().headers(),
        "OAI-Sites-Authorization": "Bearer " + serviceToken,
      },
    });
  });
  context.on("response", async (response) => {
    const url = new URL(response.url());
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith("/api/") ||
      response.status() < 400
    )
      return;
    lastAPIError = { path: url.pathname, status: response.status() };
    try {
      const value = (await response.json()) as { error?: unknown };
      if (typeof value.error === "string") {
        let message = value.error;
        for (const secret of sensitiveValues)
          if (secret) message = message.replaceAll(secret, "[redacted]");
        lastAPIError.error = message.slice(0, 500);
      }
    } catch {
      /* Non-JSON rejection is reported by status only. */
    }
  });
}
async function siteInput() {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of process.stdin) {
    const data = Buffer.from(part);
    size += data.length;
    check(size <= 65536);
    parts.push(data);
    if (data.includes(10)) break;
  }
  return z
    .object({
      url: z.string().url(),
      token: z.string().min(20).max(10000),
      username: z.string().min(3).max(32),
      password: z.string().min(12).max(128),
      bootstrap: z.string().min(16).max(256).optional(),
    })
    .strict()
    .parse(JSON.parse(Buffer.concat(parts).toString()));
}
const completed: string[] = [];
const screenshots: string[] = [];

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error("Verification condition did not hold.");
}
async function protectedText(path: string | undefined, maxBytes: number) {
  check(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    check(
      info.isFile() &&
        (info.mode & 0o077) === 0 &&
        info.size > 0 &&
        info.size <= maxBytes,
    );
    const text = await file.readFile("utf8");
    check(Buffer.byteLength(text) <= maxBytes);
    return text;
  } finally {
    await file.close();
  }
}
async function credentialsFromFile(): Promise<Credentials> {
  const input: unknown = JSON.parse(
    await protectedText(process.env.CFORGE_VERIFY_CREDENTIALS_FILE, 4096),
  );
  return z
    .object({
      username: z
        .string()
        .min(3)
        .max(32)
        .regex(/^[A-Za-z0-9_.-]+$/),
      password: z.string().min(12).max(128),
    })
    .strict()
    .parse(input);
}
function installationUrl() {
  const url = new URL(
    process.env.CFORGE_VERIFY_URL ?? "https://51.170.138.252:8445/forge/",
  );
  check(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
  );
  check(url.pathname === "/" || /^\/(?:[A-Za-z0-9_-]+\/)+$/.test(url.pathname));
  return url;
}
function urlAt(base: URL, path: string) {
  check(!path.startsWith("/") && !path.includes(".."));
  const url = new URL(path, base);
  check(url.origin === base.origin && url.pathname.startsWith(base.pathname));
  return url.href;
}
async function json<T>(page: Page, url: string) {
  const browserCookies = siteMode ? await page.context().cookies(url) : [];
  const session = browserCookies.find(
    (value) => value.name === "cforge_session",
  );
  const response = await page.request.get(url, {
    headers: siteMode
      ? {
          "OAI-Sites-Authorization": "Bearer " + serviceToken,
          ...(session ? { cookie: session.name + "=" + session.value } : {}),
        }
      : {},
  });
  check(response.ok());
  return (await response.json()) as T;
}
async function signIn(
  page: Page,
  base: URL,
  credentials: Credentials,
  bootstrap?: string,
) {
  await page.goto(base.href);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /Open your workshop|Welcome back/,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  const setup = page.getByLabel("Server bootstrap secret");
  if (bootstrap !== undefined) {
    check((await setup.count()) === 1);
    await setup.fill(bootstrap);
  } else {
    check((await setup.count()) === 0);
  }
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel(/^Password/).fill(credentials.password);
  await page
    .getByRole("button", {
      name:
        bootstrap === undefined ? "Continue learning" : "Create my workshop",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make something click." }),
  ).toBeVisible();
  await expect(page).toHaveURL(base.href);
}
async function saved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText(/Saved to account/);
}
async function openDetails(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").click();
}
async function replaceCode(page: Page, value: string) {
  const editor = page.getByLabel("Source code editor");
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(value);
}
async function openWorkspace(page: Page, base: URL, mobile = false) {
  await page.goto(
    urlAt(base, `lesson/source-to-program?exercise=${exerciseId}`),
  );
  if (mobile)
    await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(page.getByLabel("Source code editor")).toBeVisible();
}
async function assertDraft(
  page: Page,
  base: URL,
  source: string,
  note: string,
) {
  const draft = await json<Draft>(
    page,
    urlAt(base, `api/drafts/${exerciseId}`),
  );
  check(
    draft.exerciseId === exerciseId &&
      draft.contentVersion === 1 &&
      draft.revision > 0,
  );
  check(
    Object.keys(draft.data.files).length === 1 &&
      draft.data.files["main.c"] === source,
  );
  check(
    draft.data.stdin === stdin &&
      draft.data.notes === note &&
      draft.data.bookmark &&
      draft.data.step === 2 &&
      draft.data.activeFile === "main.c",
  );
  const state = await json<LearnerState>(page, urlAt(base, "api/state"));
  check(
    state.resume?.lessonId === "source-to-program" &&
      state.resume.exerciseId === exerciseId &&
      state.resume.step === 2,
  );
  return draft;
}
async function assertSecureSession(context: BrowserContext, base: URL) {
  const cookies = await context.cookies(base.href);
  const cookie = cookies.find((value) => value.name === "cforge_session");
  check(
    cookie &&
      cookie.path === base.pathname &&
      cookie.secure &&
      cookie.httpOnly &&
      cookie.sameSite === (siteMode ? "None" : "Lax"),
  );
  check(cookie.value.length >= 32 && cookie.expires > Date.now() / 1000);
}
async function noOverflow(page: Page) {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth + 1,
  );
  check(fits);
}
async function screenshot(page: Page, directory: string, name: string) {
  check(await page.locator(".app-shell").isVisible());
  check((await page.locator("input[type=password]").count()) === 0);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: join(directory, name),
    fullPage: true,
    animations: "disabled",
    mask: [page.locator(".sidebar-bottom")],
  });
  screenshots.push(name);
}
async function availableWorker(page: Page, base: URL) {
  await expect
    .poll(
      async () =>
        (await json<Runner>(page, urlAt(base, "api/runner"))).available,
      { timeout: 30_000, intervals: [1000, 2000] },
    )
    .toBe(true);
  const runner = await json<Runner>(page, urlAt(base, "api/runner"));
  check(
    runner.toolchain.includes("GCC 14.2.0") &&
      runner.toolchain.includes("-std=c17"),
  );
}
async function submit(page: Page, base: URL, mode: "run" | "check") {
  await saved(page);
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === urlAt(base, "api/jobs") &&
        response.request().method() === "POST",
    ),
    page
      .getByRole("button", {
        name: mode === "run" ? "Run" : "Check",
        exact: true,
      })
      .click(),
  ]);
  check(response.status() === 202);
  const submitted = (await response.json()) as Job;
  check(
    /^[a-f0-9-]{36}$/.test(submitted.id) &&
      submitted.state === "queued" &&
      submitted.result === null,
  );
  let finished: Job | undefined;
  await expect
    .poll(
      async () => {
        finished = await json<Job>(
          page,
          urlAt(base, `api/jobs/${submitted.id}`),
        );
        return [
          "succeeded",
          "failed",
          "timed_out",
          "cancelled",
          "infrastructure_error",
        ].includes(finished.state);
      },
      { timeout: 45_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  check(finished?.result && finished.id === submitted.id);
  return finished.result;
}

async function main() {
  // Debug logging may include fill arguments and request data; refuse that mode.
  check(!process.env.DEBUG && !process.env.PWDEBUG);
  const args = process.argv.slice(2).filter((value) => value !== "--sites");
  siteMode = process.argv.includes("--sites");
  check(args.length === 1 && ["--first", "--after-restart"].includes(args[0]));
  const mode = args[0] as Mode;
  const input = siteMode ? await siteInput() : null;
  if (input) {
    const expected = new URL(input.url);
    check(
      expected.protocol === "https:" &&
        expected.hostname.endsWith(".chatgpt.site") &&
        expected.pathname === "/",
    );
    process.env.CFORGE_VERIFY_URL = input.url;
    serviceToken = input.token;
    sensitiveValues = [
      input.token,
      input.password,
      input.bootstrap ?? "",
      input.username,
    ];
  }
  const credentials = input
    ? { username: input.username, password: input.password }
    : await credentialsFromFile();
  const bootstrap =
    mode === "--first"
      ? input
        ? input.bootstrap
        : (
            await protectedText(process.env.CFORGE_VERIFY_BOOTSTRAP_FILE, 1024)
          ).trim()
      : undefined;
  check(
    bootstrap === undefined ||
      (bootstrap.length >= 16 && bootstrap.length <= 256),
  );
  const base = installationUrl();
  const directory =
    process.env.CFORGE_VERIFY_SCREENSHOTS_DIR ?? "docs/screenshots";
  await mkdir(directory, { recursive: true, mode: 0o700 });
  stage = "launch_browser_with_tls_validation";
  const browser = await chromium.launch({
    ...(process.env.CFORGE_VERIFY_CHROMIUM
      ? { executablePath: process.env.CFORGE_VERIFY_CHROMIUM }
      : existsSync("/usr/bin/chromium")
        ? { executablePath: "/usr/bin/chromium" }
        : {}),
    ...(siteMode && process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY } }
      : {}),
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  let pageErrorCount = 0;
  try {
    const desktop = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ignoreHTTPSErrors: false,
    });
    await protectedSiteContext(desktop, base);
    const pc = await desktop.newPage();
    pc.setDefaultTimeout(15_000);
    pc.setDefaultNavigationTimeout(30_000);
    pc.on("pageerror", () => {
      pageErrorCount++;
    });
    stage =
      mode === "--first" ? "protected_owner_setup" : "sign_in_after_restart";
    await signIn(pc, base, credentials, bootstrap);
    await assertSecureSession(desktop, base);
    check(
      await pc.evaluate(
        () => isSecureContext && typeof crypto.randomUUID === "function",
      ),
    );
    completed.push("trusted_https_and_secure_scoped_session");

    if (mode === "--first") {
      stage = "desktop_source_and_metadata_save";
      await openWorkspace(pc, base);
      await replaceCode(pc, desktopCode);
      await pc.locator(".lesson-steps button").nth(2).click();
      await openDetails(pc, ".stdin-panel");
      await pc.getByLabel("Text supplied to the program").fill(stdin);
      await openDetails(pc, ".lesson-notes");
      await pc
        .getByRole("textbox", { name: "Notes", exact: true })
        .fill(desktopNote);
      await pc.getByLabel("Bookmark this exercise").check();
      await saved(pc);
      await assertDraft(pc, base, desktopCode, desktopNote);
      await noOverflow(pc);
      await screenshot(pc, directory, "vps-desktop-saved-draft.png");
      completed.push("desktop_server_saved_source_step_stdin_notes_bookmark");

      stage = "independent_phone_sign_in_and_resume";
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        ignoreHTTPSErrors: false,
      });
      await protectedSiteContext(phone, base);
      const mobile = await phone.newPage();
      mobile.setDefaultTimeout(15_000);
      mobile.setDefaultNavigationTimeout(30_000);
      mobile.on("pageerror", () => {
        pageErrorCount++;
      });
      await signIn(mobile, base, credentials);
      await assertSecureSession(phone, base);
      await mobile.getByRole("link", { name: "Resume lesson" }).click();
      await expect(mobile).toHaveURL(
        urlAt(base, `lesson/source-to-program?exercise=${exerciseId}`),
      );
      await mobile.getByRole("tab", { name: "Code", exact: true }).click();
      await expect(mobile.getByLabel("Source code editor")).toContainText(
        "Forge ready.",
      );
      await assertDraft(mobile, base, desktopCode, desktopNote);
      await replaceCode(mobile, phoneCode);
      await mobile.getByRole("tab", { name: "Learn", exact: true }).click();
      await openDetails(mobile, ".lesson-notes");
      await mobile
        .getByRole("textbox", { name: "Notes", exact: true })
        .fill(phoneNote);
      await mobile.getByRole("tab", { name: "Code", exact: true }).click();
      await saved(mobile);
      await assertDraft(mobile, base, phoneCode, phoneNote);
      await noOverflow(mobile);
      await screenshot(mobile, directory, "vps-phone-saved-draft.png");
      await phone.close();
      completed.push("fresh_phone_account_resume_and_independent_edit");

      stage = "desktop_retrieves_phone_saved_draft";
      await pc.reload();
      await expect(pc.getByLabel("Source code editor")).toContainText(
        "Saved from a separate phone browser.",
      );
      await assertDraft(pc, base, phoneCode, phoneNote);
      await availableWorker(pc, base);
      completed.push("desktop_reloads_phone_source_and_notes");

      stage = "native_run_through_ui";
      const run = await submit(pc, base, "run");
      check(
        run.state === "succeeded" &&
          run.exitCode === 0 &&
          run.stdout === "Forge ready.\n" &&
          run.passed === undefined,
      );
      await expect(pc.locator(".result-feedback")).toContainText("Program ran");
      completed.push("real_native_run_stdout_and_exit_status");

      stage = "server_owned_native_grading_through_ui";
      const checked = await submit(pc, base, "check");
      check(
        checked.state === "succeeded" &&
          checked.passed === true &&
          checked.exitCode === 0,
      );
      check(
        checked.casesTotal !== undefined &&
          checked.casesTotal > 0 &&
          checked.casesPassed === checked.casesTotal,
      );
      await expect(pc.locator(".result-feedback")).toContainText(
        "Check passed",
      );
      const state = await json<LearnerState>(pc, urlAt(base, "api/state"));
      check(
        state.progress.some(
          (item) =>
            item.exerciseId === exerciseId &&
            item.proficient &&
            item.completed &&
            !item.helpUsed,
        ),
      );
      await screenshot(pc, directory, "vps-native-check-passed.png");
      completed.push("real_native_check_and_transactional_proficiency");

      stage = "real_compile_failure_through_ui";
      await replaceCode(pc, brokenCode);
      const failed = await submit(pc, base, "run");
      check(
        failed.state === "failed" &&
          failed.exitCode !== null &&
          failed.exitCode !== 0 &&
          failed.diagnostics.length > 0 &&
          failed.passed !== true,
      );
      await expect(
        pc.getByRole("heading", { name: "Original compiler diagnostics" }),
      ).toBeVisible();
      await expect(pc.locator(".diagnostics")).toContainText("error:");
      await screenshot(pc, directory, "vps-native-compile-failure.png");
      completed.push("real_compilation_failure_and_original_diagnostics");

      stage = "restore_known_phone_draft_for_restart_verification";
      await replaceCode(pc, phoneCode);
      await saved(pc);
      await assertDraft(pc, base, phoneCode, phoneNote);
      completed.push("known_phone_draft_left_for_restart_and_backup_restore");
    } else {
      stage =
        "exact_account_restore_after_api_worker_restart_and_backup_restore";
      await assertDraft(pc, base, phoneCode, phoneNote);
      await pc.getByRole("link", { name: "Resume lesson" }).click();
      await expect(pc).toHaveURL(
        urlAt(base, `lesson/source-to-program?exercise=${exerciseId}`),
      );
      await expect(pc.getByLabel("Source code editor")).toContainText(
        "Saved from a separate phone browser.",
      );
      await expect(pc.locator(".lesson-steps button").nth(2)).toHaveAttribute(
        "aria-current",
        "step",
      );
      await openDetails(pc, ".stdin-panel");
      await expect(pc.getByLabel("Text supplied to the program")).toHaveValue(
        stdin,
      );
      await openDetails(pc, ".lesson-notes");
      await expect(
        pc.getByRole("textbox", { name: "Notes", exact: true }),
      ).toHaveValue(phoneNote);
      await expect(pc.getByLabel("Bookmark this exercise")).toBeChecked();
      await saved(pc);
      await pc.reload();
      await expect(pc.getByLabel("Source code editor")).toContainText(
        "Saved from a separate phone browser.",
      );
      await assertDraft(pc, base, phoneCode, phoneNote);
      await availableWorker(pc, base);
      await noOverflow(pc);
      await screenshot(pc, directory, "vps-after-restart-account-resume.png");
      completed.push(
        "exact_server_draft_resume_after_restart_and_backup_restore",
        "isolated_worker_available_after_restart",
      );
    }
    if (siteMode && mode === "--after-restart") {
      stage = "hosted_native_failed_check";
      await replaceCode(
        pc,
        phoneCode.replace("Forge ready.", "Wrong greeting."),
      );
      const wrong = await submit(pc, base, "check");
      check(wrong.state === "succeeded" && wrong.passed === false);
      await screenshot(pc, directory, "sites-native-failed-check.png");
      await replaceCode(pc, phoneCode);
      await saved(pc);
      completed.push("native_wrong_output_rejected_by_server_grader");
      stage = "hosted_screen_visual_review";
      await pc.goto(base.href);
      await expect(
        pc.getByRole("heading", { name: "Make something click." }),
      ).toBeVisible();
      await screenshot(pc, directory, "sites-home.png");
      await noOverflow(pc);
      await pc.goto(urlAt(base, "path"));
      await expect(pc.getByRole("heading", { level: 1 })).toBeVisible();
      await screenshot(pc, directory, "sites-learning-path.png");
      await noOverflow(pc);
      await pc.goto(
        urlAt(
          base,
          "lesson/debugging-checkpoint?exercise=debugging-checkpoint-project-cli&project=study-tracker",
        ),
      );
      await expect(pc.getByLabel("Source code editor")).toBeVisible();
      await screenshot(pc, directory, "sites-capstone-workspace.png");
      await noOverflow(pc);
      await pc.setViewportSize({ width: 768, height: 1000 });
      await noOverflow(pc);
      await screenshot(pc, directory, "sites-tablet-workspace.png");
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        ignoreHTTPSErrors: false,
      });
      await protectedSiteContext(phone, base);
      const mobile = await phone.newPage();
      mobile.setDefaultTimeout(15000);
      await signIn(mobile, base, credentials);
      await openWorkspace(mobile, base, true);
      await noOverflow(mobile);
      await screenshot(mobile, directory, "sites-mobile-code.png");
      await mobile.getByRole("tab", { name: "Learn", exact: true }).click();
      await screenshot(mobile, directory, "sites-mobile-learn.png");
      await phone.close();
      completed.push(
        "hosted_home_path_capstone_390_768_1440_visual_capture_no_overflow",
      );
    }
    stage = "browser_runtime_health";
    check(pageErrorCount === 0);
    completed.push("no_page_runtime_errors");
    await desktop.close();
    process.stdout.write(
      `${JSON.stringify({ status: "passed", mode, checks: completed, screenshots, tlsValidation: "enabled" })}\n`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  // Do not print error messages, stacks, response bodies, locators with fill
  // values, or browser traces: they may include credentials or learner content.
  const category =
    error instanceof Error && error.name === "TimeoutError"
      ? "timeout"
      : "verification_failed";
  process.stderr.write(
    `${JSON.stringify({ status: "failed", stage, category, lastAPIError, completedChecks: completed, screenshots })}\n`,
  );
  process.exitCode = 1;
});
