/** Ephemeral /forge/ fixture. Never opens production databases or credentials. */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createApp } from "../server/app.js";

const directory = mkdtempSync(join(tmpdir(), "c-forge-subpath-"));
const staticRoot = join(directory, "dist");
const builder = spawn(
  process.execPath,
  [
    resolve("node_modules/vite/bin/vite.js"),
    "build",
    "--outDir",
    staticRoot,
    "--emptyOutDir",
  ],
  {
    env: { ...process.env, CFORGE_BASE_PATH: "/forge/" },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
await new Promise<void>((done, reject) => {
  builder.once("error", reject);
  builder.once("exit", (code) =>
    code === 0
      ? done()
      : reject(new Error(`Subpath Vite build failed (${code}).`)),
  );
});
const { app } = await createApp({
  databasePath: join(directory, "test.sqlite"),
  bootstrapSecret: "subpath-bootstrap-test-only",
  exportKey: "subpath-export-test-only",
  secureCookies: true,
  cookieName: "cforge_session",
  cookiePath: "/forge/",
  trustProxyLoopback: true,
  staticRoot,
  serveStatic: true,
});
await app.listen({ host: "127.0.0.1", port: 3301 });
const config = join(directory, "Caddyfile");
writeFileSync(
  config,
  `{
  admin off
  skip_install_trust
  http_port 3081
  https_port 3444
  auto_https disable_redirects
}
http://localhost:3081 {
  bind 127.0.0.1
  redir https://localhost:3444{uri} 308
}
https://localhost:3444 {
  bind 127.0.0.1
  tls internal
  route {
    @private path /internal /internal/* /forge/internal /forge/internal/*
    respond @private 404
    @bare path /forge
    redir @bare /forge/ 308
    handle_path /forge/* {
      reverse_proxy 127.0.0.1:3301
    }
    handle {
      respond 404
    }
  }
}
`,
);
const gateway = spawn(
  process.env.CADDY_BINARY ?? "caddy",
  ["run", "--config", config, "--adapter", "caddyfile"],
  {
    env: {
      ...process.env,
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
  await new Promise<void>((done) => {
    if (gateway.exitCode !== null) return done();
    const timer = setTimeout(() => {
      gateway.kill("SIGKILL");
      done();
    }, 3000);
    gateway.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
  rmSync(directory, { recursive: true, force: true });
  process.exit(code);
}
gateway.on("error", (error) => {
  console.error(
    "Subpath tests need Caddy; set CADDY_BINARY to the installed binary.",
    error.message,
  );
  void shutdown(1);
});
gateway.on("exit", (code) => {
  if (!stopping) void shutdown(code ?? 1);
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => void shutdown(0));
