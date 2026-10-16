import { openDB, type DBSchema } from "idb";
import type { Draft, DraftConflict, DraftSave } from "../../shared/app";

// BASE_URL is replaced by Vite; the root fallback also supports Node unit imports.
export const appBasePath = import.meta.env?.BASE_URL ?? "/";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(
      typeof detail === "object" && detail !== null && "error" in detail
        ? String(detail.error)
        : `Request failed (${status})`,
    );
    this.name = "ApiError";
  }
}

export interface LocalDraftRecord {
  key: string;
  ownerId: string;
  tabId: string;
  exerciseId: string;
  draft: Draft;
  pending: boolean;
  sequence: number;
  touchedAt: number;
  mutation?: DraftSave;
  conflict?: DraftConflict;
}

export interface LocalHistoryEntry {
  id: string;
  draft: Draft;
  reason: string;
  createdAt: string;
  local: true;
}

interface LocalDatabase extends DBSchema {
  drafts: {
    key: string;
    value: LocalDraftRecord;
    indexes: { owner: string; exercise: [string, string] };
  };
  content: {
    key: string;
    value: {
      key: string;
      ownerId: string;
      path: string;
      value: unknown;
      openedAt: number;
    };
    indexes: { owner: string };
  };
  history: {
    key: string;
    value: LocalHistoryEntry & { ownerId: string; exerciseId: string };
    indexes: { exercise: [string, string] };
  };
}

let ownerId: string | null = null;
let localGeneration = 0;
const ownerListeners = new Set<() => void>();
let database: ReturnType<typeof openDB<LocalDatabase>> | undefined;

function db() {
  const databaseName =
    appBasePath === "/"
      ? "c-forge-recovery-v1"
      : `c-forge-recovery-v1:${appBasePath}`;
  database ??= openDB<LocalDatabase>(databaseName, 2, {
    upgrade(store, oldVersion) {
      if (oldVersion < 1) {
        const drafts = store.createObjectStore("drafts", { keyPath: "key" });
        drafts.createIndex("owner", "ownerId");
        drafts.createIndex("exercise", ["ownerId", "exerciseId"]);
        const content = store.createObjectStore("content", { keyPath: "key" });
        content.createIndex("owner", "ownerId");
      }
      if (oldVersion < 2) {
        const history = store.createObjectStore("history", { keyPath: "id" });
        history.createIndex("exercise", ["ownerId", "exerciseId"]);
      }
    },
    blocking() {
      void database?.then((store) => store.close());
      database = undefined;
    },
  });
  return database;
}

export function getLocalOwner() {
  return ownerId;
}

export function setLocalOwner(id: string | null) {
  if (id === ownerId) return;
  ownerId = id;
  localGeneration += 1;
  ownerListeners.forEach((listener) => listener());
}

export function subscribeLocalOwner(listener: () => void) {
  ownerListeners.add(listener);
  return () => {
    ownerListeners.delete(listener);
  };
}

/** Clear recovery on explicit logout/import. No session tokens are stored in IndexedDB. */
export async function purgeLocal(options: { preserveAccount?: boolean } = {}) {
  const preserved = options.preserveAccount ? ownerId : null;
  if (!options.preserveAccount) setLocalOwner(null);
  const store = await db();
  const transaction = store.transaction(
    ["drafts", "content", "history"],
    "readwrite",
  );
  if (preserved) {
    const drafts = await transaction
      .objectStore("drafts")
      .index("owner")
      .getAllKeys(preserved);
    const content = await transaction
      .objectStore("content")
      .index("owner")
      .getAllKeys(preserved);
    const history = await transaction.objectStore("history").getAll();
    await Promise.all([
      ...drafts.map((key) => transaction.objectStore("drafts").delete(key)),
      ...content.map((key) => transaction.objectStore("content").delete(key)),
      ...history
        .filter((item) => item.ownerId === preserved)
        .map((item) => transaction.objectStore("history").delete(item.id)),
    ]);
  } else
    await Promise.all([
      transaction.objectStore("drafts").clear(),
      transaction.objectStore("content").clear(),
      transaction.objectStore("history").clear(),
    ]);
  await transaction.done;
}

/** Explicit snapshots, including offline pre-reset copies; never auto-restored as drafts. */
export async function readLocalHistory(
  exerciseId: string,
): Promise<LocalHistoryEntry[]> {
  const owner = ownerId;
  const generation = localGeneration;
  if (!owner) return [];
  const store = await db();
  const records = await store.getAllFromIndex("history", "exercise", [
    owner,
    exerciseId,
  ]);
  if (owner !== ownerId || generation !== localGeneration) return [];
  return records
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ id, draft, reason, createdAt, local }) => ({
      id,
      draft,
      reason,
      createdAt,
      local,
    }));
}

function isCacheable(path: string) {
  return /^\/api\/(course|reference|lessons\/[a-z0-9-]+|projects\/[a-z0-9-]+)$/.test(
    path,
  );
}

export async function cacheContent(path: string, value: unknown) {
  const currentOwner = ownerId;
  if (!currentOwner || !isCacheable(path)) return;
  const generation = localGeneration;
  const store = await db();
  if (ownerId !== currentOwner || generation !== localGeneration) return;
  await store.put("content", {
    key: `${currentOwner}:${path}`,
    ownerId: currentOwner,
    path,
    value,
    openedAt: Date.now(),
  });
}

export async function readCachedContent<T>(
  path: string,
): Promise<T | undefined> {
  const currentOwner = ownerId;
  if (!currentOwner || !isCacheable(path)) return undefined;
  const store = await db();
  const record = await store.get("content", `${currentOwner}:${path}`);
  if (currentOwner !== ownerId) return undefined;
  return record?.value as T | undefined;
}

/** Same-origin only: the browser sends the HttpOnly session cookie. Runs are never queued. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/api/") || path.startsWith("//")) {
    throw new Error("API requests must use a same-origin /api/ path.");
  }
  const publicPath = [
    "/api/health",
    "/api/auth/me",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/setup",
  ].includes(path);
  if (!publicPath && !ownerId)
    throw new ApiError(401, {
      error:
        "Sign in again before continuing. Your device drafts remain scoped to their own account.",
    });
  const method = (init.method ?? "GET").toUpperCase();
  const requestGeneration = localGeneration;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (
    ownerId &&
    ![
      "/api/auth/me",
      "/api/auth/status",
      "/api/auth/login",
      "/api/auth/register",
      "/api/auth/setup",
    ].includes(path)
  )
    headers.set("x-cforge-account-id", ownerId);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(
      `${appBasePath === "/" ? "" : appBasePath.slice(0, -1)}${path}`,
      {
        ...init,
        headers,
        credentials: "same-origin",
      },
    );
  } catch (error) {
    if (method === "GET" && !init.signal?.aborted) {
      try {
        const cached = await readCachedContent<T>(path);
        if (cached !== undefined) return cached;
      } catch {
        /* Unavailable device storage does not hide the original network error. */
      }
    }
    throw error;
  }
  const raw = await response.text();
  let detail: unknown;
  try {
    detail = raw ? JSON.parse(raw) : undefined;
  } catch {
    detail = { error: "The server returned an unreadable response." };
    if (response.ok) throw new ApiError(502, detail);
  }
  if (!response.ok) {
    if (response.status === 401 && requestGeneration === localGeneration)
      setLocalOwner(null);
    throw new ApiError(response.status, detail);
  }
  if (
    path === "/api/auth/me" &&
    detail &&
    typeof detail === "object" &&
    "id" in detail
  ) {
    setLocalOwner(String(detail.id));
  }
  if (method === "GET" && isCacheable(path)) {
    void cacheContent(path, detail).catch(() => undefined);
  }
  return detail as T;
}

export function recoveryStore(
  owner: string,
  tabId: string,
  exerciseId: string,
) {
  const key = `${owner}:${tabId}:${exerciseId}`;
  const ownerGeneration = localGeneration;
  return {
    async load(): Promise<LocalDraftRecord | null> {
      const store = await db();
      const records = await store.getAllFromIndex("drafts", "exercise", [
        owner,
        exerciseId,
      ]);
      const own = records.find((record) => record.key === key);
      const pending = records
        .filter((record) => record.pending)
        .sort((a, b) => b.touchedAt - a.touchedAt);
      return (
        pending[0] ??
        own ??
        records.sort(
          (a, b) =>
            b.draft.revision - a.draft.revision || b.touchedAt - a.touchedAt,
        )[0] ??
        null
      );
    },
    async write(
      record: Omit<
        LocalDraftRecord,
        "key" | "ownerId" | "tabId" | "exerciseId"
      >,
    ) {
      // A late write from a disposed/logged-out controller must not recreate cleared data.
      if (ownerId !== owner || ownerGeneration !== localGeneration)
        throw new Error(
          "The account session changed. Sign in to resume saving.",
        );
      const generation = localGeneration;
      const store = await db();
      if (
        ownerId !== owner ||
        generation !== localGeneration ||
        ownerGeneration !== localGeneration
      ) {
        throw new Error(
          "The account session changed. Sign in to resume saving.",
        );
      }
      const transaction = store.transaction("drafts", "readwrite");
      await transaction.store.put({
        ...record,
        key,
        ownerId: owner,
        tabId,
        exerciseId,
      });
      // Keep twenty acknowledged recovery snapshots per exercise. Pending/conflicted
      // work is retained until explicitly synced/resolved rather than evicted silently.
      const rows = await transaction.store
        .index("exercise")
        .getAll([owner, exerciseId]);
      const archived = rows
        .filter((row) => !row.pending)
        .sort((a, b) => b.touchedAt - a.touchedAt);
      await Promise.all(
        archived.slice(20).map((row) => transaction.store.delete(row.key)),
      );
      await transaction.done;
    },
    async acknowledge(data: Draft["data"]) {
      if (ownerId !== owner || ownerGeneration !== localGeneration) return;
      const store = await db();
      const transaction = store.transaction("drafts", "readwrite");
      const records = await transaction.store
        .index("exercise")
        .getAll([owner, exerciseId]);
      const serialized = JSON.stringify(data);
      await Promise.all(
        records.map((record) => {
          if (
            record.pending &&
            JSON.stringify(record.draft.data) === serialized
          ) {
            return transaction.store.put({
              ...record,
              pending: false,
              mutation: undefined,
              conflict: undefined,
            });
          }
          return Promise.resolve();
        }),
      );
      await transaction.done;
    },
    async archive(draft: Draft, reason: string) {
      if (ownerId !== owner || ownerGeneration !== localGeneration) {
        throw new Error(
          "The account session changed. Sign in to preserve a recovery copy.",
        );
      }
      const store = await db();
      if (ownerId !== owner || ownerGeneration !== localGeneration) {
        throw new Error(
          "The account session changed. Sign in to preserve a recovery copy.",
        );
      }
      const transaction = store.transaction("history", "readwrite");
      const entry: LocalHistoryEntry & { ownerId: string; exerciseId: string } =
        {
          id: crypto.randomUUID(),
          draft: structuredClone(draft),
          reason: reason.slice(0, 100),
          createdAt: new Date().toISOString(),
          local: true,
          ownerId: owner,
          exerciseId,
        };
      await transaction.store.add(entry);
      const records = await transaction.store
        .index("exercise")
        .getAll([owner, exerciseId]);
      records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      await Promise.all(
        records.slice(20).map((record) => transaction.store.delete(record.id)),
      );
      await transaction.done;
    },
  };
}
