import cookie from "@fastify/cookie";
import argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { clientIdentity, rateLimit } from "./rate-limit.js";
import { defaultPreferences } from "../shared/app.js";
import { parse } from "./validation.js";
import { requireOwner, now, type Context } from "./context.js";
export { hashToken, safeEqual } from "./security.js";
import { hashToken, safeEqual } from "./security.js";
export async function authRoutes(ctx: Context) {
  const { app, store } = ctx;
  await app.register(cookie);
  app.decorateRequest("ownerId", null);
  app.decorateRequest("sessionId", null);
  app.decorateRequest("accountRole", null);
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/internal/")) return;
    const token = req.cookies[ctx.cookieName];
    if (token) {
      const s = store.get<{
        id: string;
        owner_id: string;
        role: "admin" | "learner";
      }>(
        "SELECT sessions.id,owner_id,role FROM sessions JOIN owner ON owner.id=sessions.owner_id WHERE token_hash=? AND expires_at>?",
        hashToken(token),
        now(),
      );
      if (s) {
        req.ownerId = s.owner_id;
        req.sessionId = s.id;
        req.accountRole = s.role;
      }
    }
    const expected = req.headers["x-cforge-account-id"];
    const publicAuth = [
      "/api/auth/me",
      "/api/auth/status",
      "/api/auth/register",
      "/api/auth/login",
      "/api/auth/setup",
    ].includes(req.url.split("?")[0]);
    if (
      ctx.publicRegistration &&
      req.url.startsWith("/api/") &&
      req.accountRole === "learner" &&
      !publicAuth &&
      typeof expected !== "string"
    )
      throw Object.assign(
        new Error(
          "Reload the workshop to use account-scoped requests. Your saved code remains separate.",
        ),
        { statusCode: 401 },
      );
    if (
      req.ownerId &&
      typeof expected === "string" &&
      expected !== req.ownerId
    ) {
      throw Object.assign(
        new Error(
          "The signed-in account changed. Sign in again before continuing; your device draft remains separate.",
        ),
        { statusCode: 401 },
      );
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      // Fastify honors forwarded host only when the connecting proxy is trusted.
      const host = req.host;
      let sameHost = true;
      if (origin) {
        try {
          sameHost = new URL(origin).host.toLowerCase() === host.toLowerCase();
        } catch {
          sameHost = false;
        }
      }
      if (req.headers["sec-fetch-site"] === "cross-site" || !sameHost)
        throw Object.assign(
          new Error("This request must come from the C Forge site."),
          { statusCode: 403 },
        );
    }
  });
  const limit = (req: import("fastify").FastifyRequest, username: string) => {
    rateLimit(
      ctx,
      "auth-global",
      60,
      60000,
      "Sign-in is busy. Try again in a minute.",
    );
    rateLimit(
      ctx,
      "auth-ip:" + clientIdentity(ctx, req),
      20,
      60000,
      "Too many sign-in attempts. Try again in a minute.",
    );
    rateLimit(
      ctx,
      "auth-name:" + hashToken(username.toLowerCase()),
      12,
      60000,
      "Too many sign-in attempts. Try again in a minute.",
    );
  };
  // Two concurrent Argon2 operations bound native memory while preserving its cost.
  let activeHashes = 0;
  async function passwordWork<T>(operation: () => Promise<T>): Promise<T> {
    if (activeHashes >= 2)
      throw Object.assign(new Error("Sign-in is busy. Try again shortly."), {
        statusCode: 429,
      });
    activeHashes++;
    try {
      return await operation();
    } finally {
      activeHashes--;
    }
  }
  const hashPassword = (password: string) =>
    passwordWork(() =>
      argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      }),
    );
  const dummyHash = await argon2.hash(randomBytes(32).toString("base64url"), {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const credentials = z
    .object({
      username: z
        .string()
        .min(3)
        .max(32)
        .regex(/^[a-zA-Z0-9_.-]+$/),
      password: z.string().min(12).max(128),
    })
    .strict();
  async function session(
    reply: import("fastify").FastifyReply,
    accountId: string,
  ) {
    const token = randomBytes(32).toString("base64url");
    const date = now();
    const expires = new Date(Date.now() + 14 * 86400000).toISOString();
    const id = randomUUID();
    store.run(
      "INSERT INTO sessions VALUES (?,?,?,?,?)",
      id,
      accountId,
      hashToken(token),
      date,
      expires,
    );
    reply.setCookie(ctx.cookieName, token, {
      path: ctx.cookiePath,
      httpOnly: true,
      secure: ctx.secureCookies,
      sameSite: "lax",
      maxAge: 14 * 86400,
    });
    return { id: accountId };
  }
  app.get("/api/auth/status", async () => ({
    setupRequired:
      !ctx.publicRegistration && !store.get("SELECT id FROM owner"),
    registrationOpen: ctx.publicRegistration,
    bootstrapConfigured: !!ctx.bootstrapSecret,
  }));
  app.post("/api/auth/setup", async (req, reply) => {
    const b = parse(
      credentials.extend({ bootstrapSecret: z.string().min(16).max(256) }),
      req.body,
    );
    limit(req, b.username);
    if (
      !ctx.bootstrapSecret ||
      !safeEqual(b.bootstrapSecret, ctx.bootstrapSecret)
    )
      throw Object.assign(new Error("The bootstrap secret is incorrect."), {
        statusCode: 403,
      });
    const hash = await hashPassword(b.password);
    store.transaction(() => {
      if (store.get("SELECT id FROM owner WHERE id='owner'"))
        throw Object.assign(
          new Error("The owner is already configured. Sign in instead."),
          { statusCode: 409 },
        );
      store.run(
        "INSERT INTO owner(id,username,password_hash,created_at,role) VALUES (?,?,?,?,'admin')",
        "owner",
        b.username,
        hash,
        now(),
      );
      store.run(
        "INSERT INTO learner(owner_id,preferences) VALUES (?,?)",
        "owner",
        JSON.stringify(defaultPreferences),
      );
    });
    return session(reply, "owner");
  });
  app.post("/api/auth/register", async (req, reply) => {
    if (!ctx.publicRegistration)
      throw Object.assign(
        new Error("Registration is closed on this installation."),
        { statusCode: 403 },
      );
    const b = parse(credentials, req.body);
    limit(req, b.username);
    rateLimit(
      ctx,
      "signup-global",
      30,
      3600000,
      "Account creation is busy. Try again later.",
    );
    rateLimit(
      ctx,
      "signup-ip:" + clientIdentity(ctx, req),
      10,
      3600000,
      "Too many new accounts from this connection. Try again later.",
    );
    if (store.get<{ n: number }>("SELECT count(*) AS n FROM owner")!.n >= 500)
      throw Object.assign(
        new Error("This study server has reached its account capacity."),
        { statusCode: 503 },
      );
    const hash = await hashPassword(b.password);
    const id = randomUUID();
    store.transaction(() => {
      if (store.get<{ n: number }>("SELECT count(*) AS n FROM owner")!.n >= 500)
        throw Object.assign(
          new Error("This study server has reached its account capacity."),
          { statusCode: 503 },
        );
      if (
        store.get(
          "SELECT id FROM owner WHERE username=? COLLATE NOCASE",
          b.username,
        )
      )
        throw Object.assign(
          new Error(
            "That username is already in use. Choose another or sign in.",
          ),
          { statusCode: 409 },
        );
      store.run(
        "INSERT INTO owner(id,username,password_hash,created_at,role) VALUES (?,?,?,?,'learner')",
        id,
        b.username,
        hash,
        now(),
      );
      store.run(
        "INSERT INTO learner(owner_id,preferences) VALUES (?,?)",
        id,
        JSON.stringify(defaultPreferences),
      );
    });
    return session(reply, id);
  });
  app.post("/api/auth/login", async (req, reply) => {
    const b = parse(credentials, req.body);
    limit(req, b.username);
    const user = store.get<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM owner WHERE username=? COLLATE NOCASE",
      b.username,
    );
    const valid = await passwordWork(() =>
      argon2.verify(user?.password_hash ?? dummyHash, b.password),
    );
    if (!user || !valid)
      throw Object.assign(new Error("Username or password is incorrect."), {
        statusCode: 401,
      });
    return session(reply, user.id);
  });
  app.get("/api/auth/me", async (req) => {
    requireOwner(req);
    const owner = store.get<{ username: string }>(
      "SELECT username FROM owner WHERE id=?",
      req.ownerId!,
    );
    return { id: req.ownerId, username: owner!.username };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    requireOwner(req);
    store.run("DELETE FROM sessions WHERE id=?", req.sessionId!);
    reply.clearCookie(ctx.cookieName, {
      path: ctx.cookiePath,
      secure: ctx.secureCookies,
      httpOnly: true,
      sameSite: "lax",
    });
    return { ok: true };
  });
  app.get("/api/auth/sessions", async (req) => {
    const owner = requireOwner(req);
    return store
      .all<{ id: string; created_at: string; expires_at: string }>(
        "SELECT id,created_at,expires_at FROM sessions WHERE owner_id=? AND expires_at>? ORDER BY created_at DESC",
        owner,
        now(),
      )
      .map((s) => ({
        id: s.id,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        current: s.id === req.sessionId,
      }));
  });
  app.delete<{ Params: { id: string } }>(
    "/api/auth/sessions/:id",
    async (req, reply) => {
      const owner = requireOwner(req);
      store.run(
        "DELETE FROM sessions WHERE owner_id=? AND id=?",
        owner,
        req.params.id,
      );
      if (req.params.id === req.sessionId)
        reply.clearCookie(ctx.cookieName, {
          path: ctx.cookiePath,
          secure: ctx.secureCookies,
          httpOnly: true,
          sameSite: "lax",
        });
      return { ok: true };
    },
  );
}
