import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { isIP } from "node:net";
import type { Context } from "./context.js";
import { safeEqual } from "./security.js";

/** Trust a visitor IP only from the authenticated server-to-server Site proxy. */
export function clientIdentity(ctx: Context, req: FastifyRequest) {
  const proxy = req.headers["x-cforge-proxy-secret"];
  const forwarded = req.headers["x-cforge-client-ip"];
  const ip =
    ctx.siteProxySecret &&
    typeof proxy === "string" &&
    safeEqual(proxy, ctx.siteProxySecret) &&
    typeof forwarded === "string" &&
    isIP(forwarded)
      ? forwarded
      : req.ip;
  return createHash("sha256").update(ip).digest("hex");
}
export function rateLimit(
  ctx: Context,
  key: string,
  maximum: number,
  windowMs: number,
  message: string,
) {
  const stamp = Date.now();
  const allowed = ctx.store.transaction(() => {
    ctx.store.run("DELETE FROM auth_rate_limits WHERE expires_at<=?", stamp);
    const row = ctx.store.get<{ count: number }>(
      "SELECT count FROM auth_rate_limits WHERE key=?",
      key,
    );
    if (row && row.count >= maximum) return false;
    ctx.store.run(
      "INSERT INTO auth_rate_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      key,
      1,
      stamp + windowMs,
    );
    return true;
  });
  if (!allowed) throw Object.assign(new Error(message), { statusCode: 429 });
}
