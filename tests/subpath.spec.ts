import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Draft } from "../shared/app";

const origin = "https://localhost:3444";
const username = "subpath-learner";
const password = "subpath-password-testing-only";
const bootstrapSecret = "subpath-bootstrap-test-only";
const exerciseId = "source-to-program-guided";
const exerciseRoute = `/forge/lesson/source-to-program?exercise=${exerciseId}`;
const draftRoute = `/forge/api/drafts/${exerciseId}`;
const code =
  '#include <stdio.h>\n\nint main(void) {\n    printf("My saved subpath draft.\\n");\n    return 0;\n}\n';

async function signIn(page: Page) {
  await page.goto("/forge/");
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /Open your workshop|Welcome back/,
    }),
  ).toBeVisible();
  const secret = page.getByLabel("Server bootstrap secret");
  if (await secret.count()) await secret.fill(bootstrapSecret);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel(/^Password/).fill(password);
  await page
    .getByRole("button", { name: /Create my workshop|Continue learning/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make something click." }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${origin}/forge/`);
}
async function openDetails(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").click();
}
async function openCode(page: Page) {
  await page.goto(exerciseRoute);
  await expect(page.getByLabel("Source code editor")).toBeVisible();
}
async function saved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText(/Saved to account/);
}
async function accountDraft(page: Page) {
  const response = await page.request.get(draftRoute);
  expect(response.status()).toBe(200);
  return (await response.json()) as Draft;
}

test.describe
  .serial("the /forge/ installation behind a real stripping gateway", () => {
  test.beforeAll(async () => {
    await mkdir("docs/screenshots", { recursive: true });
  });
  test.beforeEach(async ({ page }, testInfo) => {
    // This journey creates its own fresh mobile context and signs in there.
    if (testInfo.title.startsWith("another phone")) return;
    await signIn(page);
  });

  test("protected owner setup/login and correctly scoped HTTPS cookies", async ({
    page,
    context,
  }) => {
    const cookie = (await context.cookies()).find(
      (value) => value.name === "cforge_session",
    );
    expect(cookie).toMatchObject({
      domain: "localhost",
      path: "/forge/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    });
    expect(cookie?.value.length).toBeGreaterThan(30);
    expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000);
    expect((await page.request.get("/forge/api/me")).status()).toBe(404);
    expect((await page.request.get("/forge/api/auth/me")).status()).toBe(200);
    for (const path of [
      "/internal/lease",
      "/forge/internal/lease",
      "/api/health",
    ]) {
      expect((await page.request.get(path)).status(), path).toBe(404);
    }
    const bare = await page.request.get("/forge", { maxRedirects: 0 });
    expect(bare.status()).toBe(308);
    expect(bare.headers().location).toBe("/forge/");
    const insecure = await page.request.get("http://localhost:3081/forge/", {
      maxRedirects: 0,
    });
    expect(insecure.status()).toBe(308);
    expect(insecure.headers().location).toBe(`${origin}/forge/`);
    const anonymous = await context
      .browser()!
      .newContext({ ignoreHTTPSErrors: true });
    expect(
      (await anonymous.request.get(`${origin}/forge/api/state`)).status(),
    ).toBe(401);
    const rejectedSetup = await anonymous.request.post(
      `${origin}/forge/api/auth/setup`,
      {
        data: {
          username: "another-owner",
          password,
          bootstrapSecret: "incorrect-bootstrap-secret",
        },
      },
    );
    expect(rejectedSetup.status()).toBe(403);
    await anonymous.close();
  });

  test("server autosave restores exact code, step, input, notes, cursor, and pane after reload", async ({
    page,
  }) => {
    await openCode(page);
    const editor = page.getByLabel("Source code editor");
    await editor.click();
    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText(code);
    await page.locator(".lesson-steps button").nth(2).click();
    await openDetails(page, ".stdin-panel");
    await page.getByLabel("Text supplied to the program").fill("12\n34\n");
    await openDetails(page, ".lesson-notes");
    await page
      .getByRole("textbox", { name: "Notes", exact: true })
      .fill("This account saves through a /forge/ HTTPS gateway.");
    await page.getByLabel("Bookmark this exercise").check();
    await page.getByRole("separator", { name: "Resize lesson pane" }).focus();
    await page.keyboard.press("ArrowLeft");
    await saved(page);
    const before = await accountDraft(page);
    expect(before.data).toMatchObject({
      files: { "main.c": code },
      stdin: "12\n34\n",
      step: 2,
      notes: "This account saves through a /forge/ HTTPS gateway.",
      bookmark: true,
      activeFile: "main.c",
      paneSize: 46,
    });
    expect(before.data.cursor.head).toBe(code.length);
    await page.reload();
    await expect(page).toHaveURL(`${origin}${exerciseRoute}`);
    await expect(editor).toContainText("My saved subpath draft.");
    await expect(page.locator(".lesson-steps button").nth(2)).toHaveAttribute(
      "aria-current",
      "step",
    );
    await openDetails(page, ".stdin-panel");
    await expect(page.getByLabel("Text supplied to the program")).toHaveValue(
      "12\n34\n",
    );
    await openDetails(page, ".lesson-notes");
    await expect(
      page.getByRole("textbox", { name: "Notes", exact: true }),
    ).toHaveValue(before.data.notes);
    await expect(
      page.getByRole("separator", { name: "Resize lesson pane" }),
    ).toHaveAttribute("aria-valuenow", "46");
    await page.screenshot({
      path: "docs/screenshots/subpath-desktop-lesson.png",
      fullPage: true,
    });
  });

  test("another phone signs in and resumes the account draft without browser storage", async ({
    browser,
  }) => {
    const phone = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await phone.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await signIn(page);
    await page.getByRole("link", { name: "Resume lesson" }).click();
    await expect(page).toHaveURL(`${origin}${exerciseRoute}`);
    await expect(page.locator(".lesson-steps button").nth(2)).toHaveAttribute(
      "aria-current",
      "step",
    );
    await page.getByRole("tab", { name: "Code", exact: true }).click();
    await expect(page.getByLabel("Source code editor")).toContainText(
      "My saved subpath draft.",
    );
    await saved(page);
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    await page.screenshot({
      path: "docs/screenshots/subpath-phone-lesson.png",
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Learn", exact: true }).click();
    await openDetails(page, ".lesson-notes");
    await expect(
      page.getByRole("textbox", { name: "Notes", exact: true }),
    ).toHaveValue("This account saves through a /forge/ HTTPS gateway.");
    expect(errors).toEqual([]);
    await phone.close();
  });

  test("subpath assets, manifest, settings navigation, and deep links remain inside the installation", async ({
    page,
  }) => {
    const external: string[] = [];
    const failed: string[] = [];
    const fontPaths = new Set<string>();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith(origin)) external.push(request.url());
      if (request.resourceType() === "font")
        fontPaths.add(new URL(request.url()).pathname);
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        failed.push(`${response.status()} ${response.url()}`);
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Make something click." }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(fontPaths.size).toBeGreaterThanOrEqual(2);
    for (const path of fontPaths)
      expect(path).toMatch(/^\/forge\/(fonts|assets)\//);
    const manifestHref = await page
      .locator("link[rel=manifest]")
      .getAttribute("href");
    expect(manifestHref).toBe("/forge/manifest.webmanifest");
    const manifestResponse = await page.request.get(manifestHref!);
    expect(manifestResponse.status()).toBe(200);
    const manifest = (await manifestResponse.json()) as {
      id: string;
      scope: string;
      start_url: string;
      icons: { src: string }[];
    };
    for (const property of [manifest.id, manifest.scope, manifest.start_url])
      expect(new URL(property, `${origin}${manifestHref}`).pathname).toBe(
        "/forge/",
      );
    for (const icon of manifest.icons) {
      const url = new URL(icon.src, `${origin}${manifestHref}`);
      expect(url.pathname).toMatch(/^\/forge\/icons\//);
      const response = await page.request.get(url.href);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(/^image\/png/);
    }
    for (const relation of ["icon", "apple-touch-icon"]) {
      const href = await page
        .locator(`link[rel="${relation}"]`)
        .getAttribute("href");
      expect(href).toMatch(/^\/forge\//);
      expect((await page.request.get(href!)).status()).toBe(200);
    }
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/forge/settings`);
    await expect(
      page.getByRole("heading", { name: "Make room for your attention." }),
    ).toBeVisible();
    await page.getByLabel("Suggested session length").selectOption("30");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(
      page.getByText("Preferences saved to your account."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Suggested session length")).toHaveValue("30");
    for (const route of [
      "/forge/reference",
      "/forge/path",
      "/forge/projects?project=study-tracker",
      exerciseRoute,
    ]) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toBeVisible();
      await page.reload();
      await expect(page.locator("h1")).toBeVisible();
    }
    expect(pageErrors).toEqual([]);
    expect(failed).toEqual([]);
    expect(external).toEqual([]);
  });

  test("native execution stays unavailable while a real conceptual check can fail", async ({
    page,
  }) => {
    await openCode(page);
    const responseEvent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/forge/api/jobs") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Run", exact: true }).click();
    expect((await responseEvent).status()).toBe(503);
    await expect(page.locator(".results-panel")).toContainText(
      "Runner unavailable",
    );
    await expect(page.locator(".results-panel")).not.toContainText(
      "Check passed",
    );
    await page.goto(
      "/forge/lesson/arrays-checkpoint?exercise=arrays-checkpoint-independent",
    );
    await page.locator(".lesson-steps button").nth(2).click();
    await page
      .getByLabel("Short answer")
      .fill("Reading an array outside its bounds is safe.");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.locator(".result-feedback")).toContainText(
      "Check needs another attempt",
    );
    const state = (await (
      await page.request.get("/forge/api/state")
    ).json()) as { progress: { exerciseId: string; proficient: boolean }[] };
    expect(
      state.progress.find(
        (item) => item.exerciseId === "arrays-checkpoint-independent",
      )?.proficient,
    ).toBe(false);
  });

  test("sign-out stays under the base and leaves unrelated session cookies intact", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "session",
        value: "unrelated-service-cookie-test-only",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
    ]);
    await page.goto("/forge/settings");
    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .locator(".session-management-list")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await expect(page).toHaveURL(`${origin}/forge/`);
    const cookies = await context.cookies();
    expect(cookies.some((cookie) => cookie.name === "cforge_session")).toBe(
      false,
    );
    expect(cookies.find((cookie) => cookie.name === "session")?.value).toBe(
      "unrelated-service-cookie-test-only",
    );
    expect((await page.request.get("/forge/api/state")).status()).toBe(401);
    await signIn(page);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await expect(page).toHaveURL(`${origin}/forge/`);
  });
});
