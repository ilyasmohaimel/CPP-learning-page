import { spawn } from "node:child_process";
const children = [
  spawn(
    process.execPath,
    [
      "--env-file-if-exists=.env",
      "--import",
      "tsx",
      "--watch",
      "server/index.ts",
    ],
    { stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"],
    { stdio: "inherit" },
  ),
];
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    children.forEach((p) => p.kill(sig));
  });
for (const p of children)
  p.on("exit", (code) => {
    if (code && code !== 0) {
      children.forEach((c) => c.kill());
      process.exitCode = code;
    }
  });
