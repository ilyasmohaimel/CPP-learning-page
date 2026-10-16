import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const origin = "https://localhost:3443",
  username = "https-test-owner",
  password = "https-password-test-only";
async function login(page: Page) {
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: /Open your workshop|Welcome back/ }),
  ).toBeVisible();
  const secret = page.getByLabel("Server bootstrap secret");
  if (await secret.count()) await secret.fill("https-bootstrap-test-only");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel(/^Password/).fill(password);
  await page
    .getByRole("button", { name: /Create my workshop|Continue learning/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your workshop", exact: true }),
  ).toBeVisible();
}
test("actual HTTPS gateway supports desktop to phone account resume, secure cookies, compression, and private worker routes", async ({
  browser,
  request,
}) => {
  const desktop = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    }),
    phone = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
  try {
    const pc = await desktop.newPage();
    await login(pc);
    const cookies = await desktop.cookies();
    const session = cookies.find((c) => c.name === "session");
    expect(session?.secure).toBe(true);
    expect(session?.httpOnly).toBe(true);
    await expect
      .poll(() =>
        pc.evaluate(
          () =>
            window.isSecureContext && typeof crypto.randomUUID === "function",
        ),
      )
      .toBe(true);
    await pc.goto("/lesson/source-to-program");
    const code =
      '#include <stdio.h>\nint main(void) { printf("Saved from my Linux browser.\\n"); return 0; }\n';
    await pc.getByLabel("Source code editor").click();
    await pc.getByLabel("Source code editor").press("ControlOrMeta+A");
    await pc.keyboard.insertText(code);
    await expect(pc.locator(".save-status")).toContainText("Saved to account");
    const mobile = await phone.newPage();
    await login(mobile);
    await mobile.getByRole("link", { name: "Resume lesson" }).click();
    await mobile.getByRole("tab", { name: "Code", exact: true }).click();
    await expect(mobile.getByLabel("Source code editor")).toContainText(
      "Saved from my Linux browser.",
    );
    const mobileCode = code.replace("Linux browser", "phone");
    await mobile.getByLabel("Source code editor").click();
    await mobile.getByLabel("Source code editor").press("ControlOrMeta+A");
    await mobile.keyboard.insertText(mobileCode);
    await expect(mobile.locator(".save-status")).toContainText(
      "Saved to account",
    );
    await pc.reload();
    await expect(pc.getByLabel("Source code editor")).toContainText(
      "Saved from my phone.",
    );
    await pc.screenshot({
      path: "docs/screenshots/https-desktop-account-resume.png",
      animations: "disabled",
    });
    expect(await pc.evaluate(() => document.cookie.includes("session="))).toBe(
      false,
    );
    await mobile.goto("/settings");
    await expect(
      mobile.getByLabel("Workshop address", { exact: true }),
    ).toHaveValue(origin + "/");
    await mobile.getByRole("button", { name: "Copy workshop address" }).click();
    await expect(
      mobile.getByRole("status").filter({
        hasText: /Workshop address copied|Clipboard access was unavailable/,
      }),
    ).toBeVisible();
    await mobile.locator(".device-access").screenshot({
      path: "docs/screenshots/https-phone-access-settings.png",
      animations: "disabled",
    });
    expect((await request.get("/internal/runner/lease")).status()).toBe(404);
    expect(
      (
        await request.post("/internal/runner/heartbeat", {
          data: { workerId: "public", available: true, detail: "forged" },
        })
      ).status(),
    ).toBe(404);
    const health = await request.get("/api/health");
    expect(health.ok()).toBe(true);
    expect((await health.json()).database).toBe(true);
    const course = await pc.request.get("/api/course", {
      headers: { "accept-encoding": "gzip" },
    });
    expect(course.headers()["content-encoding"]).toBe("gzip");
    const plain = await request.get(
      "http://localhost:3080/lesson/source-to-program",
      { maxRedirects: 0 },
    );
    expect(plain.status()).toBe(308);
    // Caddy redirects to the standard public TLS port. The test fixture only
    // changes its listening ports to avoid touching host ports 80/443.
    expect(plain.headers().location).toBe(
      "https://localhost/lesson/source-to-program",
    );
  } finally {
    await desktop.close();
    await phone.close();
  }
});
test("phone installation metadata and all icons are served locally over HTTPS", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/forge-180.png",
  );
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "C Forge Coding Workshop",
    start_url: "./",
    scope: "./",
    display: "standalone",
  });
  for (const icon of manifest.icons as {
    src: string;
    sizes: string;
    purpose: string;
  }[]) {
    expect(icon.src).toMatch(/^icons\//);
    const fetched = await request.get(new URL(icon.src, response.url()).href);
    expect(fetched.ok()).toBe(true);
    expect(fetched.headers()["content-type"]).toContain("image/png");
    const bytes = await fetched.body();
    const size = Number(icon.sizes.split("x")[0]);
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
  const apple = readFileSync("public/icons/forge-180.png");
  expect(apple.readUInt32BE(16)).toBe(180);
  expect(apple.readUInt32BE(20)).toBe(180);
});
