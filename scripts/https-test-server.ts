/** Isolated HTTPS gateway fixture; never loads production credentials or databases. */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createApp } from "../server/app.js";
const directory = mkdtempSync(join(tmpdir(), "c-forge-https-"));
const { app } = await createApp({
  databasePath: join(directory, "test.sqlite"),
  bootstrapSecret: "https-bootstrap-test-only",
  exportKey: "https-export-test-only",
  secureCookies: true,
  serveStatic: true,
});
await app.listen({ host: "127.0.0.1", port: 3300 });
const production = readFileSync("deploy/Caddyfile", "utf8");
const fixture =
  "{\n admin off\n skip_install_trust\n http_port 3080\n https_port 3443\n}\n" +
  production.replace("{$CFORGE_DOMAIN} {", "{$CFORGE_DOMAIN} {\n tls internal");
const config = join(directory, "Caddyfile");
writeFileSync(config, fixture);
const gateway = spawn(
  process.env.CADDY_BINARY ?? "caddy",
  ["run", "--config", config, "--adapter", "caddyfile"],
  {
    env: {
      ...process.env,
      CFORGE_DOMAIN: "localhost:3443",
      CFORGE_UPSTREAM: "127.0.0.1:3300",
      XDG_DATA_HOME: join(directory, "gateway-data"),
      XDG_CONFIG_HOME: join(directory, "gateway-config"),
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
let stopping = false;
async function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  gateway.kill("SIGTERM");
  await app.close();
  await new Promise<void>((resolve) => {
    if (gateway.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      gateway.kill("SIGKILL");
      resolve();
    }, 3000);
    gateway.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  rmSync(directory, { recursive: true, force: true });
  process.exit(code);
}
gateway.on("error", (error) => {
  console.error(
    "HTTPS tests need an installed Caddy binary or CADDY_BINARY path.",
    error.message,
  );
  void shutdown(1);
});
gateway.on("exit", (code) => {
  if (!stopping) void shutdown(code ?? 1);
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => void shutdown(0));
