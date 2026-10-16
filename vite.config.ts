import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export function normalizeBasePath(value: string) {
  if (value === "/") return value;
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\/?$/.test(value)) {
    throw new Error(
      "CFORGE_BASE_PATH must be / or an absolute path such as /forge/.",
    );
  }
  return value.endsWith("/") ? value : `${value}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "CFORGE_");
  const base = normalizeBasePath(
    process.env.CFORGE_BASE_PATH ?? env.CFORGE_BASE_PATH ?? "/",
  );
  const apiPrefix = `${base === "/" ? "" : base.slice(0, -1)}/api`;
  return {
    base,
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        [apiPrefix]: {
          target: "http://127.0.0.1:3000",
          rewrite: (path) =>
            base === "/" ? path : path.slice(base.length - 1),
        },
      },
    },
    build: { outDir: "dist", sourcemap: false },
  };
});
