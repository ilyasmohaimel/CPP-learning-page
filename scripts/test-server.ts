/** Local browser-test fixture. Public test credentials are never production defaults. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";

const directory = mkdtempSync(join(tmpdir(), "c-forge-browser-"));
const { app } = await createApp({
  databasePath: join(directory, "learner.sqlite"),
  bootstrapSecret: "browser-bootstrap-secret-for-testing-only",
  exportKey: "browser-export-key-for-testing-only",
  serveStatic: true,
  publicRegistration: process.env.CFORGE_TEST_PUBLIC_REGISTRATION === "true",
});
await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.CFORGE_TEST_PORT ?? 3100),
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void app.close().finally(() => {
      rmSync(directory, { recursive: true, force: true });
      process.exit(0);
    });
  });
}
