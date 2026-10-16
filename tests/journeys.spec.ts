import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile } from "node:fs/promises";
import type { Draft, LearnerState } from "../shared/app";

const username = "browser-learner";
const password = "browser-test-password-only";
const bootstrapSecret = "browser-bootstrap-secret-for-testing-only";
const screenshots = "docs/screenshots";
let suiteCookies:
  | Parameters<import("@playwright/test").BrowserContext["addCookies"]>[0]
  | null = null;
const draftPath = "/api/drafts/source-to-program-guided";

async function signIn(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /Open your workshop|Welcome back/,
    }),
  ).toBeVisible();
  const setup = page.getByLabel("Server bootstrap secret");
  if (await setup.count()) await setup.fill(bootstrapSecret);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel(/^Password/).fill(password);
  await page
    .getByRole("button", { name: /Create my workshop|Continue learning/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Make something click." }),
  ).toBeVisible();
  suiteCookies = await page.context().cookies();
}
async function openLesson(
  page: Page,
  lessonId = "source-to-program",
  exerciseId = `${lessonId}-guided`,
) {
  await page.goto(`/lesson/${lessonId}?exercise=${exerciseId}`);
  await expect(page.locator(".save-status")).toBeVisible();
  await expect(page.getByLabel("Source code editor")).toBeVisible();
}
async function replaceCode(page: Page, code: string) {
  const editor = page.getByLabel("Source code editor");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
}
async function openDetails(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").click();
}
async function saved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText(/Saved to account/);
}
async function accountDraft(page: Page, path = draftPath) {
  const response = await page.request.get(path);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Draft;
}
async function noHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
}

test.describe.serial("the learner workspace", () => {
  test.beforeAll(async () => {
    await mkdir(screenshots, { recursive: true });
  });
  test.beforeEach(async ({ page }) => {
    if (suiteCookies) {
      await page.context().addCookies(suiteCookies);
      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1, name: "Make something click." }),
      ).toBeVisible();
    } else await signIn(page);
  });

  test("owner setup, account save, reopen, and sign-in restore exact work", async ({
    page,
    browser,
  }) => {
    await openLesson(page);
    const code =
      '#include <stdio.h>\n\nint main(void) {\n    printf("Returned to my draft.\\n");\n    return 0;\n}\n';
    await replaceCode(page, code);
    await page.locator(".lesson-steps button").nth(2).click();
    await openDetails(page, ".stdin-panel");
    await page
      .getByLabel("Text supplied to the program")
      .fill("saved batch input\n");
    await openDetails(page, ".lesson-notes");
    await page
      .getByLabel("Notes", { exact: true })
      .fill("Compilation builds a program; execution runs it.");
    await page.getByLabel("Bookmark this exercise").check();
    await saved(page);
    const draft = await accountDraft(page);
    expect(draft.data).toMatchObject({
      files: { "main.c": code },
      stdin: "saved batch input\n",
      notes: "Compilation builds a program; execution runs it.",
      bookmark: true,
      step: 2,
      activeFile: "main.c",
    });

    const cookies = await page.context().storageState();
    const reopened = await browser.newContext({
      storageState: cookies,
      baseURL: "http://127.0.0.1:3100",
    });
    const reopenedPage = await reopened.newPage();
    await reopenedPage.goto("/");
    await reopenedPage.getByRole("link", { name: "Resume lesson" }).click();
    await expect(reopenedPage.getByLabel("Source code editor")).toContainText(
      "Returned to my draft.",
    );
    await expect(
      reopenedPage.locator(".lesson-steps button").nth(2),
    ).toHaveAttribute("aria-current", "step");
    await expect(reopenedPage.locator(".save-status")).toHaveText(
      /Saved to account/,
    );
    await reopened.close();

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await signIn(page);
    await page.getByRole("link", { name: "Resume lesson" }).click();
    await expect(page.getByLabel("Source code editor")).toContainText(
      "Returned to my draft.",
    );
    await openDetails(page, ".stdin-panel");
    await expect(page.getByLabel("Text supplied to the program")).toHaveValue(
      "saved batch input\n",
    );
    await openDetails(page, ".lesson-notes");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
      "Compilation builds a program; execution runs it.",
    );
  });

  test("slow save responses cannot replace a newer editor draft", async ({
    page,
  }) => {
    await openLesson(page);
    let delayFirst = true;
    let announce!: () => void;
    const firstSent = new Promise<void>((resolve) => {
      announce = resolve;
    });
    await page.route(
      "**/api/drafts/source-to-program-guided",
      async (route) => {
        if (route.request().method() !== "PUT" || !delayFirst)
          return route.continue();
        delayFirst = false;
        const response = await route.fetch();
        announce();
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.fulfill({ response });
      },
    );
    await replaceCode(page, "int main(void) { return 1; }\n");
    await firstSent;
    const newest = "int main(void) { return 0; } /* newest edit */\n";
    await replaceCode(page, newest);
    await saved(page);
    expect((await accountDraft(page)).data.files["main.c"]).toBe(newest);
    await expect(page.getByLabel("Source code editor")).toContainText(
      "newest edit",
    );
    await page.reload();
    await expect(page.getByLabel("Source code editor")).toContainText(
      "newest edit",
    );
  });

  test("offline local recovery syncs on reconnect without queuing executions", async ({
    page,
    context,
  }) => {
    await openLesson(page);
    await saved(page);
    const code = "int main(void) { return 0; } /* written offline */\n";
    await context.setOffline(true);
    await expect(page.locator(".offline-banner")).toBeVisible();
    await replaceCode(page, code);
    await expect(page.locator(".save-status")).toHaveText(
      /Saved on this device/,
    );
    let submissions = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/jobs"))
        submissions++;
    });
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.locator(".results-panel")).toContainText(
      "Runner unavailable",
    );
    await context.setOffline(false);
    await saved(page);
    expect((await accountDraft(page)).data.files["main.c"]).toBe(code);
    await page.waitForTimeout(500);
    expect(submissions).toBe(1);
    const state = (await (
      await page.request.get("/api/state")
    ).json()) as LearnerState;
    expect(
      state.progress.some(
        (p) => p.exerciseId === "source-to-program-guided" && p.proficient,
      ),
    ).toBeFalsy();
  });

  test("two tabs preserve and resolve an actual revision conflict", async ({
    page,
    context,
  }) => {
    await openLesson(page);
    await saved(page);
    const other = await context.newPage();
    await openLesson(other);
    await saved(other);
    const first = "int main(void) { return 0; } /* tab one */\n";
    const second = "int main(void) { return 0; } /* tab two */\n";
    await replaceCode(page, first);
    await saved(page);
    await replaceCode(other, second);
    const dialog = other.getByRole("dialog", {
      name: "Two drafts need your choice",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("tab one");
    await expect(dialog).toContainText("tab two");
    await other.screenshot({
      path: `${screenshots}/draft-conflict.png`,
      fullPage: true,
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Use this device’s version" })
      .click();
    await saved(other);
    expect((await accountDraft(other)).data.files["main.c"]).toBe(second);
    const history = (await (
      await other.request.get(`${draftPath}/history`)
    ).json()) as { draft: Draft }[];
    expect(
      history.some((item) => item.draft.data.files["main.c"] === first),
    ).toBeTruthy();
    expect(
      history.some((item) => item.draft.data.files["main.c"] === second),
    ).toBeTruthy();
    await other.close();
  });

  test("save failure is honest and a manual retry preserves the source", async ({
    page,
  }) => {
    await openLesson(page);
    await page.route("**/api/drafts/source-to-program-guided", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "The account save service is unavailable. Device recovery is intact.",
            }),
          })
        : route.continue(),
    );
    const code =
      "int main(void) { return 0; } /* recover after save failure */\n";
    await replaceCode(page, code);
    await expect(page.locator(".save-status")).toHaveText(/Save failed/);
    await expect(page.getByLabel("Source code editor")).toContainText(
      "recover after save failure",
    );
    await page.screenshot({
      path: `${screenshots}/save-failure.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.unroute("**/api/drafts/source-to-program-guided");
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await saved(page);
    expect((await accountDraft(page)).data.files["main.c"]).toBe(code);
  });

  test("real unavailable-runner feedback and a real conceptual failed check", async ({
    page,
  }) => {
    await openLesson(page);
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.locator(".results-panel")).toContainText(
      "Runner unavailable",
    );
    await expect(page.locator(".results-panel")).toContainText(
      /Isolated C execution is unavailable|worker/,
    );
    await page.screenshot({
      path: `${screenshots}/runner-unavailable.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.goto(
      "/lesson/arrays-checkpoint?exercise=arrays-checkpoint-independent",
    );
    await page.locator(".lesson-steps button").nth(2).click();
    await page
      .getByLabel("Short answer")
      .fill("outside array bounds is always safe");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.locator(".result-feedback")).toContainText(
      "Check needs another attempt",
    );
    await page.screenshot({
      path: `${screenshots}/failed-conceptual-check.png`,
      fullPage: true,
      animations: "disabled",
    });
  });

  test("JSON export, preview, preserving import, and replacement import round trip", async ({
    page,
  }) => {
    await openLesson(page);
    await openDetails(page, ".lesson-notes");
    await page
      .getByLabel("Notes", { exact: true })
      .fill("A note to round-trip through JSON.");
    await saved(page);
    const before = await accountDraft(page);
    await page.goto("/settings");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export learner data" }).click();
    const download = await downloadEvent;
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();
    const exportText = await readFile(downloadedPath!, "utf8");
    const exported = JSON.parse(exportText) as {
      format: string;
      data: { drafts: Draft[] };
    };
    expect(exported.format).toBe("c-forge");
    expect(
      exported.data.drafts.some(
        (draft) => draft.data.notes === before.data.notes,
      ),
    ).toBeTruthy();
    expect(exportText).not.toContain("password_hash");

    await openLesson(page);
    await openDetails(page, ".lesson-notes");
    await page
      .getByLabel("Notes", { exact: true })
      .fill("Keep this existing note on preserving import.");
    await saved(page);
    await page.goto("/settings");
    await page.locator("input[type=file]").setInputFiles({
      name: "learner-export.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportText),
    });
    await expect(
      page.getByRole("heading", {
        name: "Review the import before applying it.",
      }),
    ).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .getByRole("button", { name: "Confirm preserving import" })
      .click();
    await expect(
      page.getByText("Import completed. Your account data has been refreshed."),
    ).toBeVisible();
    expect((await accountDraft(page)).data.notes).toBe(
      "Keep this existing note on preserving import.",
    );

    await page.locator("input[type=file]").setInputFiles({
      name: "learner-export.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportText),
    });
    await page.getByLabel("Replace learner data").check();
    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .getByRole("button", { name: "Confirm replacement import" })
      .click();
    await expect(
      page.getByText("Import completed. Your account data has been refreshed."),
    ).toBeVisible();
    expect((await accountDraft(page)).data.notes).toBe(before.data.notes);
    await openLesson(page);
    await expect(page.getByLabel("Source code editor")).toContainText(
      "recover after save failure",
    );
  });

  test("desktop, tablet, mobile, genuine page screenshots, and console health", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/");
    await expect(page).toHaveTitle(/C Forge/);
    await page.screenshot({
      path: `${screenshots}/home-dark.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/path");
    await expect(
      page.getByRole("heading", { name: "One clear path. Your own pace." }),
    ).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/learning-path-dark.png`,
      fullPage: true,
      animations: "disabled",
    });
    await openLesson(page);
    await page.locator(".lesson-steps button").nth(0).click();
    await saved(page);
    await page.screenshot({
      path: `${screenshots}/lesson-desktop.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/projects?project=study-tracker");
    await expect(
      page.getByRole("heading", { name: "The final rubric" }),
    ).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/project-workspace.png`,
      fullPage: true,
      animations: "disabled",
    });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        "/",
        "/path",
        "/projects",
        "/settings",
        "/lesson/source-to-program",
      ]) {
        await page.goto(route);
        await expect(page.locator("h1")).toBeVisible();
        await noHorizontalOverflow(page);
      }
    }
    await page.getByRole("tab", { name: "Code", exact: true }).click();
    await expect(page.getByLabel("Source code editor")).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/lesson-mobile-code.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("tab", { name: "Results", exact: true }).click();
    await expect(page.locator(".results-panel")).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/lesson-mobile-results.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  });

  test("WCAG automated checks on light/dark core screens and keyboard modal behavior", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const findings: { theme: string; route: string; violations: unknown[] }[] =
      [];
    for (const theme of ["dark", "light"]) {
      await page.goto("/settings");
      const state = (await (
        await page.request.get("/api/state")
      ).json()) as LearnerState;
      if (state.preferences.theme !== theme) {
        await page.getByLabel("Theme", { exact: true }).selectOption(theme);
        await page.getByRole("button", { name: "Save preferences" }).click();
        await expect(
          page.getByText("Preferences saved to your account."),
        ).toBeVisible();
      }
      for (const route of [
        "/",
        "/path",
        "/lesson/source-to-program",
        "/projects",
        "/settings",
      ]) {
        await page.goto(route);
        await expect(page.locator("h1")).toBeVisible();
        if (route.startsWith("/lesson/"))
          await expect(page.getByLabel("Source code editor")).toBeVisible();
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        if (scan.violations.length)
          findings.push({
            theme,
            route,
            violations: scan.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              description: violation.description,
              nodes: violation.nodes.map((node) => ({
                target: node.target,
                summary: node.failureSummary,
              })),
            })),
          });
      }
      if (theme === "light") {
        await page.goto("/");
        await page.screenshot({
          path: `${screenshots}/home-light.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    await openLesson(page);
    await page.getByRole("button", { name: "Restore starter code" }).click();
    const dialog = page.getByRole("dialog", { name: "Restore the starter?" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Restore starter", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Restore starter code" }),
    ).toBeFocused();
    expect(findings).toEqual([]);
  });
});
