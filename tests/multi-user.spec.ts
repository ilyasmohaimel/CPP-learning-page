import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const password = "fictional-browser-friend-password-only";
const exercise = "source-to-program-guided";
const url = "/lesson/source-to-program?exercise=" + exercise;
const source = (person: string) =>
  "#include <stdio.h>\n\n/* Private to " +
  person +
  '. */\nint main(void) {\n    printf("Forge ready.\\n");\n    return 0;\n}\n';
async function signup(page: Page, name: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByLabel("Server bootstrap secret")).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Repeat password").fill(password);
  await page
    .getByRole("button", { name: "Create my workshop", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your workshop", exact: true }),
  ).toBeVisible();
}
async function login(page: Page, name: string) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Continue learning", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your workshop", exact: true }),
  ).toBeVisible();
}
async function edit(page: Page, code: string) {
  const editor = page.getByLabel("Source code editor");
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
}
async function saved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText(/Saved to account/);
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: "docs/screenshots/" + name,
    fullPage: true,
    animations: "disabled",
    mask: [page.locator(".sidebar-bottom")],
  });
}
test("public signup gives friends private drafts, independent resume, mobile access and safe shared-browser account switching", async ({
  browser,
  page,
}) => {
  await mkdir("docs/screenshots", { recursive: true });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create your workshop" }),
  ).toBeVisible();
  await screenshot(page, "public-registration.png");
  await signup(page, "browser_alice");
  await page.goto(url);
  await edit(page, source("Alice"));
  await saved(page);
  const staleTab = await page.context().newPage();
  await staleTab.goto(url);
  await expect(staleTab.getByLabel("Source code editor")).toContainText(
    "Private to Alice",
  );
  const friend = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await friend.newPage();
  await signup(phone, "browser_bob");
  await expect(phone.getByRole("link", { name: "Resume lesson" })).toHaveCount(
    0,
  );
  await phone.goto(url);
  await phone.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(phone.getByLabel("Source code editor")).not.toContainText(
    "Private to Alice",
  );
  await edit(phone, source("Bob"));
  await saved(phone);
  await screenshot(phone, "public-friend-mobile.png");
  const response = await phone.request.get("/api/auth/me");
  const b = (await response.json()) as { id: string };
  const a = (await (await page.request.get("/api/auth/me")).json()) as {
    id: string;
  };
  expect(a.id).not.toEqual(b.id);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "browser_bob");
  await page.getByRole("link", { name: "Resume lesson" }).click();
  await expect(page.getByLabel("Source code editor")).toContainText(
    "Private to Bob",
  );
  await expect(page.getByLabel("Source code editor")).not.toContainText(
    "Private to Alice",
  );
  // The old tab still thinks Alice is signed in, but the shared cookie now names Bob.
  // Its account header must be rejected instead of copying Alice's source to Bob.
  await edit(staleTab, source("Alice stale tab must remain private"));
  await expect(
    staleTab.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await phone.reload();
  await phone.getByRole("tab", { name: "Code", exact: true }).click();
  await expect(phone.getByLabel("Source code editor")).toContainText(
    "Private to Bob",
  );
  await expect(phone.getByLabel("Source code editor")).not.toContainText(
    "stale tab",
  );
  const fresh = await browser.newContext();
  const reopened = await fresh.newPage();
  await login(reopened, "browser_alice");
  await reopened.getByRole("link", { name: "Resume lesson" }).click();
  await expect(reopened.getByLabel("Source code editor")).toContainText(
    "Private to Alice",
  );
  await expect(reopened.getByLabel("Source code editor")).not.toContainText(
    "Private to Bob",
  );
  expect(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await fresh.close();
  await friend.close();
});

test("light is the default, explicit dark survives first paint and fresh login, system choice reacts, and account themes stay separate", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await signup(page, "theme_alice");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page
      .getByRole("button", { name: "Switch to dark theme", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(
      "**/api/auth/me",
      async (route) => {
        await held;
        await route.continue();
      },
      { times: 1 },
    );
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(
        page.getByText("Opening your workshop…", { exact: true }),
      ).toBeVisible();
    } finally {
      release();
    }
    await expect(
      page.getByRole("heading", { name: "Your workshop", exact: true }),
    ).toBeVisible();
    const secondDevice = await browser.newContext({ colorScheme: "light" });
    const second = await secondDevice.newPage();
    try {
      await login(second, "theme_alice");
      await expect(second.locator("html")).toHaveAttribute(
        "data-theme",
        "dark",
      );
      await second.reload();
      await expect(second.locator("html")).toHaveAttribute(
        "data-theme",
        "dark",
      );
    } finally {
      await secondDevice.close();
    }
    await page
      .locator(".sidebar-bottom")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await signup(page, "theme_bob");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.goto("/settings");
    await page.getByLabel("Theme", { exact: true }).selectOption("system");
    await page
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await expect(
      page.getByText("Preferences saved to your account."),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page
      .getByRole("button", { name: "Switch to dark theme", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("button", { name: "Switch to light theme", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page
      .locator(".sidebar-bottom")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await login(page, "theme_alice");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  } finally {
    await context.close();
  }
});
