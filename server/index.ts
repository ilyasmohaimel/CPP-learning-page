import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createApp } from "./app.js";
const dataDir = resolve(process.env.DATA_DIR ?? ".data");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
function key(name: string) {
  const path = resolve(dataDir, name);
  if (!existsSync(path))
    writeFileSync(path, randomBytes(32).toString("base64url"), {
      mode: 0o600,
      flag: "wx",
    });
  return readFileSync(path, "utf8").trim();
}
const bootstrapSecret = process.env.BOOTSTRAP_SECRET ?? key("bootstrap-secret");
const exportKey = process.env.EXPORT_KEY ?? key("export-key");
const { app } = await createApp({
  databasePath: process.env.DATABASE_PATH ?? resolve(dataDir, "c-forge.sqlite"),
  bootstrapSecret,
  exportKey,
  runnerSecret: process.env.RUNNER_SECRET,
  publicRegistration: process.env.PUBLIC_REGISTRATION === "true",
  siteProxySecret: process.env.SITE_PROXY_SECRET,
  secureCookies: process.env.COOKIE_SECURE === "true",
  cookieName: process.env.COOKIE_NAME,
  cookiePath: process.env.COOKIE_PATH,
  trustProxyLoopback: process.env.TRUST_PROXY_LOOPBACK === "true",
  logger: true,
});
const host = process.env.HOST ?? "127.0.0.1",
  port = Number(process.env.PORT ?? 3000);
await app.listen({ host, port });
console.log(
  `C Forge listening on http://${host}:${port}. Bootstrap secret is stored in ${dataDir}/bootstrap-secret; no credentials are printed.`,
);
for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
