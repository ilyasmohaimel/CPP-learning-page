import { test, expect, type Page } from "@playwright/test";
import type { Draft } from "../shared/app";
import type { RunnerOutcome } from "../shared/runner";

/**
 * This is a mocked diagnostic/job transport regression, not a native compiler
 * test. The real project content, CodeMirror editor, and account draft saves
 * are used; the fixed diagnostic response exists only inside Playwright routes.
 */
test("mocked diagnostic transport navigates /src/project.c while ignoring library and hidden-driver locations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /Open your workshop|Welcome back/,
    }),
  ).toBeVisible();
  const bootstrap = page.getByLabel("Server bootstrap secret");
  if (await bootstrap.count())
    await bootstrap.fill("browser-bootstrap-secret-for-testing-only");
  await page.getByLabel("Username", { exact: true }).fill("browser-learner");
  await page.getByLabel(/^Password/).fill("browser-test-password-only");
  await page
    .getByRole("button", { name: /Create my workshop|Continue learning/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your workshop", exact: true }),
  ).toBeVisible();

  const exerciseId = "debugging-checkpoint-project-cli";
  const draftUrl = `/api/drafts/${exerciseId}`;
  const jobId = "8c987ab8-8dc9-4eb3-9d89-29e2d1b0ba01";
  const sourceDiagnostic =
    "/src/store.c:4:5: error: fixture-only source navigation diagnostic";
  const libraryDiagnostic =
    "/usr/include/store.c:1:1: note: fixture library location; do not navigate";
  const driverDiagnostic =
    "/src/__harness.c:1:1: error: fixture hidden-driver location; do not navigate";
  const outcome: RunnerOutcome = {
    state: "failed",
    stdout: "",
    stderr: "",
    diagnostics: [sourceDiagnostic, libraryDiagnostic, driverDiagnostic].join(
      "\n",
    ),
    exitCode: 1,
    elapsedMs: 0,
    truncated: false,
    feedback:
      "Mocked diagnostic transport fixture. No program was compiled or executed.",
  };
  await page.route("**/api/runner", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        detail: "Mocked transport fixture only; no compiler is connected.",
        toolchain: "GCC 14.2.0 · -std=c17",
      }),
    }),
  );
  await page.route("**/api/jobs", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ id: jobId, state: "queued", result: null }),
        })
      : route.continue(),
  );
  await page.route(`**/api/jobs/${jobId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: jobId, state: "failed", result: outcome }),
    }),
  );
  await page.goto(
    `/lesson/debugging-checkpoint?exercise=${exerciseId}&project=study-tracker`,
  );
  const editor = page.getByLabel("Source code editor");
  await expect(editor).toBeVisible();
  await page
    .locator(".code-pane")
    .getByRole("button", { name: "main.c", exact: true })
    .click();
  await expect(page.locator(".save-status")).toHaveText(/Saved to account/);
  const before = await draft(page, draftUrl);
  expect(before.data.activeFile).toBe("main.c");
  expect(Object.keys(before.data.files)).toEqual(
    expect.arrayContaining([
      "main.c",
      "store.c",
      "vector.c",
      "tracker.h",
      "Makefile",
    ]),
  );
  const sourceLines = before.data.files["store.c"].split("\n");
  expect(sourceLines.length).toBeGreaterThanOrEqual(4);
  const expectedCursor =
    sourceLines
      .slice(0, 3)
      .reduce((offset, line) => offset + line.length + 1, 0) +
    Math.min(4, sourceLines[3].length);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".result-feedback")).toContainText(
    "No program was compiled or executed.",
  );
  await page
    .locator(".diagnostics")
    .getByRole("button", { name: sourceDiagnostic, exact: true })
    .click();
  await expect(
    page
      .locator(".code-pane")
      .getByRole("button", { name: "store.c", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toBeFocused();
  await expect
    .poll(async () => {
      const saved = await draft(page, draftUrl);
      return {
        file: saved.data.activeFile,
        anchor: saved.data.cursor.anchor,
        head: saved.data.cursor.head,
      };
    })
    .toEqual({ file: "store.c", anchor: expectedCursor, head: expectedCursor });
  await expect(page.locator(".save-status")).toHaveText(/Saved to account/);

  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith(draftUrl))
      writes++;
  });
  for (const diagnostic of [libraryDiagnostic, driverDiagnostic]) {
    const button = page
      .locator(".diagnostics")
      .getByRole("button", { name: diagnostic, exact: true });
    await button.click();
    // The location handler schedules source focus after 50 ms. An ignored
    // location must keep focus on its diagnostic button and leave the cursor.
    await page.waitForTimeout(150);
    await expect(button).toBeFocused();
    await expect(
      page
        .locator(".code-pane")
        .getByRole("button", { name: "store.c", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page.waitForTimeout(800);
  expect(writes).toBe(0);
  const unchanged = await draft(page, draftUrl);
  expect(unchanged.data.activeFile).toBe("store.c");
  expect(unchanged.data.cursor).toEqual({
    anchor: expectedCursor,
    head: expectedCursor,
  });
});

async function draft(page: Page, url: string): Promise<Draft> {
  const response = await page.request.get(url);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Draft;
}
