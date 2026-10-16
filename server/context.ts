import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Curriculum, Exercise, Lesson } from "../shared/content.js";
import type { Store } from "./db.js";
export interface Context {
  app: FastifyInstance;
  store: Store;
  content: Curriculum;
  exercise: (id: string) => Exercise;
  lesson: (id: string) => Lesson;
  bootstrapSecret: string;
  runnerSecret: string;
  publicRegistration: boolean;
  siteProxySecret: string;
  secureCookies: boolean;
  cookieName: string;
  cookiePath: string;
}
declare module "fastify" {
  interface FastifyRequest {
    ownerId: string | null;
    sessionId: string | null;
    accountRole: "admin" | "learner" | null;
  }
}
// Historical owner_id columns now contain the authenticated learner account ID.
export function requireOwner(req: FastifyRequest) {
  if (!req.ownerId)
    throw Object.assign(new Error("Sign in to access your account."), {
      statusCode: 401,
    });
  return req.ownerId;
}
export function notFound(label: string): never {
  throw Object.assign(new Error(`${label} not found.`), { statusCode: 404 });
}
export const now = () => new Date().toISOString();
