import { createHash, timingSafeEqual } from "node:crypto";
export const hashToken = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
