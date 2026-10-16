import { z } from "zod";
export const filename = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  .refine(
    (n) =>
      !n.includes("..") &&
      !n.startsWith("__forge_") &&
      (/\.(c|h|cpp|hpp|txt)$/.test(n) || n === "Makefile"),
    "Use a simple .c, .h, .cpp, .hpp, .txt filename or Makefile.",
  );
export const files = z
  .record(
    filename,
    z
      .string()
      .max(50000)
      .refine((s) => !s.includes("\0"), "NUL text is not accepted."),
  )
  .refine(
    (f) =>
      Object.keys(f).length >= 1 &&
      Object.keys(f).length <= 12 &&
      Object.values(f).reduce((n, s) => n + Buffer.byteLength(s), 0) <= 100000,
    "Limit: 12 files and 100 KB total.",
  );
export const draftData = z
  .object({
    files,
    stdin: z.string().max(8192),
    activeFile: filename,
    step: z.number().int().min(0).max(8),
    cursor: z
      .object({
        anchor: z.number().int().min(0).max(100000),
        head: z.number().int().min(0).max(100000),
      })
      .strict(),
    scrollAnchor: z.number().min(0).max(100000),
    paneSize: z.number().min(25).max(75),
    notes: z.string().max(20000),
    bookmark: z.boolean(),
    prediction: z.string().max(2000).optional(),
    sanitize: z.boolean().optional(),
    mobileTab: z.enum(["learn", "code", "results"]).optional(),
  })
  .strict()
  .refine(
    (d) => Object.hasOwn(d.files, d.activeFile),
    "Active file must exist.",
  );
export const draftSave = z
  .object({
    revision: z.number().int().min(0),
    mutationId: z.string().uuid(),
    contentVersion: z.number().int().positive(),
    data: draftData,
  })
  .strict();
export const preferences = z
  .object({
    courseId: z.enum(["c17", "cpp20"]).optional(),
    theme: z.enum(["dark", "light", "system"]),
    proseSize: z.number().min(16).max(24),
    editorSize: z.number().min(12).max(24),
    lineSpacing: z.number().min(1.4).max(2.2),
    reducedMotion: z.boolean(),
    focusMode: z.boolean(),
    sessionMinutes: z.union([z.literal(5), z.literal(15), z.literal(30)]),
    timezone: z
      .string()
      .max(100)
      .refine((t) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: t });
          return true;
        } catch {
          return false;
        }
      }, "Use an IANA timezone such as Asia/Shanghai."),
  })
  .strict();
export const outcome = z
  .object({
    state: z.enum([
      "queued",
      "compiling",
      "running",
      "succeeded",
      "failed",
      "timed_out",
      "cancelled",
      "infrastructure_error",
    ]),
    stdout: z.string().max(70000),
    stderr: z.string().max(70000),
    diagnostics: z.string().max(70000),
    exitCode: z.number().int().nullable(),
    elapsedMs: z.number().nonnegative(),
    truncated: z.boolean(),
    signal: z.string().optional(),
    passed: z.boolean().optional(),
    feedback: z.string().max(5000).optional(),
    casesPassed: z.number().int().optional(),
    casesTotal: z.number().int().optional(),
  })
  .strict();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw Object.assign(
      new Error(
        r.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      ),
      { statusCode: 400 },
    );
  return r.data;
}
