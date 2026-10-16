import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";

test("both courses preserve drafts, course choice and resume across switches and fresh login", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Username", { exact: true }).fill("preview-learner");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByLabel("Repeat password").fill("browser-test-password-only");
  await page
    .getByRole("button", { name: "Create my workshop", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make something click." }),
  ).toBeVisible();
  const identity = await (await page.request.get("/api/auth/me")).json();
  async function editAndVerify(exercise: string, code: string) {
    const editor = page.getByLabel("Source code editor");
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText(code);
    await expect
      .poll(async () => {
        const result = await page.request.get(`/api/drafts/${exercise}`, {
          headers: { "x-cforge-account-id": identity.id },
        });
        const draft = await result.json();
        return draft?.data?.files[Object.keys(draft.data.files)[0]];
      })
      .toBe(code);
  }
  await page
    .getByRole("combobox", { name: "Course", exact: true })
    .selectOption("c17");
  await page.goto(
    "/lesson/source-to-program?exercise=source-to-program-guided",
  );
  const cCode =
    '#include <stdio.h>\n\nint main(void) {\n    puts("My C draft");\n    return 0;\n}\n';
  await editAndVerify("source-to-program-guided", cCode);
  await page
    .getByRole("combobox", { name: "Course", exact: true })
    .selectOption("cpp20");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("combobox", { name: "Course", exact: true }),
  ).toHaveValue("cpp20");
  await page.getByRole("link", { name: "Learning path", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Already know some C?" }),
  ).toBeHidden();
  await expect(page.locator(".course-outline")).toContainText("48");
  await page.getByRole("link", { name: "Reference", exact: true }).click();
  await expect(page.locator(".search-meta")).toContainText("48 entries");
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Number toolkit", exact: true }),
  ).toBeVisible();
  await page.goto(
    "/lesson/cpp-source-and-output?exercise=cpp-source-and-output-guided",
  );
  const cppCode =
    '#include <iostream>\n\nint main() {\n    std::cout << "Hello, workshop!\\n";\n}\n';
  await editAndVerify("cpp-source-and-output-guided", cppCode);
  await expect(page.locator(".editor-toolbar")).toContainText("C++20");
  await expect(
    page.getByRole("button", { name: "main.cpp", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.locator(".results-panel")).toContainText(
    "Runner unavailable",
  );
  await expect(page.locator(".results-panel")).not.toContainText(
    "checks passed",
  );
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/preview-cpp-workspace.png",
    animations: "disabled",
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(page.getByLabel("Source code editor")).toContainText(
    "Hello, workshop!",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(
    await page
      .getByRole("combobox", { name: "Course", exact: true })
      .evaluate((select) => select.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(110);
  await page.screenshot({
    path: "docs/screenshots/preview-mobile.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Resume lesson", exact: true }),
  ).toHaveAttribute("href", /cpp-source-and-output/);
  await page.screenshot({
    path: "docs/screenshots/preview-home.png",
    animations: "disabled",
  });
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto("http://127.0.0.1:3116/");
  await other.getByLabel("Username", { exact: true }).fill("preview-learner");
  await other.getByLabel(/^Password/).fill("browser-test-password-only");
  await other
    .getByRole("button", { name: "Continue learning", exact: true })
    .click();
  await expect(
    other.getByRole("combobox", { name: "Course", exact: true }),
  ).toHaveValue("cpp20");
  await other.getByRole("link", { name: "Resume lesson", exact: true }).click();
  await expect(other.getByLabel("Source code editor")).toContainText(
    "Hello, workshop!",
  );
  await fresh.close();
  await page.goto(
    "/lesson/cpp-source-and-output?exercise=cpp-source-and-output-independent",
  );
  await page.getByLabel("Short answer").fill("compilation");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.locator(".result-feedback")).toContainText("Check passed");

  await page
    .getByRole("combobox", { name: "Course", exact: true })
    .selectOption("c17");
  await expect(
    page.getByRole("link", { name: "Resume lesson", exact: true }),
  ).toHaveAttribute("href", /source-to-program/);
  await page.getByRole("link", { name: "Resume lesson", exact: true }).click();
  await expect(page.getByLabel("Source code editor")).toContainText(
    "My C draft",
  );
  expect(errors).toEqual([]);
});
