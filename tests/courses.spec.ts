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
    page.getByRole("heading", { name: "Your workshop", exact: true }),
  ).toBeVisible();
  const cChoice = page.getByRole("button", {
    name: "C programming",
    exact: true,
  });
  const cppChoice = page.getByRole("button", {
    name: "C++ programming",
    exact: true,
  });
  await expect(cChoice).toBeVisible();
  await expect(cppChoice).toBeVisible();
  await expect(cChoice).toHaveAttribute("aria-pressed", "true");
  await expect(cppChoice).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const profile = page.getByRole("dialog", {
    name: "Edit profile",
    exact: true,
  });
  await profile
    .getByLabel("Display name", { exact: true })
    .fill("Workshop learner");
  await profile
    .getByLabel("Profile picture", { exact: true })
    .setInputFiles("public/icons/forge-192.png");
  await expect(profile.locator(".avatar img")).toBeVisible();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/preview-profile.png",
    animations: "disabled",
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await profile
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await expect(profile).toBeHidden();
  await expect(page.locator(".profile-trigger strong")).toHaveText(
    "Workshop learner",
  );
  await expect(page.locator(".profile-trigger img")).toHaveAttribute(
    "src",
    /^data:image\/webp;base64,/,
  );
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await profile
    .getByLabel("Display name", { exact: true })
    .fill("Unsaved name");
  await profile.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".profile-trigger strong")).toHaveText(
    "Workshop learner",
  );
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
  await page.goto(
    "/lesson/source-to-program?exercise=source-to-program-guided",
  );
  const cCode =
    '#include <stdio.h>\n\nint main(void) {\n    puts("My C draft");\n    return 0;\n}\n';
  await editAndVerify("source-to-program-guided", cCode);
  await expect(cppChoice).toBeVisible();
  await cppChoice.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(cppChoice).toHaveAttribute("aria-pressed", "true");
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
  await expect(cChoice).toBeVisible();
  await expect(cppChoice).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Collapse navigation", exact: true })
    .click();
  await expect(cChoice).toBeVisible();
  await expect(cppChoice).toBeVisible();
  await expect(cChoice.locator(".language-logo")).toBeVisible();
  await expect(cppChoice.locator(".language-logo")).toBeVisible();
  await page
    .getByRole("button", { name: "Expand navigation", exact: true })
    .click();
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
  await expect(
    page.getByRole("combobox", { name: "Course", exact: true }),
  ).toHaveCount(0);
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
    other.getByRole("button", { name: "C++ programming", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(other.locator(".profile-trigger strong")).toHaveText(
    "Workshop learner",
  );
  await expect(other.locator(".profile-trigger img")).toHaveAttribute(
    "src",
    /^data:image\/webp;base64,/,
  );
  await other.getByRole("link", { name: "Resume lesson", exact: true }).click();
  await expect(other.getByLabel("Source code editor")).toContainText(
    "Hello, workshop!",
  );
  await other.setViewportSize({ width: 390, height: 844 });
  await other
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await other
    .getByRole("button", { name: "Edit profile", exact: true })
    .click();
  const mobileProfile = other.getByRole("dialog", {
    name: "Edit profile",
    exact: true,
  });
  await expect(
    mobileProfile.getByLabel("Display name", { exact: true }),
  ).toHaveValue("Workshop learner");
  expect(
    await other.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await mobileProfile
    .getByRole("button", { name: "Remove picture", exact: true })
    .click();
  await mobileProfile
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await expect(mobileProfile).toBeHidden();
  await expect(other.locator(".profile-trigger img")).toHaveCount(0);
  await fresh.close();
  await page.goto(
    "/lesson/cpp-source-and-output?exercise=cpp-source-and-output-independent",
  );
  await page.getByLabel("Short answer").fill("compilation");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.locator(".result-feedback")).toContainText("Check passed");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(cChoice).toBeVisible();
  await expect(cppChoice).toBeVisible();
  await expect(cppChoice).toHaveAttribute("aria-pressed", "true");
  await cChoice.press("Enter");
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("link", { name: "Resume lesson", exact: true }),
  ).toHaveAttribute("href", /source-to-program/);
  await page.getByRole("link", { name: "Resume lesson", exact: true }).click();
  await expect(page.getByLabel("Source code editor")).toContainText(
    "My C draft",
  );
  expect(errors).toEqual([]);
});
