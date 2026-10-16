import Fastify from "fastify";
import statics from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "./db.js";
import { loadCourses } from "./content.js";
import type { Curriculum } from "../shared/content.js";
import type { Context } from "./context.js";
import { notFound, now } from "./context.js";
import { authRoutes } from "./auth.js";
import { draftRoutes } from "./drafts.js";
import { learningRoutes } from "./learning.js";
import { jobRoutes, expireJobs } from "./jobs.js";
import { installResponseValidation } from "./responses.js";
import { dataRoutes } from "./data.js";
export interface AppOptions {
  databasePath: string;
  bootstrapSecret: string;
  runnerSecret?: string;
  publicRegistration?: boolean;
  siteProxySecret?: string;
  exportKey: string;
  secureCookies?: boolean;
  cookieName?: string;
  cookiePath?: string;
  trustProxyLoopback?: boolean;
  content?: Curriculum;
  serveStatic?: boolean;
  staticRoot?: string;
  logger?: boolean;
}
export async function createApp(options: AppOptions) {
  const cookieName = options.cookieName ?? "session";
  const cookiePath = options.cookiePath ?? "/";
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(cookieName)) {
    throw new Error(
      "COOKIE_NAME must be a simple cookie name of up to 64 characters.",
    );
  }
  if (cookiePath !== "/" && !/^\/(?:[A-Za-z0-9_-]+\/)+$/.test(cookiePath)) {
    throw new Error(
      "COOKIE_PATH must be / or an absolute directory path such as /forge/.",
    );
  }
  if (
    options.siteProxySecret &&
    (options.siteProxySecret.length < 32 ||
      options.siteProxySecret.length > 256)
  )
    throw new Error(
      "SITE_PROXY_SECRET must be a separate 32–256 character server credential.",
    );
  const app = Fastify({
      logger: options.logger ?? false,
      bodyLimit: 4 * 1024 * 1024,
      trustProxy: options.trustProxyLoopback
        ? (address) =>
            ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)
        : false,
    }),
    store = new Store(options.databasePath),
    courses = options.content ? [options.content] : loadCourses(),
    content = {
      ...courses[0],
      modules: courses.flatMap((c) => c.modules),
      lessons: courses.flatMap((c) => c.lessons),
      exercises: courses.flatMap((c) => c.exercises),
      projects: courses.flatMap((c) => c.projects),
      references: courses.flatMap((c) => c.references),
    };
  const ctx: Context = {
    app,
    store,
    content,
    courses,
    bootstrapSecret: options.bootstrapSecret,
    runnerSecret: options.runnerSecret ?? "",
    publicRegistration: options.publicRegistration ?? false,
    siteProxySecret: options.siteProxySecret ?? "",
    secureCookies: options.secureCookies ?? false,
    cookieName,
    cookiePath,
    exercise: (id) =>
      content.exercises.find((e) => e.id === id) ?? notFound("Exercise"),
    lesson: (id) =>
      content.lessons.find((l) => l.id === id) ?? notFound("Lesson"),
  };
  store.transaction(() => {
    for (const e of [
      ...content.lessons.map((l) => ({
        id: l.id,
        version: l.version,
        kind: "lesson",
      })),
      ...content.exercises.map((e) => ({
        id: e.id,
        version: e.version,
        kind: "exercise",
      })),
    ])
      store.run(
        "INSERT INTO content_registry VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version",
        e.id,
        e.kind,
        e.version,
      );
  });
  app.setErrorHandler((error, req, reply) => {
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error }, "Request failed");
    reply.code(status).send({
      error:
        status >= 500
          ? "The server encountered an unexpected error. Your last acknowledged save is preserved."
          : (err.message ?? "Invalid request."),
    });
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  installResponseValidation(app);
  await authRoutes(ctx);
  draftRoutes(ctx);
  learningRoutes(ctx);
  jobRoutes(ctx);
  dataRoutes(ctx, options.exportKey);
  app.get("/api/health", async () => ({
    status: "ok",
    database: !!store.get("SELECT version FROM migrations WHERE version=1"),
    storage:
      "configured server SQLite volume; workspace durability depends on host",
    time: now(),
  }));
  const reaper = setInterval(() => expireJobs(ctx), 10000);
  reaper.unref();
  app.addHook("onClose", async () => {
    clearInterval(reaper);
    store.close();
  });
  const staticRoot = resolve(options.staticRoot ?? "dist");
  if (
    options.serveStatic !== false &&
    existsSync(resolve(staticRoot, "index.html"))
  ) {
    await app.register(statics, { root: staticRoot, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/internal/"))
        return reply.code(404).send({ error: "Route not found." });
      return reply.sendFile("index.html");
    });
  }
  return { app, store, ctx };
}
